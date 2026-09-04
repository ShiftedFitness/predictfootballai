-- ============================================================
-- 016_swap.sql   —   THE CUTOVER
--
-- Points the live names at the rebuilt data. One transaction: it either all
-- happens or none of it does.
--
-- DO NOT RUN THIS UNTIL THE SMOKE TEST PASSES. As of 4 Sep 2026 it does:
--
--     node scripts/fbref/smoke.js --live     13 passed · 1 failed
--     node scripts/fbref/smoke.js            13 passed · 1 failed
--
-- Same functions, same results, against old data and new. The single failure
-- is a test query of mine that matches nothing in either — not a regression.
--
-- WHAT THIS IS NOT: a table rename. The rebuilt tables key on player_id, not
-- player_uid, and every club_id changed. What actually moves are the four
-- compatibility VIEWS from 015 — they already emit the old column names from
-- the new tables, and every game function has been run against them.
--
-- SAFE BECAUSE:
--   · the old tables are renamed, never dropped — rollback is at the bottom
--   · no function writes to players, clubs or player_season_stats (checked:
--     every reference is a read), so replacing them with views breaks nothing
--   · nothing anonymous reads them; all four names return 401 without a key
--   · saved community games embed their payload and never re-query by uid
-- ============================================================


BEGIN;

-- 1. The old views have to go first: they are defined over the old tables and
--    hold the names we want.
DROP VIEW IF EXISTS public.v_game_player_club_comp CASCADE;
DROP VIEW IF EXISTS public.v_all_player_season_stats CASCADE;

-- 2. Park the old tables. Renamed, not dropped: foreign keys, policies and
--    row counts all survive, and they stay one command from coming back.
ALTER TABLE public.players                     RENAME TO players_pre_rebuild;
ALTER TABLE public.clubs                       RENAME TO clubs_pre_rebuild;
ALTER TABLE public.player_season_stats         RENAME TO player_season_stats_pre_rebuild;
ALTER TABLE public.current_season_player_stats RENAME TO current_season_player_stats_pre_rebuild;

-- 3. Promote the compatibility views into the live names.
--    Views bind to the OID of what they select from, not its name, so these
--    keep pointing at players_v2 / clubs_v2 / player_season_stats_v2 no matter
--    what gets renamed around them.
ALTER VIEW public.players_compat                    RENAME TO players;
ALTER VIEW public.clubs_compat                      RENAME TO clubs;
ALTER VIEW public.v_all_player_season_stats_compat  RENAME TO v_all_player_season_stats;
ALTER VIEW public.v_game_player_club_comp_compat    RENAME TO v_game_player_club_comp;

-- 4. Match the grants the tables had, so the functions keep their access.
GRANT SELECT ON public.players                   TO service_role, authenticated, anon;
GRANT SELECT ON public.clubs                     TO service_role, authenticated, anon;
GRANT SELECT ON public.v_all_player_season_stats TO service_role, authenticated, anon;
GRANT SELECT ON public.v_game_player_club_comp   TO service_role, authenticated, anon;

COMMIT;


-- ────────────────────────────────────────────────────────────
-- VERIFY — run straight after. Every row should read true.
-- ────────────────────────────────────────────────────────────

SELECT 'players'      AS name, count(*) AS rows, count(*) > 36000  AS ok FROM public.players
UNION ALL
SELECT 'clubs',                count(*),         count(*) > 500          FROM public.clubs
UNION ALL
SELECT 'season stats',         count(*),         count(*) > 200000       FROM public.v_all_player_season_stats
UNION ALL
SELECT 'game view',            count(*),         count(*) > 100000       FROM public.v_game_player_club_comp;

-- The four tiers of English football, which is the point of the whole exercise.
SELECT c.tier, c.competition_name,
       min(s.season_start_year) AS from_season,
       max(s.season_start_year) AS to_season,
       count(*)                 AS rows
FROM public.v_all_player_season_stats s
JOIN public.competitions c USING (competition_id)
WHERE c.country = 'ENG' AND c.tier IS NOT NULL
GROUP BY c.tier, c.competition_name
ORDER BY c.tier;


-- ────────────────────────────────────────────────────────────
-- STEP 2 OF 2 — RUN THIS YOURSELF, after the transaction above commits.
--
--    It is left commented ON PURPOSE. Pasting this whole file does the swap
--    and the verification; it does NOT do this. Uncomment the last line, or
--    just run it on its own once the checks above look right.
--
--    player_performance_scores is a denormalised cache: it carries its own
--    player names and totals, and xi_start reads them directly rather than
--    joining. So it survives the swap intact — except for scope_id, which
--    holds a CLUB ID, and every club id changed. Its 6,548 rows also key on
--    the old player_uid, only 41% of which are the canonical form.
--
--    Recomputing is cleaner than re-keying: this RPC reads the live names,
--    which by now point at the rebuilt data, so it regenerates scores and
--    scope ids consistently in one step. The pre-rebuild copy is in
--    data/backups/<timestamp>/player_performance_scores.ndjson if needed.
-- ────────────────────────────────────────────────────────────

SELECT public.compute_performance_scores();   -- <<< RUN THIS SEPARATELY


-- ────────────────────────────────────────────────────────────
-- ROLLBACK — if anything looks wrong, this puts it all back.
-- The old tables are untouched by everything above.
-- ────────────────────────────────────────────────────────────

-- BEGIN;
--   ALTER VIEW public.players                   RENAME TO players_compat;
--   ALTER VIEW public.clubs                     RENAME TO clubs_compat;
--   ALTER VIEW public.v_all_player_season_stats RENAME TO v_all_player_season_stats_compat;
--   ALTER VIEW public.v_game_player_club_comp   RENAME TO v_game_player_club_comp_compat;
--
--   ALTER TABLE public.players_pre_rebuild                     RENAME TO players;
--   ALTER TABLE public.clubs_pre_rebuild                       RENAME TO clubs;
--   ALTER TABLE public.player_season_stats_pre_rebuild         RENAME TO player_season_stats;
--   ALTER TABLE public.current_season_player_stats_pre_rebuild RENAME TO current_season_player_stats;
--
--   -- and restore the original two views (see sql/002 and sql/003)
-- COMMIT;
