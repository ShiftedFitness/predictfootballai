-- ============================================================
-- 002_current_season_table.sql
-- Creates current_season_player_stats table + combined view
-- Run via Supabase SQL Editor
-- ============================================================

-- 1. Create the current_season_player_stats table
--    Mirrors player_season_stats schema but for in-season data
--    that gets overwritten weekly (not append-only)
CREATE TABLE IF NOT EXISTS current_season_player_stats (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_uid      text NOT NULL REFERENCES players(player_uid),
  competition_id  integer NOT NULL REFERENCES competitions(competition_id),
  club_id         integer NOT NULL REFERENCES clubs(club_id),
  season_label    text NOT NULL,          -- e.g. '2025/26'
  season_start_year integer NOT NULL,     -- e.g. 2025
  position_raw    text,                   -- FBref raw e.g. 'FW,MF'
  position_bucket text,                   -- GK/DEF/MID/FWD
  age             integer,
  appearances     integer DEFAULT 0,
  starts          integer DEFAULT 0,
  sub_appearances integer DEFAULT 0,
  minutes         integer DEFAULT 0,
  goals           integer DEFAULT 0,
  assists         integer DEFAULT 0,
  pens_scored     integer DEFAULT 0,
  pens_attempted  integer DEFAULT 0,
  goals_against   integer,               -- GK only
  clean_sheets    integer,               -- GK only
  shots_on_target_against integer,       -- GK only
  saves           integer,               -- GK only
  wins            integer,               -- GK only
  draws           integer,               -- GK only
  losses          integer,               -- GK only
  tackles_won     integer,
  interceptions   integer,
  tackles_interceptions integer,
  is_u19          boolean DEFAULT false,
  is_u21          boolean DEFAULT false,
  is_35plus       boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),

  -- Unique constraint for upsert: one row per player+comp+club+season
  CONSTRAINT uq_current_season_player
    UNIQUE (player_uid, competition_id, club_id, season_label)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_csps_comp_season
  ON current_season_player_stats(competition_id, season_label);
CREATE INDEX IF NOT EXISTS idx_csps_player
  ON current_season_player_stats(player_uid);
CREATE INDEX IF NOT EXISTS idx_csps_club
  ON current_season_player_stats(club_id);

-- 2. Create combined view: historical + current season
CREATE OR REPLACE VIEW v_all_player_season_stats AS
SELECT
  id,
  player_uid,
  competition_id,
  club_id,
  season_label,
  season_start_year,
  position_raw,
  position_bucket,
  age,
  appearances,
  starts,
  sub_appearances,
  minutes,
  goals,
  assists,
  pens_scored,
  pens_attempted,
  goals_against,
  clean_sheets,
  shots_on_target_against,
  saves,
  wins,
  draws,
  losses,
  tackles_won,
  interceptions,
  tackles_interceptions,
  is_u19,
  is_u21,
  is_35plus,
  'historical'::text AS source
FROM player_season_stats

UNION ALL

SELECT
  id,
  player_uid,
  competition_id,
  club_id,
  season_label,
  season_start_year,
  position_raw,
  position_bucket,
  age,
  appearances,
  starts,
  sub_appearances,
  minutes,
  goals,
  assists,
  pens_scored,
  pens_attempted,
  goals_against,
  clean_sheets,
  shots_on_target_against,
  saves,
  wins,
  draws,
  losses,
  tackles_won,
  interceptions,
  tackles_interceptions,
  is_u19,
  is_u21,
  is_35plus,
  'current'::text AS source
FROM current_season_player_stats;

-- 3. Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_csps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_csps_updated_at ON current_season_player_stats;
CREATE TRIGGER trg_csps_updated_at
  BEFORE UPDATE ON current_season_player_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_csps_updated_at();
