-- ============================================================
-- 003_fix_bullseye_view.sql
-- Redefines v_game_player_club_comp to include current season data
--
-- PROBLEM: The old view reads from player_club_total_competition
-- (a pre-aggregated rollup table with ONLY historical data).
-- This means Bullseye/Football 501 never shows current season stats.
--
-- FIX: Aggregate directly from v_all_player_season_stats (which
-- UNION ALLs both historical + current_season_player_stats).
--
-- Run via Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE VIEW v_game_player_club_comp AS
SELECT
  t.player_uid,
  p.player_name,
  p.nationality_norm,
  t.competition_id,
  c.competition_name,
  t.club_id,
  cl.club_name,
  t.appearances,
  t.goals,
  t.assists,
  t.minutes,
  t.seasons,
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
