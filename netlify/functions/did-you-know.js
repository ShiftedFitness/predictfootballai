/**
 * did-you-know.js — Return dynamic, game-specific stats for the homepage
 *
 * Designed to hook players with interesting data tidbits that make them
 * want to dig deeper into the games.
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
    // 1. Bullseye: Is there a player with exactly 501 appearances? (direct checkout!)
    const { data: exact501 } = await client
      .from('v_game_player_club_comp')
      .select('player_name, appearances')
      .eq('competition_name', 'Premier League')
      .eq('appearances', 501)
      .limit(1)
      .maybeSingle();

    if (exact501) {
      stats.push({
        type: 'bullseye_501',
        text: `${exact501.player_name} has exactly 501 Premier League appearances — a one-pick Bullseye checkout!`
      });
    } else {
      stats.push({
        type: 'bullseye_501',
        text: `No player has exactly 501 Premier League appearances. A one-pick Bullseye checkout remains impossible… for now.`
      });
    }

    // 2. How many players have only ever had 1 EPL match?
    const { data: oneMatchData } = await client
      .from('v_game_player_club_comp')
      .select('player_uid', { count: 'exact', head: true })
      .eq('competition_name', 'Premier League')
      .eq('appearances', 1);

    if (oneMatchData !== null) {
      // oneMatchData is null when head: true, use count instead
      const { count: oneMatchCount } = await client
        .from('v_game_player_club_comp')
        .select('player_uid', { count: 'exact', head: true })
        .eq('competition_name', 'Premier League')
        .eq('appearances', 1);

      if (oneMatchCount) {
        stats.push({
          type: 'one_match_wonders',
          text: `${oneMatchCount.toLocaleString()} players have made just 1 Premier League appearance — true one-match wonders. Can you name any?`
        });
      }
    }

    // 3. Best XI performance rating holder
    const { data: topPerf } = await client
      .from('player_performance_scores')
      .select('player_name, performance_score, position_bucket')
      .eq('scope_type', 'league')
      .order('performance_score', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (topPerf) {
      stats.push({
        type: 'xi_top_rated',
        text: `${topPerf.player_name} holds the highest Starting XI performance rating (${topPerf.performance_score.toFixed(1)}) across all ${topPerf.position_bucket}s in EPL history`
      });
    }

    // 4. Player who played for the most EPL clubs
    const { data: mostClubs } = await client
      .rpc('sql', { query: `
        SELECT player_name, COUNT(DISTINCT club_name) as club_count
        FROM v_game_player_club_comp
        WHERE competition_name = 'Premier League' AND appearances > 0
        GROUP BY player_uid, player_name
        ORDER BY club_count DESC
        LIMIT 1
      `}).maybeSingle();

    // If RPC doesn't work, skip this stat silently
    if (mostClubs && mostClubs.player_name) {
      stats.push({
        type: 'most_clubs',
        text: `${mostClubs.player_name} played for ${mostClubs.club_count} different Premier League clubs — the ultimate journeyman. Perfect for Alphabet!`
      });
    }

    // 5. Total perfect Bullseye checkouts
    const { count: perfectCount } = await client
      .from('ts_game_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('game_type', 'bullseye')
      .eq('is_perfect_round', true);

    if (perfectCount !== null) {
      stats.push({
        type: 'bullseye_checkouts',
        text: perfectCount > 0
          ? `Only ${perfectCount} perfect Bullseye checkout${perfectCount !== 1 ? 's have' : ' has'} been achieved. Can you join the elite?`
          : `Nobody has hit a perfect Bullseye checkout yet. Will you be the first to hit exactly zero?`
      });
    }

    // 6. Total players in database
    const { count: playerCount } = await client
      .from('players')
      .select('player_uid', { count: 'exact', head: true });

    if (playerCount) {
      stats.push({
        type: 'player_count',
        text: `${playerCount.toLocaleString()} players across 5 European leagues are in the TeleStats database — and growing`
      });
    }

    // 7. Highest-scoring player (goals)
    const { data: topScorer } = await client
      .from('v_game_player_club_comp')
      .select('player_name, goals')
      .eq('competition_name', 'Premier League')
      .order('goals', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (topScorer) {
      stats.push({
        type: 'top_scorer',
        text: `${topScorer.player_name} is the all-time EPL top scorer with ${topScorer.goals} goals. Worth ${topScorer.goals} points in a Goals Bullseye!`
      });
    }

    // 8. User's personal stats (if logged in)
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

    // Shuffle and return 3 stats
    const shuffled = stats.sort(() => Math.random() - 0.5).slice(0, 3);

    return respond(200, { stats: shuffled });

  } catch (err) {
    console.error('did-you-know error:', err);
    return respond(200, { stats: [] });
  }
};
