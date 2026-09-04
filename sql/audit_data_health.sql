-- ============================================================
-- audit_data_health.sql   (READ ONLY — nothing here writes)
--
-- Run in the Supabase SQL Editor. Answers the open questions
-- from the 2026-09-04 evergreen-data review:
--
--   A. What competitions do we hold, from when, and how fresh?
--      (this is also the query behind the Data Summary tab)
--   B. How badly is player identity fragmented?
--   C. Why is it fragmented — which uid formats are in play?
--   D. Are clubs fragmented the same way?
--   E. Salah as a worked example
--
-- NOTE: this is deliberately NOT numbered as a migration. It
-- changes nothing and can be re-run any time.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- A. DATA SUMMARY — one row per competition
--    First season, last season, coverage, volume.
-- ────────────────────────────────────────────────────────────
SELECT
  c.competition_id,
  c.competition_name,
  c.competition_group,
  MIN(s.season_start_year)                       AS first_season,
  MAX(s.season_start_year)                       AS last_season,
  COUNT(DISTINCT s.season_label)                 AS seasons_held,
  MAX(s.season_start_year) - MIN(s.season_start_year) + 1
                                                 AS season_span,
  COUNT(DISTINCT s.season_label)
    - (MAX(s.season_start_year) - MIN(s.season_start_year) + 1)
                                                 AS gap_seasons,  -- negative = missing seasons
  COUNT(*)                                       AS stat_rows,
  COUNT(DISTINCT s.player_uid)                   AS distinct_uids,
  COUNT(DISTINCT s.club_id)                      AS distinct_clubs
FROM v_all_player_season_stats s
JOIN competitions c USING (competition_id)
GROUP BY 1, 2, 3
ORDER BY 1;


-- A2. FRESHNESS — when was each competition's current-season data last written?
SELECT
  c.competition_id,
  c.competition_name,
  cs.season_label,
  COUNT(*)              AS rows,
  MAX(cs.updated_at)    AS last_updated,
  now() - MAX(cs.updated_at) AS age
FROM current_season_player_stats cs
JOIN competitions c USING (competition_id)
GROUP BY 1, 2, 3
ORDER BY 1;


-- A3. The stamp the /meta endpoint reads.
SELECT key, value, updated_at FROM ingestion_meta ORDER BY key;


-- ────────────────────────────────────────────────────────────
-- B. IDENTITY FRAGMENTATION — how many people hold >1 uid?
-- ────────────────────────────────────────────────────────────

-- B1. Headline numbers.
WITH by_name AS (
  SELECT lower(player_name) AS name, COUNT(*) AS uids
  FROM players
  WHERE player_name IS NOT NULL
  GROUP BY 1
)
SELECT
  COUNT(*) FILTER (WHERE uids = 1)  AS names_with_one_uid,
  COUNT(*) FILTER (WHERE uids > 1)  AS names_with_multiple_uids,
  SUM(uids) FILTER (WHERE uids > 1) AS surplus_player_rows,
  ROUND(100.0 * COUNT(*) FILTER (WHERE uids > 1) / NULLIF(COUNT(*), 0), 2)
                                    AS pct_names_fragmented
FROM by_name;

-- NOTE ON B1: shared names are real in football (two Danny Wards, etc.),
-- so this over-counts. B2 is the number that actually matters — it only
-- counts names whose uids differ ONLY in the nationality or birth-year
-- segment, which cannot be two different people.

-- B2. Fragmentation that is definitely a bug: same name, and the
--     name segment of the uid is identical, but the rest differs.
WITH parts AS (
  SELECT
    player_uid,
    player_name,
    split_part(player_uid, '|', 1) AS uid_name,
    split_part(player_uid, '|', 2) AS uid_nat,
    split_part(player_uid, '|', 3) AS uid_born
  FROM players
)
SELECT
  uid_name,
  COUNT(*)                                   AS uid_count,
  array_agg(DISTINCT uid_nat)                AS nationality_forms,
  array_agg(DISTINCT uid_born)               AS birth_year_forms,
  array_agg(player_uid ORDER BY player_uid)  AS uids
FROM parts
GROUP BY uid_name
HAVING COUNT(*) > 1
   -- same person if the birth years agree (or one is blank)
   AND COUNT(DISTINCT NULLIF(uid_born, '')) <= 1
ORDER BY uid_count DESC, uid_name
LIMIT 100;

-- B3. Just the count from B2 — the number to fix.
WITH parts AS (
  SELECT split_part(player_uid, '|', 1) AS uid_name,
         split_part(player_uid, '|', 3) AS uid_born
  FROM players
),
dupes AS (
  SELECT uid_name, COUNT(*) AS n
  FROM parts
  GROUP BY uid_name
  HAVING COUNT(*) > 1 AND COUNT(DISTINCT NULLIF(uid_born, '')) <= 1
)
SELECT COUNT(*) AS people_split, SUM(n) AS uids_involved FROM dupes;

