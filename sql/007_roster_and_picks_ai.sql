-- ============================================================
-- 007_roster_and_picks_ai.sql
--
-- Run AFTER 006 has committed successfully.
--
-- Everything here changes WHO is playing this season. It is kept
-- separate from 006 on purpose: the season rollover is the critical
-- path and must not fail because of an INSERT into predict_users,
-- whose NOT NULL requirements we have not verified. Roster changes
-- are safely retryable on their own; the rollover is not.
--
-- Run the sections one at a time and check the output of each.
-- ============================================================


-- ============================================================
-- STEP 1 — what does predict_users actually require?
-- READ ONLY. Run this first and read the result before step 2.
-- Any row with is_nullable = 'NO' and no column_default must be
-- supplied explicitly in the INSERT below.
-- ============================================================
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'predict_users'
ORDER BY ordinal_position;


-- ============================================================
-- STEP 2 — create the Picks AI competitor
--
-- Deliberately has NO auth_id: that is what keeps its picks
-- private. The pp_select_own RLS policy matches rows via
-- auth_id, so with none, only pp_select_locked can ever expose
-- its predictions — i.e. never before a week locks.
--
-- The email is real-looking so nothing chokes on a NULL, but
-- picks-reminder.js filters is_bot = false, so nothing is ever
-- sent to it.
-- ============================================================
INSERT INTO public.predict_users (username, full_name, email, is_bot, is_active, joined_season)
SELECT 'Picks AI', 'Picks AI', 'picks-ai@telestats.net', TRUE, TRUE, '2026/27'
WHERE NOT EXISTS (SELECT 1 FROM public.predict_users WHERE is_bot = TRUE);

-- Give it a 2026/27 standings row like every other player.
INSERT INTO public.predict_user_seasons (user_id, season)
SELECT id, '2026/27' FROM public.predict_users WHERE is_bot
ON CONFLICT (user_id, season) DO NOTHING;

-- Confirm
SELECT id, username, email, is_bot, is_active, joined_season
FROM public.predict_users WHERE is_bot;


-- ============================================================
-- STEP 3 — the departing player
--
-- SOFT DELETE ONLY. Do not DELETE this row.
-- predict_predictions.user_id references predict_users ON DELETE
-- CASCADE, so a DELETE would silently destroy every pick they
-- have ever made — which would tear a hole in the 2025/26 archive
-- we just spent four queries verifying, and break the weekly
-- tables and head-to-head history for everyone else too.
--
-- Setting is_active = false removes them from this season's
-- league table, the reminder emails and the leaderboard, while
-- leaving their 2025/26 finishing position intact.
--
-- >>> REPLACE 'USERNAME_HERE' BEFORE RUNNING <<<
-- ============================================================
-- UPDATE public.predict_users
-- SET    is_active   = FALSE,
--        left_season = '2025/26'
-- WHERE  username    = 'USERNAME_HERE';

-- Their 2026/27 standings row should not exist. Remove it if 006
-- created one before they were marked inactive.
-- DELETE FROM public.predict_user_seasons
-- WHERE  season = '2026/27'
--   AND  user_id IN (SELECT id FROM public.predict_users WHERE NOT is_active);


-- ============================================================
-- STEP 4 — new players
--
-- >>> REPLACE THE PLACEHOLDER ROWS BEFORE RUNNING <<<
-- Add one line per joiner. joined_season marks them as new this
-- season so their blank 2025/26 record is never mistaken for a
-- last-place finish.
-- ============================================================
-- INSERT INTO public.predict_users (username, full_name, email, is_active, joined_season)
-- VALUES
--   ('NEW_USERNAME_1', '', 'their.email@example.com', TRUE, '2026/27'),
--   ('NEW_USERNAME_2', '', 'their.email@example.com', TRUE, '2026/27')
-- ON CONFLICT DO NOTHING;

-- Give every active player a 2026/27 standings row (idempotent —
-- safe to run after adding joiners, catches anyone missed).
-- INSERT INTO public.predict_user_seasons (user_id, season)
-- SELECT id, '2026/27' FROM public.predict_users WHERE is_active
-- ON CONFLICT (user_id, season) DO NOTHING;


-- ============================================================
-- STEP 5 — final roster check
-- Everyone who should be playing 2026/27, and nobody who should not.
-- ============================================================
SELECT u.id, u.username, u.is_bot, u.is_active, u.joined_season, u.left_season,
       s.points AS points_2026_27,
       (SELECT points FROM public.predict_user_seasons
        WHERE user_id = u.id AND season = '2025/26') AS points_2025_26
FROM public.predict_users u
LEFT JOIN public.predict_user_seasons s
  ON s.user_id = u.id AND s.season = '2026/27'
ORDER BY u.is_active DESC, u.is_bot DESC, u.username;
