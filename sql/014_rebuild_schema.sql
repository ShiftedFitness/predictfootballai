-- ============================================================
-- 014_rebuild_schema.sql   —   DRAFT, NOT YET RUN
--
-- The target schema for the FBref rebuild. Creates everything alongside the
-- live tables with a _v2 suffix, so the site keeps serving throughout. The
-- swap is section 6 and is deliberately left commented out — it runs only
-- after the diff has been reviewed.
--
-- Two ideas underpin all of it:
--
--   1. IDENTITY COMES FROM FBREF, NOT FROM A STRING WE BUILD.
--      player_uid is `name|nationality|birth_year`, derived from cells that
--      contain a flag icon rendered as text. That is why the database holds
--      "mohamed salah|eg egy|1992" beside "mohamed salah|egy|1992", a club
--      called "eng Liverpool", and — measured on 2024-25 — Jarrod Bowen with
--      a whole Premier League season missing. FBref's own 8-hex player and
--      squad ids are stable, spelling-independent and already in every page
--      we scrape.
--
--   2. FACTS AND ANSWERS ARE DIFFERENT TABLES.
--      One fact table that the ingest writes, and rollups rebuilt from it
--      that the games read. Today every game pulls a whole division across
--      the wire and aggregates it in JavaScript.
--
-- Volumes for sizing: ~36k players, ~550 clubs, ~225k season rows after the
-- EFL lands. Small. Nothing here needs partitioning or anything exotic.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. COMPETITIONS — add the shape the games need to ask about
--    tier is what makes "all English tiers" one query instead of four.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS country      text;
ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS tier         smallint;
ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS comp_type    text
  CHECK (comp_type IN ('league', 'cup', 'continental'));
ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS fbref_comp_id integer;

-- NOTE THE COLLISION. Our ids and FBref's are different numbering systems
-- that overlap: our 10 is the EFL Cup, FBref's 10 is the Championship; our 8
-- is the Championship, FBref's 8 is the Champions League. Nothing outside
-- this table may assume they correspond.
UPDATE public.competitions SET country='ENG', tier=1,    comp_type='league',      fbref_comp_id=9   WHERE competition_id=7;
UPDATE public.competitions SET country='ENG', tier=2,    comp_type='league',      fbref_comp_id=10  WHERE competition_id=8;
UPDATE public.competitions SET country='ENG', tier=NULL, comp_type='cup',         fbref_comp_id=514 WHERE competition_id=4;
UPDATE public.competitions SET country='ENG', tier=NULL, comp_type='cup',         fbref_comp_id=690 WHERE competition_id=10;
UPDATE public.competitions SET country='ENG', tier=NULL, comp_type='cup',         fbref_comp_id=602 WHERE competition_id=5;
UPDATE public.competitions SET country='EUR', tier=NULL, comp_type='continental', fbref_comp_id=8   WHERE competition_id=2;
UPDATE public.competitions SET country='ESP', tier=1,    comp_type='league',      fbref_comp_id=12  WHERE competition_id=1;
UPDATE public.competitions SET country='ITA', tier=1,    comp_type='league',      fbref_comp_id=11  WHERE competition_id=3;
UPDATE public.competitions SET country='GER', tier=1,    comp_type='league',      fbref_comp_id=20  WHERE competition_id=9;
UPDATE public.competitions SET country='FRA', tier=1,    comp_type='league',      fbref_comp_id=13  WHERE competition_id=6;

-- The two genuinely new divisions. (The Championship already exists as 8 —
-- it was in the database all along, just stopping at 2024.)
INSERT INTO public.competitions (competition_id, competition_name, competition_group, country, tier, comp_type, fbref_comp_id)
VALUES (11, 'League One', 'league', 'ENG', 3, 'league', 15),
       (12, 'League Two', 'league', 'ENG', 4, 'league', 16)
ON CONFLICT (competition_id) DO UPDATE
  SET country = EXCLUDED.country, tier = EXCLUDED.tier,
      comp_type = EXCLUDED.comp_type, fbref_comp_id = EXCLUDED.fbref_comp_id;

CREATE INDEX IF NOT EXISTS idx_comp_tier ON public.competitions(country, tier);


