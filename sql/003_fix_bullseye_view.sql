-- ============================================================
-- 003_fix_bullseye_view.sql
-- Two fixes for current season data flowing into games:
--
-- FIX 1: Redefine v_game_player_club_comp view
--   PROBLEM: The old view read from player_club_total_competition
--   (a pre-aggregated rollup table with ONLY historical data).
--   FIX: Aggregate from v_all_player_season_stats instead.
--
-- FIX 2: Remap current season UIDs to match historical UIDs
--   PROBLEM: Current season UIDs use single-nat format (eng|2001)
--   but historical data uses double-nat (eng eng|2002) for many
--   players. Since they're different UIDs, stats don't aggregate.
--   FIX: Update current season UIDs to match the historical UID
--   that has the most appearances in the same competition.
--
-- Run via Supabase SQL Editor
-- ============================================================

-- ---- FIX 1: Recreate the Bullseye game view ----
-- Must DROP first because SUM() returns bigint, not integer
DROP VIEW IF EXISTS v_game_player_club_comp;

CREATE VIEW v_game_player_club_comp AS
SELECT
  t.player_uid,
  p.player_name,
  p.nationality_norm,
  t.competition_id,
  c.competition_name,
  t.club_id,
  cl.club_name,
  t.appearances::integer AS appearances,
  t.goals::integer AS goals,
  t.assists::integer AS assists,
  t.minutes::integer AS minutes,
  t.seasons::integer AS seasons,
  t.first_season_start_year,
  t.last_season_start_year
FROM (
  SELECT
    player_uid,
    competition_id,
    club_id,
    COALESCE(SUM(appearances), 0) AS appearances,
    COALESCE(SUM(goals), 0)       AS goals,
    COALESCE(SUM(assists), 0)     AS assists,
    COALESCE(SUM(minutes), 0)     AS minutes,
    COUNT(DISTINCT season_label)  AS seasons,
    MIN(season_start_year)        AS first_season_start_year,
    MAX(season_start_year)        AS last_season_start_year
  FROM v_all_player_season_stats
  GROUP BY player_uid, competition_id, club_id
) t
JOIN players p USING (player_uid)
JOIN competitions c ON (c.competition_id = t.competition_id)
JOIN clubs cl ON (cl.club_id = t.club_id);

-- ---- FIX 2: Remap current season UIDs to match historical ----
-- For each current season row that has no matching historical data
-- in the same competition, find the best historical UID (by appearances)
-- for the same player_name and update.
WITH mismatched AS (
  SELECT c.id, c.player_uid AS current_uid, c.competition_id,
         c.club_id, c.season_label, p.player_name
  FROM current_season_player_stats c
  JOIN players p ON p.player_uid = c.player_uid
  WHERE NOT EXISTS (
    SELECT 1 FROM player_season_stats h
    WHERE h.player_uid = c.player_uid
      AND h.competition_id = c.competition_id
  )
),
best_historical AS (
  SELECT DISTINCT ON (m.id)
    m.id,
    m.current_uid,
    h_agg.player_uid AS target_uid
  FROM mismatched m
  JOIN players p2 ON p2.player_name = m.player_name
    AND p2.player_uid != m.current_uid
  JOIN LATERAL (
    SELECT ps.player_uid, SUM(ps.appearances) AS total_apps
    FROM player_season_stats ps
    WHERE ps.player_uid = p2.player_uid
      AND ps.competition_id = m.competition_id
    GROUP BY ps.player_uid
    HAVING SUM(ps.appearances) > 0
  ) h_agg ON true
  ORDER BY m.id, h_agg.total_apps DESC
)
UPDATE current_season_player_stats c
SET player_uid = bh.target_uid,
    updated_at = now()
FROM best_historical bh
WHERE c.id = bh.id;
