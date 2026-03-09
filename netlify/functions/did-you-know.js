/**
 * did-you-know.js — Return dynamic, game-specific stats for the homepage
 *
 * Designed to hook players with interesting data tidbits that make them
 * want to dig deeper into the games.
 *
 * POST body (optional): { userId: number }
 * Returns: { stats: [{ type, text }] }
 *
 * OPTIMISATION: General stats (queries 1-7) are cached in-memory with a
 * 1-hour TTL.  Only the personal stats query (query 8) runs fresh on
 * every request when a userId is provided.  This reduces the typical
 * homepage load from 8 sequential DB queries down to 0-1.
 */

const { sb, respond, handleOptions } = require('./_supabase');

/* ── In-memory cache for general (non-user-specific) stats ────────── */
let _generalStatsCache = null;
let _generalStatsCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in ms

/**
 * Fetch general stats (queries 1-7) from the database.
 * These are the same for every visitor and change infrequently.
 */
async function fetchGeneralStats(client) {
  const stats = [];

  // 1. Bullseye: Is there a player with exactly 501 appearances?
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
      text: `${exact501.player_name} has exactly 501 Premier League appearances at one club — a one-pick Bullseye checkout!`
    });
  } else {
    // Check closest to 501
    const { data: close501 } = await client
      .from('v_game_player_club_comp')
      .select('player_name, appearances')
      .eq('competition_name', 'Premier League')
      .gte('appearances', 490)
      .lte('appearances', 510)
      .order('appearances', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (close501) {
      stats.push({
        type: 'bullseye_501',
        text: `${close501.player_name} is tantalisingly close to 501 with ${close501.appearances} appearances at one club. The perfect one-pick Bullseye checkout is still up for grabs!`
      });
    } else {
      stats.push({
        type: 'bullseye_501',
        text: `No player has exactly 501 Premier League appearances. A one-pick Bullseye checkout remains impossible… for now.`
      });
    }
  }

  // 2. How many players have only ever had 1 EPL match?
  const { data: oneMatchData } = await client
    .from('v_game_player_club_comp')
    .select('player_uid', { count: 'exact', head: true })
    .eq('competition_name', 'Premier League')
    .eq('appearances', 1);

  if (oneMatchData !== null) {
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
        ? `Only ${perfectCount} player${perfectCount !== 1 ? 's have' : ' has'} hit exactly 0 in Bullseye — a perfect checkout. Can you join them?`
        : `Nobody has hit exactly 0 in Bullseye yet — the elusive perfect checkout. Will you be the first?`
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

  // 7. Highest-scoring player (goals — aggregated across all clubs)
  const { data: allEPLScorers } = await client
    .from('v_game_player_club_comp')
    .select('player_uid, player_name, goals')
    .eq('competition_name', 'Premier League')
    .gt('goals', 50)
    .order('goals', { ascending: false })
    .limit(500);

  if (allEPLScorers && allEPLScorers.length > 0) {
    const goalMap = {};
    for (const r of allEPLScorers) {
      if (!goalMap[r.player_uid]) goalMap[r.player_uid] = { name: r.player_name, goals: 0 };
      goalMap[r.player_uid].goals += r.goals;
    }
    const sorted = Object.values(goalMap).sort((a, b) => b.goals - a.goals);
    const top = sorted[0];
    if (top) {
      stats.push({
        type: 'top_scorer',
        text: `${top.name} is the all-time EPL top scorer with ${top.goals} goals. Worth ${top.goals} points in a Goals Bullseye!`
      });
    }
  }

  return stats;
}

/**
 * Fetch user-specific personal stats (query 8).
 * Always runs fresh — never cached.
 */
async function fetchPersonalStats(client, userId) {
  if (!userId) return null;

  const { data: userStats } = await client
    .from('ts_users')
    .select('total_games_played, total_xp, current_streak, level_name')
    .eq('id', userId)
    .maybeSingle();

  if (userStats?.total_games_played > 0) {
    return {
      type: 'personal',
      text: `You've played ${userStats.total_games_played} game${userStats.total_games_played !== 1 ? 's' : ''} and earned ${(userStats.total_xp || 0).toLocaleString()} XP as a ${userStats.level_name || 'player'}`
    };
  }
  return null;
}

/* ── Handler ──────────────────────────────────────────────────────── */

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

  try {
    // ── General stats: serve from cache if fresh ──────────────────
    let generalStats;
    const cacheAge = Date.now() - _generalStatsCacheTime;

    if (_generalStatsCache && cacheAge < CACHE_TTL) {
      generalStats = _generalStatsCache;
    } else {
      generalStats = await fetchGeneralStats(client);
      _generalStatsCache = generalStats;
      _generalStatsCacheTime = Date.now();
    }

    // ── Personal stats: always fresh (user-specific) ─────────────
    const personalStat = await fetchPersonalStats(client, userId);

    // ── Combine, shuffle, and return 3 stats ─────────────────────
    const allStats = [...generalStats];
    if (personalStat) allStats.push(personalStat);

    const shuffled = allStats.sort(() => Math.random() - 0.5).slice(0, 3);

    return respond(200, { stats: shuffled });

  } catch (err) {
    console.error('did-you-know error:', err);
    return respond(200, { stats: [] });
  }
};
