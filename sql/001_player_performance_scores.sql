-- ============================================================
-- Football XI — Performance Scores Table + Computation
-- ============================================================
-- Run this in the Supabase SQL editor.
--
-- Creates a table to cache per-player, per-scope performance
-- scores used by the Starting XI game mode.
-- ============================================================

-- 1. Create the performance scores table
CREATE TABLE IF NOT EXISTS player_performance_scores (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope_type    text    NOT NULL CHECK (scope_type IN ('league', 'club')),
  scope_id      integer,               -- NULL for league scope, club_id for club scope
  position_bucket text  NOT NULL CHECK (position_bucket IN ('GK', 'DEF', 'MID', 'FWD')),
  player_uid    text    NOT NULL REFERENCES players(player_uid),
  player_name   text,
  nationality   text,
  appearances   integer NOT NULL DEFAULT 0,
  goals         integer NOT NULL DEFAULT 0,
  assists       integer NOT NULL DEFAULT 0,
  minutes       integer NOT NULL DEFAULT 0,
  clean_sheets  integer NOT NULL DEFAULT 0,
  saves         integer NOT NULL DEFAULT 0,
  goals_against integer NOT NULL DEFAULT 0,
  shots_on_target_against integer NOT NULL DEFAULT 0,
  tackles_won   integer NOT NULL DEFAULT 0,
  interceptions integer NOT NULL DEFAULT 0,
  tackles_interceptions integer NOT NULL DEFAULT 0,
  wins          integer NOT NULL DEFAULT 0,
  draws         integer NOT NULL DEFAULT 0,
  losses        integer NOT NULL DEFAULT 0,
  raw_score     numeric NOT NULL DEFAULT 0,
  performance_score numeric NOT NULL DEFAULT 0,   -- z-score normalized within position bucket
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, position_bucket, player_uid)
);

-- 2. Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_perf_scope_pos
  ON player_performance_scores (scope_type, scope_id, position_bucket);

CREATE INDEX IF NOT EXISTS idx_perf_player
  ON player_performance_scores (player_uid);

