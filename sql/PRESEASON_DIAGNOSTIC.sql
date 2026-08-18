-- ============================================================
-- PRESEASON_DIAGNOSTIC.sql   (READ ONLY — safe to run)
-- Run in the Supabase SQL editor before applying 006.
-- Paste each result back so the migration can be finalised.
-- ============================================================

-- 1. What weeks exist, and are they all one season?
SELECT
  w.week_number,
  w.status,
  COUNT(m.id)                                   AS matches,
  COUNT(m.correct_result) FILTER (WHERE m.correct_result IN ('HOME','AWAY','DRAW')) AS results_in,
  MIN(m.lockout_time)::date                     AS first_lockout,
  MAX(m.lockout_time)::date                     AS last_lockout
FROM predict_match_weeks w
LEFT JOIN predict_matches m ON m.match_week_id = w.id
GROUP BY w.week_number, w.status
ORDER BY w.week_number;


-- 2. The roster, with final standings, so we can confirm who leaves/stays.
SELECT
  id, username, full_name, email,
  points, correct_results, incorrect_results,
  full_houses, blanks, current_week,
  (SELECT COUNT(*) FROM predict_predictions p WHERE p.user_id = u.id) AS total_picks
FROM predict_users u
ORDER BY points DESC NULLS LAST, full_houses DESC NULLS LAST;


-- 3. THE BIG ONE: is week_number actually populated?
--    NOTE: an earlier run of this proved predict_matches.week_number DOES NOT
--    EXIST, so the plain COUNT version errored. This version asks
--    information_schema instead and works whether or not the column is there.
--    Migration 006 now recreates the column, so this is mainly a before/after
--    check. Run it again after 006 and every 'present' should say true.
SELECT
  t.table_name,
  EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = t.table_name
      AND c.column_name = 'week_number'
  ) AS week_number_present,
  EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = t.table_name
      AND c.column_name = 'season'
  ) AS season_present
FROM (VALUES ('predict_matches'), ('predict_predictions'), ('predict_match_weeks'))
  AS t(table_name);


-- 3b. ONLY run this once 006 has been applied (before that, the column is
--     missing and it will error). Every count should be zero.
-- SELECT
--   COUNT(*) FILTER (WHERE m.week_number IS NULL)                   AS matches_missing_week,
--   COUNT(*) FILTER (WHERE m.week_number IS DISTINCT FROM w.week_number) AS matches_mismatched
-- FROM predict_matches m
-- JOIN predict_match_weeks w ON w.id = m.match_week_id;


-- 4. Actual column definitions + defaults (004 may have drifted).
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('predict_users','predict_matches',
                     'predict_predictions','predict_match_weeks')
ORDER BY table_name, ordinal_position;


-- 5. Constraints we need to alter (esp. the UNIQUE on week_number)
--    and any triggers that might be filling week_number in.
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('predict_match_weeks'::regclass,
                   'predict_matches'::regclass,
                   'predict_predictions'::regclass,
                   'predict_users'::regclass)
ORDER BY conrelid::regclass::text, contype;

SELECT event_object_table AS tbl, trigger_name, action_timing,
       event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table LIKE 'predict_%'
ORDER BY event_object_table;


-- 6. Sanity: does every prediction still have a live user and match?
SELECT
  (SELECT COUNT(*) FROM predict_predictions p
     LEFT JOIN predict_users u ON u.id = p.user_id WHERE u.id IS NULL)   AS orphan_by_user,
  (SELECT COUNT(*) FROM predict_predictions p
     LEFT JOIN predict_matches m ON m.id = p.match_id WHERE m.id IS NULL) AS orphan_by_match,
  (SELECT COUNT(*) FROM predict_matches m
     LEFT JOIN predict_match_weeks w ON w.id = m.match_week_id WHERE w.id IS NULL) AS orphan_match_week;
