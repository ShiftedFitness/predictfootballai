-- ============================================================
-- 006_season_support.sql
-- TeleStats Fives — multi-season support + roster flags + Picks AI
--
-- Adds:
--   1. A season registry, and a season on every matchweek
--   2. Per-season standings (archives 2025/26, opens 2026/27)
--   3. Soft-delete + bot flags on predict_users (NEVER hard-delete:
--      predict_predictions cascades and would wipe the archive)
--   4. Rationale + source on predictions, for Picks AI
--   5. A season-aware league table view
--
-- Idempotent. Runs in one transaction — if any step fails, nothing
-- is applied. Run PRESEASON_DIAGNOSTIC.sql FIRST.
--
-- >>> CHECK THESE TWO LABELS BEFORE RUNNING <<<
--     archive season = '2025/26'   (the season just finished)
--     new season     = '2026/27'   (starts Sat 22 Aug 2026)
-- ============================================================

BEGIN;

-- ── 0. Schema repair (run before anything issues an UPDATE) ─────────────
-- Migration 004 declared updated_at on these tables and attached the
-- predict_set_updated_at() trigger to them, but the live schema drifted:
-- the trigger is there and the column is not, so the very first UPDATE in
-- this migration failed with
--   ERROR 42703: record "new" has no field "updated_at"
-- Same class of drift that lost predict_matches.week_number.
--
-- Two fixes, belt and braces:
--   (a) recreate the missing columns, restoring 004's intent
--   (b) make the trigger function tolerate a table without the column, so
--       this can never take the migration down again. plpgsql resolves
--       record fields at runtime, so the guarded assignment is never
--       compiled for a table that lacks the field. jsonb_exists() is used
--       rather than the `?` operator, which some SQL clients mistake for a
--       bind-parameter placeholder.

