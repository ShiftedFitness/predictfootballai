// netlify/functions/match_start.js
// Football 501 - Match Start API
// FIXED: Uses actual Supabase schema (player_uid, nationality_norm, NO starts in rollups)

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;
const DEBUG = process.env.DEBUG_MATCH_START === 'true';

// ============================================================
// LOGGING
// ============================================================
function log(...args) {
  if (DEBUG) console.log('[match_start]', ...args);
}

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
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

// ============================================================
// COMPETITION MAPPING
// DB stores full names like "Premier League"
// ============================================================
const COMPETITIONS = {
  EPL: 'Premier League',
  UCL: 'Champions League',
  LALIGA: 'La Liga',
  SERIEA: 'Serie A',
  BUNDESLIGA: 'Bundesliga',
  LIGUE1: 'Ligue 1',
};

function getDbCompetition(code) {
  return COMPETITIONS[code] || code;
}

// British nationality codes
const BRITISH_CODES = ['ENG', 'SCO', 'WAL', 'NIR'];

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
    codes: ['NGA', 'GHA', 'CIV', 'SEN', 'CMR', 'MAR', 'ALG', 'TUN', 'EGY', 'RSA', 'COD', 'MLI', 'ZIM', 'ZAM'],
  },
  continent_ASIA_OCEANIA: {
    name: 'Asia & Oceania', flag: '🌏',
    codes: ['AUS', 'NZL', 'JPN', 'KOR', 'CHN', 'IRN', 'SAU', 'UAE', 'QAT', 'IND', 'THA', 'MAS', 'ISR'],
  },
  continent_CONCACAF: {
    name: 'CONCACAF', flag: '🌎',
    codes: ['USA', 'CAN', 'MEX', 'CRC', 'JAM', 'TRI', 'HON', 'PAN', 'GUA', 'SLV', 'HAI', 'CUB'],
  },
  continent_SOUTH_AMERICA: {
    name: 'South America (excl. BRA/ARG)', flag: '🌎',
    codes: ['URU', 'CHI', 'COL', 'PER', 'ECU', 'PAR', 'VEN', 'BOL'],
  },
};

