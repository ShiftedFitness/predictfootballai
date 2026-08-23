-- ============================================================
-- 009_fix_week1.sql
--
-- Two jobs, run in order:
--   PART A  add glyn_marshall's missing week 1 picks
--   PART B  work out why almost nobody has points
--
-- Read PART B's output before re-scoring anything.
-- ============================================================


-- ============================================================
-- PART A — glyn_marshall's picks
--
-- Match ids are resolved by team name so nothing has to be
-- looked up by hand. Picks, as given:
--   Nottingham Forest to win        → HOME
--   Everton to win                  → HOME
--   Brentford v Spurs draw          → DRAW
--   Brighton to win                 → HOME
--   Liverpool v Newcastle draw      → DRAW
--
-- NOTE these are being added after lockout. That is a deliberate
-- admin decision, not something the app would allow — RLS blocks
-- post-deadline writes for real users. Fine as a correction for
-- picks that were made but not saved; just be aware it bypasses
-- the deadline everyone else was held to.
-- ============================================================

-- A1. Preview first: does every fixture resolve, and is the pick sane?
WITH wk AS (
  SELECT m.id, m.home_team, m.away_team, m.correct_result
  FROM public.predict_matches m
  JOIN public.predict_match_weeks w ON w.id = m.match_week_id
  WHERE w.week_number = 1
    AND w.season = (SELECT season FROM public.predict_seasons WHERE is_current)
),
picks(home_like, pick) AS (
  VALUES ('%Forest%',    'HOME'),
         ('%Everton%',   'HOME'),
         ('%Brentford%', 'DRAW'),
         ('%Brighton%',  'HOME'),
         ('%Newcastle%', 'DRAW')
)
SELECT p.home_like, p.pick, wk.id AS match_id,
       wk.home_team || ' v ' || wk.away_team AS fixture,
       wk.correct_result,
       CASE WHEN wk.correct_result = p.pick THEN 1 ELSE 0 END AS would_score
FROM picks p
LEFT JOIN wk ON wk.home_team ILIKE p.home_like
ORDER BY wk.id;
-- Every row must have a match_id. If any is NULL, stop and tell me.


-- A2. Insert them. Safe to re-run — ON CONFLICT updates the pick.
WITH wk AS (
  SELECT m.id, m.home_team
  FROM public.predict_matches m
  JOIN public.predict_match_weeks w ON w.id = m.match_week_id
  WHERE w.week_number = 1
    AND w.season = (SELECT season FROM public.predict_seasons WHERE is_current)
),
picks(home_like, pick) AS (
  VALUES ('%Forest%',    'HOME'),
         ('%Everton%',   'HOME'),
         ('%Brentford%', 'DRAW'),
         ('%Brighton%',  'HOME'),
         ('%Newcastle%', 'DRAW')
)
INSERT INTO public.predict_predictions (user_id, match_id, week_number, pick, source)
SELECT u.id, wk.id, 1, p.pick, 'user'
FROM picks p
JOIN wk ON wk.home_team ILIKE p.home_like
CROSS JOIN (SELECT id FROM public.predict_users WHERE username = 'glyn_marshall') u
ON CONFLICT (user_id, match_id) DO UPDATE SET pick = EXCLUDED.pick;

-- A3. Confirm: five rows, points_awarded still NULL (scoring comes later).
SELECT m.home_team || ' v ' || m.away_team AS fixture,
       p.pick, m.correct_result, p.points_awarded
FROM public.predict_predictions p
JOIN public.predict_matches m ON m.id = p.match_id
JOIN public.predict_users u ON u.id = p.user_id
WHERE u.username = 'glyn_marshall' AND p.week_number = 1
ORDER BY m.id;


-- ============================================================
-- PART B — why does almost nobody have points?
-- All READ ONLY. Send me all four results.
-- ============================================================

-- B1. Do all five matches actually have a result?
--     Scoring only runs when every match in the week is settled.
SELECT m.id, m.home_team || ' v ' || m.away_team AS fixture,
       m.correct_result, m.locked, m.lockout_time
FROM public.predict_matches m
JOIN public.predict_match_weeks w ON w.id = m.match_week_id
WHERE w.week_number = 1
  AND w.season = (SELECT season FROM public.predict_seasons WHERE is_current)
ORDER BY m.id;


-- B2. How many predictions have been scored at all?
--     points_awarded NULL = never scored. This is the key number.
SELECT COUNT(*) AS total_picks,
       COUNT(points_awarded) AS scored_picks,
       COUNT(*) - COUNT(points_awarded) AS unscored_picks,
       SUM(COALESCE(points_awarded, 0)) AS total_correct
FROM public.predict_predictions p
JOIN public.predict_matches m ON m.id = p.match_id
JOIN public.predict_match_weeks w ON w.id = m.match_week_id
WHERE w.week_number = 1
  AND w.season = (SELECT season FROM public.predict_seasons WHERE is_current);


-- B3. Per player: what they SHOULD have vs what is recorded.
--     "would_be_correct" is computed live from the results, so it is
--     what scoring ought to produce. Compare with scored_correct and
--     stored_points.
SELECT u.username,
       COUNT(p.id) AS picks,
       COUNT(p.points_awarded) AS scored,
       SUM(CASE WHEN p.pick = m.correct_result THEN 1 ELSE 0 END) AS would_be_correct,
       SUM(COALESCE(p.points_awarded, 0)) AS scored_correct,
       u.points AS stored_points,
       u.current_week
FROM public.predict_users u
LEFT JOIN public.predict_predictions p ON p.user_id = u.id
LEFT JOIN public.predict_matches m ON m.id = p.match_id
LEFT JOIN public.predict_match_weeks w ON w.id = m.match_week_id
WHERE u.is_active
  AND (w.week_number = 1 OR w.week_number IS NULL)
GROUP BY u.id, u.username, u.points, u.current_week
ORDER BY would_be_correct DESC NULLS LAST;


-- B4. THE LIKELY CULPRIT.
--     auto-score refuses to score a week if ANY user's current_week is
--     already past it — a guard against double-scoring. Migration 006 set
--     everyone to current_week = 1. If scoring ran for even one user and
--     bumped them to 2, every later attempt aborts for EVERYONE, which
--     would look exactly like "one player has points and nobody else does".
SELECT current_week, COUNT(*) AS players,
       string_agg(username, ', ' ORDER BY username) AS who
FROM public.predict_users
WHERE is_active
GROUP BY current_week
ORDER BY current_week;