ALTER TABLE public.predict_match_weeks
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.predict_matches
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.predict_predictions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- predict_users too: section 6d updates it, and if it carries the same
-- trigger without the column that update would fail the same way.
ALTER TABLE public.predict_users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.predict_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF jsonb_exists(to_jsonb(NEW), 'updated_at') THEN
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── 1. Season registry ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.predict_seasons (
  season      TEXT PRIMARY KEY,              -- '2026/27'
  label       TEXT NOT NULL,                 -- 'Season 2026/27'
  is_current  BOOLEAN NOT NULL DEFAULT FALSE,
  starts_on   DATE,
  ends_on     DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly one season may be current at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_predict_seasons_current
  ON public.predict_seasons (is_current) WHERE is_current;

INSERT INTO public.predict_seasons (season, label, is_current, starts_on, ends_on)
VALUES ('2025/26', 'Season 2025/26', FALSE, '2025-08-16', '2026-05-24')
ON CONFLICT (season) DO NOTHING;

INSERT INTO public.predict_seasons (season, label, is_current, starts_on, ends_on)
VALUES ('2026/27', 'Season 2026/27', TRUE,  '2026-08-22', '2027-05-23')
ON CONFLICT (season) DO UPDATE SET is_current = TRUE;


-- ── 2. Season on matchweeks ─────────────────────────────────
-- Everything that exists today belongs to the season just finished.

ALTER TABLE public.predict_match_weeks
  ADD COLUMN IF NOT EXISTS season TEXT;

UPDATE public.predict_match_weeks SET season = '2025/26' WHERE season IS NULL;

ALTER TABLE public.predict_match_weeks
  ALTER COLUMN season SET NOT NULL,
  ALTER COLUMN season SET DEFAULT '2026/27';

-- Week numbers restart at 1 each season, so the old global UNIQUE
-- on week_number has to go. Drop by lookup — the auto-generated name
-- from migration 004 may have drifted.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.predict_match_weeks'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (week_number)'
  LOOP
    EXECUTE format('ALTER TABLE public.predict_match_weeks DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped global UNIQUE constraint %', c.conname;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.predict_match_weeks'::regclass
      AND conname = 'uq_pmw_season_week'
  ) THEN
    ALTER TABLE public.predict_match_weeks
      ADD CONSTRAINT uq_pmw_season_week UNIQUE (season, week_number);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pmw_season ON public.predict_match_weeks(season);


-- ── 3. Season denormalised onto matches ─────────────────────
-- Lets the frontend filter a season without joining every time.

ALTER TABLE public.predict_matches
  ADD COLUMN IF NOT EXISTS season TEXT;

-- SCHEMA REPAIR: migration 004 declared predict_matches.week_number NOT NULL,
-- but it is absent from the live database — PredictData.seedWeek() only ever
-- wrote match_week_id, so the column was never created (or was dropped).
-- Seven serverless functions filter on it and have therefore been returning
-- nothing. Recreate it nullable, backfill below, and keep it correct with the
-- trigger further down. Same story on predict_predictions.
ALTER TABLE public.predict_matches
  ADD COLUMN IF NOT EXISTS week_number INTEGER;

ALTER TABLE public.predict_predictions
  ADD COLUMN IF NOT EXISTS week_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_pm_week_number  ON public.predict_matches(week_number);
CREATE INDEX IF NOT EXISTS idx_pp_week_number  ON public.predict_predictions(week_number);

UPDATE public.predict_matches m
SET    season = w.season
FROM   public.predict_match_weeks w
WHERE  w.id = m.match_week_id
  AND  m.season IS DISTINCT FROM w.season;

CREATE INDEX IF NOT EXISTS idx_pm_season ON public.predict_matches(season);

-- Keep it in sync automatically, and backfill week_number at the same
-- time. PredictData.seedWeek() writes match_week_id but NOT week_number,
-- while several serverless functions filter on week_number — this
-- trigger closes that gap for good.
CREATE OR REPLACE FUNCTION public.predict_match_fill_week()
RETURNS TRIGGER AS $$
DECLARE w RECORD;
BEGIN
  IF NEW.match_week_id IS NOT NULL THEN
    SELECT season, week_number INTO w
    FROM public.predict_match_weeks WHERE id = NEW.match_week_id;
    IF FOUND THEN
      NEW.season      := w.season;
      NEW.week_number := w.week_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pm_fill_week ON public.predict_matches;
CREATE TRIGGER trg_pm_fill_week
  BEFORE INSERT OR UPDATE OF match_week_id ON public.predict_matches
  FOR EACH ROW EXECUTE FUNCTION public.predict_match_fill_week();


-- ── 4. week_number on predictions ───────────────────────────
-- Same gap: PredictData.submitPicks() never writes it.

CREATE OR REPLACE FUNCTION public.predict_prediction_fill_week()
RETURNS TRIGGER AS $$
DECLARE m RECORD;
BEGIN
  IF NEW.match_id IS NOT NULL THEN
    SELECT week_number INTO m FROM public.predict_matches WHERE id = NEW.match_id;
    IF FOUND AND m.week_number IS NOT NULL THEN
      NEW.week_number := m.week_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pp_fill_week ON public.predict_predictions;
CREATE TRIGGER trg_pp_fill_week
  BEFORE INSERT OR UPDATE OF match_id ON public.predict_predictions
  FOR EACH ROW EXECUTE FUNCTION public.predict_prediction_fill_week();

-- Repair any existing rows that drifted.
UPDATE public.predict_matches m
SET    week_number = w.week_number
FROM   public.predict_match_weeks w
WHERE  w.id = m.match_week_id
  AND  m.week_number IS DISTINCT FROM w.week_number;

UPDATE public.predict_predictions p
SET    week_number = m.week_number
FROM   public.predict_matches m
WHERE  m.id = p.match_id
  AND  m.week_number IS NOT NULL
  AND  p.week_number IS DISTINCT FROM m.week_number;


-- ── 5. Roster flags ─────────────────────────────────────────
-- is_active: soft delete. Departing players keep their history.
-- is_bot:    Picks AI — excluded from reminder emails.

ALTER TABLE public.predict_users
  ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_bot        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS joined_season TEXT,
  ADD COLUMN IF NOT EXISTS left_season   TEXT;

UPDATE public.predict_users
SET joined_season = '2025/26'
WHERE joined_season IS NULL;


-- ── 6. Per-season standings ─────────────────────────────────
-- predict_users keeps mirroring the CURRENT season (so existing
-- code paths keep working untouched); this table is the real
-- per-season record and the source for the season toggle.

CREATE TABLE IF NOT EXISTS public.predict_user_seasons (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES public.predict_users(id) ON DELETE CASCADE,
  season            TEXT    NOT NULL REFERENCES public.predict_seasons(season),
  points            INTEGER NOT NULL DEFAULT 0,
  correct_results   INTEGER NOT NULL DEFAULT 0,
  incorrect_results INTEGER NOT NULL DEFAULT 0,
  full_houses       INTEGER NOT NULL DEFAULT 0,
  blanks            INTEGER NOT NULL DEFAULT 0,
  current_week      INTEGER,
  final_position    INTEGER,          -- set once the season is done
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, season)
);

