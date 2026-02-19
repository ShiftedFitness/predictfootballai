/**
 * TeleStats Data Module
 * Shared data layer for game sessions, leaderboards, profiles, community.
 *
 * Requires: ts-auth.js loaded first (for TSAuth.supabase)
 */

(function () {
  'use strict';

  function sb() { return TSAuth.supabase; }

  const GAME_TYPE_LABELS = {
    bullseye: 'Bullseye',
    starting_xi: 'Starting XI',
    who_am_i: 'Who Am I?',
    pop_quiz: 'Pop Quiz',
    higher_lower: 'Higher or Lower',
    player_alphabet: 'Player Alphabet'
  };

  const GAME_TYPE_ICONS = {
    bullseye: '\uD83C\uDFAF',
    starting_xi: '\u26BD',
    who_am_i: '\uD83D\uDD75\uFE0F',
    pop_quiz: '\uD83E\uDDE0',
    higher_lower: '\uD83C\uDCCF',
    player_alphabet: '\uD83D\uDD24'
  };

  const TSData = {

    GAME_TYPE_LABELS,
    GAME_TYPE_ICONS,

    /**
     * Log a completed game session and award XP.
     * @param {Object} sessionData - Game results
     * @returns {Object} XP result from award_xp_for_session
     */
    async logGameSession(sessionData) {
      const userId = TSAuth.getUserId();
      if (!userId) return { error: 'No user' };

      // Increment daily play count
      await this.incrementDailyPlay(sessionData.game_type);

      // Insert game session
      const { data: session, error: insertErr } = await sb()
        .from('ts_game_sessions')
        .insert({
          user_id: userId,
          game_type: sessionData.game_type,
          game_category: sessionData.game_category || null,
          score: sessionData.score || null,
          max_possible_score: sessionData.max_possible_score || null,
          correct_answers: sessionData.correct_answers || 0,
          total_questions: sessionData.total_questions || 0,
          darts_used: sessionData.darts_used || null,
          checkout_score: sessionData.checkout_score || null,
          players_named: sessionData.players_named || null,
          time_taken_seconds: sessionData.time_taken_seconds || null,
          guesses_used: sessionData.guesses_used || null,
          is_perfect_round: sessionData.is_perfect_round || false,
          completed: sessionData.completed !== false
        })
        .select('id')
        .single();

      if (insertErr) {
        console.error('[TSData] Failed to log session:', insertErr);
        return { error: insertErr.message };
      }

      // Award XP via RPC
      const { data: xpResult, error: xpErr } = await sb()
        .rpc('award_xp_for_session', { p_session_id: session.id });

      if (xpErr) {
        console.error('[TSData] XP award failed:', xpErr);
        return { session_id: session.id, error: xpErr.message };
      }

      // Refresh user profile cache
      await TSAuth.refreshProfile();

      return {
        session_id: session.id,
        ...xpResult
      };
    },

    /** Increment daily play count for a game type */
    async incrementDailyPlay(gameType) {
      const userId = TSAuth.getUserId();
      if (!userId) return;

      const today = new Date().toISOString().split('T')[0];
      const { data: existing } = await sb()
        .from('ts_daily_plays')
        .select('id, play_count')
        .eq('user_id', userId)
        .eq('play_date', today)
        .eq('game_type', gameType)
        .maybeSingle();

      if (existing) {
        await sb().from('ts_daily_plays')
          .update({ play_count: existing.play_count + 1 })
          .eq('id', existing.id);
      } else {
        await sb().from('ts_daily_plays')
          .insert({ user_id: userId, play_date: today, game_type: gameType, play_count: 1 });
      }
    },

    /** Get remaining plays today for a game type */
    async getRemainingPlays(gameType) {
      const userId = TSAuth.getUserId();
      const tier = TSAuth.getTier();
      if (tier === 'paid') return { remaining: Infinity, limit: Infinity };

      const today = new Date().toISOString().split('T')[0];

      if (tier === 'anonymous') {
        const { data } = await sb()
          .from('ts_daily_plays')
          .select('play_count')
          .eq('user_id', userId)
          .eq('play_date', today);
        const total = (data || []).reduce((sum, r) => sum + r.play_count, 0);
        return { remaining: Math.max(0, 3 - total), limit: 3 };
      }

      // Free tier
      const user = TSAuth.getUser();
      const limit = user?.referral_unlocked ? 8 : 5;
      const { data } = await sb()
        .from('ts_daily_plays')
        .select('play_count')
        .eq('user_id', userId)
        .eq('play_date', today)
        .eq('game_type', gameType)
        .maybeSingle();
      const used = data?.play_count || 0;
      return { remaining: Math.max(0, limit - used), limit };
    },

    /** Fetch a user profile with achievements and ratings */
    async getProfile(userId) {
      const [userRes, achieveRes, ratingsRes, recentRes] = await Promise.all([
        sb().from('ts_users').select('*').eq('id', userId).single(),
        sb().from('ts_user_achievements')
          .select('achievement_id, earned_at, ts_achievements(name, description, icon, category, xp_reward)')
          .eq('user_id', userId),
        sb().from('ts_game_ratings').select('*').eq('user_id', userId),
        sb().from('ts_game_sessions')
          .select('id, game_type, game_category, score, correct_answers, total_questions, darts_used, players_named, guesses_used, xp_earned, is_perfect_round, played_at')
          .eq('user_id', userId)
          .order('played_at', { ascending: false })
          .limit(10)
      ]);

      return {
        user: userRes.data,
        achievements: achieveRes.data || [],
        ratings: ratingsRes.data || [],
        recentGames: recentRes.data || []
      };
    },

    /** Fetch profile by username */
    async getProfileByUsername(username) {
      const { data } = await sb().from('ts_users').select('id').eq('username', username).maybeSingle();
      if (!data) return null;
      return this.getProfile(data.id);
    },

    /** Global XP leaderboard */
    async getGlobalLeaderboard(limit = 50) {
      const { data, error } = await sb()
        .from('ts_leaderboard_global')
        .select('*')
        .limit(limit);
      if (error) { console.error('[TSData] leaderboard error:', error); return []; }
      return data || [];
    },

    /** Per-game leaderboard */
    async getGameLeaderboard(gameType, limit = 50) {
      const { data, error } = await sb()
        .from('ts_leaderboard_by_game')
        .select('*')
        .eq('game_type', gameType)
        .limit(limit);
      if (error) { console.error('[TSData] game leaderboard error:', error); return []; }
      return data || [];
    },

    /** Get all achievements (for display grid) */
    async getAllAchievements() {
      const { data } = await sb().from('ts_achievements').select('*').order('category');
      return data || [];
    },

    /** Community games: browse */
    async getCommunityGames(gameType, sortBy = 'popular', limit = 20) {
      let query = sb().from('ts_community_games')
        .select('*, ts_users!creator_id(username, display_name, avatar_url)')
        .eq('status', 'published');

      if (gameType && gameType !== 'all') query = query.eq('game_type', gameType);

      if (sortBy === 'popular') query = query.order('play_count', { ascending: false });
      else if (sortBy === 'rated') query = query.order('upvotes', { ascending: false });
      else if (sortBy === 'newest') query = query.order('created_at', { ascending: false });

      const { data, error } = await query.limit(limit);
      if (error) { console.error('[TSData] community games error:', error); return []; }
      return data || [];
    },

    /** Create a community game */
    async createCommunityGame(gameData) {
      const userId = TSAuth.getUserId();
      const { data, error } = await sb().from('ts_community_games')
        .insert({ ...gameData, creator_id: userId })
        .select('*')
        .single();
      if (error) return { error: error.message };
      // Increment creator's games_created count
      await sb().from('ts_users')
        .update({ games_created: (TSAuth.getUser()?.games_created || 0) + 1 })
        .eq('id', userId);
      return { game: data };
    },

    /** Vote on a community game */
    async voteCommunityGame(gameId, vote) {
      const userId = TSAuth.getUserId();
      const { error } = await sb().from('ts_community_votes')
        .upsert({ user_id: userId, game_id: gameId, vote }, { onConflict: 'user_id,game_id' });
      if (error) return { error: error.message };

      // Recalculate votes
      const { data: votes } = await sb().from('ts_community_votes').select('vote').eq('game_id', gameId);
      const upvotes = (votes || []).filter(v => v.vote === 1).length;
      const downvotes = (votes || []).filter(v => v.vote === -1).length;
      await sb().from('ts_community_games').update({ upvotes, downvotes }).eq('id', gameId);

      return { success: true, upvotes, downvotes };
    },

    /**
     * Generate share text for a game session result.
     * @param {Object} result - Game result data
     * @returns {string} Formatted share text
     */
    generateShareText(result) {
      const gameLabel = GAME_TYPE_LABELS[result.game_type] || result.game_type;
      const icon = GAME_TYPE_ICONS[result.game_type] || '';
      const user = TSAuth.getUser();
      const streak = user?.current_streak || 0;

      let scoreLine = '';
      switch (result.game_type) {
        case 'bullseye':
          scoreLine = `Score: 501 ${result.is_perfect_round ? '✓' : '✗'} in ${result.darts_used || '?'} darts`;
          break;
        case 'starting_xi':
          scoreLine = `Named: ${result.players_named || 0}/11 players`;
          break;
        case 'who_am_i':
          scoreLine = `Guessed in ${result.guesses_used || '?'} clue${(result.guesses_used || 0) !== 1 ? 's' : ''}`;
          break;
        case 'pop_quiz':
          scoreLine = `Score: ${result.correct_answers || 0}/${result.total_questions || 5}`;
          break;
        case 'higher_lower':
          scoreLine = `Streak: ${result.score || 0}`;
          break;
        case 'player_alphabet':
          scoreLine = `Letters: ${result.correct_answers || 0}/26`;
          break;
      }

      const lines = [
        `${icon} ${gameLabel} — TeleStats.net`,
        '━━━━━━━━━━━━━━━━━━',
        scoreLine,
        result.game_category ? `Category: ${result.game_category}` : null,
        result.xp_earned ? `+${result.xp_earned} XP` : null,
        streak > 1 ? `\uD83D\uDD25 Day ${streak} streak` : null,
        '━━━━━━━━━━━━━━━━━━',
        'Can you beat my score?',
        `telestats.net/games/`
      ].filter(Boolean);

      return lines.join('\n');
    },

    /** Share result via Web Share API or clipboard */
    async shareResult(result) {
      const text = this.generateShareText(result);
      if (navigator.share) {
        try {
          await navigator.share({ text });
          return { shared: true };
        } catch (e) {
          if (e.name !== 'AbortError') console.warn('[TSData] Share failed:', e);
        }
      }
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(text);
        return { copied: true };
      } catch {
        return { error: 'Failed to copy' };
      }
    }
  };

  window.TSData = TSData;
})();
