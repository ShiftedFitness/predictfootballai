/**
 * community-builder.js — Community Game Builder API
 *
 * Uses v_game_player_club_comp view (same as match_start.js / Bullseye).
 * View columns: player_uid, player_name, nationality_norm, competition_id,
 *               competition_name, club_id, club_name, appearances, goals,
 *               assists, minutes, seasons, first_season_start_year, last_season_start_year
 *
 * NOTE: The view has ONE ROW per player per club per competition.
 *       So a player who played for Man Utd and Liverpool will have 2 rows.
 *
 * POST body:
 *   action: 'preview' | 'generate'
 *   gameType: 'bullseye' | 'starting_xi' | 'higher_lower' | 'player_alphabet'
 *   filters: {
 *     competitions: ['Premier League', 'La Liga', ...],
 *     clubs: ['Liverpool', 'Manchester United', ...],   // optional
 *     clubMode: 'any' | 'all',                          // 'all' = played at ALL listed clubs (intersection)
 *     nationalities: ['ENG', 'FRA', ...],                // optional
 *     measure: 'appearances' | 'goals' | 'performance'  // default: appearances
 *     freeText: 'combined XI for Liverpool and Man Utd'  // optional natural language
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

// ============================================================
// FREE TEXT PARSING — Extract clubs and nationalities from text
// ============================================================
const CLUB_ALIASES = {
  'arsenal': 'Arsenal',
  'aston villa': 'Aston Villa',
  'villa': 'Aston Villa',
  'blackburn': 'Blackburn Rovers',
  'blackburn rovers': 'Blackburn Rovers',
  'bolton': 'Bolton Wanderers',
  'bolton wanderers': 'Bolton Wanderers',
  'bournemouth': 'Bournemouth',
  'afc bournemouth': 'Bournemouth',
  'brentford': 'Brentford',
  'brighton': 'Brighton & Hove Albion',
  'brighton & hove albion': 'Brighton & Hove Albion',
  'burnley': 'Burnley',
  'charlton': 'Charlton Athletic',
  'charlton athletic': 'Charlton Athletic',
  'chelsea': 'Chelsea',
  'coventry': 'Coventry City',
  'coventry city': 'Coventry City',
  'crystal palace': 'Crystal Palace',
  'palace': 'Crystal Palace',
  'derby': 'Derby County',
  'derby county': 'Derby County',
  'everton': 'Everton',
  'fulham': 'Fulham',
  'ipswich': 'Ipswich Town',
  'ipswich town': 'Ipswich Town',
  'leeds': 'Leeds United',
  'leeds united': 'Leeds United',
  'leicester': 'Leicester City',
  'leicester city': 'Leicester City',
  'liverpool': 'Liverpool',
  'man city': 'Manchester City',
  'manchester city': 'Manchester City',
  'man utd': 'Manchester United',
  'man united': 'Manchester United',
  'manchester united': 'Manchester United',
  'manchester utd': 'Manchester United',
  'middlesbrough': 'Middlesbrough',
  'boro': 'Middlesbrough',
  'newcastle': 'Newcastle United',
  'newcastle united': 'Newcastle United',
  'norwich': 'Norwich City',
  'norwich city': 'Norwich City',
  'nottingham forest': 'Nottingham Forest',
  'nottm forest': 'Nottingham Forest',
  'forest': 'Nottingham Forest',
  'portsmouth': 'Portsmouth',
  'qpr': 'Queens Park Rangers',
  'queens park rangers': 'Queens Park Rangers',
  'reading': 'Reading',
  'sheffield united': 'Sheffield United',
  'sheffield utd': 'Sheffield United',
  'sheff utd': 'Sheffield United',
  'sheffield wednesday': 'Sheffield Weds',
  'sheffield weds': 'Sheffield Weds',
  'sheff wed': 'Sheffield Weds',
  'southampton': 'Southampton',
  'stoke': 'Stoke City',
  'stoke city': 'Stoke City',
  'sunderland': 'Sunderland',
  'swansea': 'Swansea City',
  'swansea city': 'Swansea City',
  'tottenham': 'Tottenham Hotspur',
  'tottenham hotspur': 'Tottenham Hotspur',
  'spurs': 'Tottenham Hotspur',
  'watford': 'Watford',
  'west brom': 'West Bromwich Albion',
  'west bromwich albion': 'West Bromwich Albion',
  'west ham': 'West Ham United',
  'west ham united': 'West Ham United',
  'wigan': 'Wigan Athletic',
  'wigan athletic': 'Wigan Athletic',
  'wimbledon': 'Wimbledon',
  'wolves': 'Wolves',
  'wolverhampton': 'Wolves',
  'wolverhampton wanderers': 'Wolves',
  // La Liga
  'barcelona': 'Barcelona',
  'barca': 'Barcelona',
  'real madrid': 'Real Madrid',
  'atletico madrid': 'Atlético Madrid',
  'atletico': 'Atlético Madrid',
  'sevilla': 'Sevilla',
  'valencia': 'Valencia',
  'villarreal': 'Villarreal',
  'real sociedad': 'Real Sociedad',
  'athletic bilbao': 'Athletic Club',
  'athletic club': 'Athletic Club',
  'real betis': 'Real Betis',
  'betis': 'Real Betis',
  // Bundesliga
  'bayern munich': 'Bayern Munich',
  'bayern': 'Bayern Munich',
  'dortmund': 'Borussia Dortmund',
  'borussia dortmund': 'Borussia Dortmund',
  'leverkusen': 'Bayer Leverkusen',
  'bayer leverkusen': 'Bayer Leverkusen',
  'rb leipzig': 'RB Leipzig',
  'leipzig': 'RB Leipzig',
  'schalke': 'Schalke 04',
  // Serie A
  'juventus': 'Juventus',
  'juve': 'Juventus',
  'ac milan': 'AC Milan',
  'milan': 'AC Milan',
  'inter milan': 'Inter Milan',
  'inter': 'Inter Milan',
  'napoli': 'Napoli',
  'roma': 'Roma',
  'as roma': 'Roma',
  'lazio': 'Lazio',
  'fiorentina': 'Fiorentina',
  'atalanta': 'Atalanta',
  // Ligue 1
  'psg': 'Paris Saint-Germain',
  'paris saint-germain': 'Paris Saint-Germain',
  'paris saint germain': 'Paris Saint-Germain',
  'marseille': 'Marseille',
  'lyon': 'Lyon',
  'monaco': 'Monaco',
  'lille': 'Lille',
};

const NATIONALITY_ALIASES = {
  'english': 'ENG', 'england': 'ENG',
  'french': 'FRA', 'france': 'FRA',
  'spanish': 'ESP', 'spain': 'ESP',
  'german': 'GER', 'germany': 'GER',
  'italian': 'ITA', 'italy': 'ITA',
  'brazilian': 'BRA', 'brazil': 'BRA',
  'argentinian': 'ARG', 'argentine': 'ARG', 'argentina': 'ARG',
  'dutch': 'NED', 'netherlands': 'NED', 'holland': 'NED',
  'portuguese': 'POR', 'portugal': 'POR',
  'welsh': 'WAL', 'wales': 'WAL',
  'scottish': 'SCO', 'scotland': 'SCO',
  'irish': 'IRL', 'ireland': 'IRL',
  'iranian': 'IRN', 'iran': 'IRN', 'persian': 'IRN',
  'japanese': 'JPN', 'japan': 'JPN',
  'korean': 'KOR', 'south korean': 'KOR', 'south korea': 'KOR',
  'australian': 'AUS', 'australia': 'AUS',
  'nigerian': 'NGA', 'nigeria': 'NGA',
  'ghanaian': 'GHA', 'ghana': 'GHA',
  'senegalese': 'SEN', 'senegal': 'SEN',
  'ivorian': 'CIV', 'ivory coast': 'CIV', "cote d'ivoire": 'CIV',
  'cameroonian': 'CMR', 'cameroon': 'CMR',
  'egyptian': 'EGY', 'egypt': 'EGY',
  'moroccan': 'MAR', 'morocco': 'MAR',
  'algerian': 'ALG', 'algeria': 'ALG',
  'tunisian': 'TUN', 'tunisia': 'TUN',
  'colombian': 'COL', 'colombia': 'COL',
  'uruguayan': 'URU', 'uruguay': 'URU',
  'chilean': 'CHI', 'chile': 'CHI',
  'mexican': 'MEX', 'mexico': 'MEX',
  'american': 'USA', 'usa': 'USA', 'united states': 'USA',
  'canadian': 'CAN', 'canada': 'CAN',
  'turkish': 'TUR', 'turkey': 'TUR',
  'belgian': 'BEL', 'belgium': 'BEL',
  'swiss': 'SUI', 'switzerland': 'SUI',
  'austrian': 'AUT', 'austria': 'AUT',
  'danish': 'DEN', 'denmark': 'DEN',
  'swedish': 'SWE', 'sweden': 'SWE',
  'norwegian': 'NOR', 'norway': 'NOR',
  'finnish': 'FIN', 'finland': 'FIN',
  'icelandic': 'ISL', 'iceland': 'ISL',
  'polish': 'POL', 'poland': 'POL',
  'czech': 'CZE', 'czech republic': 'CZE', 'czechia': 'CZE',
  'croatian': 'CRO', 'croatia': 'CRO',
  'serbian': 'SRB', 'serbia': 'SRB',
  'jamaican': 'JAM', 'jamaica': 'JAM',
  'trinidadian': 'TRI', 'trinidad': 'TRI',
  'chinese': 'CHN', 'china': 'CHN',
  'indian': 'IND', 'india': 'IND',
  'african': null, // too broad, skip
  'european': null,
  'south american': null,
  'asian': null,
};

/**
 * Parse free text to extract structured filters.
 * Returns { clubs: [...], nationalities: [...], clubMode: 'all'|'any' }
 */