-- B4. Careers actually broken by it: a person whose STATS span >1 uid.
--     This is the set of players the games currently get wrong.
WITH parts AS (
  SELECT player_uid, split_part(player_uid, '|', 1) AS uid_name
  FROM players
)
SELECT
  p.uid_name,
  COUNT(DISTINCT s.player_uid)                        AS uids_with_stats,
  COUNT(DISTINCT s.competition_id)                    AS competitions,
  SUM(s.appearances)                                  AS total_apps
FROM v_all_player_season_stats s
JOIN parts p USING (player_uid)
GROUP BY p.uid_name
HAVING COUNT(DISTINCT s.player_uid) > 1
ORDER BY total_apps DESC NULLS LAST
LIMIT 100;


-- ────────────────────────────────────────────────────────────
-- C. WHY — the shape of the uid strings themselves.
--    Expect to see BOTH a one-part and a two-part nationality
--    form. That split is the whole bug.
-- ────────────────────────────────────────────────────────────
SELECT
  CASE
    WHEN split_part(player_uid, '|', 2) = ''        THEN '3. nationality missing'
    WHEN split_part(player_uid, '|', 2) LIKE '% %'  THEN '2. two-part  (eg: "eg egy")'
    ELSE                                                 '1. one-part  (eg: "egy")'
  END AS nationality_form,
  CASE
    WHEN split_part(player_uid, '|', 3) = '' THEN 'no birth year'
    ELSE                                          'has birth year'
  END AS birth_year_form,
  COUNT(*) AS players,
  MIN(created_at) AS first_created,
  MAX(created_at) AS last_created
FROM players
GROUP BY 1, 2
ORDER BY 1, 2;

-- C2. Does the uid's nationality segment agree with the stored column?
--     Any row where they disagree was built before normalisation.
SELECT
  COUNT(*) FILTER (
    WHERE lower(COALESCE(nationality_norm, '')) = split_part(player_uid, '|', 2)
  ) AS uid_matches_column,
  COUNT(*) FILTER (
    WHERE lower(COALESCE(nationality_norm, '')) <> split_part(player_uid, '|', 2)
  ) AS uid_disagrees_with_column,
  COUNT(*) AS total
FROM players;


-- ────────────────────────────────────────────────────────────
-- D. CLUBS — same disease?
-- ────────────────────────────────────────────────────────────

-- D1. Exact duplicate club names holding different ids.
SELECT
  club_name,
  COUNT(*)                                  AS club_ids,
  array_agg(club_id ORDER BY club_id)       AS ids,
  array_agg(DISTINCT country)               AS countries
FROM clubs
GROUP BY club_name
HAVING COUNT(*) > 1
ORDER BY 2 DESC, club_name;

-- D2. The specific case spotted in review: Liverpool appears under two
--     club_ids in Salah's Champions League rows (28 and 206).
SELECT club_id, club_name, country, created_at
FROM clubs
WHERE club_id IN (28, 206) OR club_name ILIKE '%liverpool%'
ORDER BY club_id;

-- D3. Clubs carrying stats under more than one id, by volume.
SELECT
  cl.club_name,
  COUNT(DISTINCT s.club_id)  AS ids_in_use,
  array_agg(DISTINCT s.club_id) AS ids,
  SUM(s.appearances)         AS total_apps
FROM v_all_player_season_stats s
JOIN clubs cl ON cl.club_id = s.club_id
GROUP BY cl.club_name
HAVING COUNT(DISTINCT s.club_id) > 1
ORDER BY total_apps DESC NULLS LAST
LIMIT 50;


-- ────────────────────────────────────────────────────────────
-- E. WORKED EXAMPLE — Mohamed Salah.
--    Expect three uids, split by COMPETITION, not by club.
-- ────────────────────────────────────────────────────────────
SELECT
  s.player_uid,
  c.competition_name,
  COUNT(*)                        AS season_rows,
  MIN(s.season_label)             AS first_season,
  MAX(s.season_label)             AS last_season,
  SUM(s.appearances)              AS apps,
  SUM(s.goals)                    AS goals,
  array_agg(DISTINCT cl.club_name ORDER BY cl.club_name) AS clubs
FROM v_all_player_season_stats s
JOIN players p    USING (player_uid)
JOIN competitions c USING (competition_id)
JOIN clubs cl ON cl.club_id = s.club_id
WHERE p.player_name = 'Mohamed Salah'
GROUP BY s.player_uid, c.competition_name
ORDER BY s.player_uid, c.competition_name;