CREATE INDEX IF NOT EXISTS idx_pus_season ON public.predict_user_seasons(season);

-- 6a. ARCHIVE 2025/26 from the denormalised totals on predict_users.
INSERT INTO public.predict_user_seasons
  (user_id, season, points, correct_results, incorrect_results,
   full_houses, blanks, current_week)
SELECT id, '2025/26',
       COALESCE(points, 0), COALESCE(correct_results, 0),
       COALESCE(incorrect_results, 0), COALESCE(full_houses, 0),
       COALESCE(blanks, 0), current_week
FROM public.predict_users
ON CONFLICT (user_id, season) DO NOTHING;

-- 6b. Stamp final positions for the archived season.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           ORDER BY points DESC, full_houses DESC, correct_results DESC
         ) AS pos
  FROM public.predict_user_seasons
  WHERE season = '2025/26'
)
UPDATE public.predict_user_seasons s
SET    final_position = r.pos
FROM   ranked r
WHERE  s.id = r.id AND s.final_position IS NULL;

-- 6c. Open 2026/27 with a zeroed row for every active player.
INSERT INTO public.predict_user_seasons (user_id, season)
SELECT id, '2026/27' FROM public.predict_users WHERE is_active
ON CONFLICT (user_id, season) DO NOTHING;

-- 6d. Reset the live mirror on predict_users for the new season.
--     Safe: 6a has already archived these numbers.
UPDATE public.predict_users
SET points = 0, correct_results = 0, incorrect_results = 0,
    full_houses = 0, blanks = 0, current_week = 1;


-- ── 7. Picks AI support on predictions ──────────────────────

ALTER TABLE public.predict_predictions
  ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS rationale  TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.predict_predictions'::regclass
      AND conname = 'predict_predictions_source_check'
  ) THEN
    ALTER TABLE public.predict_predictions
      ADD CONSTRAINT predict_predictions_source_check
      CHECK (source IN ('user', 'ai'));
  END IF;
END $$;


-- ── 8. Season-aware league table view ───────────────────────
-- Replaces the old all-time view over predict_users.

-- CREATE OR REPLACE VIEW can only APPEND columns — it cannot reorder or
-- rename existing ones, and 004's version of this view starts with `id`
-- where this one starts with `season`. Hence the drop.
--   ERROR 42P16: cannot change name of view column "id" to "season"
-- No CASCADE: nothing in the app reads this view (the frontend and
-- leaderboard.js both read predict_users directly), so a dependency error
-- here would be genuine news rather than something to steamroll.
DROP VIEW IF EXISTS public.predict_league_table;

CREATE VIEW public.predict_league_table AS
SELECT
  s.season,
  u.id,
  u.username,
  u.full_name,
  u.is_bot,
  u.is_active,
  s.points,
  s.correct_results,
  s.incorrect_results,
  s.full_houses,
  s.blanks,
  s.final_position,
  CASE
    WHEN (COALESCE(s.correct_results,0) + COALESCE(s.incorrect_results,0)) > 0
    THEN s.correct_results::FLOAT / (s.correct_results + s.incorrect_results)
    ELSE 0
  END AS accuracy,
  ROW_NUMBER() OVER (
    PARTITION BY s.season
    ORDER BY s.points DESC, s.full_houses DESC, s.correct_results DESC
  ) AS position