const CLUB_CATS = {
  club_Arsenal: { club: 'Arsenal', label: 'Arsenal' },
  club_AstonVilla: { club: 'Aston Villa', label: 'Aston Villa' },
  club_Blackburn: { club: 'Blackburn Rovers', alt: 'Blackburn', label: 'Blackburn' },
  club_Bolton: { club: 'Bolton Wanderers', alt: 'Bolton', label: 'Bolton' },
  club_Bournemouth: { club: 'AFC Bournemouth', alt: 'Bournemouth', label: 'Bournemouth' },
  club_Brentford: { club: 'Brentford', label: 'Brentford' },
  club_Brighton: { club: 'Brighton & Hove Albion', alt: 'Brighton', label: 'Brighton' },
  club_Burnley: { club: 'Burnley', label: 'Burnley' },
  club_Charlton: { club: 'Charlton Athletic', alt: 'Charlton', label: 'Charlton' },
  club_Chelsea: { club: 'Chelsea', label: 'Chelsea' },
  club_Coventry: { club: 'Coventry City', alt: 'Coventry', label: 'Coventry' },
  club_CrystalPalace: { club: 'Crystal Palace', label: 'Crystal Palace' },
  club_Derby: { club: 'Derby County', alt: 'Derby', label: 'Derby' },
  club_Everton: { club: 'Everton', label: 'Everton' },
  club_Fulham: { club: 'Fulham', label: 'Fulham' },
  club_Ipswich: { club: 'Ipswich Town', alt: 'Ipswich', label: 'Ipswich' },
  club_Leeds: { club: 'Leeds United', alt: 'Leeds', label: 'Leeds' },
  club_Leicester: { club: 'Leicester City', alt: 'Leicester', label: 'Leicester' },
  club_Liverpool: { club: 'Liverpool', label: 'Liverpool' },
  club_ManCity: { club: 'Manchester City', alt: 'Man City', label: 'Man City' },
  club_ManUtd: { club: 'Manchester United', alt: 'Man Utd', label: 'Man Utd' },
  club_Middlesbrough: { club: 'Middlesbrough', label: 'Middlesbrough' },
  club_Newcastle: { club: 'Newcastle United', alt: 'Newcastle', label: 'Newcastle' },
  club_Norwich: { club: 'Norwich City', alt: 'Norwich', label: 'Norwich' },
  club_NottmForest: { club: 'Nottingham Forest', alt: "Nott'm Forest", label: 'Nottm Forest' },
  club_Portsmouth: { club: 'Portsmouth', label: 'Portsmouth' },
  club_QPR: { club: 'Queens Park Rangers', alt: 'QPR', label: 'QPR' },
  club_Reading: { club: 'Reading', label: 'Reading' },
  club_SheffUtd: { club: 'Sheffield United', alt: 'Sheffield Utd', label: 'Sheff Utd' },
  club_SheffWed: { club: 'Sheffield Wednesday', alt: 'Sheffield Wed', label: 'Sheff Wed' },
  club_Southampton: { club: 'Southampton', label: 'Southampton' },
  club_Stoke: { club: 'Stoke City', alt: 'Stoke', label: 'Stoke' },
  club_Sunderland: { club: 'Sunderland', label: 'Sunderland' },
  club_Swansea: { club: 'Swansea City', alt: 'Swansea', label: 'Swansea' },
  club_Tottenham: { club: 'Tottenham Hotspur', alt: 'Spurs', label: 'Spurs' },
  club_Watford: { club: 'Watford', label: 'Watford' },
  club_WestBrom: { club: 'West Bromwich Albion', alt: 'West Brom', label: 'West Brom' },
  club_WestHam: { club: 'West Ham United', alt: 'West Ham', label: 'West Ham' },
  club_Wigan: { club: 'Wigan Athletic', alt: 'Wigan', label: 'Wigan' },
  club_Wimbledon: { club: 'Wimbledon', label: 'Wimbledon' },
  club_Wolves: { club: 'Wolverhampton Wanderers', alt: 'Wolves', label: 'Wolves' },
};

const GOALS_CATS = {
  goals_overall: { label: 'All EPL Goals' },
  goals_Arsenal: { club: 'Arsenal', label: 'Arsenal Goals' },
  goals_AstonVilla: { club: 'Aston Villa', label: 'Aston Villa Goals' },
  goals_Chelsea: { club: 'Chelsea', label: 'Chelsea Goals' },
  goals_Everton: { club: 'Everton', label: 'Everton Goals' },
  goals_Leeds: { club: 'Leeds United', alt: 'Leeds', label: 'Leeds Goals' },
  goals_Leicester: { club: 'Leicester City', alt: 'Leicester', label: 'Leicester Goals' },
  goals_Liverpool: { club: 'Liverpool', label: 'Liverpool Goals' },
  goals_ManCity: { club: 'Manchester City', label: 'Man City Goals' },
  goals_ManUtd: { club: 'Manchester United', label: 'Man Utd Goals' },
  goals_Newcastle: { club: 'Newcastle United', alt: 'Newcastle', label: 'Newcastle Goals' },
  goals_Southampton: { club: 'Southampton', label: 'Southampton Goals' },
  goals_Sunderland: { club: 'Sunderland', label: 'Sunderland Goals' },
  goals_Tottenham: { club: 'Tottenham Hotspur', alt: 'Spurs', label: 'Spurs Goals' },
  goals_WestHam: { club: 'West Ham United', alt: 'West Ham', label: 'West Ham Goals' },
};

