-- ============================================================
-- 018_fix_fk.sql   —   SETUP ONLY. NO RPC CALL. This will commit.
--
-- Supersedes 017, which rolled back in full: the Supabase SQL editor runs a
-- script as ONE transaction, so when compute_performance_scores() failed at
-- the end it took the view creation at the top down with it. Bundling a call
-- that might fail together with DDL that must land was my error, twice over.
--
-- So this file does the groundwork and nothing else. The RPC lives in 019 and
-- is pasted separately, where it can fail without undoing anything.
--
-- Two problems to fix, both invisible from the repository:
--
--   1. compute_performance_scores() reads the BASE TABLE by name
--        FROM player_season_stats pss JOIN players p ON ...
--      and 016 renamed that table. The body of a stored procedure is not
--      something grep over the repo can see.
--
--   2. player_performance_scores has a foreign key to players(player_uid).
--      Foreign keys bind to the TABLE, not its name, so the rename carried the
--      constraint along with it: it now polices players_pre_rebuild while the
--      RPC computes from live data. Every new or newly-canonical uid fails it —
--      "andy robertson|sco|1994" was the one that surfaced.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. WHAT ELSE IS STILL ATTACHED TO THE PARKED TABLES?
--    Read this output. Anything listed is the same problem waiting.
-- ────────────────────────────────────────────────────────────

SELECT
  con.conname                    AS constraint_name,
  child.relname                  AS on_table,
  parent.relname                 AS points_at,
  pg_get_constraintdef(con.oid)  AS definition
FROM pg_constraint con
JOIN pg_class child  ON child.oid  = con.conrelid
JOIN pg_class parent ON parent.oid = con.confrelid
WHERE con.contype = 'f'
  AND parent.relname LIKE '%_pre_rebuild'
ORDER BY child.relname, con.conname;


-- ────────────────────────────────────────────────────────────
-- 2. Restore the base-table names as views over the rebuilt data.
--    This is what 017 was meant to do. It covers the RPC, and anything else
--    still addressing these names that neither of us has found.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.player_season_stats AS
SELECT * FROM public.v_all_player_season_stats;

CREATE OR REPLACE VIEW public.current_season_player_stats AS
SELECT * FROM public.v_all_player_season_stats
WHERE season_start_year = (
  SELECT max(season_start_year) FROM public.player_season_stats_v2
);

GRANT SELECT ON public.player_season_stats         TO service_role, authenticated, anon;
GRANT SELECT ON public.current_season_player_stats TO service_role, authenticated, anon;


-- ────────────────────────────────────────────────────────────
-- 3. Drop the constraint that is blocking.
--
--    No integrity is lost. player_performance_scores is a derived cache: the
--    RPC empties and rebuilds it wholesale, and it carries its own copies of
--    player_name and every total rather than joining for them. The foreign key
--    was guarding against a table that is now a historical artefact.
--
--    It cannot be re-pointed at the new `players`, because that is a view, and
--    a foreign key needs a real table with a unique key. player_uid on
--    players_v2 is deliberately neither unique nor mandatory — it is a display
--    column; player_id is the key.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.player_performance_scores
  DROP CONSTRAINT IF EXISTS player_performance_scores_player_uid_fkey;


-- ────────────────────────────────────────────────────────────
-- VERIFY — then paste 019.
-- ────────────────────────────────────────────────────────────

SELECT 'player_season_stats'  AS name, count(*) AS rows FROM public.player_season_stats
UNION ALL
SELECT 'current_season',             count(*)          FROM public.current_season_player_stats;

SELECT count(*) AS fks_left_on_parked_tables
FROM pg_constraint con
JOIN pg_class parent ON parent.oid = con.confrelid
WHERE con.contype = 'f' AND parent.relname LIKE '%_pre_rebuild';
