-- ============================================================
-- 017_base_table_views.sql
--
-- 016 renamed player_season_stats to player_season_stats_pre_rebuild and put
-- a view called v_all_player_season_stats in front of the new data. That
-- covered every Netlify function, because all of them read the view.
--
-- It did not cover compute_performance_scores(), which reads the BASE TABLE
-- by name:
--
--     FROM player_season_stats pss
--     JOIN players p ON p.player_uid = pss.player_uid
--
-- so calling it after the swap failed with 42P01. I had checked the function
-- files for references and missed this one, because it lives inside a stored
-- procedure rather than in the repository.
--
-- The fix restores the two base-table names as views over the rebuilt data.
-- That also protects anything else still addressing them that neither of us
-- has found — a saved query, an RPC, a dashboard.
--
-- The swap itself is unaffected and stays committed. Nothing here touches it.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. player_season_stats — the name the RPC expects.
--
--    Everything it needs is already assembled by v_all_player_season_stats:
--    the canonical player_uid, competition_id, club_id, position_bucket and
--    every counting column. Defining it as a passthrough keeps the two in
--    step for good, rather than leaving a second definition to drift.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.player_season_stats AS
SELECT * FROM public.v_all_player_season_stats;

GRANT SELECT ON public.player_season_stats TO service_role, authenticated, anon;


-- ────────────────────────────────────────────────────────────
-- 2. current_season_player_stats — the other half of the old split.
--
--    The rebuild has one table, so "current" is no longer a separate store;
--    it is simply the newest season present. Anything still asking for this
--    name gets what it always meant.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.current_season_player_stats AS
SELECT * FROM public.v_all_player_season_stats
WHERE season_start_year = (
  SELECT max(season_start_year) FROM public.player_season_stats_v2
);

GRANT SELECT ON public.current_season_player_stats TO service_role, authenticated, anon;


-- ────────────────────────────────────────────────────────────
-- 3. NOW re-run the performance scores.
--
--    Two things improve on their own as a result of the rebuild. The scores
--    group by player_uid, so a player who used to be split across three uids
--    is now rated once on his whole career rather than three times on
--    fragments of it. And scope_id is written from the new club ids, which is
--    what xi_start and xi_score now expect.
--
--    Takes a little while — it aggregates the whole database per scope. If it
--    fails, the previous copy is in the backup:
--      data/backups/2026-09-04T12-00-36/player_performance_scores.ndjson
-- ────────────────────────────────────────────────────────────

SELECT public.compute_performance_scores();


-- ────────────────────────────────────────────────────────────
-- VERIFY
-- ────────────────────────────────────────────────────────────

SELECT 'player_season_stats' AS name, count(*) AS rows FROM public.player_season_stats
UNION ALL
SELECT 'current_season',            count(*)         FROM public.current_season_player_stats
UNION ALL
SELECT 'performance_scores',        count(*)         FROM public.player_performance_scores;

-- Club scopes should now carry the NEW club ids — Arsenal is 4, not 94.
SELECT s.scope_type, s.scope_id, c.club_name, count(*) AS rated_players
FROM public.player_performance_scores s
LEFT JOIN public.clubs c ON c.club_id = s.scope_id
WHERE s.scope_type = 'club'
GROUP BY s.scope_type, s.scope_id, c.club_name
ORDER BY rated_players DESC
LIMIT 8;