-- ────────────────────────────────────────────────────────────
-- 2. PLAYERS — a surrogate key, anchored on FBref's id
--    player_uid survives as a display/compatibility column. It is no longer
--    load-bearing, which is the entire point.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.players_v2 (
  player_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fbref_player_id  text NOT NULL UNIQUE,          -- e.g. 'f586779e'
  player_name      text NOT NULL,
  nationality      char(3),                       -- 'ENG', from the country link
  birth_year       smallint,
  position_bucket  text,                          -- most common across seasons
  player_uid       text,                          -- legacy, non-unique, display only
  first_seen       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pv2_name ON public.players_v2 (lower(player_name));
CREATE INDEX IF NOT EXISTS idx_pv2_uid  ON public.players_v2 (player_uid);
CREATE INDEX IF NOT EXISTS idx_pv2_nat  ON public.players_v2 (nationality);


-- ────────────────────────────────────────────────────────────
-- 3. CLUBS — same treatment.
--    club_name comes from the squad LINK, not the cell: the cell carries
--    FBref's short form ("Newcastle") while the link carries the canonical
--    one ("Newcastle United"). Mixing the two is how the live database ended
--    up holding both spellings of eleven clubs.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.clubs_v2 (
  club_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fbref_squad_id  text NOT NULL UNIQUE,           -- e.g. 'b2b47a98'
  club_name       text NOT NULL,                  -- 'Newcastle United'
  club_name_short text,                           -- 'Newcastle', for display
  country         char(3),
  first_seen      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cv2_name ON public.clubs_v2 (lower(club_name));


-- ────────────────────────────────────────────────────────────
-- 4. THE FACT TABLE — one table, not two.
--
--    The historical/current split existed only because two pipelines wrote
--    them. One pipeline means one table, and every `UNION ALL` in the
--    codebase disappears with it.
--
--    The primary key is what makes a mid-season transfer work: a player who
--    moves within a division gets one row per club, sharing a player_id, so
--    his career still aggregates. Verified on real data — 12 such players in
--    the Premier League in 2024-25, 34 in League One in 2025-26, no key
--    collisions and no combined "2 Clubs" row to double-count.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.player_season_stats_v2 (
  player_id         bigint   NOT NULL REFERENCES public.players_v2(player_id),
  club_id           bigint   NOT NULL REFERENCES public.clubs_v2(club_id),
  competition_id    integer  NOT NULL REFERENCES public.competitions(competition_id),
  season_start_year smallint NOT NULL,
  season_label      text     NOT NULL,            -- '2024/25'

  position_raw      text,
  position_bucket   text,
  age               smallint,

  appearances       smallint NOT NULL DEFAULT 0,  -- FBref MP. The stat everything is built on.
  starts            smallint,
  sub_appearances   smallint,
  minutes           integer,
  goals             smallint NOT NULL DEFAULT 0,
  assists           smallint,
  pens_scored       smallint,
  pens_attempted    smallint,
  cards_yellow      smallint,
  cards_red         smallint,

  goals_against           smallint,               -- keepers
  clean_sheets            smallint,
  shots_on_target_against smallint,
  saves                   smallint,
  wins                    smallint,
  draws                   smallint,
  losses                  smallint,

  tackles_won             smallint,               -- defensive, recent seasons only
  interceptions           smallint,
  tackles_interceptions   smallint,

  ingested_at       timestamptz DEFAULT now(),

  PRIMARY KEY (player_id, club_id, competition_id, season_start_year)
);

-- Index for the questions the games actually ask.
CREATE INDEX IF NOT EXISTS idx_pss2_comp_season ON public.player_season_stats_v2 (competition_id, season_start_year);
CREATE INDEX IF NOT EXISTS idx_pss2_club_season ON public.player_season_stats_v2 (club_id, season_start_year);
CREATE INDEX IF NOT EXISTS idx_pss2_player      ON public.player_season_stats_v2 (player_id);


-- ────────────────────────────────────────────────────────────
-- 5. THE READ MODEL — rebuilt after every ingest, never edited.
--
--    Names are denormalised in so a read needs no joins. That makes them
--    wrong the moment an upstream name changes, which is exactly why they
--    are regenerated wholesale rather than maintained by trigger. Cheap to
--    rebuild at this size; never a source of truth.
-- ────────────────────────────────────────────────────────────

-- 5a. player x club x competition — Bullseye, XI, the quiz
CREATE TABLE IF NOT EXISTS public.agg_player_club_comp (
  player_id        bigint   NOT NULL,
  club_id          bigint   NOT NULL,
  competition_id   integer  NOT NULL,
  player_name      text     NOT NULL,
  nationality      char(3),
  position_bucket  text,
  club_name        text     NOT NULL,
  competition_name text     NOT NULL,
  country          char(3),
  tier             smallint,
  appearances      integer  NOT NULL,
  goals            integer  NOT NULL,
  assists          integer,
  minutes          integer,
  seasons          smallint NOT NULL,
  first_season     smallint,
  last_season      smallint,
  PRIMARY KEY (player_id, club_id, competition_id)
);

CREATE INDEX IF NOT EXISTS idx_apcc_comp_apps ON public.agg_player_club_comp (competition_id, appearances DESC);
CREATE INDEX IF NOT EXISTS idx_apcc_club_apps ON public.agg_player_club_comp (club_id, appearances DESC);
CREATE INDEX IF NOT EXISTS idx_apcc_tier      ON public.agg_player_club_comp (country, tier);
CREATE INDEX IF NOT EXISTS idx_apcc_name      ON public.agg_player_club_comp (lower(player_name));

-- 5b. player x club, competitions merged — "Sunderland all-time"
CREATE TABLE IF NOT EXISTS public.agg_player_club (
  player_id     bigint   NOT NULL,
  club_id       bigint   NOT NULL,
  player_name   text     NOT NULL,
  nationality   char(3),
  club_name     text     NOT NULL,
  appearances   integer  NOT NULL,
  goals         integer  NOT NULL,
  assists       integer,
  minutes       integer,
  competitions  smallint NOT NULL,
  seasons       smallint NOT NULL,
  first_season  smallint,
  last_season   smallint,
  PRIMARY KEY (player_id, club_id)
);

CREATE INDEX IF NOT EXISTS idx_apc_club_apps ON public.agg_player_club (club_id, appearances DESC);
CREATE INDEX IF NOT EXISTS idx_apc_player    ON public.agg_player_club (player_id);

-- 5c. club x competition x season — "Sunderland, League One, 2018-19"
CREATE TABLE IF NOT EXISTS public.agg_club_season (
  club_id           bigint   NOT NULL,
  competition_id    integer  NOT NULL,
  season_start_year smallint NOT NULL,
  club_name         text     NOT NULL,
  competition_name  text     NOT NULL,
  tier              smallint,
  squad_size        smallint NOT NULL,
  goals             integer,
  PRIMARY KEY (club_id, competition_id, season_start_year)
);

CREATE INDEX IF NOT EXISTS idx_acs_club   ON public.agg_club_season (club_id, season_start_year DESC);
CREATE INDEX IF NOT EXISTS idx_acs_season ON public.agg_club_season (competition_id, season_start_year DESC);


-- 5d. Rebuild them all. Called at the end of every ingest.
CREATE OR REPLACE FUNCTION public.rebuild_aggregates()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE public.agg_player_club_comp;
  INSERT INTO public.agg_player_club_comp
  SELECT s.player_id, s.club_id, s.competition_id,
         p.player_name, p.nationality, p.position_bucket,
         c.club_name, k.competition_name, k.country, k.tier,
         SUM(s.appearances), SUM(s.goals), SUM(s.assists), SUM(s.minutes),
         COUNT(DISTINCT s.season_start_year),
         MIN(s.season_start_year), MAX(s.season_start_year)
  FROM public.player_season_stats_v2 s
  JOIN public.players_v2  p USING (player_id)
  JOIN public.clubs_v2    c USING (club_id)
  JOIN public.competitions k USING (competition_id)
  GROUP BY s.player_id, s.club_id, s.competition_id,
           p.player_name, p.nationality, p.position_bucket,
           c.club_name, k.competition_name, k.country, k.tier;

  TRUNCATE public.agg_player_club;
  INSERT INTO public.agg_player_club
  SELECT s.player_id, s.club_id, p.player_name, p.nationality, c.club_name,
         SUM(s.appearances), SUM(s.goals), SUM(s.assists), SUM(s.minutes),
         COUNT(DISTINCT s.competition_id),
         COUNT(DISTINCT s.season_start_year),
         MIN(s.season_start_year), MAX(s.season_start_year)
  FROM public.player_season_stats_v2 s
  JOIN public.players_v2 p USING (player_id)
  JOIN public.clubs_v2   c USING (club_id)
  GROUP BY s.player_id, s.club_id, p.player_name, p.nationality, c.club_name;

  TRUNCATE public.agg_club_season;
  INSERT INTO public.agg_club_season
  SELECT s.club_id, s.competition_id, s.season_start_year,
         c.club_name, k.competition_name, k.tier,
         COUNT(*), SUM(s.goals)
  FROM public.player_season_stats_v2 s
  JOIN public.clubs_v2    c USING (club_id)
  JOIN public.competitions k USING (competition_id)
  GROUP BY s.club_id, s.competition_id, s.season_start_year,
           c.club_name, k.competition_name, k.tier;

  ANALYZE public.agg_player_club_comp;
  ANALYZE public.agg_player_club;
  ANALYZE public.agg_club_season;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 6. THE SWAP — deliberately not executed here.
--
--    Run only after the load has been diffed and reviewed. Renaming rather
--    than dropping keeps the old tables one command away for as long as we
--    want them.
-- ────────────────────────────────────────────────────────────

-- BEGIN;
--   ALTER TABLE public.players             RENAME TO players_pre_rebuild;
--   ALTER TABLE public.clubs               RENAME TO clubs_pre_rebuild;
--   ALTER TABLE public.player_season_stats RENAME TO player_season_stats_pre_rebuild;
--
--   ALTER TABLE public.players_v2             RENAME TO players;
--   ALTER TABLE public.clubs_v2               RENAME TO clubs;
--   ALTER TABLE public.player_season_stats_v2 RENAME TO player_season_stats;
--
--   -- v_all_player_season_stats was a UNION of the historical and current
--   -- tables. With one table it becomes a plain passthrough, so every query
--   -- in the codebase keeps working untouched while the games are migrated
--   -- onto the aggregates one at a time.
--   DROP VIEW IF EXISTS public.v_all_player_season_stats CASCADE;
--   CREATE VIEW public.v_all_player_season_stats AS
--     SELECT *, 'rebuilt'::text AS source FROM public.player_season_stats;
-- COMMIT;
