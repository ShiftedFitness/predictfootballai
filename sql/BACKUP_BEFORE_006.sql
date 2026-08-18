-- ============================================================
-- BACKUP_BEFORE_006.sql
--
-- Run this in the Supabase SQL editor immediately BEFORE 006.
-- It copies the four tables 006 touches into plain backup tables
-- sitting in the same database. Takes a second, works on any
-- Supabase plan, and needs no dashboard settings.
--
-- Why bother when 006 is a single transaction? Because the
-- transaction protects you from a FAILED migration (it rolls back
-- on its own). It does not protect you from a SUCCESSFUL migration
-- that did the wrong thing — e.g. archiving under a season label
-- you later decide was wrong. That is what these copies are for.
--
-- The one genuinely destructive step in 006 is 6d, which zeroes the
-- running totals on predict_users for the new season. Those numbers
-- are archived into predict_user_seasons first, and also land in
-- bak_predict_users below, so there are two ways back.
-- ============================================================

-- Drop any previous attempt so this is safe to re-run.
DROP TABLE IF EXISTS bak_predict_users;
DROP TABLE IF EXISTS bak_predict_match_weeks;
DROP TABLE IF EXISTS bak_predict_matches;
DROP TABLE IF EXISTS bak_predict_predictions;

CREATE TABLE bak_predict_users       AS SELECT * FROM predict_users;
CREATE TABLE bak_predict_match_weeks AS SELECT * FROM predict_match_weeks;
CREATE TABLE bak_predict_matches     AS SELECT * FROM predict_matches;
CREATE TABLE bak_predict_predictions AS SELECT * FROM predict_predictions;

-- Confirm the copies match the originals. Every diff column must be 0.
SELECT 'predict_users' AS table_name,
       (SELECT COUNT(*) FROM predict_users)       AS live,
       (SELECT COUNT(*) FROM bak_predict_users)   AS backup,
       (SELECT COUNT(*) FROM predict_users) - (SELECT COUNT(*) FROM bak_predict_users) AS diff
UNION ALL
SELECT 'predict_match_weeks',
       (SELECT COUNT(*) FROM predict_match_weeks),
       (SELECT COUNT(*) FROM bak_predict_match_weeks),
       (SELECT COUNT(*) FROM predict_match_weeks) - (SELECT COUNT(*) FROM bak_predict_match_weeks)
UNION ALL
SELECT 'predict_matches',
       (SELECT COUNT(*) FROM predict_matches),
       (SELECT COUNT(*) FROM bak_predict_matches),
       (SELECT COUNT(*) FROM predict_matches) - (SELECT COUNT(*) FROM bak_predict_matches)
UNION ALL
SELECT 'predict_predictions',
       (SELECT COUNT(*) FROM predict_predictions),
       (SELECT COUNT(*) FROM bak_predict_predictions),
       (SELECT COUNT(*) FROM predict_predictions) - (SELECT COUNT(*) FROM bak_predict_predictions);


-- ============================================================
-- IF SOMETHING GOES WRONG — restoring the totals
-- ============================================================
-- The likely regret is "the season totals got zeroed and I wanted
-- them back". This puts them back exactly as they were:
--
--   UPDATE predict_users u
--   SET    points            = b.points,
--          correct_results   = b.correct_results,
--          incorrect_results = b.incorrect_results,
--          full_houses       = b.full_houses,
--          blanks            = b.blanks,
--          current_week      = b.current_week
--   FROM   bak_predict_users b
--   WHERE  b.id = u.id;
--
-- Deleting rows is NOT part of any of this, so nothing needs
-- re-inserting. Ask before running a full table restore.


-- ============================================================
-- ONCE THE SEASON IS RUNNING HAPPILY, tidy up:
-- ============================================================
--   DROP TABLE bak_predict_users;
--   DROP TABLE bak_predict_match_weeks;
--   DROP TABLE bak_predict_matches;
--   DROP TABLE bak_predict_predictions;
--
-- Leave them until at least the first matchweek has been scored.
