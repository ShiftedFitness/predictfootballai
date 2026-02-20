/**
 * community-builder.js — Community Game Builder API
 *
 * POST body:
 *   action: 'preview' | 'generate'
 *   gameType: 'bullseye' | 'starting_xi' | 'higher_lower' | 'player_alphabet'
 *   filters: {
 *     competitions: ['Premier League', 'La Liga', ...],
 *     clubs: ['Arsenal', 'Barcelona', ...],      // optional
 *     nationalities: ['ENG', 'FRA', ...],         // optional
 *     measure: 'appearances' | 'goals'            // default: appearances
 *   }
 *   freeText: string  // optional — NLP shortcut (forwarded to match_start)
 *
 * Returns:
 *   preview: { playerCount, feasible, samplePlayers, difficulty }
 *   generate: { gameData, playerCount, title }
 */

const { sb, respond, handleOptions } = require('./_supabase');

exports.handler = async (event) => {
  const cors = handleOptions(event);
  if (cors) return cors;

  if (event.httpMethod !== 'POST') return respond(405, 'POST only');

  let body;
  try { body = JSON.parse(event.body); }
  catch { return respond(400, 'Invalid JSON'); }

  const { action, gameType, filters = {}, freeText } = body;

  if (!action || !['preview', 'generate'].includes(action)) {
    return respond(400, 'action must be "preview" or "generate"');
  }

  if (!gameType || !['bullseye', 'starting_xi', 'higher_lower', 'player_alphabet'].includes(gameType)) {
    return respond(400, 'Invalid gameType');
  }

  const client = sb();

  try {
    // Build the query based on filters
    const competitions = filters.competitions || ['Premier League'];
    const measure = filters.measure || 'appearances';
    const clubs = filters.clubs || [];
    const nationalities = filters.nationalities || [];

    // Starting XI is EPL-only
    if (gameType === 'starting_xi' && !competitions.includes('Premier League')) {
      return respond(400, 'Starting XI is Premier League only');
    }

    // Query players matching filters from v_all_player_season_stats
    let query = client
      .from('v_all_player_season_stats')
      .select('player_uid, player_name, club, season, appearances, goals, assists, competition');

    // Filter by competitions
    if (competitions.length === 1) {
      query = query.eq('competition', competitions[0]);
    } else if (competitions.length > 1) {
      query = query.in('competition', competitions);
    }

    // Filter by clubs
    if (clubs.length === 1) {
      query = query.eq('club', clubs[0]);
    } else if (clubs.length > 1) {
      query = query.in('club', clubs);
    }

    // Limit to avoid massive queries
    const { data: rawData, error } = await query.limit(10000);

    if (error) {
      console.error('community-builder query error:', error);
      return respond(500, 'Database query failed');
    }

    if (!rawData || rawData.length === 0) {
      return respond(200, { playerCount: 0, feasible: false, message: 'No players found matching these filters.' });
    }

    // Aggregate per player
    const playerMap = {};
    for (const row of rawData) {
      if (!playerMap[row.player_uid]) {
        playerMap[row.player_uid] = {
          player_uid: row.player_uid,
          player_name: row.player_name || row.player_uid.split('|')[0],
          totalApps: 0,
          totalGoals: 0,
          totalAssists: 0,
          seasons: 0,
          clubs: new Set(),
        };
      }
      const p = playerMap[row.player_uid];
      p.totalApps += row.appearances || 0;
      p.totalGoals += row.goals || 0;
      p.totalAssists += row.assists || 0;
      p.seasons++;
      if (row.club) p.clubs.add(row.club);
    }

    let players = Object.values(playerMap);

    // Filter by nationality if requested
    if (nationalities.length > 0) {
      // Need to look up nationality from players table
      const uids = players.map(p => p.player_uid);
      const batchSize = 500;
      const natResults = [];
      for (let i = 0; i < uids.length; i += batchSize) {
        const batch = uids.slice(i, i + batchSize);
        const { data: natData } = await client
          .from('players')
          .select('player_uid, nationality_norm')
          .in('player_uid', batch);
        if (natData) natResults.push(...natData);
      }

      const natMap = {};
      for (const r of natResults) {
        natMap[r.player_uid] = r.nationality_norm;
      }

      const natSet = new Set(nationalities.map(n => n.toUpperCase()));
      players = players.filter(p => {
        const nat = natMap[p.player_uid];
        return nat && natSet.has(nat.toUpperCase());
      });
    }

    // Sort by chosen measure
    const sortKey = measure === 'goals' ? 'totalGoals' : 'totalApps';
    players.sort((a, b) => b[sortKey] - a[sortKey]);

    // Determine feasibility by game type
    const count = players.length;
    let feasible = false;
    let minPlayers = 10;

    if (gameType === 'bullseye') minPlayers = 15;
    if (gameType === 'starting_xi') minPlayers = 30;
    if (gameType === 'higher_lower') minPlayers = 15;
    if (gameType === 'player_alphabet') minPlayers = 10;

    feasible = count >= minPlayers;

    // Difficulty estimate
    let difficulty = 'Easy';
    if (count <= 50) difficulty = 'Hard';
    else if (count <= 150) difficulty = 'Medium';

    if (action === 'preview') {
      // Return preview with sample players
      const sample = players.slice(0, 5).map(p => ({
        name: p.player_name,
        stat: p[sortKey],
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

    // ACTION: generate — build game data JSON
    if (!feasible) {
      return respond(400, 'Not enough players to generate a game. Try broader filters.');
    }

    let gameData = {};

    if (gameType === 'bullseye') {
      // Bullseye needs player list with stat values
      gameData = {
        target: 501,
        measure,
        players: players.map(p => ({
          uid: p.player_uid,
          name: p.player_name,
          value: p[sortKey],
          clubs: [...p.clubs],
        })),
      };
    } else if (gameType === 'starting_xi') {
      // Starting XI needs players with positions
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
          value: p[sortKey],
          position: posMap[p.player_uid] || 'MID',
          clubs: [...p.clubs],
        })),
      };
    } else if (gameType === 'higher_lower') {
      // HoL needs pairs of players with stat values, shuffled
      const shuffled = players.sort(() => Math.random() - 0.5);
      gameData = {
        measure,
        players: shuffled.slice(0, Math.min(50, shuffled.length)).map(p => ({
          uid: p.player_uid,
          name: p.player_name,
          value: p[sortKey],
          clubs: [...p.clubs],
        })),
      };
    } else if (gameType === 'player_alphabet') {
      // Alphabet needs players grouped by first letter of surname
      gameData = {
        measure,
        players: players.map(p => ({
          uid: p.player_uid,
          name: p.player_name,
          value: p[sortKey],
          clubs: [...p.clubs],
        })),
      };
    }

    // Generate a title suggestion
    const compLabel = competitions.length === 1 ? competitions[0] : `${competitions.length} Leagues`;
    const clubLabel = clubs.length > 0 ? clubs.slice(0, 2).join(' & ') : '';
    const title = clubLabel
      ? `${clubLabel} — ${measure === 'goals' ? 'Goals' : 'Appearances'}`
      : `${compLabel} — ${measure === 'goals' ? 'Goals' : 'Appearances'}`;

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
