-- ============================================================
-- 008_provisional_picks.sql
--
-- Lets Picks AI make an EARLY provisional set of picks that a
-- later scheduled run is allowed to replace.
--
-- Why: the guard in picks-ai.js skips a week the bot has already
-- picked, so running it early to check everything works would
-- have silently blocked the real run. This distinguishes the two.
--
--   provisional (is_final = false)
--     made outside the 10-14h window, e.g. days early as a dry
--     run for peace of mind. A later run WILL overwrite it.
--
--   final (is_final = true)
--     made inside the normal window, on the freshest team news.
--     Nothing overwrites this except an explicit force.
--
-- Safe to run any time after 006. Idempotent.
-- ============================================================

ALTER TABLE public.predict_ai_runs
  ADD COLUMN IF NOT EXISTS is_final BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.predict_ai_runs.is_final IS
  'False when the picks were made outside the normal pre-deadline window '
  '(an early provisional run). A later run may replace provisional picks; '
  'final picks are only replaced with an explicit force.';

-- Any run recorded before this migration was made under the old
-- one-shot behaviour, so treat it as final.
UPDATE public.predict_ai_runs SET is_final = TRUE WHERE is_final IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_runs_week_final
  ON public.predict_ai_runs (season, week_number, is_final);

-- Check: one row per run, newest first.
SELECT id, season, week_number, is_final, picks_written,
       estimated_cost_usd, created_at
FROM public.predict_ai_runs
ORDER BY created_at DESC
LIMIT 10;