// UCL Categories
const UCL_COUNTRY_CATS = {
  ucl_country_ALL: { name: 'All Nationalities', flag: '🌍' },
  ucl_country_ENG: { code: 'ENG', name: 'English', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  ucl_country_FRA: { code: 'FRA', name: 'French', flag: '🇫🇷' },
  ucl_country_ESP: { code: 'ESP', name: 'Spanish', flag: '🇪🇸' },
  ucl_country_ITA: { code: 'ITA', name: 'Italian', flag: '🇮🇹' },
  ucl_country_GER: { code: 'GER', name: 'German', flag: '🇩🇪' },
  ucl_country_BRA: { code: 'BRA', name: 'Brazilian', flag: '🇧🇷' },
  ucl_country_ARG: { code: 'ARG', name: 'Argentine', flag: '🇦🇷' },
  ucl_country_NED: { code: 'NED', name: 'Dutch', flag: '🇳🇱' },
  ucl_country_POR: { code: 'POR', name: 'Portuguese', flag: '🇵🇹' },
};

const UCL_CLUB_CATS = {
  ucl_club_RealMadrid: { club: 'Real Madrid', label: 'Real Madrid' },
  ucl_club_Barcelona: { club: 'FC Barcelona', alt: 'Barcelona', label: 'Barcelona' },
  ucl_club_ManUtd: { club: 'Manchester United', label: 'Man Utd' },
  ucl_club_ManCity: { club: 'Manchester City', label: 'Man City' },
  ucl_club_Liverpool: { club: 'Liverpool', label: 'Liverpool' },
  ucl_club_Bayern: { club: 'Bayern Munich', alt: 'Bayern München', label: 'Bayern Munich' },
  ucl_club_Juventus: { club: 'Juventus', label: 'Juventus' },
  ucl_club_Chelsea: { club: 'Chelsea', label: 'Chelsea' },
  ucl_club_Arsenal: { club: 'Arsenal', label: 'Arsenal' },
  ucl_club_ACMilan: { club: 'AC Milan', alt: 'Milan', label: 'AC Milan' },
  ucl_club_Inter: { club: 'Inter Milan', alt: 'Inter', label: 'Inter Milan' },
  ucl_club_PSG: { club: 'Paris Saint-Germain', alt: 'PSG', label: 'PSG' },
};

// Chat builder aliases
const CLUB_ALIASES = {
  'man utd': 'Manchester United', 'man united': 'Manchester United', 'united': 'Manchester United',
  'man city': 'Manchester City', 'city': 'Manchester City',
  'spurs': 'Tottenham Hotspur', 'tottenham': 'Tottenham Hotspur',
  'arsenal': 'Arsenal', 'gunners': 'Arsenal',
  'liverpool': 'Liverpool', 'reds': 'Liverpool',
  'chelsea': 'Chelsea', 'blues': 'Chelsea',
  'everton': 'Everton', 'toffees': 'Everton',
  'newcastle': 'Newcastle United', 'magpies': 'Newcastle United',
  'west ham': 'West Ham United', 'hammers': 'West Ham United',
  'aston villa': 'Aston Villa', 'villa': 'Aston Villa',
  'leicester': 'Leicester City', 'foxes': 'Leicester City',
  'leeds': 'Leeds United',
  'wolves': 'Wolverhampton Wanderers',
  'southampton': 'Southampton', 'saints': 'Southampton',
  'brighton': 'Brighton & Hove Albion',
  'palace': 'Crystal Palace', 'crystal palace': 'Crystal Palace',
  'fulham': 'Fulham', 'brentford': 'Brentford',
  'bournemouth': 'AFC Bournemouth',
  'nottingham forest': 'Nottingham Forest', 'forest': 'Nottingham Forest',
  'sunderland': 'Sunderland',
};

const NAT_ALIASES = {
  'english': 'ENG', 'england': 'ENG',
  'french': 'FRA', 'france': 'FRA',
  'spanish': 'ESP', 'spain': 'ESP',
  'german': 'GER', 'germany': 'GER',
  'italian': 'ITA', 'italy': 'ITA',
  'dutch': 'NED', 'netherlands': 'NED', 'holland': 'NED',
  'portuguese': 'POR', 'portugal': 'POR',
  'brazilian': 'BRA', 'brazil': 'BRA',
  'argentine': 'ARG', 'argentinian': 'ARG', 'argentina': 'ARG',
  'scottish': 'SCO', 'scotland': 'SCO',
  'welsh': 'WAL', 'wales': 'WAL',
  'irish': 'IRL', 'ireland': 'IRL',
  'northern irish': 'NIR', 'northern ireland': 'NIR',
  'belgian': 'BEL', 'belgium': 'BEL',
  'danish': 'DEN', 'denmark': 'DEN',
  'norwegian': 'NOR', 'norway': 'NOR',
  'nigerian': 'NGA', 'nigeria': 'NGA',
  'ghanaian': 'GHA', 'ghana': 'GHA',
  'ivorian': 'CIV', 'ivory coast': 'CIV',
  'senegalese': 'SEN', 'senegal': 'SEN',
  'egyptian': 'EGY', 'egypt': 'EGY',
  'moroccan': 'MAR', 'morocco': 'MAR',
  'american': 'USA', 'usa': 'USA',
  'canadian': 'CAN', 'canada': 'CAN',
  'mexican': 'MEX', 'mexico': 'MEX',
  'jamaican': 'JAM', 'jamaica': 'JAM',
  'australian': 'AUS', 'australia': 'AUS',
  'japanese': 'JPN', 'japan': 'JPN',
  'korean': 'KOR', 'south korean': 'KOR',
};

// ============================================================
// UTILITIES
// ============================================================
function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.-]/g, '').trim();
}

