/**
 * community-builder.js — Community Game Builder API
 *
 * Uses v_game_player_club_comp view (same as match_start.js / Bullseye).
 * View columns: player_uid, player_name, nationality_norm, competition_id,
 *               competition_name, club_id, club_name, appearances, goals,
 *               assists, minutes, seasons, first_season_start_year, last_season_start_year
 *
 * POST body:
 *   action: 'preview' | 'generate'
 *   gameType: 'bullseye' | 'starting_xi' | 'higher_lower' | 'player_alphabet'
 *   filters: {
 *     competitions: ['Premier League', 'La Liga', ...],
 *     clubs: ['Arsenal', 'Barcelona', ...],      // optional
 *     nationalities: ['ENG', 'FRA', ...],         // optional
 *     measure: 'appearances' | 'goals' | 'performance'  // default: appearances
 *   }
 *
 * Returns:
 *   preview: { playerCount, feasible, samplePlayers, difficulty }
 *   generate: { gameData, playerCount, title }
 */

const { sb, respond, handleOptions } = require('./_supabase');

/**
 * Paginated fetch — Supabase returns max 1000 rows per request.
 */
async function fetchAll(queryBuilder) {
  const PAGE_SIZE = 1000;
  let allData = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await queryBuilder()
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    hasMore = data.length === PAGE_SIZE;
    offset += PAGE_SIZE;
    if (offset > 20000) break; // Safety cap
  }
  return allData;
}

