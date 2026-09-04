-- ============================================================
-- 015_compat_views.sql
--
-- The compatibility layer between the rebuilt tables and eleven Netlify
-- functions that still speak the old schema.
--
-- CORRECTION TO 014: that file claimed the swap was a rename and "every
-- query in the codebase keeps working untouched". That was wrong. The new
-- tables key on player_id, not player_uid; club_id 28 (Liverpool) became
-- club_id 17; and `players` no longer has a nationality_norm column. Renaming
-- alone would have broken every game on the site.
--
-- So the swap becomes: keep the new tables as the source of truth, and put
-- views in front of them wearing the old schema's clothes. The functions do
-- not change. Later, one at a time, they can be moved onto agg_* for the
-- speed win — but that becomes optional rather than urgent.
--
-- NOTHING HERE RENAMES ANYTHING. These views are created under _compat names
-- so every game can be tested against them while the live site carries on
-- serving the old tables. The rename is 016, and only after the tests pass.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. ALIAS TABLE — every old uid, including the duplicates.
--
--    Salah's three uids and Bowen's three all point at one player_id. That
--    collapsing is the fix, and this table is what lets anything still
--    holding an old uid — performance scores, a saved community game —
--    find the player it meant.
--
--    Populated from data/bridge/uid_to_player_id.json by bridge.js, not here:
--    36,000 INSERT statements do not belong in a migration.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.player_uid_aliases (
  player_uid text PRIMARY KEY,
  player_id  bigint NOT NULL REFERENCES public.players_v2(player_id),
  match_rule text,                       -- how it was matched, for auditing
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alias_player ON public.player_uid_aliases(player_id);


-- ────────────────────────────────────────────────────────────
-- 2. players — the old shape, from the new table.
--
--    The old table had nationality_raw AND nationality_norm; the new one has
--    a single clean three-letter code, so both map to it. player_uid is the
--    canonical old uid where one was matched, and a deterministic fallback
--    otherwise, because a NULL primary identifier would break every join
--    downstream for the 5,400 players who are new since the last import.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.players_compat AS
SELECT
  COALESCE(
    p.player_uid,
    lower(p.player_name) || '|' || lower(COALESCE(p.nationality, '')) || '|' ||
      COALESCE(p.birth_year::text, '')
  )                                          AS player_uid,
  p.player_name,
  p.nationality                              AS nationality_raw,
  p.nationality                              AS nationality_norm,
  p.birth_year,
  p.position_bucket,
  lower(p.player_name)                       AS normalized_player_name,
  p.first_seen                               AS created_at,
  p.player_id,                               -- new, additive
  p.fbref_player_id                          -- new, additive
FROM public.players_v2 p;


-- ────────────────────────────────────────────────────────────
-- 3. clubs — unchanged in shape, so this is nearly a passthrough.
--    The club_ids are NEW values. That is safe only because every view here
--    reads them from the same new tables: the ids move together or not at all.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.clubs_compat AS
SELECT
  c.club_id,
  c.club_name,
  c.country,
  c.first_seen        AS created_at,
  c.club_name_short,  -- new, additive
  c.fbref_squad_id    -- new, additive
FROM public.clubs_v2 c;


-- ────────────────────────────────────────────────────────────
-- 4. v_all_player_season_stats — what five of the six games read.
--
--    Was a UNION ALL of the historical and current tables. There is now one
--    table, so the union is gone; `source` is kept because callers select it.
--    is_u19/is_u21/is_35plus were NULL for every row in the old table — a
--    code comment in match_start.js says so outright — so they are emitted as
--    NULL rather than recomputed.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_all_player_season_stats_compat AS
SELECT
  NULL::bigint                               AS id,
  pc.player_uid,
  s.competition_id,
  s.club_id,
  s.season_label,
  s.season_start_year,
  s.position_raw,
  s.position_bucket,
  s.age,
  s.appearances,
  s.starts,
  s.sub_appearances,
  s.minutes,
  s.goals,
  s.assists,
  s.pens_scored,
  s.pens_attempted,
  s.goals_against,
  s.clean_sheets,
  s.shots_on_target_against,
  s.saves,
  s.wins,
  s.draws,
  s.losses,
  s.tackles_won,
  s.interceptions,
  s.tackles_interceptions,
  NULL::boolean                              AS is_u19,
  NULL::boolean                              AS is_u21,
  NULL::boolean                              AS is_35plus,
  s.ingested_at                              AS created_at,
  'rebuilt'::text                            AS source,
  s.player_id,                               -- new, additive
  s.cards_yellow,
  s.cards_red
FROM public.player_season_stats_v2 s
JOIN public.players_compat pc ON pc.player_id = s.player_id;


-- ────────────────────────────────────────────────────────────
-- 5. v_game_player_club_comp — Bullseye and the community builder.
--
--    Was a GROUP BY over the whole union, recomputed on every single call.
--    It now reads agg_player_club_comp, which is a real table rebuilt once
--    per ingest. Same columns, same meaning, one index lookup instead of a
--    full aggregation.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_game_player_club_comp_compat AS
SELECT
  pc.player_uid,
  a.player_name,
  a.nationality                              AS nationality_norm,
  a.competition_id,
  a.competition_name,
  a.club_id,
  a.club_name,
  a.appearances::integer                     AS appearances,
  a.goals::integer                           AS goals,
  a.assists::integer                         AS assists,
  a.minutes::integer                         AS minutes,
  a.seasons::integer                         AS seasons,
  a.first_season                             AS first_season_start_year,
  a.last_season                              AS last_season_start_year,
  a.player_id,                               -- new, additive
  a.tier,                                    -- new: makes cross-tier one query
  a.country
FROM public.agg_player_club_comp a
JOIN public.players_compat pc ON pc.player_id = a.player_id;


-- ────────────────────────────────────────────────────────────
-- 6. Sanity checks. Run these after applying — all three should return true.
-- ────────────────────────────────────────────────────────────

-- SELECT count(*) > 200000  AS stats_ok   FROM public.v_all_player_season_stats_compat;
-- SELECT count(*) > 100000  AS agg_ok     FROM public.v_game_player_club_comp_compat;
-- SELECT count(*) = 0       AS no_null_uid FROM public.players_compat WHERE player_uid IS NULL;
