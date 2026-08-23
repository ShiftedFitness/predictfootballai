-- ============================================================
-- 012_week_results_email.sql
--
-- Two timestamps on the matchweek so the results email can fire
-- exactly once, an hour after the week is scored.
--
--   scored_at              when the week was first seen fully
--                          scored (all results in, all picks
--                          scored). Detected rather than set by
--                          the scoring code, so it works however
--                          you score a week — admin button,
--                          auto-score, or by hand in SQL.
--
--   results_email_sent_at  set once the email goes out. The week
--                          is skipped thereafter, so a redeploy
--                          or an extra cron tick cannot send
--                          twice.
--
-- Idempotent. Run any time.
-- ============================================================

ALTER TABLE public.predict_match_weeks
  ADD COLUMN IF NOT EXISTS scored_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS results_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.predict_match_weeks.scored_at IS
  'When the week was first observed fully scored. Set by week-results, not '
  'by the scoring code, so it is independent of how the week got scored.';

COMMENT ON COLUMN public.predict_match_weeks.results_email_sent_at IS
  'When the weekly results email went out. Send-once guard.';

CREATE INDEX IF NOT EXISTS idx_pmw_results_email
  ON public.predict_match_weeks (season, scored_at, results_email_sent_at);

-- Current state.
SELECT week_number, status, scored_at, results_email_sent_at, reminder_sent_at
FROM public.predict_match_weeks
WHERE season = (SELECT season FROM public.predict_seasons WHERE is_current)
ORDER BY week_number;