// ============================================================
// DATA FETCHING - OPTION 2: Separate queries, NO embedded joins
// Uses actual schema: player_uid, player_name, nationality_norm
// Rollup tables do NOT have 'starts' column
// ============================================================

async function fetchPlayersForCompetition(supabase, competition, nationalityCodes, metric = 'appearances') {
  const dbComp = getDbCompetition(competition);
  log('fetchPlayersForCompetition', { dbComp, nationalityCodes, metric });

  // Step 1: Query player_competition_totals (NO starts column!)
  const { data: totals, error: totalsErr } = await supabase
    .from('player_competition_totals')
    .select('player_uid, appearances, goals, minutes')
    .eq('competition', dbComp)
    .gt(metric === 'goals' ? 'goals' : 'appearances', 0);

  if (totalsErr) {
    console.error('Error fetching totals:', totalsErr);
    throw new Error(`Failed to fetch competition totals: ${totalsErr.message}`);
  }

  if (!totals || totals.length === 0) {
    log('No totals found for competition:', dbComp);
    return [];
  }

  log('Found totals rows:', totals.length);

  // Step 2: Get unique player_uids
  const uids = [...new Set(totals.map(r => r.player_uid))];

  // Step 3: Fetch player info from players table
  // Schema: player_uid, player_name, nationality_norm, birth_year
  const playerMap = new Map();
  const batchSize = 400;

  for (let i = 0; i < uids.length; i += batchSize) {
    const batch = uids.slice(i, i + batchSize);
    const { data: players, error: playersErr } = await supabase
      .from('players')
      .select('player_uid, player_name, nationality_norm')
      .in('player_uid', batch);

    if (playersErr) {
      console.error('Error fetching players:', playersErr);
      continue;
    }

    (players || []).forEach(p => playerMap.set(p.player_uid, p));
  }

  log('Fetched player info for:', playerMap.size, 'players');

  // Step 4: Join in JS and filter by nationality
  const hasNatFilter = nationalityCodes && (Array.isArray(nationalityCodes) ? nationalityCodes.length > 0 : true);
  const result = [];

  for (const row of totals) {
    const player = playerMap.get(row.player_uid);
    if (!player) continue;

    const nat = (player.nationality_norm || '').toUpperCase();

    // Apply nationality filter
    if (hasNatFilter) {
      if (Array.isArray(nationalityCodes)) {
        if (!nationalityCodes.includes(nat)) continue;
      } else {
        if (nat !== nationalityCodes) continue;
      }
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
    });
  }

  log('After filtering:', result.length, 'players');
  return result;
}