exports.handler = async (event) => {
  const cors = handleOptions(event);
  if (cors) return cors;

  if (event.httpMethod !== 'POST') return respond(405, 'POST only');

  let body;
  try { body = JSON.parse(event.body); }
  catch { return respond(400, 'Invalid JSON'); }

  const { action, gameType, filters = {} } = body;

  if (!action || !['preview', 'generate'].includes(action)) {
    return respond(400, 'action must be "preview" or "generate"');
  }

  if (!gameType || !['bullseye', 'starting_xi', 'higher_lower', 'player_alphabet'].includes(gameType)) {
    return respond(400, 'Invalid gameType');
  }

  const client = sb();

  try {
    const competitions = filters.competitions || ['Premier League'];
    const measure = filters.measure || 'appearances';
    const clubs = filters.clubs || [];
    const nationalities = filters.nationalities || [];

    // Starting XI is EPL-only for now
    if (gameType === 'starting_xi' && !competitions.includes('Premier League')) {
      return respond(400, 'Starting XI is Premier League only');
    }

    // Performance measure is EPL-only (uses minutes from the view)
    if (measure === 'performance' && !competitions.every(c => c === 'Premier League')) {
      return respond(400, 'Performance measure is only available for Premier League');
    }

    // Build query using v_game_player_club_comp (the proven working view)
    const buildQuery = () => {
      let query = client
        .from('v_game_player_club_comp')
        .select('player_uid, player_name, nationality_norm, competition_name, club_name, appearances, goals, assists, minutes, seasons');

      // Filter by competitions
      if (competitions.length === 1) {
        query = query.eq('competition_name', competitions[0]);
      } else if (competitions.length > 1) {
        query = query.in('competition_name', competitions);
      }

      // Filter by clubs
      if (clubs.length === 1) {
        query = query.eq('club_name', clubs[0]);
      } else if (clubs.length > 1) {
        query = query.in('club_name', clubs);
      }

      // Filter by nationality
      if (nationalities.length === 1) {
        query = query.eq('nationality_norm', nationalities[0]);
      } else if (nationalities.length > 1 && nationalities.length <= 15) {
        query = query.in('nationality_norm', nationalities);
      }

      // Require at least some stats
      const metricCol = measure === 'goals' ? 'goals' : 'appearances';
      query = query.gt(metricCol, 0);

      return query;
    };

    const rawData = await fetchAll(buildQuery);

    if (!rawData || rawData.length === 0) {
      return respond(200, { playerCount: 0, feasible: false, message: 'No players found matching these filters.' });
    }

    // Aggregate by player_uid (a player may have rows for multiple clubs)
    const playerMap = {};
    for (const row of rawData) {
      if (!playerMap[row.player_uid]) {
        playerMap[row.player_uid] = {
          player_uid: row.player_uid,
          player_name: row.player_name || row.player_uid.split('|')[0],
          nationality: row.nationality_norm || '',
          totalApps: 0,
          totalGoals: 0,
          totalAssists: 0,
          totalMinutes: 0,
          totalSeasons: 0,
          clubs: new Set(),
        };
      }
      const p = playerMap[row.player_uid];
      p.totalApps += row.appearances || 0;
      p.totalGoals += row.goals || 0;
      p.totalAssists += row.assists || 0;
      p.totalMinutes += row.minutes || 0;
      p.totalSeasons += row.seasons || 0;
      if (row.club_name) p.clubs.add(row.club_name);
    }

    // If nationality filter was too large for DB, apply in-memory
    let players = Object.values(playerMap);
    if (nationalities.length > 15) {
      const natSet = new Set(nationalities.map(n => n.toUpperCase()));
      players = players.filter(p => natSet.has(p.nationality.toUpperCase()));
    }

    // Sort by chosen measure
    let sortKey = 'totalApps';
    if (measure === 'goals') sortKey = 'totalGoals';
    if (measure === 'performance') {
      // Performance index: (goals * 3 + assists * 2 + appearances) / appearances
      players.forEach(p => {
        p.performance = p.totalApps > 0
          ? Math.round(((p.totalGoals * 3 + p.totalAssists * 2 + p.totalApps) / p.totalApps) * 100) / 100
          : 0;
      });
      sortKey = 'performance';
    }
    players.sort((a, b) => b[sortKey] - a[sortKey]);

    // Determine feasibility by game type
    const count = players.length;
    let minPlayers = 10;
    if (gameType === 'bullseye') minPlayers = 15;
    if (gameType === 'starting_xi') minPlayers = 30;
    if (gameType === 'higher_lower') minPlayers = 15;
    if (gameType === 'player_alphabet') minPlayers = 10;

    const feasible = count >= minPlayers;

    // Difficulty estimate
    let difficulty = 'Easy';
    if (count <= 50) difficulty = 'Hard';
    else if (count <= 150) difficulty = 'Medium';

    if (action === 'preview') {
      const sample = players.slice(0, 5).map(p => ({
        name: p.player_name,
        stat: measure === 'performance' ? p.performance : p[sortKey],
        clubs: [...p.clubs].slice(0, 3),
      }));

      return respond(200, {
        playerCount: count,
        feasible,
        difficulty,
        samplePlayers: sample,
        measure,
        competitions,
        clubs: clubs.length > 0 ? clubs : undefined,
        nationalities: nationalities.length > 0 ? nationalities : undefined,
      });
    }

    // ACTION: generate
    if (!feasible) {
      return respond(400, 'Not enough players to generate a game. Try broader filters.');
    }

    let gameData = {};
    const getValue = (p) => measure === 'performance' ? p.performance : p[sortKey];

    if (gameType === 'bullseye') {
      gameData = {
        target: 501,
        measure,
        players: players.map(p => ({
          uid: p.player_uid,
          name: p.player_name,
          value: getValue(p),
          clubs: [...p.clubs],
        })),
      };
    } else if (gameType === 'starting_xi') {
      // Look up positions
      const uids = players.slice(0, 200).map(p => p.player_uid);
      const { data: posData } = await client
        .from('players')
        .select('player_uid, position_bucket')
        .in('player_uid', uids);

      const posMap = {};
      if (posData) {
        for (const r of posData) posMap[r.player_uid] = r.position_bucket;
      }

      gameData = {
        measure,
        players: players.slice(0, 200).map(p => ({
          uid: p.player_uid,
          name: p.player_name,
          value: getValue(p),
          position: posMap[p.player_uid] || 'MID',
          clubs: [...p.clubs],
        })),
      };
    } else if (gameType === 'higher_lower') {
      const shuffled = [...players].sort(() => Math.random() - 0.5);
      gameData = {
        measure,
        players: shuffled.slice(0, Math.min(50, shuffled.length)).map(p => ({
          uid: p.player_uid,
          name: p.player_name,
          value: getValue(p),
          clubs: [...p.clubs],
        })),
      };
    } else if (gameType === 'player_alphabet') {
      gameData = {
        measure,
        players: players.map(p => ({
          uid: p.player_uid,
          name: p.player_name,
          value: getValue(p),
          clubs: [...p.clubs],
        })),
      };
    }

    // Generate title suggestion
    const compLabel = competitions.length === 1 ? competitions[0] : `${competitions.length} Leagues`;
    const clubLabel = clubs.length > 0 ? clubs.slice(0, 2).join(' & ') : '';
    const measureLabel = measure === 'goals' ? 'Goals' : measure === 'performance' ? 'Performance' : 'Appearances';
    const title = clubLabel
      ? `${clubLabel} — ${measureLabel}`
      : `${compLabel} — ${measureLabel}`;

    return respond(200, {
      gameData,
      playerCount: count,
      title,
      difficulty,
    });

  } catch (err) {
    console.error('community-builder error:', err);
    return respond(500, { error: 'Internal error' });
  }
};