-- ============================================================
-- 3. Function: compute_performance_scores()
--    Computes raw scores for ALL scopes, then z-score normalizes
--    within each (scope_type, scope_id, position_bucket) group.
-- ============================================================
CREATE OR REPLACE FUNCTION compute_performance_scores()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  epl_comp_id integer;
BEGIN
  -- Get EPL competition_id
  SELECT competition_id INTO epl_comp_id
  FROM competitions
  WHERE competition_name = 'Premier League'
  LIMIT 1;

  IF epl_comp_id IS NULL THEN
    RAISE EXCEPTION 'Premier League competition not found';
  END IF;

  -- Clear existing scores
  TRUNCATE player_performance_scores;

  -- ============================================================
  -- STEP A: Insert raw aggregated stats + raw_score for LEAGUE scope
  -- Aggregates player_season_stats across ALL EPL seasons
  -- ============================================================
  INSERT INTO player_performance_scores (
    scope_type, scope_id, position_bucket, player_uid, player_name, nationality,
    appearances, goals, assists, minutes,
    clean_sheets, saves, goals_against, shots_on_target_against,
    tackles_won, interceptions, tackles_interceptions,
    wins, draws, losses,
    raw_score, performance_score, computed_at
  )
  SELECT
    'league'::text,
    NULL::integer,
    pss.position_bucket,
    pss.player_uid,
    p.player_name,
    p.nationality_norm,
    SUM(COALESCE(pss.appearances, 0))::integer,
    SUM(COALESCE(pss.goals, 0))::integer,
    SUM(COALESCE(pss.assists, 0))::integer,
    SUM(COALESCE(pss.minutes, 0))::integer,
    SUM(COALESCE(pss.clean_sheets, 0))::integer,
    SUM(COALESCE(pss.saves, 0))::integer,
    SUM(COALESCE(pss.goals_against, 0))::integer,
    SUM(COALESCE(pss.shots_on_target_against, 0))::integer,
    SUM(COALESCE(pss.tackles_won, 0))::integer,
    SUM(COALESCE(pss.interceptions, 0))::integer,
    SUM(COALESCE(pss.tackles_interceptions, 0))::integer,
    SUM(COALESCE(pss.wins, 0))::integer,
    SUM(COALESCE(pss.draws, 0))::integer,
    SUM(COALESCE(pss.losses, 0))::integer,
    -- Raw score computed below
    0,
    0,
    now()
  FROM player_season_stats pss
  JOIN players p ON p.player_uid = pss.player_uid
  WHERE pss.competition_id = epl_comp_id
    AND pss.position_bucket IS NOT NULL
  GROUP BY pss.position_bucket, pss.player_uid, p.player_name, p.nationality_norm
  HAVING SUM(COALESCE(pss.appearances, 0)) >= 40;  -- league min threshold

  -- ============================================================
  -- STEP B: Insert raw aggregated stats for CLUB scopes
  -- Only for the 5 supported clubs
  -- ============================================================
  INSERT INTO player_performance_scores (
    scope_type, scope_id, position_bucket, player_uid, player_name, nationality,
    appearances, goals, assists, minutes,
    clean_sheets, saves, goals_against, shots_on_target_against,
    tackles_won, interceptions, tackles_interceptions,
    wins, draws, losses,
    raw_score, performance_score, computed_at
  )
  SELECT
    'club'::text,
    pss.club_id,
    pss.position_bucket,
    pss.player_uid,
    p.player_name,
    p.nationality_norm,
    SUM(COALESCE(pss.appearances, 0))::integer,
    SUM(COALESCE(pss.goals, 0))::integer,
    SUM(COALESCE(pss.assists, 0))::integer,
    SUM(COALESCE(pss.minutes, 0))::integer,
    SUM(COALESCE(pss.clean_sheets, 0))::integer,
    SUM(COALESCE(pss.saves, 0))::integer,
    SUM(COALESCE(pss.goals_against, 0))::integer,
    SUM(COALESCE(pss.shots_on_target_against, 0))::integer,
    SUM(COALESCE(pss.tackles_won, 0))::integer,
    SUM(COALESCE(pss.interceptions, 0))::integer,
    SUM(COALESCE(pss.tackles_interceptions, 0))::integer,
    SUM(COALESCE(pss.wins, 0))::integer,
    SUM(COALESCE(pss.draws, 0))::integer,
    SUM(COALESCE(pss.losses, 0))::integer,
    0,
    0,
    now()
  FROM player_season_stats pss
  JOIN players p ON p.player_uid = pss.player_uid
  WHERE pss.competition_id = epl_comp_id
    AND pss.position_bucket IS NOT NULL
    AND pss.club_id IN (
      SELECT club_id FROM clubs
      WHERE club_name IN ('Sunderland', 'Manchester United', 'Arsenal', 'Liverpool', 'Chelsea')
    )
  GROUP BY pss.club_id, pss.position_bucket, pss.player_uid, p.player_name, p.nationality_norm
  HAVING SUM(COALESCE(pss.appearances, 0)) >= 20;  -- club min threshold

  -- ============================================================
  -- STEP C: Compute raw_score based on position bucket
  -- ============================================================

  -- FWD + MID: attacking score
  UPDATE player_performance_scores
  SET raw_score = (
    (goals * 4.0 + assists * 3.0 + (goals + assists) * 1.0)
    / GREATEST(minutes::numeric / 90.0, 1.0)
  ) * sqrt(appearances::numeric)
  WHERE position_bucket IN ('FWD', 'MID');

  -- DEF: defensive score (fallback to availability + contributions)
  UPDATE player_performance_scores
  SET raw_score = (
    ((CASE WHEN COALESCE(tackles_interceptions, 0) > 0 THEN tackles_interceptions
           WHEN COALESCE(tackles_won, 0) + COALESCE(interceptions, 0) > 0 THEN tackles_won + interceptions
           ELSE 0 END)::numeric * 0.08
     + assists * 2.0
     + goals * 2.0)
    / GREATEST(minutes::numeric / 90.0, 1.0)
  ) * sqrt(appearances::numeric)
  WHERE position_bucket = 'DEF';

  -- GK: goalkeeper score
  UPDATE player_performance_scores
  SET raw_score = (
    (CASE WHEN appearances > 0 THEN clean_sheets::numeric / appearances ELSE 0 END) * 5.0
    + (CASE WHEN shots_on_target_against > 0 THEN LEAST(saves::numeric / shots_on_target_against, 1.0) ELSE 0 END) * 4.0
    - (goals_against::numeric / GREATEST(minutes::numeric / 90.0, 1.0)) * 2.0
  ) * sqrt(appearances::numeric)
  WHERE position_bucket = 'GK';

  -- ============================================================
  -- STEP D: Z-score normalize within each (scope, position) group
  -- performance_score = (raw - mean) / stddev
  -- If stddev = 0, set performance_score = 0
  -- ============================================================
  UPDATE player_performance_scores pps
  SET performance_score = CASE
    WHEN stats.stddev_val > 0
      THEN (pps.raw_score - stats.mean_val) / stats.stddev_val
    ELSE 0
  END
  FROM (
    SELECT
      scope_type, scope_id, position_bucket,
      AVG(raw_score) AS mean_val,
      STDDEV_POP(raw_score) AS stddev_val
    FROM player_performance_scores
    GROUP BY scope_type, scope_id, position_bucket
  ) stats
  WHERE pps.scope_type = stats.scope_type
    AND pps.scope_id IS NOT DISTINCT FROM stats.scope_id
    AND pps.position_bucket = stats.position_bucket;

END;
$$;

-- ============================================================
-- 4. Run the computation (execute this after creating the function)
-- ============================================================
SELECT compute_performance_scores();
