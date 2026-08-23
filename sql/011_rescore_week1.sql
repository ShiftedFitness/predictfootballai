-- ============================================================
-- 011_rescore_week1.sql
--
-- Run ONLY after:
--   1. the auto-score background fix is deployed
--   2. auto-score-trigger has been run and matches 344 + 345
--      finally have a correct_result
--
-- Check that first:
SELECT id, home_team || ' v ' || away_team AS fixture, correct_result, locked
FROM public.predict_matches
WHERE id IN (344, 345);
-- Both must show a result. If they still say NULL, STOP — re-scoring now
-- would bake the same wrong zeros back in.
-- ============================================================


-- ============================================================
-- What went wrong, for the record
--
-- Every one of the 120 predictions has points_awarded set, but only 1 is
-- marked correct. Scoring ran while most fixtures still had no result, so
-- pick-vs-result compared against an empty string and recorded 0. Those
-- zeros then looked like completed scoring, which is why the matchweek
-- table showed almost nobody with points.
--
-- The repair is to recompute points_awarded from the results that now
-- exist. This is NOT destructive: the picks themselves were never touched,
-- only the derived score.
-- ============================================================

-- STEP 1 — preview. What SHOULD each player have scored?
SELECT u.username,
       SUM(CASE WHEN p.pick = m.correct_result THEN 1 ELSE 0 END) AS correct,
       SUM(COALESCE(p.points_awarded, 0)) AS currently_recorded,
       CASE WHEN SUM(CASE WHEN p.pick = m.correct_result THEN 1 ELSE 0 END) = 5
            THEN 'FULL HOUSE (+5)' ELSE '' END AS bonus
FROM public.predict_users u
JOIN public.predict_predictions p ON p.user_id = u.id
JOIN public.predict_matches m ON m.id = p.match_id
JOIN public.predict_match_weeks w ON w.id = m.match_week_id
WHERE w.week_number = 1
  AND w.season = (SELECT season FROM public.predict_seasons WHERE is_current)
GROUP BY u.id, u.username
ORDER BY correct DESC, u.username;


-- STEP 2 — recompute points_awarded from the actual results.
UPDATE public.predict_predictions p
SET    points_awarded = CASE WHEN p.pick = m.correct_result THEN 1 ELSE 0 END
FROM   public.predict_matches m
JOIN   public.predict_match_weeks w ON w.id = m.match_week_id
WHERE  m.id = p.match_id
  AND  w.week_number = 1
  AND  w.season = (SELECT season FROM public.predict_seasons WHERE is_current)
  AND  m.correct_result IN ('HOME', 'AWAY', 'DRAW');


-- STEP 3 — rebuild each player's season totals from their scored picks.
--          Written to run correctly whether or not step 2 has been run
--          before, so it is safe to repeat.
WITH weekly AS (
  SELECT p.user_id, w.week_number,
         SUM(COALESCE(p.points_awarded, 0)) AS correct,
         COUNT(*) AS picks
  FROM public.predict_predictions p
  JOIN public.predict_matches m ON m.id = p.match_id
  JOIN public.predict_match_weeks w ON w.id = m.match_week_id
  WHERE w.season = (SELECT season FROM public.predict_seasons WHERE is_current)
  GROUP BY p.user_id, w.week_number
),
totals AS (
  SELECT user_id,
         SUM(correct) + 5 * COUNT(*) FILTER (WHERE correct = 5 AND picks = 5) AS points,
         SUM(correct) AS correct_results,
         SUM(picks) - SUM(correct) AS incorrect_results,
         COUNT(*) FILTER (WHERE correct = 5 AND picks = 5) AS full_houses,
         COUNT(*) FILTER (WHERE correct = 0 AND picks >= 5) AS blanks,
         MAX(week_number) + 1 AS current_week
  FROM weekly
  GROUP BY user_id
)
UPDATE public.predict_users u
SET    points            = t.points,
       correct_results   = t.correct_results,
       incorrect_results = t.incorrect_results,
       full_houses       = t.full_houses,
       blanks            = t.blanks,
       current_week      = t.current_week
FROM   totals t
WHERE  u.id = t.user_id;


-- STEP 4 — mirror into the per-season standings the league toggle reads.
INSERT INTO public.predict_user_seasons
  (user_id, season, points, correct_results, incorrect_results,
   full_houses, blanks, current_week)
SELECT u.id, (SELECT season FROM public.predict_seasons WHERE is_current),
       u.points, u.correct_results, u.incorrect_results,
       u.full_houses, u.blanks, u.current_week
FROM public.predict_users u
WHERE u.is_active
ON CONFLICT (user_id, season) DO UPDATE SET
  points            = EXCLUDED.points,
  correct_results   = EXCLUDED.correct_results,
  incorrect_results = EXCLUDED.incorrect_results,
  full_houses       = EXCLUDED.full_houses,
  blanks            = EXCLUDED.blanks,
  current_week      = EXCLUDED.current_week;


-- STEP 5 — the week 1 table as players will now see it.
SELECT u.username, u.points, u.correct_results, u.full_houses, u.blanks
FROM public.predict_users u
WHERE u.is_active
ORDER BY u.points DESC, u.full_houses DESC, u.username;
