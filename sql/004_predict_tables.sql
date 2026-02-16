-- ============================================================
-- TeleStats Fives – Prediction Game Tables
-- Migration 004: Create predict_matches, predict_predictions,
--                predict_match_weeks tables and league view.
-- ============================================================

-- ── predict_match_weeks ─────────────────────────────────────
-- Groups matches by week number with open/closed/scored status.
CREATE TABLE IF NOT EXISTS public.predict_match_weeks (
  id            SERIAL PRIMARY KEY,
  week_number   INTEGER NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'closed', 'scored')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pmw_week
  ON public.predict_match_weeks(week_number);

-- ── predict_matches ─────────────────────────────────────────
-- Individual fixtures within a matchweek.
CREATE TABLE IF NOT EXISTS public.predict_matches (
  id              SERIAL PRIMARY KEY,
  match_week_id   INTEGER NOT NULL
                    REFERENCES public.predict_match_weeks(id) ON DELETE CASCADE,
  week_number     INTEGER NOT NULL,
  home_team       TEXT NOT NULL,
  away_team       TEXT NOT NULL,
  lockout_time    TIMESTAMPTZ,
  locked          BOOLEAN NOT NULL DEFAULT FALSE,

  -- Result (set by admin after match)
  correct_result  TEXT CHECK (correct_result IS NULL
                    OR correct_result IN ('HOME', 'AWAY', 'DRAW')),

  -- External API reference
  api_fixture_id  INTEGER,

  -- Enrichment / prediction data (nullable)
  home_form         TEXT,
  away_form         TEXT,
  prediction_home   NUMERIC,
  prediction_draw   NUMERIC,
  prediction_away   NUMERIC,
  prediction_advice TEXT,
  h2h_summary       JSONB,
  match_stats       JSONB,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pm_week     ON public.predict_matches(week_number);
CREATE INDEX IF NOT EXISTS idx_pm_week_id  ON public.predict_matches(match_week_id);
CREATE INDEX IF NOT EXISTS idx_pm_lockout  ON public.predict_matches(lockout_time);

-- ── predict_predictions ─────────────────────────────────────
-- Each user's pick for a specific match.
CREATE TABLE IF NOT EXISTS public.predict_predictions (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL
                    REFERENCES public.predict_users(id) ON DELETE CASCADE,
  match_id        INTEGER NOT NULL
                    REFERENCES public.predict_matches(id) ON DELETE CASCADE,
  week_number     INTEGER NOT NULL,
  pick            TEXT NOT NULL CHECK (pick IN ('HOME', 'AWAY', 'DRAW')),
  points_awarded  INTEGER,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_pp_user      ON public.predict_predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_pp_match     ON public.predict_predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_pp_week      ON public.predict_predictions(week_number);
CREATE INDEX IF NOT EXISTS idx_pp_user_week ON public.predict_predictions(user_id, week_number);

-- ── Extend predict_users ────────────────────────────────────
-- Add columns for full-house tracking and scoring state.
ALTER TABLE public.predict_users
  ADD COLUMN IF NOT EXISTS full_houses   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blanks        INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_week  INTEGER;

-- ── predict_league_table (VIEW) ─────────────────────────────
-- Ordered leaderboard used by the league page.
CREATE OR REPLACE VIEW public.predict_league_table AS
SELECT
  id,
  username,
  full_name,
  points,
  correct_results,
  incorrect_results,
  COALESCE(full_houses, 0)  AS full_houses,
  COALESCE(blanks, 0)       AS blanks,
  CASE
    WHEN (COALESCE(correct_results,0) + COALESCE(incorrect_results,0)) > 0
    THEN correct_results::FLOAT / (correct_results + incorrect_results)
    ELSE 0
  END AS accuracy
FROM public.predict_users
ORDER BY
  COALESCE(points, 0) DESC,
  COALESCE(full_houses, 0) DESC,
  COALESCE(correct_results, 0) DESC;

-- ── Row-Level Security ──────────────────────────────────────

-- Enable RLS
ALTER TABLE public.predict_match_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predict_matches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predict_predictions ENABLE ROW LEVEL SECURITY;

-- predict_match_weeks: everyone can read
CREATE POLICY "pmw_select_all"
  ON public.predict_match_weeks FOR SELECT
  USING (true);

-- predict_matches: everyone can read
CREATE POLICY "pm_select_all"
  ON public.predict_matches FOR SELECT
  USING (true);

-- predict_predictions: read own predictions always
CREATE POLICY "pp_select_own"
  ON public.predict_predictions FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM public.predict_users
      WHERE auth_id = auth.uid()
    )
  );

-- predict_predictions: read all predictions when the match is locked
CREATE POLICY "pp_select_locked"
  ON public.predict_predictions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.predict_matches m
      WHERE m.id = predict_predictions.match_id
        AND (m.locked = true OR m.lockout_time <= NOW())
    )
  );

-- predict_predictions: insert own
CREATE POLICY "pp_insert_own"
  ON public.predict_predictions FOR INSERT
  WITH CHECK (
    user_id IN (
      SELECT id FROM public.predict_users
      WHERE auth_id = auth.uid()
    )
  );

-- predict_predictions: update own
CREATE POLICY "pp_update_own"
  ON public.predict_predictions FOR UPDATE
  USING (
    user_id IN (
      SELECT id FROM public.predict_users
      WHERE auth_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id IN (
      SELECT id FROM public.predict_users
      WHERE auth_id = auth.uid()
    )
  );

-- predict_users: everyone can read (for leaderboard)
-- NOTE: predict_users may already have RLS policies; only create if needed.
-- If RLS is not enabled on predict_users, enable it and add a select policy.
DO $$
BEGIN
  -- Enable RLS if not already enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'predict_users'
      AND n.nspname = 'public'
      AND c.relrowsecurity = true
  ) THEN
    ALTER TABLE public.predict_users ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;

-- Allow public read on predict_users (leaderboard, compare dropdown)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'predict_users'
      AND policyname = 'pu_select_all'
  ) THEN
    CREATE POLICY "pu_select_all"
      ON public.predict_users FOR SELECT
      USING (true);
  END IF;
END
$$;

-- ── Timestamps trigger ──────────────────────────────────────
-- Auto-update updated_at on row changes.
CREATE OR REPLACE FUNCTION public.predict_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pmw_updated
  BEFORE UPDATE ON public.predict_match_weeks
  FOR EACH ROW EXECUTE FUNCTION public.predict_set_updated_at();

CREATE TRIGGER trg_pm_updated
  BEFORE UPDATE ON public.predict_matches
  FOR EACH ROW EXECUTE FUNCTION public.predict_set_updated_at();

CREATE TRIGGER trg_pp_updated
  BEFORE UPDATE ON public.predict_predictions
  FOR EACH ROW EXECUTE FUNCTION public.predict_set_updated_at();
