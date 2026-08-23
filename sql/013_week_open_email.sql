-- ============================================================
-- 013_week_open_email.sql
--
-- Send-once guard for the "new week is live" email.
--
-- Unlike the results email this one is NOT sent automatically —
-- a week gets seeded, and the admin may still want to correct a
-- fixture or a deadline before telling 23 people about it. So it
-- goes out when the admin presses the button, and this stamp
-- stops it going twice.
--
-- Idempotent. Run any time.
-- ============================================================

ALTER TABLE public.predict_match_weeks
  ADD COLUMN IF NOT EXISTS open_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.predict_match_weeks.open_email_sent_at IS
  'When the "picks are open" email was sent for this week. Send-once guard. '
  'Test sends deliberately do NOT stamp it.';

SELECT week_number, status,
       open_email_sent_at, reminder_sent_at, results_email_sent_at
FROM public.predict_match_weeks
WHERE season = (SELECT season FROM public.predict_seasons WHERE is_current)
ORDER BY week_number;