async function fetchPlayersForClub(supabase, competition, clubName, altClub, metric = 'appearances') {
  const dbComp = getDbCompetition(competition);
  log('fetchPlayersForClub', { dbComp, clubName, altClub, metric });

  // Try primary club name first
  let { data: totals, error: totalsErr } = await supabase
    .from('player_club_totals')
    .select('player_uid, club, appearances, goals, minutes')
    .eq('competition', dbComp)
    .eq('club', clubName)
    .gt(metric === 'goals' ? 'goals' : 'appearances', 0);

  if (totalsErr) {
    console.error('Error fetching club totals:', totalsErr);
  }

  // Try alt club name if needed
  if ((!totals || totals.length === 0) && altClub) {
    log('Trying alt club name:', altClub);
    const { data: altTotals, error: altErr } = await supabase
      .from('player_club_totals')
      .select('player_uid, club, appearances, goals, minutes')
      .eq('competition', dbComp)
      .eq('club', altClub)
      .gt(metric === 'goals' ? 'goals' : 'appearances', 0);

    if (!altErr && altTotals) {
      totals = altTotals;
    }
  }

  if (!totals || totals.length === 0) {
    log('No club totals found');
    return [];
  }

  log('Found club totals rows:', totals.length);

  // Fetch player info
  const uids = [...new Set(totals.map(r => r.player_uid))];
  const playerMap = new Map();

  const batchSize = 400;
  for (let i = 0; i < uids.length; i += batchSize) {
    const batch = uids.slice(i, i + batchSize);
    const { data: players } = await supabase
      .from('players')
      .select('player_uid, player_name, nationality_norm')
      .in('player_uid', batch);

    (players || []).forEach(p => playerMap.set(p.player_uid, p));
  }

  // Get all clubs for these players (for display)
  const clubsMap = {};
  for (let i = 0; i < uids.length; i += batchSize) {
    const batch = uids.slice(i, i + batchSize);
    const { data: clubData } = await supabase
      .from('player_club_totals')
      .select('player_uid, club')
      .eq('competition', dbComp)
      .in('player_uid', batch);

    (clubData || []).forEach(r => {
      if (!clubsMap[r.player_uid]) clubsMap[r.player_uid] = [];
      if (!clubsMap[r.player_uid].includes(r.club)) {
        clubsMap[r.player_uid].push(r.club);
      }
    });
  }

  return totals.map(row => {
    const player = playerMap.get(row.player_uid) || {};
    const clubs = clubsMap[row.player_uid] || [row.club];
    const value = metric === 'goals' ? (row.goals || 0) : (row.appearances || 0);

    return {
      playerId: row.player_uid,
      name: player.player_name || 'Unknown',
      normalized: normalize(player.player_name || ''),
      nationality: (player.nationality_norm || '').toUpperCase(),
      subtractValue: value,
      overlay: {
        apps: row.appearances || 0,
        goals: row.goals || 0,
        mins: row.minutes || 0,
        club: row.club,
      },
      clubs: clubs.slice(0, 5),
      clubCount: clubs.length,
    };
  });
}