function parseFreeText(text) {
  if (!text || !text.trim()) return { clubs: [], nationalities: [], clubMode: 'any' };

  const lower = text.toLowerCase().trim();
  const foundClubs = [];
  const foundNats = [];

  // Detect "combined" / "played for X and Y" / "both" pattern → clubMode = 'all'
  const combinedPattern = /\b(combined|played for|played at|both|and)\b/i;
  const clubMode = combinedPattern.test(lower) ? 'all' : 'any';

  // Sort club aliases by length (longest first) to match multi-word names first
  const sortedClubKeys = Object.keys(CLUB_ALIASES).sort((a, b) => b.length - a.length);
  let remaining = lower;

  for (const alias of sortedClubKeys) {
    if (remaining.includes(alias)) {
      const dbName = CLUB_ALIASES[alias];
      if (!foundClubs.includes(dbName)) {
        foundClubs.push(dbName);
      }
      // Remove matched text to avoid double-matching
      remaining = remaining.replace(alias, ' ');
    }
  }

  // Extract nationalities
  const sortedNatKeys = Object.keys(NATIONALITY_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of sortedNatKeys) {
    if (lower.includes(alias)) {
      const code = NATIONALITY_ALIASES[alias];
      if (code && !foundNats.includes(code)) {
        foundNats.push(code);
      }
    }
  }

  return { clubs: foundClubs, nationalities: foundNats, clubMode };
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
    let clubs = filters.clubs || [];
    let nationalities = filters.nationalities || [];
    let clubMode = filters.clubMode || 'any'; // 'all' = must have played at ALL clubs

    // Parse free text if provided — merge with chip-based filters
    const freeText = filters.freeText || '';
    if (freeText) {
      const parsed = parseFreeText(freeText);
      if (parsed.clubs.length > 0) {
        // Free text clubs override chip clubs (more specific)
        clubs = [...new Set([...clubs, ...parsed.clubs])];
        clubMode = parsed.clubMode;
      }
      if (parsed.nationalities.length > 0) {
        nationalities = [...new Set([...nationalities, ...parsed.nationalities])];
      }
    }

    // Starting XI is EPL-only for now
    if (gameType === 'starting_xi' && !competitions.includes('Premier League')) {
      return respond(400, 'Starting XI is Premier League only');
    }

    // Performance measure is EPL-only
    if (measure === 'performance' && !competitions.every(c => c === 'Premier League')) {
      return respond(400, 'Performance measure is only available for Premier League');
    }

    // Build query using v_game_player_club_comp
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

      // Filter by clubs — for 'all' mode we still fetch rows matching ANY club,
      // then do the intersection in-memory
      if (clubs.length === 1) {
        query = query.eq('club_name', clubs[0]);
      } else if (clubs.length > 1) {
        query = query.in('club_name', clubs);
      }

      // Filter by nationality (skip if too many — filter in-memory)
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
      return respond(200, {
        playerCount: 0,
        feasible: false,
        message: 'No players found matching these filters.',
        parsedFilters: { clubs, nationalities, clubMode, freeText: freeText || undefined },
      });
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

    let players = Object.values(playerMap);

    // If nationality filter was too large for DB, apply in-memory
    if (nationalities.length > 15) {
      const natSet = new Set(nationalities.map(n => n.toUpperCase()));
      players = players.filter(p => natSet.has(p.nationality.toUpperCase()));
    }

    // CRITICAL: For clubMode 'all', filter to only players who played at ALL listed clubs
    if (clubMode === 'all' && clubs.length > 1) {
      const clubSet = new Set(clubs);
      players = players.filter(p => {
        for (const c of clubSet) {
          if (!p.clubs.has(c)) return false;
        }
        return true;
      });
    }

    if (players.length === 0) {
      return respond(200, {
        playerCount: 0,
        feasible: false,
        message: clubs.length > 1 && clubMode === 'all'
          ? `No players found who played at all of: ${clubs.join(', ')}. Try fewer clubs or switch to "any".`
          : 'No players found matching these filters.',
        parsedFilters: { clubs, nationalities, clubMode, freeText: freeText || undefined },
      });
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
        clubMode: clubs.length > 1 ? clubMode : undefined,
        nationalities: nationalities.length > 0 ? nationalities : undefined,
        parsedFilters: freeText ? { clubs, nationalities, clubMode, freeText } : undefined,
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
