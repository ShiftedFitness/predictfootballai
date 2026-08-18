-- ============================================================
-- FINAL_CHECK_BEFORE_006.sql   (READ ONLY)
--
-- Does each player's stored points total actually match what
-- their picks earned? 006 freezes predict_users totals as the
-- 2025/26 final table, so this is the last thing worth checking
-- before that becomes history.
--
-- Doubles as the roster — this is the list to tell me who is
-- leaving and who is staying.
--
-- PASS = every row has unscored_picks 0 and discrepancy 0.
-- ============================================================

SELECT
  u.id,
  u.username,
  u.full_name,
  u.email,
  u.points                                        AS stored_points,
  COALESCE(u.full_houses, 0)                      AS full_houses,
  COALESCE(SUM(p.points_awarded), 0)              AS correct_picks,
  COALESCE(SUM(p.points_awarded), 0)
    + 5 * COALESCE(u.full_houses, 0)              AS expected_points,
  COALESCE(u.points, 0)
    - (COALESCE(SUM(p.points_awarded), 0)
       + 5 * COALESCE(u.full_houses, 0))          AS discrepancy,
  COUNT(p.id)                                     AS total_picks,
  COUNT(p.id) FILTER (WHERE p.points_awarded IS NULL) AS unscored_picks
FROM public.predict_users u
LEFT JOIN public.predict_predictions p ON p.user_id = u.id
GROUP BY u.id, u.username, u.full_name, u.email, u.points, u.full_houses
ORDER BY u.points DESC NULLS LAST;
