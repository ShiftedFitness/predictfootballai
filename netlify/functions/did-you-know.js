/**
 * did-you-know.js — Return dynamic stats for the homepage "Did You Know?" section
 *
 * POST body (optional): { userId: number }
 * Returns: { stats: [{ type, text }] }
 */

const { sb, respond, handleOptions } = require('./_supabase');

exports.handler = async (event) => {
  const cors = handleOptions(event);
  if (cors) return cors;

  let userId = null;
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      userId = body.userId;
    } catch {}
  }

  const client = sb();
  const stats = [];

  try {
    // 1. Top ranked player by performance score (overall)
    const { data: topPerf } = await client
      .from('player_performance_scores')
      .select('player_name, performance_score, position_bucket')
      .eq('scope_type', 'league')
      .order('performance_score', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (topPerf) {
      stats.push({
        type: 'top_performer',
        text: `${topPerf.player_name} holds the highest performance rating across all ${topPerf.position_bucket}s in Premier League history`
      });
    }

    // 2. Total perfect Bullseye checkouts
    const { count: perfectCount } = await client
      .from('ts_game_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('game_type', 'bullseye')
      .eq('is_perfect_round', true);

    if (perfectCount !== null) {
      stats.push({
        type: 'bullseye_checkouts',
        text: perfectCount > 0
          ? `${perfectCount} perfect Bullseye checkout${perfectCount !== 1 ? 's have' : ' has'} been achieved so far. Can you add to it?`
          : `Nobody has hit a perfect Bullseye checkout yet. Will you be the first?`
      });
    }

    // 3. Total number of players in the database
    const { count: playerCount } = await client
      .from('players')
      .select('player_uid', { count: 'exact', head: true });

    if (playerCount) {
      stats.push({
        type: 'player_count',
        text: `The TeleStats database contains ${playerCount.toLocaleString()} players across 30+ seasons of Premier League football`
      });
    }

    // 4. Total community games created
    const { count: communityCount } = await client
      .from('ts_community_games')
      .select('id', { count: 'exact', head: true });

    if (communityCount !== null && communityCount > 0) {
      stats.push({
        type: 'community_games',
        text: `The community has created ${communityCount} custom game${communityCount !== 1 ? 's' : ''} — browse and play them all`
      });
    }

    // 5. User's personal stats (if logged in)
    if (userId) {
      const { data: userStats } = await client
        .from('ts_users')
        .select('total_games_played, total_xp, current_streak, level_name')
        .eq('id', userId)
        .maybeSingle();

      if (userStats?.total_games_played > 0) {
        stats.push({
          type: 'personal',
          text: `You've played ${userStats.total_games_played} game${userStats.total_games_played !== 1 ? 's' : ''} and earned ${(userStats.total_xp || 0).toLocaleString()} XP as a ${userStats.level_name || 'player'}`
        });
      }
    }

    // Shuffle and return 2-3 stats
    const shuffled = stats.sort(() => Math.random() - 0.5).slice(0, 3);

    return respond(200, { stats: shuffled });

  } catch (err) {
    console.error('did-you-know error:', err);
    return respond(200, { stats: [] });
  }
};
