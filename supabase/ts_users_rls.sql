-- ============================================================
-- ts_users RLS Policies
-- ============================================================
-- All INSERT/UPDATE operations go through Netlify functions
-- (service-role key, which bypasses RLS entirely).
-- Client-side JS only needs SELECT access.
-- ============================================================

-- 1. Enable RLS (if not already enabled)
ALTER TABLE public.ts_users ENABLE ROW LEVEL SECURITY;

-- 2. Drop any existing policies (clean slate)
DROP POLICY IF EXISTS "ts_users_select_all" ON public.ts_users;
DROP POLICY IF EXISTS "ts_users_insert_anon" ON public.ts_users;
DROP POLICY IF EXISTS "ts_users_insert_auth" ON public.ts_users;
DROP POLICY IF EXISTS "ts_users_update_own" ON public.ts_users;
DROP POLICY IF EXISTS "ts_users_update_anon" ON public.ts_users;
DROP POLICY IF EXISTS "Allow public read" ON public.ts_users;
DROP POLICY IF EXISTS "Allow insert" ON public.ts_users;
DROP POLICY IF EXISTS "Allow update own" ON public.ts_users;

-- 3. SELECT: Allow anyone to read ts_users rows
--    Needed for: lookups, leaderboards, profiles, referral code checks
CREATE POLICY "ts_users_select_all"
  ON public.ts_users
  FOR SELECT
  USING (true);

-- 4. INSERT: Allow via anon key (for edge cases where server function fails)
--    Primary inserts go through server functions, but this is a safety net
CREATE POLICY "ts_users_insert_open"
  ON public.ts_users
  FOR INSERT
  WITH CHECK (true);

-- 5. UPDATE: Allow authenticated users to update their own row
--    Needed for: refreshProfile, minor client-side updates
CREATE POLICY "ts_users_update_own_auth"
  ON public.ts_users
  FOR UPDATE
  USING (auth_id = auth.uid());

-- 6. UPDATE: Allow updates to anonymous rows (no auth_id)
--    Needed for: anonymous users updating their own profiles
--    (games_created now goes through server function, so this is minimal)
CREATE POLICY "ts_users_update_anon_rows"
  ON public.ts_users
  FOR UPDATE
  USING (auth_id IS NULL);

-- ============================================================
-- Also ensure ts_referrals and ts_daily_plays have proper RLS
-- ============================================================

-- ts_referrals: referral inserts now go through server function
ALTER TABLE IF EXISTS public.ts_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ts_referrals_select_all" ON public.ts_referrals;
DROP POLICY IF EXISTS "ts_referrals_insert_open" ON public.ts_referrals;
CREATE POLICY "ts_referrals_select_all" ON public.ts_referrals FOR SELECT USING (true);
CREATE POLICY "ts_referrals_insert_open" ON public.ts_referrals FOR INSERT WITH CHECK (true);

-- ts_daily_plays: needs client-side read/write for play tracking
ALTER TABLE IF EXISTS public.ts_daily_plays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ts_daily_plays_select_all" ON public.ts_daily_plays;
DROP POLICY IF EXISTS "ts_daily_plays_insert_open" ON public.ts_daily_plays;
DROP POLICY IF EXISTS "ts_daily_plays_update_open" ON public.ts_daily_plays;
CREATE POLICY "ts_daily_plays_select_all" ON public.ts_daily_plays FOR SELECT USING (true);
CREATE POLICY "ts_daily_plays_insert_open" ON public.ts_daily_plays FOR INSERT WITH CHECK (true);
CREATE POLICY "ts_daily_plays_update_open" ON public.ts_daily_plays FOR UPDATE USING (true);

-- ts_game_sessions: needs client-side insert for logging games
ALTER TABLE IF EXISTS public.ts_game_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ts_game_sessions_select_own" ON public.ts_game_sessions;
DROP POLICY IF EXISTS "ts_game_sessions_insert_open" ON public.ts_game_sessions;
CREATE POLICY "ts_game_sessions_select_own" ON public.ts_game_sessions FOR SELECT USING (true);
CREATE POLICY "ts_game_sessions_insert_open" ON public.ts_game_sessions FOR INSERT WITH CHECK (true);

-- ts_community_games: needs client-side read + insert
ALTER TABLE IF EXISTS public.ts_community_games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ts_community_games_select_all" ON public.ts_community_games;
DROP POLICY IF EXISTS "ts_community_games_insert_open" ON public.ts_community_games;
DROP POLICY IF EXISTS "ts_community_games_update_open" ON public.ts_community_games;
CREATE POLICY "ts_community_games_select_all" ON public.ts_community_games FOR SELECT USING (true);
CREATE POLICY "ts_community_games_insert_open" ON public.ts_community_games FOR INSERT WITH CHECK (true);
CREATE POLICY "ts_community_games_update_open" ON public.ts_community_games FOR UPDATE USING (true);

-- ts_community_votes: needs client-side upsert
ALTER TABLE IF EXISTS public.ts_community_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ts_community_votes_select_all" ON public.ts_community_votes;
DROP POLICY IF EXISTS "ts_community_votes_insert_open" ON public.ts_community_votes;
DROP POLICY IF EXISTS "ts_community_votes_update_open" ON public.ts_community_votes;
CREATE POLICY "ts_community_votes_select_all" ON public.ts_community_votes FOR SELECT USING (true);
CREATE POLICY "ts_community_votes_insert_open" ON public.ts_community_votes FOR INSERT WITH CHECK (true);
CREATE POLICY "ts_community_votes_update_open" ON public.ts_community_votes FOR UPDATE USING (true);

-- ts_game_ratings: needs client-side upsert
ALTER TABLE IF EXISTS public.ts_game_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ts_game_ratings_select_all" ON public.ts_game_ratings;
DROP POLICY IF EXISTS "ts_game_ratings_insert_open" ON public.ts_game_ratings;
DROP POLICY IF EXISTS "ts_game_ratings_update_open" ON public.ts_game_ratings;
CREATE POLICY "ts_game_ratings_select_all" ON public.ts_game_ratings FOR SELECT USING (true);
CREATE POLICY "ts_game_ratings_insert_open" ON public.ts_game_ratings FOR INSERT WITH CHECK (true);
CREATE POLICY "ts_game_ratings_update_open" ON public.ts_game_ratings FOR UPDATE USING (true);