FROM public.predict_user_seasons s
JOIN public.predict_users u ON u.id = s.user_id;


-- ── 9. RLS on the new tables ────────────────────────────────
-- Both are public-read (leaderboards); writes are service-role only.

ALTER TABLE public.predict_seasons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predict_user_seasons ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'predict_seasons' AND policyname = 'ps_select_all') THEN
    CREATE POLICY "ps_select_all" ON public.predict_seasons FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'predict_user_seasons' AND policyname = 'pus_select_all') THEN
    CREATE POLICY "pus_select_all" ON public.predict_user_seasons FOR SELECT USING (true);
  END IF;
END $$;


-- ── 10. updated_at trigger for the new standings table ──────
DROP TRIGGER IF EXISTS trg_pus_updated ON public.predict_user_seasons;
CREATE TRIGGER trg_pus_updated
  BEFORE UPDATE ON public.predict_user_seasons
  FOR EACH ROW EXECUTE FUNCTION public.predict_set_updated_at();

-- ── 11. Picks AI ────────────────────────────────────────────────────────
-- The bot competitor. No auth_id and no email, so:
--   * the pp_select_own RLS policy never matches it — its picks stay
--     unreadable via the anon key until pp_select_locked opens them
--   * picks-reminder.js must skip it (it has no inbox)

-- NOTE: creating the Picks AI *user row* has been moved out to
-- sql/007_roster_and_picks_ai.sql, together with the leaver and joiners.
-- Reason: this migration is the critical path for the season rollover and
-- must not be held hostage by an INSERT whose NOT NULL requirements on
-- predict_users we have not verified. Roster changes are retryable in
-- isolation; the rollover is not. Run 007 after this commits.

-- Spend audit — one row per picks-ai run, so the season budget is
-- verifiable rather than assumed.
CREATE TABLE IF NOT EXISTS public.predict_ai_runs (
  id                 SERIAL PRIMARY KEY,
  season             TEXT,
  week_number        INTEGER,
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  web_searches       INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  picks_written      INTEGER NOT NULL DEFAULT 0,
  detail             JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The strategy note Picks AI wrote for that week (league position, whether it
-- played the percentages or differentiated). Revealed to players after lockout
-- via the view below.
ALTER TABLE public.predict_ai_runs ADD COLUMN IF NOT EXISTS strategy TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_runs_season ON public.predict_ai_runs(season);

-- Service-role only: no public read policy is created, and RLS with no
-- policy denies every anon/authenticated request. Keeps spend private.
ALTER TABLE public.predict_ai_runs ENABLE ROW LEVEL SECURITY;

-- ...but the strategy note itself should be readable once the week has locked,
-- on the same terms as the picks. This view exposes ONLY (season, week, note)
-- and bakes the lockout check into its WHERE clause. It is intentionally a
-- non-security_invoker view so it can read past the deny-all RLS above —
-- Supabase's linter flags that as "security definer view"; it is deliberate,
-- and no cost or token data is reachable through it.
CREATE OR REPLACE VIEW public.predict_ai_week_notes AS
SELECT r.season, r.week_number, r.strategy
FROM public.predict_ai_runs r
WHERE r.strategy IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.predict_match_weeks w
    JOIN public.predict_matches m ON m.match_week_id = w.id
    WHERE w.season = r.season
      AND w.week_number = r.week_number
      AND (m.locked = TRUE OR m.lockout_time <= NOW())
  );

GRANT SELECT ON public.predict_ai_week_notes TO anon, authenticated;

COMMIT;

-- ============================================================
-- VERIFY (run after commit)
-- ============================================================
-- SELECT season, COUNT(*) FROM predict_match_weeks GROUP BY season;
-- SELECT id, username, is_bot, is_active FROM predict_users ORDER BY id;
-- SELECT season, SUM(estimated_cost_usd) FROM predict_ai_runs GROUP BY season;
-- SELECT * FROM predict_league_table WHERE season = '2025/26' ORDER BY position;
-- SELECT * FROM predict_league_table WHERE season = '2026/27' ORDER BY position;
