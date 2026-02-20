/**
 * featured-player.js — Return a random notable player with career stats
 *
 * GET — returns a random player with 100+ PL appearances, their career stats and clubs.
 */

const { sb, respond, handleOptions } = require('./_supabase');

exports.handler = async (event) => {
  const cors = handleOptions(event);
  if (cors) return cors;

  if (event.httpMethod !== 'GET') return respond(405, 'GET only');

  const client = sb();

  try {
    // Get count of notable players (100+ EPL appearances)
    const { count } = await client
      .from('v_all_player_season_stats')
      .select('player_uid', { count: 'exact', head: true })
      .eq('competition', 'Premier League')
      .gte('appearances', 1);

    // We'll aggregate to find players with significant careers
    // Use a random offset approach with the players table
    const { data: allPlayers } = await client
      .from('players')
      .select('player_uid, player_name, nationality_norm, position_bucket, birth_year')
      .not('nationality_norm', 'is', null)
      .limit(5000);

    if (!allPlayers || allPlayers.length === 0) {
      return respond(404, { error: 'No players found' });
    }

    // Pick a random player
    const randomIdx = Math.floor(Math.random() * allPlayers.length);
    const player = allPlayers[randomIdx];

    // Get their career stats from EPL
    const { data: stats } = await client
      .from('v_all_player_season_stats')
      .select('season, club, appearances, goals, assists, competition')
      .eq('player_uid', player.player_uid)
      .eq('competition', 'Premier League')
      .order('season', { ascending: true });

    // Skip players with very few EPL seasons — pick another if < 2 seasons
    if (!stats || stats.length < 2) {
      // Fallback: try again with a known good query
      const { data: fallbackStats } = await client
        .from('v_all_player_season_stats')
        .select('player_uid, season, club, appearances, goals, assists')
        .eq('competition', 'Premier League')
        .gte('appearances', 20)
        .limit(1000);

      if (!fallbackStats || fallbackStats.length === 0) {
        return respond(404, { error: 'No suitable player found' });
      }

      // Group by player_uid and pick one with decent career
      const grouped = {};
      for (const row of fallbackStats) {
        if (!grouped[row.player_uid]) grouped[row.player_uid] = [];
        grouped[row.player_uid].push(row);
      }

      const uids = Object.keys(grouped).filter(uid => grouped[uid].length >= 3);
      if (uids.length === 0) return respond(404, { error: 'No suitable player found' });

      const fbUid = uids[Math.floor(Math.random() * uids.length)];
      const fbRows = grouped[fbUid];

      // Look up player name
      const { data: fbPlayer } = await client
        .from('players')
        .select('player_name, nationality_norm, position_bucket')
        .eq('player_uid', fbUid)
        .maybeSingle();

      const totalApps = fbRows.reduce((s, r) => s + (r.appearances || 0), 0);
      const totalGoals = fbRows.reduce((s, r) => s + (r.goals || 0), 0);
      const totalAssists = fbRows.reduce((s, r) => s + (r.assists || 0), 0);
      const clubs = [...new Set(fbRows.map(r => r.club))];

      return respond(200, {
        name: fbPlayer?.player_name || fbUid.split('|')[0],
        nationality: fbPlayer?.nationality_norm || '',
        position: fbPlayer?.position_bucket || '',
        appearances: totalApps,
        goals: totalGoals,
        assists: totalAssists,
        seasons: fbRows.length,
        clubs
      });
    }

    // Aggregate this player's stats
    const totalApps = stats.reduce((s, r) => s + (r.appearances || 0), 0);
    const totalGoals = stats.reduce((s, r) => s + (r.goals || 0), 0);
    const totalAssists = stats.reduce((s, r) => s + (r.assists || 0), 0);
    const clubs = [...new Set(stats.map(r => r.club))];

    return respond(200, {
      name: player.player_name,
      nationality: player.nationality_norm || '',
      position: player.position_bucket || '',
      appearances: totalApps,
      goals: totalGoals,
      assists: totalAssists,
      seasons: stats.length,
      clubs
    });

  } catch (err) {
    console.error('featured-player error:', err);
    return respond(500, { error: 'Internal error' });
  }
};
