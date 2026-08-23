-- ============================================================
-- 010_reminder_stamp.sql
--
-- Reliable de-duplication for the reminder emails.
--
-- The old scheme relied on the trigger window (28 minutes) being
-- NARROWER than the cron interval (30 minutes), so at most one
-- tick could ever land inside it. That also meant an awkwardly
-- timed lockout could fall BETWEEN two ticks and nobody got a
-- reminder at all — which is what happened in week 1.
--
-- With an explicit stamp the window can be comfortably wider
-- than the cron interval (now 90-180 minutes) and still send
-- exactly once.
--
-- Idempotent. Run any time.
-- ============================================================

ALTER TABLE public.predict_match_weeks
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.predict_match_weeks.reminder_sent_at IS
  'When the pre-deadline reminder emails were sent for this week. '
  'Set once by picks-reminder; the week is skipped thereafter. '
  'Test sends (test_email) deliberately do NOT stamp it.';

-- Week 1's reminders never went out, so leave it NULL — if the week is
-- still open the next cron tick inside the window will send them.
SELECT week_number, status, reminder_sent_at
FROM public.predict_match_weeks
WHERE season = (SELECT season FROM public.predict_seasons WHERE is_current)
ORDER BY week_number;