async function fetchBig5British(supabase, metric = 'appearances') {
  const competitions = ['La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];
  const playerMap = new Map();

  // First get all British players
  const { data: britishPlayers } = await supabase
    .from('players')
    .select('player_uid, player_name, nationality_norm')
    .in('nationality_norm', BRITISH_CODES);

  if (!britishPlayers || britishPlayers.length === 0) return [];

  const britishUids = britishPlayers.map(p => p.player_uid);
  const playerInfoMap = new Map();
  britishPlayers.forEach(p => playerInfoMap.set(p.player_uid, p));

  for (const comp of competitions) {
    const batchSize = 400;
    for (let i = 0; i < britishUids.length; i += batchSize) {
      const batch = britishUids.slice(i, i + batchSize);
      const { data } = await supabase
        .from('player_competition_totals')
        .select('player_uid, appearances, goals, minutes')
        .eq('competition', comp)
        .in('player_uid', batch)
        .gt(metric === 'goals' ? 'goals' : 'appearances', 0);

      (data || []).forEach(row => {
        const value = metric === 'goals' ? (row.goals || 0) : (row.appearances || 0);
        const existing = playerMap.get(row.player_uid);

        if (existing) {
          existing.subtractValue += value;
          existing.overlay.apps += row.appearances || 0;
          existing.overlay.goals += row.goals || 0;
          if (!existing.competitions.includes(comp)) {
            existing.competitions.push(comp);
          }
        } else {
          const player = playerInfoMap.get(row.player_uid) || {};
          playerMap.set(row.player_uid, {
            playerId: row.player_uid,
            name: player.player_name || 'Unknown',
            normalized: normalize(player.player_name || ''),
            nationality: (player.nationality_norm || '').toUpperCase(),
            subtractValue: value,
            overlay: {
              apps: row.appearances || 0,
              goals: row.goals || 0,
              mins: row.minutes || 0,
            },
            competitions: [comp],
            clubs: [],
            clubCount: 0,
          });
        }
      });
    }
  }

  return Array.from(playerMap.values());
}

async function fetchTopClubs(supabase, competition, limit = 25) {
  const dbComp = getDbCompetition(competition);

  const { data, error } = await supabase
    .from('player_club_totals')
    .select('club')
    .eq('competition', dbComp)
    .gt('appearances', 0);

  if (error || !data) return [];

  const counts = {};
  data.forEach(r => {
    counts[r.club] = (counts[r.club] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([club, count]) => ({ club, count }));
}

// ============================================================
// CHAT BUILDER PARSER
// ============================================================
function parseChatQuery(text) {
  const lower = text.toLowerCase();

  // Metric
  let metric = 'appearances';
  if (/goals?|scor/.test(lower)) metric = 'goals';

  // Competition (default EPL)
  let competition = 'Premier League';
  if (/champions league|ucl|cl\b/.test(lower)) competition = 'Champions League';
  else if (/la liga|laliga|spain/.test(lower)) competition = 'La Liga';
  else if (/serie a|seriea|italy/.test(lower)) competition = 'Serie A';
  else if (/bundesliga|germany/.test(lower)) competition = 'Bundesliga';
  else if (/ligue 1|ligue1|france/.test(lower)) competition = 'Ligue 1';

  // Nationalities
  const nationalities = [];
  for (const [alias, code] of Object.entries(NAT_ALIASES)) {
    if (lower.includes(alias) && !nationalities.includes(code)) {
      nationalities.push(code);
    }
  }

  // Clubs
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

    log('Request:', { categoryId, previewOnly, mode });

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
    // EPL COUNTRY
    // ============================================================
    if (categoryId && COUNTRY_CATS[categoryId]) {
      const cat = COUNTRY_CATS[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      players = await fetchPlayersForCompetition(supabase, 'EPL', cat.code, 'appearances');
    }

    // ============================================================
    // EPL CONTINENT
    // ============================================================
    else if (categoryId && CONTINENT_CATS[categoryId]) {
      const cat = CONTINENT_CATS[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      players = await fetchPlayersForCompetition(supabase, 'EPL', cat.codes, 'appearances');
    }

    // ============================================================
    // EPL CLUB (Apps)
    // ============================================================
    else if (categoryId && CLUB_CATS[categoryId]) {
      const cat = CLUB_CATS[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      players = await fetchPlayersForClub(supabase, 'EPL', cat.club, cat.alt, 'appearances');
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
        players = await fetchPlayersForClub(supabase, 'EPL', cat.club, cat.alt, 'goals');
      } else {
        players = await fetchPlayersForCompetition(supabase, 'EPL', null, 'goals');
      }
    }

    // ============================================================
    // UCL COUNTRY
    // ============================================================
    else if (categoryId && UCL_COUNTRY_CATS[categoryId]) {
      const cat = UCL_COUNTRY_CATS[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      competition = 'Champions League';
      const natFilter = cat.code || null;
      players = await fetchPlayersForCompetition(supabase, 'UCL', natFilter, 'appearances');
    }

    // ============================================================
    // UCL CLUB
    // ============================================================
    else if (categoryId && UCL_CLUB_CATS[categoryId]) {
      const cat = UCL_CLUB_CATS[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      competition = 'Champions League';
      players = await fetchPlayersForClub(supabase, 'UCL', cat.club, cat.alt, 'appearances');
    }

    // ============================================================
    // DYNAMIC: La Liga, Serie A, Bundesliga clubs
    // ============================================================
    else if (categoryId?.startsWith('laliga_club_')) {
      const clubName = categoryId.replace('laliga_club_', '').replace(/_/g, ' ');
      categoryName = clubName;
      categoryFlag = '🇪🇸';
      competition = 'La Liga';
      players = await fetchPlayersForClub(supabase, 'LALIGA', clubName, null, 'appearances');
    }
    else if (categoryId?.startsWith('laliga_goals_')) {
      const clubName = categoryId.replace('laliga_goals_', '').replace(/_/g, ' ');
      categoryName = `${clubName} Goals`;
      categoryFlag = '🇪🇸';
      competition = 'La Liga';
      metric = 'goals';
      metricLabel = 'Goals';
      players = await fetchPlayersForClub(supabase, 'LALIGA', clubName, null, 'goals');
    }
    else if (categoryId?.startsWith('seriea_club_')) {
      const clubName = categoryId.replace('seriea_club_', '').replace(/_/g, ' ');
      categoryName = clubName;
      categoryFlag = '🇮🇹';
      competition = 'Serie A';
      players = await fetchPlayersForClub(supabase, 'SERIEA', clubName, null, 'appearances');
    }
    else if (categoryId?.startsWith('seriea_goals_')) {
      const clubName = categoryId.replace('seriea_goals_', '').replace(/_/g, ' ');
      categoryName = `${clubName} Goals`;
      categoryFlag = '🇮🇹';
      competition = 'Serie A';
      metric = 'goals';
      metricLabel = 'Goals';
      players = await fetchPlayersForClub(supabase, 'SERIEA', clubName, null, 'goals');
    }
    else if (categoryId?.startsWith('bundesliga_club_')) {
      const clubName = categoryId.replace('bundesliga_club_', '').replace(/_/g, ' ');
      categoryName = clubName;
      categoryFlag = '🇩🇪';
      competition = 'Bundesliga';
      players = await fetchPlayersForClub(supabase, 'BUNDESLIGA', clubName, null, 'appearances');
    }
    else if (categoryId?.startsWith('bundesliga_goals_')) {
      const clubName = categoryId.replace('bundesliga_goals_', '').replace(/_/g, ' ');
      categoryName = `${clubName} Goals`;
      categoryFlag = '🇩🇪';
      competition = 'Bundesliga';
      metric = 'goals';
      metricLabel = 'Goals';
      players = await fetchPlayersForClub(supabase, 'BUNDESLIGA', clubName, null, 'goals');
    }

    // ============================================================
    // BIG 5 BRITISH
    // ============================================================
    else if (categoryId === 'big5_british_apps') {
      categoryName = 'Big 5 British (Apps)';
      categoryFlag = '🇬🇧';
      competition = 'Big 5 (ex EPL)';
      players = await fetchBig5British(supabase, 'appearances');
    }
    else if (categoryId === 'big5_british_goals') {
      categoryName = 'Big 5 British (Goals)';
      categoryFlag = '🇬🇧';
      competition = 'Big 5 (ex EPL)';
      metric = 'goals';
      metricLabel = 'Goals';
      players = await fetchBig5British(supabase, 'goals');
    }

    // ============================================================
    // GET TOP CLUBS
    // ============================================================
    else if (categoryId === 'get_top_clubs') {
      const comp = body.competition || 'La Liga';
      const clubs = await fetchTopClubs(supabase, comp, body.limit || 25);
      return respond(200, { competition: comp, clubs });
    }

    // ============================================================
    // CUSTOM GAME
    // ============================================================
    else if (categoryId === 'custom') {
      metric = body.metric === 'goals' ? 'goals' : 'appearances';
      metricLabel = metric === 'goals' ? 'Goals' : 'Apps';
      const nats = body.nationalities || null;
      const clubs = body.clubs || null;
      competition = body.competition || 'Premier League';
      categoryName = 'Custom Game';
      categoryFlag = '🎮';

      if (clubs && clubs.length > 0) {
        // Club filter - aggregate across specified clubs
        const playerAgg = new Map();
        for (const clubName of clubs) {
          const resolved = CLUB_ALIASES[clubName.toLowerCase()] || clubName;
          const clubPlayers = await fetchPlayersForClub(supabase, 'EPL', resolved, null, metric);

          for (const p of clubPlayers) {
            // Nat filter
            if (nats && nats.length > 0 && !nats.includes(p.nationality)) continue;

            const existing = playerAgg.get(p.playerId);
            if (existing) {
              existing.subtractValue += p.subtractValue;
              existing.overlay.apps += p.overlay.apps;
              existing.overlay.goals += p.overlay.goals;
              if (!existing.clubs.includes(p.overlay.club)) {
                existing.clubs.push(p.overlay.club);
              }
            } else {
              playerAgg.set(p.playerId, { ...p });
            }
          }
        }
        players = Array.from(playerAgg.values());
      } else if (nats && nats.length > 0) {
        players = await fetchPlayersForCompetition(supabase, 'EPL', nats, metric);
      } else {
        players = await fetchPlayersForCompetition(supabase, 'EPL', null, metric);
      }
    }

    // ============================================================
    // CHAT BUILDER
    // ============================================================
    else if (categoryId === 'chat_builder') {
      const text = body.text || '';
      const parsed = parseChatQuery(text);

      metric = parsed.metric;
      metricLabel = parsed.metric === 'goals' ? 'Goals' : 'Apps';
      competition = parsed.competition;
      categoryName = 'Chat Built Game';
      categoryFlag = '💬';

      const hasNatFilter = parsed.nationalities && parsed.nationalities.length > 0;
      const hasClubFilter = parsed.clubs && parsed.clubs.length > 0;

      if (hasClubFilter) {
        // Aggregate across clubs
        const playerAgg = new Map();
        const compCode = Object.keys(COMPETITIONS).find(k => COMPETITIONS[k] === competition) || 'EPL';

        for (const clubName of parsed.clubs) {
          const clubPlayers = await fetchPlayersForClub(supabase, compCode, clubName, null, parsed.metric);

          for (const p of clubPlayers) {
            if (hasNatFilter && !parsed.nationalities.includes(p.nationality)) continue;

            const existing = playerAgg.get(p.playerId);
            if (existing) {
              existing.subtractValue += p.subtractValue;
              existing.overlay.apps += p.overlay.apps;
              existing.overlay.goals += p.overlay.goals;
              if (!existing.clubs.includes(p.overlay.club)) {
                existing.clubs.push(p.overlay.club);
              }
            } else {
              playerAgg.set(p.playerId, { ...p });
            }
          }
        }
        players = Array.from(playerAgg.values());
      } else {
        const compCode = Object.keys(COMPETITIONS).find(k => COMPETITIONS[k] === competition) || 'EPL';
        players = await fetchPlayersForCompetition(supabase, compCode, parsed.nationalities, parsed.metric);
      }

      // Preview mode for chat builder
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
    // UNKNOWN
    // ============================================================
    else {
      return respond(400, {
        error: `Unknown categoryId: ${categoryId}`,
        hint: 'Valid: country_*, continent_*, club_*, goals_*, ucl_country_*, ucl_club_*, big5_british_*, chat_builder, custom, get_top_clubs',
      });
    }

    // ============================================================
    // FINAL: Filter & Sort
    // ============================================================
    players = players.filter(p => p.subtractValue > 0);
    players.sort((a, b) => b.subtractValue - a.subtractValue);

    log('Returning', players.length, 'players for', categoryId);

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
