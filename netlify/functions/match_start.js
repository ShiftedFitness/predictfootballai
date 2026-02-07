// netlify/functions/match_start.js
// Football 501 - Match Start API
// USES ACTUAL SCHEMA FROM schema_snapshot.sql.csv and v_game_player_club_comp.csv

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

// ============================================================
// RESPONSE HELPER
// ============================================================
function respond(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(body),
  };
}

// ============================================================
// NORMALIZE HELPER
// ============================================================
function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.-]/g, '').trim();
}

// ============================================================
// COMPETITION NAMES (as stored in competitions.competition_name)
// ============================================================
const COMP_NAMES = {
  EPL: 'Premier League',
  UCL: 'Champions League',
  LALIGA: 'La Liga',
  SERIEA: 'Serie A',
  BUNDESLIGA: 'Bundesliga',
  LIGUE1: 'Ligue 1',
};

// ============================================================
// CATEGORY DEFINITIONS
// ============================================================
const COUNTRY_CATS = {
  country_ENG: { code: 'ENG', name: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  country_FRA: { code: 'FRA', name: 'France', flag: '🇫🇷' },
  country_ESP: { code: 'ESP', name: 'Spain', flag: '🇪🇸' },
  country_ARG: { code: 'ARG', name: 'Argentina', flag: '🇦🇷' },
  country_NED: { code: 'NED', name: 'Netherlands', flag: '🇳🇱' },
  country_POR: { code: 'POR', name: 'Portugal', flag: '🇵🇹' },
  country_IRL: { code: 'IRL', name: 'Ireland', flag: '🇮🇪' },
  country_SCO: { code: 'SCO', name: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  country_WAL: { code: 'WAL', name: 'Wales', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
  country_NIR: { code: 'NIR', name: 'Northern Ireland', flag: '🇬🇧' },
  country_NOR: { code: 'NOR', name: 'Norway', flag: '🇳🇴' },
  country_DEN: { code: 'DEN', name: 'Denmark', flag: '🇩🇰' },
  country_BEL: { code: 'BEL', name: 'Belgium', flag: '🇧🇪' },
  country_GER: { code: 'GER', name: 'Germany', flag: '🇩🇪' },
  country_BRA: { code: 'BRA', name: 'Brazil', flag: '🇧🇷' },
  country_ITA: { code: 'ITA', name: 'Italy', flag: '🇮🇹' },
};

const CONTINENT_CATS = {
  continent_AFRICA: {
    name: 'Africa', flag: '🌍',
    codes: ['NGA', 'GHA', 'CIV', 'SEN', 'CMR', 'MAR', 'DZA', 'TUN', 'EGY', 'ZAF', 'COD', 'MLI', 'ZWE', 'ZMB'],
  },
  continent_ASIA_OCEANIA: {
    name: 'Asia & Oceania', flag: '🌏',
    codes: ['AUS', 'NZL', 'JPN', 'KOR', 'CHN', 'IRN', 'SAU', 'ARE', 'QAT', 'IND', 'THA', 'MYS', 'ISR'],
  },
  continent_CONCACAF: {
    name: 'CONCACAF', flag: '🌎',
    codes: ['USA', 'CAN', 'MEX', 'CRI', 'JAM', 'TTO', 'HND', 'PAN', 'GTM', 'SLV', 'HTI', 'CUB'],
  },
  continent_SOUTH_AMERICA: {
    name: 'South America (excl. BRA/ARG)', flag: '🌎',
    codes: ['URY', 'CHL', 'COL', 'PER', 'ECU', 'PRY', 'VEN', 'BOL'],
  },
};

const CLUB_CATS = {
  club_Arsenal: { club: 'Arsenal', label: 'Arsenal' },
  club_AstonVilla: { club: 'Aston Villa', label: 'Aston Villa' },
  club_Chelsea: { club: 'Chelsea', label: 'Chelsea' },
  club_Everton: { club: 'Everton', label: 'Everton' },
  club_Liverpool: { club: 'Liverpool', label: 'Liverpool' },
  club_ManCity: { club: 'Manchester City', label: 'Man City' },
  club_ManUtd: { club: 'Manchester United', label: 'Man Utd' },
  club_Newcastle: { club: 'Newcastle United', label: 'Newcastle' },
  club_Tottenham: { club: 'Tottenham Hotspur', label: 'Spurs' },
  club_WestHam: { club: 'West Ham United', label: 'West Ham' },
  club_Leeds: { club: 'Leeds United', label: 'Leeds' },
  club_Leicester: { club: 'Leicester City', label: 'Leicester' },
  club_Southampton: { club: 'Southampton', label: 'Southampton' },
  club_Sunderland: { club: 'Sunderland', label: 'Sunderland' },
  club_Fulham: { club: 'Fulham', label: 'Fulham' },
  club_Wolves: { club: 'Wolverhampton Wanderers', label: 'Wolves' },
  club_Brighton: { club: 'Brighton and Hove Albion', label: 'Brighton' },
  club_CrystalPalace: { club: 'Crystal Palace', label: 'Crystal Palace' },
  club_Bournemouth: { club: 'AFC Bournemouth', label: 'Bournemouth' },
  club_Brentford: { club: 'Brentford', label: 'Brentford' },
};

const GOALS_CATS = {
  goals_overall: { label: 'All EPL Goals' },
  goals_Arsenal: { club: 'Arsenal', label: 'Arsenal Goals' },
  goals_Chelsea: { club: 'Chelsea', label: 'Chelsea Goals' },
  goals_Liverpool: { club: 'Liverpool', label: 'Liverpool Goals' },
  goals_ManCity: { club: 'Manchester City', label: 'Man City Goals' },
  goals_ManUtd: { club: 'Manchester United', label: 'Man Utd Goals' },
  goals_Tottenham: { club: 'Tottenham Hotspur', label: 'Spurs Goals' },
};

// Chat builder aliases
const CLUB_ALIASES = {
  'man utd': 'Manchester United', 'man united': 'Manchester United', 'united': 'Manchester United',
  'man city': 'Manchester City', 'city': 'Manchester City',
  'spurs': 'Tottenham Hotspur', 'tottenham': 'Tottenham Hotspur',
  'arsenal': 'Arsenal', 'liverpool': 'Liverpool', 'chelsea': 'Chelsea',
  'everton': 'Everton', 'newcastle': 'Newcastle United',
  'west ham': 'West Ham United', 'aston villa': 'Aston Villa',
  'leeds': 'Leeds United', 'leicester': 'Leicester City',
  'southampton': 'Southampton', 'sunderland': 'Sunderland',
  'wolves': 'Wolverhampton Wanderers', 'brighton': 'Brighton and Hove Albion',
};

const NAT_ALIASES = {
  'english': 'ENG', 'england': 'ENG',
  'french': 'FRA', 'france': 'FRA',
  'spanish': 'ESP', 'spain': 'ESP',
  'german': 'GER', 'germany': 'GER',
  'italian': 'ITA', 'italy': 'ITA',
  'dutch': 'NED', 'netherlands': 'NED',
  'portuguese': 'POR', 'portugal': 'POR',
  'brazilian': 'BRA', 'brazil': 'BRA',
  'argentine': 'ARG', 'argentina': 'ARG',
  'scottish': 'SCO', 'scotland': 'SCO',
  'welsh': 'WAL', 'wales': 'WAL',
  'irish': 'IRL', 'ireland': 'IRL',
};

// ============================================================
// DATA FETCHING USING ACTUAL SCHEMA
// ============================================================

/**
 * Query v_game_player_club_comp view for club-based queries.
 * View columns: player_uid, player_name, nationality_norm, competition_id,
 *               competition_name, club_id, club_name, appearances, goals,
 *               assists, minutes, seasons, first_season_start_year, last_season_start_year
 */
async function fetchFromView(supabase, competitionName, clubName = null, nationalityCodes = null, metric = 'appearances') {
  console.log('[fetchFromView]', { competitionName, clubName, nationalityCodes, metric });

  let query = supabase
    .from('v_game_player_club_comp')
    .select('player_uid, player_name, nationality_norm, competition_name, club_name, appearances, goals, assists, minutes, seasons')
    .eq('competition_name', competitionName)
    .gt(metric === 'goals' ? 'goals' : 'appearances', 0);

  if (clubName) {
    query = query.eq('club_name', clubName);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[fetchFromView] Error:', error);
    throw new Error(error.message);
  }

  console.log('[fetchFromView] Raw rows:', data?.length || 0);

  if (!data || data.length === 0) return [];

  // Aggregate by player_uid (a player may have multiple club rows)
  const playerMap = new Map();

  for (const row of data) {
    const nat = (row.nationality_norm || '').toUpperCase();

    // Apply nationality filter
    if (nationalityCodes) {
      const codes = Array.isArray(nationalityCodes) ? nationalityCodes : [nationalityCodes];
      if (!codes.includes(nat)) continue;
    }

    const existing = playerMap.get(row.player_uid);
    const value = metric === 'goals' ? (row.goals || 0) : (row.appearances || 0);

    if (existing) {
      existing.subtractValue += value;
      existing.overlay.apps += row.appearances || 0;
      existing.overlay.goals += row.goals || 0;
      existing.overlay.mins += row.minutes || 0;
      if (row.club_name && !existing.clubs.includes(row.club_name)) {
        existing.clubs.push(row.club_name);
      }
    } else {
      playerMap.set(row.player_uid, {
        playerId: row.player_uid,
        name: row.player_name,
        normalized: normalize(row.player_name),
        nationality: nat,
        subtractValue: value,
        overlay: {
          apps: row.appearances || 0,
          goals: row.goals || 0,
          mins: row.minutes || 0,
        },
        clubs: row.club_name ? [row.club_name] : [],
        clubCount: 0,
        seasons: row.seasons || 0,
      });
    }
  }

  const result = Array.from(playerMap.values());
  result.forEach(p => p.clubCount = p.clubs.length);

  console.log('[fetchFromView] After aggregation:', result.length);
  return result;
}

/**
 * For competition-level queries (no club filter), use player_competition_totals
 * which has FK to players and competitions.
 *
 * Schema: player_uid, competition_id, appearances, goals, assists, minutes, seasons_count
 */
async function fetchCompetitionTotals(supabase, competitionName, nationalityCodes = null, metric = 'appearances') {
  console.log('[fetchCompetitionTotals]', { competitionName, nationalityCodes, metric });

  // First get the competition_id
  const { data: compData, error: compErr } = await supabase
    .from('competitions')
    .select('competition_id')
    .eq('competition_name', competitionName)
    .single();

  if (compErr || !compData) {
    console.error('[fetchCompetitionTotals] Competition not found:', competitionName);
    return [];
  }

  const competitionId = compData.competition_id;
  console.log('[fetchCompetitionTotals] competition_id:', competitionId);

  // Query player_competition_totals (has FK to players)
  // Use embedded join since FK exists: player_competition_totals -> players
  const { data: totals, error: totalsErr } = await supabase
    .from('player_competition_totals')
    .select(`
      player_uid,
      appearances,
      goals,
      assists,
      minutes,
      seasons_count,
      players!inner (
        player_name,
        nationality_norm
      )
    `)
    .eq('competition_id', competitionId)
    .gt(metric === 'goals' ? 'goals' : 'appearances', 0);

  if (totalsErr) {
    console.error('[fetchCompetitionTotals] Error:', totalsErr);
    throw new Error(totalsErr.message);
  }

  console.log('[fetchCompetitionTotals] Raw rows:', totals?.length || 0);

  if (!totals || totals.length === 0) return [];

  const result = [];
  for (const row of totals) {
    const player = row.players;
    if (!player) continue;

    const nat = (player.nationality_norm || '').toUpperCase();

    // Apply nationality filter
    if (nationalityCodes) {
      const codes = Array.isArray(nationalityCodes) ? nationalityCodes : [nationalityCodes];
      if (!codes.includes(nat)) continue;
    }

    const value = metric === 'goals' ? (row.goals || 0) : (row.appearances || 0);
    if (value <= 0) continue;

    result.push({
      playerId: row.player_uid,
      name: player.player_name,
      normalized: normalize(player.player_name),
      nationality: nat,
      subtractValue: value,
      overlay: {
        apps: row.appearances || 0,
        goals: row.goals || 0,
        mins: row.minutes || 0,
      },
      clubs: [],
      clubCount: 0,
      seasons: row.seasons_count || 0,
    });
  }

  console.log('[fetchCompetitionTotals] After filtering:', result.length);
  return result;
}

/**
 * Parse chat builder query
 */
function parseChatQuery(text) {
  const lower = text.toLowerCase();

  let metric = 'appearances';
  if (/goals?|scor/.test(lower)) metric = 'goals';

  let competition = 'Premier League';
  if (/champions league|ucl/.test(lower)) competition = 'Champions League';
  else if (/la liga/.test(lower)) competition = 'La Liga';
  else if (/serie a/.test(lower)) competition = 'Serie A';
  else if (/bundesliga/.test(lower)) competition = 'Bundesliga';

  const nationalities = [];
  for (const [alias, code] of Object.entries(NAT_ALIASES)) {
    if (lower.includes(alias) && !nationalities.includes(code)) {
      nationalities.push(code);
    }
  }

  const clubs = [];
  for (const [alias, club] of Object.entries(CLUB_ALIASES)) {
    if (lower.includes(alias) && !clubs.includes(club)) {
      clubs.push(club);
    }
  }

  return {
    metric,
    competition,
    nationalities: nationalities.length > 0 ? nationalities : null,
    clubs: clubs.length > 0 ? clubs : null,
  };
}

// ============================================================
// MAIN HANDLER
// ============================================================
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'POST only' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { categoryId, previewOnly = false, mode } = body;

    console.log('[match_start] Request:', { categoryId, previewOnly, mode });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return respond(500, { error: 'Missing Supabase config' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let players = [];
    let categoryName = '';
    let categoryFlag = '';
    let metric = 'appearances';
    let metricLabel = 'Apps';
    let competition = 'Premier League';

    // ============================================================
    // EPL COUNTRY - uses player_competition_totals with players join
    // ============================================================
    if (categoryId && COUNTRY_CATS[categoryId]) {
      const cat = COUNTRY_CATS[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      players = await fetchCompetitionTotals(supabase, 'Premier League', cat.code, 'appearances');
    }

    // ============================================================
    // EPL CONTINENT
    // ============================================================
    else if (categoryId && CONTINENT_CATS[categoryId]) {
      const cat = CONTINENT_CATS[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      players = await fetchCompetitionTotals(supabase, 'Premier League', cat.codes, 'appearances');
    }

    // ============================================================
    // EPL CLUB (Apps) - uses v_game_player_club_comp view
    // ============================================================
    else if (categoryId && CLUB_CATS[categoryId]) {
      const cat = CLUB_CATS[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      players = await fetchFromView(supabase, 'Premier League', cat.club, null, 'appearances');
    }

    // ============================================================
    // EPL GOALS
    // ============================================================
    else if (categoryId && GOALS_CATS[categoryId]) {
      const cat = GOALS_CATS[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      metric = 'goals';
      metricLabel = 'Goals';

      if (cat.club) {
        players = await fetchFromView(supabase, 'Premier League', cat.club, null, 'goals');
      } else {
        players = await fetchCompetitionTotals(supabase, 'Premier League', null, 'goals');
      }
    }

    // ============================================================
    // CHAT BUILDER
    // ============================================================
    else if (categoryId === 'chat_builder') {
      const text = body.text || '';
      console.log('[chat_builder] Input text:', text);

      const parsed = parseChatQuery(text);
      console.log('[chat_builder] Parsed:', parsed);

      metric = parsed.metric;
      metricLabel = parsed.metric === 'goals' ? 'Goals' : 'Apps';
      competition = parsed.competition;
      categoryName = 'Chat Built Game';
      categoryFlag = '💬';

      if (parsed.clubs && parsed.clubs.length > 0) {
        // Club-based query - aggregate across clubs
        const playerMap = new Map();

        for (const clubName of parsed.clubs) {
          const clubPlayers = await fetchFromView(supabase, competition, clubName, parsed.nationalities, parsed.metric);

          for (const p of clubPlayers) {
            const existing = playerMap.get(p.playerId);
            if (existing) {
              existing.subtractValue += p.subtractValue;
              existing.overlay.apps += p.overlay.apps;
              existing.overlay.goals += p.overlay.goals;
              for (const c of p.clubs) {
                if (!existing.clubs.includes(c)) existing.clubs.push(c);
              }
            } else {
              playerMap.set(p.playerId, { ...p, clubs: [...p.clubs] });
            }
          }
        }

        players = Array.from(playerMap.values());
      } else {
        // Nationality-only or all players
        players = await fetchCompetitionTotals(supabase, competition, parsed.nationalities, parsed.metric);
      }

      console.log('[chat_builder] Players found:', players.length);

      // Preview mode
      if (mode === 'preview' || previewOnly) {
        const count = players.length;
        let difficulty = 'easy';
        if (count < 20) difficulty = 'not_feasible';
        else if (count < 40) difficulty = 'hard';

        return respond(200, {
          meta: {
            categoryId: 'chat_builder',
            categoryName,
            categoryFlag,
            competition,
            metric,
            metricLabel,
            eligibleCount: count,
          },
          proposal: {
            competition,
            metric: metricLabel,
            nationalities: parsed.nationalities,
            clubs: parsed.clubs,
          },
          player_count: count,
          difficulty,
          eligibleCount: count,
          parsed,
        });
      }
    }

    // ============================================================
    // UNKNOWN CATEGORY
    // ============================================================
    else {
      return respond(400, {
        error: `Unknown categoryId: ${categoryId}`,
        validCategories: Object.keys(COUNTRY_CATS).concat(Object.keys(CLUB_CATS)).concat(['chat_builder']),
      });
    }

    // ============================================================
    // FILTER & SORT
    // ============================================================
    players = players.filter(p => p.subtractValue > 0);
    players.sort((a, b) => b.subtractValue - a.subtractValue);

    console.log('[match_start] Returning', players.length, 'players');

    const response = {
      meta: {
        categoryId,
        categoryName,
        categoryFlag,
        competition,
        metric,
        metricLabel,
        eligibleCount: players.length,
      },
    };

    if (previewOnly) {
      response.eligibleCount = players.length;
      return respond(200, response);
    }

    response.eligiblePlayers = players;
    return respond(200, response);

  } catch (err) {
    console.error('[match_start] Error:', err);
    return respond(500, { error: err.message, stack: err.stack });
  }
};
