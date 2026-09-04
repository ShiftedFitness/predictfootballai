-- ============================================================
-- 019_recompute_scores.sql   —   THE RPC, ON ITS OWN.
--
-- Paste this by itself, after 018 has committed. Kept separate precisely
-- because it might fail: in the Supabase editor a whole script is one
-- transaction, so anything bundled with a failing call is undone with it.
-- Alone, a failure here costs nothing that has already landed.
--
-- It rebuilds player_performance_scores from the live data. Expect it to take
-- a little while — it aggregates the whole database once per scope.
--
-- Two things improve as a by-product of the rebuild:
--   · scores group by player_uid, so a player who was split across three uids
--     is now rated ONCE on his whole career instead of three times on
--     fragments of it
--   · scope_id is written with the NEW club ids, which is what the remapped
--     xi_start.js and xi_score.js now expect
--
-- If it fails, nothing is lost: the previous copy is at
--   data/backups/2026-09-04T12-00-36/player_performance_scores.ndjson
-- ============================================================

SELECT public.compute_performance_scores();


-- ── verify ──────────────────────────────────────────────────

SELECT scope_type, count(*) AS rows, count(DISTINCT player_uid) AS players
FROM public.player_performance_scores
GROUP BY scope_type
ORDER BY scope_type;

-- Club scopes should now carry the new ids — Arsenal is 4, not 94.
SELECT s.scope_id, c.club_name, count(*) AS rated
FROM public.player_performance_scores s
LEFT JOIN public.clubs c ON c.club_id = s.scope_id
WHERE s.scope_type = 'club'
GROUP BY s.scope_id, c.club_name
ORDER BY rated DESC
LIMIT 8;
