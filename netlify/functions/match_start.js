// netlify/functions/match_start.js
// Supabase-backed match start API for Football 501
// Supports multiple competitions: EPL, UCL, La Liga, Serie A, Bundesliga, Ligue 1
// FIXED: Uses player_uid (not player_id), separate queries (no embedded joins)

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

// ============================================================
// IN-MEMORY CACHE (45-minute TTL for preview/difficulty queries)
// ============================================================
const cache = new Map();
const CACHE_TTL_MS = 45 * 60 * 1000; // 45 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ============================================================
// COMPETITION MAPPING
// DB stores full names like "Premier League", not "EPL"
// ============================================================
const COMPETITIONS = {
  EPL: { dbName: 'Premier League', displayName: 'Premier League', aliases: ['premier league', 'epl', 'pl', 'prem'] },
  UCL: { dbName: 'Champions League', displayName: 'Champions League', aliases: ['champions league', 'ucl', 'cl'] },
  LALIGA: { dbName: 'La Liga', displayName: 'La Liga', aliases: ['la liga', 'laliga', 'spain', 'spanish league'] },
  SERIEA: { dbName: 'Serie A', displayName: 'Serie A', aliases: ['serie a', 'seriea', 'italy', 'italian league'] },
  BUNDESLIGA: { dbName: 'Bundesliga', displayName: 'Bundesliga', aliases: ['bundesliga', 'germany', 'german league'] },
  LIGUE1: { dbName: 'Ligue 1', displayName: 'Ligue 1', aliases: ['ligue 1', 'ligue1', 'france', 'french league'] },
};

// Helper to get DB competition name from category code
function getCompetitionDbName(code) {
  const comp = COMPETITIONS[code];
  return comp ? comp.dbName : code;
}

// British nationality codes
const BRITISH_CODES = ['ENG', 'SCO', 'WAL', 'NIR'];

// ============================================================
// CATEGORY DEFINITIONS
// ============================================================

// EPL Country categories
const EPL_COUNTRY_CATEGORIES = {
  epl_country_ENG: { code: 'ENG', name: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', competition: 'EPL' },
  epl_country_FRA: { code: 'FRA', name: 'France', flag: '🇫🇷', competition: 'EPL' },
  epl_country_ESP: { code: 'ESP', name: 'Spain', flag: '🇪🇸', competition: 'EPL' },
  epl_country_ARG: { code: 'ARG', name: 'Argentina', flag: '🇦🇷', competition: 'EPL' },
  epl_country_NED: { code: 'NED', name: 'Netherlands', flag: '🇳🇱', competition: 'EPL' },
  epl_country_POR: { code: 'POR', name: 'Portugal', flag: '🇵🇹', competition: 'EPL' },
  epl_country_IRL: { code: 'IRL', name: 'Ireland', flag: '🇮🇪', competition: 'EPL' },
  epl_country_SCO: { code: 'SCO', name: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', competition: 'EPL' },
  epl_country_WAL: { code: 'WAL', name: 'Wales', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', competition: 'EPL' },
  epl_country_NIR: { code: 'NIR', name: 'Northern Ireland', flag: '🇬🇧', competition: 'EPL' },
  epl_country_NOR: { code: 'NOR', name: 'Norway', flag: '🇳🇴', competition: 'EPL' },
  epl_country_DEN: { code: 'DEN', name: 'Denmark', flag: '🇩🇰', competition: 'EPL' },
  epl_country_BEL: { code: 'BEL', name: 'Belgium', flag: '🇧🇪', competition: 'EPL' },
  epl_country_GER: { code: 'GER', name: 'Germany', flag: '🇩🇪', competition: 'EPL' },
  epl_country_BRA: { code: 'BRA', name: 'Brazil', flag: '🇧🇷', competition: 'EPL' },
  epl_country_ITA: { code: 'ITA', name: 'Italy', flag: '🇮🇹', competition: 'EPL' },
};

// EPL Continent categories
const EPL_CONTINENT_CATEGORIES = {
  epl_continent_CONCACAF: {
    name: 'CONCACAF', flag: '🌎', competition: 'EPL',
    codes: ['USA', 'CAN', 'MEX', 'CRC', 'JAM', 'TRI', 'HON', 'PAN', 'GUA', 'SLV', 'HAI', 'CUB'],
  },
  epl_continent_ASIA_OCEANIA: {
    name: 'Asia & Oceania', flag: '🌏', competition: 'EPL',
    codes: ['AUS', 'NZL', 'JPN', 'KOR', 'CHN', 'IRN', 'SAU', 'UAE', 'QAT', 'IND', 'THA', 'MAS', 'ISR'],
  },
  epl_continent_SOUTH_AMERICA: {
    name: 'South America (excl. BRA/ARG)', flag: '🌎', competition: 'EPL',
    codes: ['URU', 'CHI', 'COL', 'PER', 'ECU', 'PAR', 'VEN', 'BOL'],
  },
  epl_continent_AFRICA: {
    name: 'Africa', flag: '🌍', competition: 'EPL',
    codes: ['NGA', 'GHA', 'CIV', 'SEN', 'CMR', 'MAR', 'ALG', 'TUN', 'EGY', 'RSA', 'COD', 'MLI', 'ZIM', 'ZAM'],
  },
};

// EPL Position categories
const EPL_POSITION_CATEGORIES = {
  epl_position_GK: { position: 'GK', name: 'Goalkeepers', flag: '🧤', competition: 'EPL' },
  epl_position_DF: { position: 'DF', name: 'Defenders', flag: '🛡️', competition: 'EPL' },
  epl_position_MF: { position: 'MF', name: 'Midfielders', flag: '⚙️', competition: 'EPL' },
  epl_position_FW: { position: 'FW', name: 'Forwards', flag: '⚡', competition: 'EPL' },
};

// EPL Club categories (expanded to top clubs)
const EPL_CLUB_CATEGORIES = {
  club_Arsenal: { club: 'Arsenal', label: 'Arsenal', competition: 'EPL' },
  club_AstonVilla: { club: 'Aston Villa', label: 'Aston Villa', competition: 'EPL' },
  club_Blackburn: { club: 'Blackburn Rovers', altClub: 'Blackburn', label: 'Blackburn', competition: 'EPL' },
  club_Bolton: { club: 'Bolton Wanderers', altClub: 'Bolton', label: 'Bolton', competition: 'EPL' },
  club_Bournemouth: { club: 'AFC Bournemouth', altClub: 'Bournemouth', label: 'Bournemouth', competition: 'EPL' },
  club_Brentford: { club: 'Brentford', label: 'Brentford', competition: 'EPL' },
  club_Brighton: { club: 'Brighton & Hove Albion', altClub: 'Brighton', label: 'Brighton', competition: 'EPL' },
  club_Burnley: { club: 'Burnley', label: 'Burnley', competition: 'EPL' },
  club_Charlton: { club: 'Charlton Athletic', altClub: 'Charlton', label: 'Charlton', competition: 'EPL' },
  club_Chelsea: { club: 'Chelsea', label: 'Chelsea', competition: 'EPL' },
  club_Coventry: { club: 'Coventry City', altClub: 'Coventry', label: 'Coventry', competition: 'EPL' },
  club_CrystalPalace: { club: 'Crystal Palace', label: 'Crystal Palace', competition: 'EPL' },
  club_Derby: { club: 'Derby County', altClub: 'Derby', label: 'Derby', competition: 'EPL' },
  club_Everton: { club: 'Everton', label: 'Everton', competition: 'EPL' },
  club_Fulham: { club: 'Fulham', label: 'Fulham', competition: 'EPL' },
  club_Ipswich: { club: 'Ipswich Town', altClub: 'Ipswich', label: 'Ipswich', competition: 'EPL' },
  club_Leeds: { club: 'Leeds United', altClub: 'Leeds', label: 'Leeds', competition: 'EPL' },
  club_Leicester: { club: 'Leicester City', altClub: 'Leicester', label: 'Leicester', competition: 'EPL' },
  club_Liverpool: { club: 'Liverpool', label: 'Liverpool', competition: 'EPL' },
  club_ManCity: { club: 'Manchester City', altClub: 'Man City', label: 'Man City', competition: 'EPL' },
  club_ManUtd: { club: 'Manchester United', altClub: 'Man Utd', label: 'Man Utd', competition: 'EPL' },
  club_Middlesbrough: { club: 'Middlesbrough', label: 'Middlesbrough', competition: 'EPL' },
  club_Newcastle: { club: 'Newcastle United', altClub: 'Newcastle', label: 'Newcastle', competition: 'EPL' },
  club_Norwich: { club: 'Norwich City', altClub: 'Norwich', label: 'Norwich', competition: 'EPL' },
  club_NottmForest: { club: 'Nottingham Forest', altClub: "Nott'm Forest", label: 'Nottm Forest', competition: 'EPL' },
  club_Portsmouth: { club: 'Portsmouth', label: 'Portsmouth', competition: 'EPL' },
  club_QPR: { club: 'Queens Park Rangers', altClub: 'QPR', label: 'QPR', competition: 'EPL' },
  club_Reading: { club: 'Reading', label: 'Reading', competition: 'EPL' },
  club_SheffUtd: { club: 'Sheffield United', altClub: 'Sheff Utd', label: 'Sheff Utd', competition: 'EPL' },
  club_SheffWed: { club: 'Sheffield Wednesday', altClub: 'Sheff Wed', label: 'Sheff Wed', competition: 'EPL' },
  club_Southampton: { club: 'Southampton', label: 'Southampton', competition: 'EPL' },
  club_Stoke: { club: 'Stoke City', altClub: 'Stoke', label: 'Stoke', competition: 'EPL' },
  club_Sunderland: { club: 'Sunderland', label: 'Sunderland', competition: 'EPL' },
  club_Swansea: { club: 'Swansea City', altClub: 'Swansea', label: 'Swansea', competition: 'EPL' },
  club_Tottenham: { club: 'Tottenham Hotspur', altClub: 'Spurs', label: 'Spurs', competition: 'EPL' },
  club_Watford: { club: 'Watford', label: 'Watford', competition: 'EPL' },
  club_WestBrom: { club: 'West Bromwich Albion', altClub: 'West Brom', label: 'West Brom', competition: 'EPL' },
  club_WestHam: { club: 'West Ham United', altClub: 'West Ham', label: 'West Ham', competition: 'EPL' },
  club_Wigan: { club: 'Wigan Athletic', altClub: 'Wigan', label: 'Wigan', competition: 'EPL' },
  club_Wimbledon: { club: 'Wimbledon', label: 'Wimbledon', competition: 'EPL' },
  club_Wolves: { club: 'Wolverhampton Wanderers', altClub: 'Wolves', label: 'Wolves', competition: 'EPL' },
};

// EPL Goals categories (expanded)
const EPL_GOALS_CATEGORIES = {
  goals_overall: { label: 'All EPL Goals', competition: 'EPL' },
  goals_Arsenal: { club: 'Arsenal', label: 'Arsenal Goals', competition: 'EPL' },
  goals_AstonVilla: { club: 'Aston Villa', label: 'Aston Villa Goals', competition: 'EPL' },
  goals_Chelsea: { club: 'Chelsea', label: 'Chelsea Goals', competition: 'EPL' },
  goals_Everton: { club: 'Everton', label: 'Everton Goals', competition: 'EPL' },
  goals_Leeds: { club: 'Leeds United', altClub: 'Leeds', label: 'Leeds Goals', competition: 'EPL' },
  goals_Leicester: { club: 'Leicester City', altClub: 'Leicester', label: 'Leicester Goals', competition: 'EPL' },
  goals_Liverpool: { club: 'Liverpool', label: 'Liverpool Goals', competition: 'EPL' },
  goals_ManCity: { club: 'Manchester City', label: 'Man City Goals', competition: 'EPL' },
  goals_ManUtd: { club: 'Manchester United', altClub: 'Man Utd', label: 'Man Utd Goals', competition: 'EPL' },
  goals_Newcastle: { club: 'Newcastle United', altClub: 'Newcastle', label: 'Newcastle Goals', competition: 'EPL' },
  goals_Southampton: { club: 'Southampton', label: 'Southampton Goals', competition: 'EPL' },
  goals_Sunderland: { club: 'Sunderland', label: 'Sunderland Goals', competition: 'EPL' },
  goals_Tottenham: { club: 'Tottenham Hotspur', altClub: 'Spurs', label: 'Spurs Goals', competition: 'EPL' },
  goals_WestHam: { club: 'West Ham United', altClub: 'West Ham', label: 'West Ham Goals', competition: 'EPL' },
};

// UCL Nationality categories
const UCL_COUNTRY_CATEGORIES = {
  ucl_country_ALL: { name: 'All Nationalities', flag: '🌍', competition: 'UCL' },
  ucl_country_ENG: { code: 'ENG', name: 'English', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', competition: 'UCL' },
  ucl_country_FRA: { code: 'FRA', name: 'French', flag: '🇫🇷', competition: 'UCL' },
  ucl_country_ESP: { code: 'ESP', name: 'Spanish', flag: '🇪🇸', competition: 'UCL' },
  ucl_country_ITA: { code: 'ITA', name: 'Italian', flag: '🇮🇹', competition: 'UCL' },
  ucl_country_NED: { code: 'NED', name: 'Dutch', flag: '🇳🇱', competition: 'UCL' },
  ucl_country_GER: { code: 'GER', name: 'German', flag: '🇩🇪', competition: 'UCL' },
  ucl_country_BRA: { code: 'BRA', name: 'Brazilian', flag: '🇧🇷', competition: 'UCL' },
  ucl_country_ARG: { code: 'ARG', name: 'Argentine', flag: '🇦🇷', competition: 'UCL' },
  ucl_country_POR: { code: 'POR', name: 'Portuguese', flag: '🇵🇹', competition: 'UCL' },
};

// UCL Goals by nationality
const UCL_GOALS_CATEGORIES = {
  ucl_goals_ALL: { name: 'All UCL Goals', flag: '⚽', competition: 'UCL' },
  ucl_goals_ENG: { code: 'ENG', name: 'English Goals', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', competition: 'UCL' },
  ucl_goals_FRA: { code: 'FRA', name: 'French Goals', flag: '🇫🇷', competition: 'UCL' },
  ucl_goals_ESP: { code: 'ESP', name: 'Spanish Goals', flag: '🇪🇸', competition: 'UCL' },
  ucl_goals_ITA: { code: 'ITA', name: 'Italian Goals', flag: '🇮🇹', competition: 'UCL' },
  ucl_goals_NED: { code: 'NED', name: 'Dutch Goals', flag: '🇳🇱', competition: 'UCL' },
};

// UCL Club categories
const UCL_CLUB_CATEGORIES = {
  ucl_club_RealMadrid: { club: 'Real Madrid', label: 'Real Madrid', competition: 'UCL' },
  ucl_club_Barcelona: { club: 'FC Barcelona', altClub: 'Barcelona', label: 'Barcelona', competition: 'UCL' },
  ucl_club_ManUtd: { club: 'Manchester United', altClub: 'Man Utd', label: 'Man Utd', competition: 'UCL' },
  ucl_club_ManCity: { club: 'Manchester City', altClub: 'Man City', label: 'Man City', competition: 'UCL' },
  ucl_club_Liverpool: { club: 'Liverpool', label: 'Liverpool', competition: 'UCL' },
  ucl_club_Bayern: { club: 'Bayern Munich', altClub: 'Bayern München', label: 'Bayern Munich', competition: 'UCL' },
  ucl_club_Juventus: { club: 'Juventus', label: 'Juventus', competition: 'UCL' },
  ucl_club_Chelsea: { club: 'Chelsea', label: 'Chelsea', competition: 'UCL' },
  ucl_club_Arsenal: { club: 'Arsenal', label: 'Arsenal', competition: 'UCL' },
  ucl_club_ACMilan: { club: 'AC Milan', altClub: 'Milan', label: 'AC Milan', competition: 'UCL' },
  ucl_club_Inter: { club: 'Inter Milan', altClub: 'Inter', label: 'Inter Milan', competition: 'UCL' },
  ucl_club_PSG: { club: 'Paris Saint-Germain', altClub: 'PSG', label: 'PSG', competition: 'UCL' },
};

// ============================================================
// CLUB NAME MAPPING (for chat builder normalization)
// ============================================================
const CLUB_ALIASES = {
  'man utd': 'Manchester United',
  'man united': 'Manchester United',
  'manchester utd': 'Manchester United',
  'united': 'Manchester United',
  'man city': 'Manchester City',
  'city': 'Manchester City',
  'spurs': 'Tottenham Hotspur',
  'tottenham': 'Tottenham Hotspur',
  'arsenal': 'Arsenal',
  'gunners': 'Arsenal',
  'liverpool': 'Liverpool',
  'reds': 'Liverpool',
  'chelsea': 'Chelsea',
  'blues': 'Chelsea',
  'everton': 'Everton',
  'toffees': 'Everton',
  'newcastle': 'Newcastle United',
  'magpies': 'Newcastle United',
  'west ham': 'West Ham United',
  'hammers': 'West Ham United',
  'aston villa': 'Aston Villa',
  'villa': 'Aston Villa',
  'leicester': 'Leicester City',
  'foxes': 'Leicester City',
  'leeds': 'Leeds United',
  'wolves': 'Wolverhampton Wanderers',
  'wolverhampton': 'Wolverhampton Wanderers',
  'southampton': 'Southampton',
  'saints': 'Southampton',
  'brighton': 'Brighton & Hove Albion',
  'palace': 'Crystal Palace',
  'crystal palace': 'Crystal Palace',
  'fulham': 'Fulham',
  'brentford': 'Brentford',
  'bournemouth': 'AFC Bournemouth',
  'nottingham forest': 'Nottingham Forest',
  'forest': 'Nottingham Forest',
  'real madrid': 'Real Madrid',
  'barca': 'FC Barcelona',
  'barcelona': 'FC Barcelona',
  'bayern': 'Bayern Munich',
  'bayern munich': 'Bayern Munich',
  'juve': 'Juventus',
  'juventus': 'Juventus',
  'psg': 'Paris Saint-Germain',
  'paris': 'Paris Saint-Germain',
  'ac milan': 'AC Milan',
  'milan': 'AC Milan',
  'inter': 'Inter Milan',
  'inter milan': 'Inter Milan',
};

// Nationality aliases
const NATIONALITY_ALIASES = {
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
  'swedish': 'SWE', 'sweden': 'SWE',
  'nigerian': 'NGA', 'nigeria': 'NGA',
  'ghanaian': 'GHA', 'ghana': 'GHA',
  'ivorian': 'CIV', 'ivory coast': 'CIV',
  'senegalese': 'SEN', 'senegal': 'SEN',
  'cameroonian': 'CMR', 'cameroon': 'CMR',
  'egyptian': 'EGY', 'egypt': 'EGY',
  'moroccan': 'MAR', 'morocco': 'MAR',
  'american': 'USA', 'usa': 'USA', 'us': 'USA',
  'canadian': 'CAN', 'canada': 'CAN',
  'mexican': 'MEX', 'mexico': 'MEX',
  'jamaican': 'JAM', 'jamaica': 'JAM',
  'australian': 'AUS', 'australia': 'AUS',
  'japanese': 'JPN', 'japan': 'JPN',
  'korean': 'KOR', 'south korean': 'KOR', 'south korea': 'KOR',
  'colombian': 'COL', 'colombia': 'COL',
  'uruguayan': 'URU', 'uruguay': 'URU',
  'chilean': 'CHI', 'chile': 'CHI',
  'ecuadorian': 'ECU', 'ecuador': 'ECU',
  'croatian': 'CRO', 'croatia': 'CRO',
  'serbian': 'SRB', 'serbia': 'SRB',
  'polish': 'POL', 'poland': 'POL',
  'czech': 'CZE', 'czech republic': 'CZE',
  'turkish': 'TUR', 'turkey': 'TUR',
  'greek': 'GRE', 'greece': 'GRE',
  'swiss': 'SUI', 'switzerland': 'SUI',
  'austrian': 'AUT', 'austria': 'AUT',
};

// ============================================================
// HINTS (non-spoiler)
// ============================================================
const HINTS = {
  epl_country_FRA: 'French players have been a staple of the Premier League since 1992.',
  epl_country_ESP: 'Spanish flair has graced the EPL since the early 2000s.',
  epl_country_ARG: 'Argentine players have a rich history in England.',
  epl_country_NED: 'Dutch players were among the earliest foreign imports.',
  epl_country_ENG: 'English players form the backbone of the Premier League.',
  club_Arsenal: 'The Gunners have featured over 200 players in Premier League history.',
  club_ManUtd: 'Manchester United have the most Premier League titles.',
  club_Liverpool: 'Liverpool FC has seen many legendary players across all eras.',
  club_Chelsea: 'Chelsea have been a dominant force since the 2000s.',
  club_ManCity: 'Manchester City transformed into a powerhouse in the 2010s.',
  goals_overall: 'Score goals from any Premier League player.',
  ucl_country_ALL: 'All players who have appeared in the Champions League.',
  ucl_club_RealMadrid: 'Real Madrid are the most decorated UCL club.',
  big5_british_apps: 'British players plying their trade across Europe\'s top leagues.',
};

// ============================================================
// TRIVIA
// ============================================================
const TRIVIA = {
  epl_country_FRA: [
    { q: 'Which decade saw the most French players debut in the Premier League?', options: ['1990s', '2000s', '2010s', '2020s'], answer: 1 },
  ],
  epl_country_ENG: [
    { q: 'Which English player has the most Premier League appearances?', options: ['Frank Lampard', 'Gareth Barry', 'Steven Gerrard', 'Wayne Rooney'], answer: 1 },
  ],
  club_ManUtd: [
    { q: 'How many EPL titles has Manchester United won?', options: ['10', '13', '15', '20'], answer: 1 },
  ],
  club_Liverpool: [
    { q: 'What year did Liverpool win their first Premier League title?', options: ['2019', '2020', '2021', '2022'], answer: 1 },
  ],
  goals_overall: [
    { q: 'True or false: The Premier League has seen over 30,000 goals scored.', options: ['True', 'False'], answer: 0 },
  ],
  ucl_country_ALL: [
    { q: 'Which club has won the most Champions League titles?', options: ['AC Milan', 'Barcelona', 'Real Madrid', 'Bayern Munich'], answer: 2 },
  ],
};

// ============================================================
// UTILITIES
// ============================================================
function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.-]/g, '').trim();
}

// Parse nationality from DB format (e.g., "eng ENG" -> "ENG")
function parseNationality(natString) {
  if (!natString) return '';
  const parts = String(natString).trim().split(/\s+/);
  // Take the uppercase part if available
  for (const part of parts) {
    if (part === part.toUpperCase() && part.length === 3) {
      return part;
    }
  }
  // Fallback to uppercase of last part
  return parts[parts.length - 1].toUpperCase();
}

// Check if nationality matches filter (handles both single code and arrays)
function matchesNationality(playerNat, filter) {
  const parsed = parseNationality(playerNat);
  if (Array.isArray(filter)) {
    return filter.includes(parsed);
  }
  return parsed === filter;
}

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

function resolveClubName(input) {
  const normalized = normalize(input);
  return CLUB_ALIASES[normalized] || input;
}

function resolveNationalityCode(input) {
  const normalized = normalize(input);
  return NATIONALITY_ALIASES[normalized] || input.toUpperCase();
}

// ============================================================
// CHAT BUILDER PARSER
// ============================================================
function parseChatQuery(text) {
  const normalized = text.toLowerCase();

  // Determine metric
  let metric = 'appearances';
  if (/goals?|scor/.test(normalized)) {
    metric = 'goals';
  }

  // Determine competition (default to Premier League)
  let competition = 'Premier League';
  for (const [key, comp] of Object.entries(COMPETITIONS)) {
    for (const alias of comp.aliases) {
      if (normalized.includes(alias)) {
        competition = comp.dbName;
        break;
      }
    }
  }

  // Extract nationalities
  const nationalities = [];
  for (const [alias, code] of Object.entries(NATIONALITY_ALIASES)) {
    if (normalized.includes(alias) && !nationalities.includes(code)) {
      nationalities.push(code);
    }
  }

  // Extract clubs
  const clubs = [];
  for (const [alias, club] of Object.entries(CLUB_ALIASES)) {
    if (normalized.includes(alias) && !clubs.includes(club)) {
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
// DATA FETCHING HELPERS (Option 2: Separate queries, no embedded joins)
// ============================================================

// Fetch players from player_competition_totals with optional nationality filter
async function fetchPlayersByCompetitionAndNationality(supabase, competition, nationalityCodes, metric = 'appearances') {
  const competitionDbName = getCompetitionDbName(competition);
  const metricCol = metric === 'goals' ? 'goals' : 'appearances';

  // Step 1: Fetch from player_competition_totals (no join)
  let query = supabase
    .from('player_competition_totals')
    .select('player_uid, appearances, goals, minutes, starts')
    .eq('competition', competitionDbName)
    .gt(metricCol, 0);

  const { data: totalsData, error: totalsError } = await query;
  if (totalsError) {
    console.error('[fetchPlayersByCompetitionAndNationality] totals error:', totalsError);
    throw totalsError;
  }

  if (!totalsData || totalsData.length === 0) {
    return [];
  }

  // Step 2: Get unique player_uids
  const playerUids = [...new Set(totalsData.map(r => r.player_uid))];

  // Step 3: Fetch player info separately (batched if needed)
  const batchSize = 500;
  const playerInfoMap = new Map();

  for (let i = 0; i < playerUids.length; i += batchSize) {
    const batch = playerUids.slice(i, i + batchSize);
    const { data: playersData, error: playersError } = await supabase
      .from('players')
      .select('player_uid, player_name, normalized_player_name, nationality, position')
      .in('player_uid', batch);

    if (playersError) {
      console.error('[fetchPlayersByCompetitionAndNationality] players error:', playersError);
      continue;
    }

    (playersData || []).forEach(p => {
      playerInfoMap.set(p.player_uid, p);
    });
  }

  // Step 4: Join in JavaScript and filter by nationality
  const result = [];
  const hasNatFilter = nationalityCodes && (Array.isArray(nationalityCodes) ? nationalityCodes.length > 0 : true);

  for (const row of totalsData) {
    const playerInfo = playerInfoMap.get(row.player_uid);
    if (!playerInfo) continue;

    // Apply nationality filter
    if (hasNatFilter && !matchesNationality(playerInfo.nationality, nationalityCodes)) {
      continue;
    }

    const subtractValue = metric === 'goals' ? row.goals : row.appearances;

    result.push({
      playerId: row.player_uid,
      name: playerInfo.player_name,
      normalized: playerInfo.normalized_player_name || normalize(playerInfo.player_name),
      nationality: parseNationality(playerInfo.nationality),
      subtractValue,
      overlay: {
        apps: row.appearances,
        goals: row.goals,
        mins: row.minutes,
        starts: row.starts,
      },
      clubs: [],
      clubCount: 0,
      seasonsCount: null,
    });
  }

  // Step 5: Optionally fetch clubs (for display)
  if (result.length > 0 && result.length <= 2000) {
    const clubsMap = await getClubsForPlayers(supabase, result.map(r => r.playerId), competitionDbName);
    result.forEach(r => {
      r.clubs = (clubsMap[r.playerId] || []).slice(0, 5);
      r.clubCount = (clubsMap[r.playerId] || []).length;
    });
  }

  return result;
}

// Fetch players from player_club_totals for a specific club
async function fetchPlayersByClub(supabase, competition, clubName, altClubName, metric = 'appearances') {
  const competitionDbName = getCompetitionDbName(competition);
  const metricCol = metric === 'goals' ? 'goals' : 'appearances';

  // Try primary club name
  let { data: totalsData, error: totalsError } = await supabase
    .from('player_club_totals')
    .select('player_uid, club, appearances, goals, minutes, starts')
    .eq('competition', competitionDbName)
    .eq('club', clubName)
    .gt(metricCol, 0);

  if (totalsError) {
    console.error('[fetchPlayersByClub] totals error:', totalsError);
    throw totalsError;
  }

  // Try alt club name if no results
  if ((!totalsData || totalsData.length === 0) && altClubName) {
    const altResult = await supabase
      .from('player_club_totals')
      .select('player_uid, club, appearances, goals, minutes, starts')
      .eq('competition', competitionDbName)
      .eq('club', altClubName)
      .gt(metricCol, 0);

    if (!altResult.error && altResult.data) {
      totalsData = altResult.data;
    }
  }

  if (!totalsData || totalsData.length === 0) {
    return [];
  }

  // Fetch player info
  const playerUids = [...new Set(totalsData.map(r => r.player_uid))];
  const playerInfoMap = new Map();

  const batchSize = 500;
  for (let i = 0; i < playerUids.length; i += batchSize) {
    const batch = playerUids.slice(i, i + batchSize);
    const { data: playersData } = await supabase
      .from('players')
      .select('player_uid, player_name, normalized_player_name, nationality, position')
      .in('player_uid', batch);

    (playersData || []).forEach(p => {
      playerInfoMap.set(p.player_uid, p);
    });
  }

  // Get all clubs for these players
  const clubsMap = await getClubsForPlayers(supabase, playerUids, competitionDbName);

  // Join in JavaScript
  return totalsData.map(row => {
    const playerInfo = playerInfoMap.get(row.player_uid) || {};
    const allClubs = clubsMap[row.player_uid] || [row.club];

    return {
      playerId: row.player_uid,
      name: playerInfo.player_name || 'Unknown',
      normalized: playerInfo.normalized_player_name || normalize(playerInfo.player_name || ''),
      nationality: parseNationality(playerInfo.nationality),
      subtractValue: metric === 'goals' ? row.goals : row.appearances,
      overlay: {
        apps: row.appearances,
        goals: row.goals,
        mins: row.minutes,
        starts: row.starts,
        club: row.club,
      },
      clubs: allClubs.slice(0, 5),
      clubCount: allClubs.length,
      seasonsCount: null,
    };
  });
}

// Get all clubs for a set of players in a competition
async function getClubsForPlayers(supabase, playerUids, competitionDbName) {
  if (!playerUids || playerUids.length === 0) return {};

  const clubsMap = {};
  const batchSize = 500;

  for (let i = 0; i < playerUids.length; i += batchSize) {
    const batch = playerUids.slice(i, i + batchSize);
    const { data } = await supabase
      .from('player_club_totals')
      .select('player_uid, club')
      .eq('competition', competitionDbName)
      .in('player_uid', batch);

    (data || []).forEach(r => {
      if (!clubsMap[r.player_uid]) clubsMap[r.player_uid] = [];
      if (!clubsMap[r.player_uid].includes(r.club)) {
        clubsMap[r.player_uid].push(r.club);
      }
    });
  }

  return clubsMap;
}

// Fetch players by position
async function fetchPlayersByPosition(supabase, competition, position, metric = 'appearances') {
  const competitionDbName = getCompetitionDbName(competition);
  const metricCol = metric === 'goals' ? 'goals' : 'appearances';

  // Step 1: Fetch from player_competition_totals
  const { data: totalsData, error: totalsError } = await supabase
    .from('player_competition_totals')
    .select('player_uid, appearances, goals, minutes, starts')
    .eq('competition', competitionDbName)
    .gt(metricCol, 0);

  if (totalsError) throw totalsError;
  if (!totalsData || totalsData.length === 0) return [];

  // Step 2: Fetch players with the desired position
  const playerUids = [...new Set(totalsData.map(r => r.player_uid))];
  const playerInfoMap = new Map();

  const batchSize = 500;
  for (let i = 0; i < playerUids.length; i += batchSize) {
    const batch = playerUids.slice(i, i + batchSize);
    const { data: playersData } = await supabase
      .from('players')
      .select('player_uid, player_name, normalized_player_name, nationality, position')
      .in('player_uid', batch)
      .eq('position', position);

    (playersData || []).forEach(p => {
      playerInfoMap.set(p.player_uid, p);
    });
  }

  // Step 3: Join and filter
  const result = [];
  for (const row of totalsData) {
    const playerInfo = playerInfoMap.get(row.player_uid);
    if (!playerInfo) continue;

    result.push({
      playerId: row.player_uid,
      name: playerInfo.player_name,
      normalized: playerInfo.normalized_player_name || normalize(playerInfo.player_name),
      nationality: parseNationality(playerInfo.nationality),
      subtractValue: metric === 'goals' ? row.goals : row.appearances,
      overlay: {
        apps: row.appearances,
        goals: row.goals,
        mins: row.minutes,
        starts: row.starts,
        position: playerInfo.position,
      },
      clubs: [],
      clubCount: 0,
    });
  }

  // Fetch clubs
  if (result.length > 0 && result.length <= 2000) {
    const clubsMap = await getClubsForPlayers(supabase, result.map(r => r.playerId), competitionDbName);
    result.forEach(r => {
      r.clubs = (clubsMap[r.playerId] || []).slice(0, 5);
      r.clubCount = (clubsMap[r.playerId] || []).length;
    });
  }

  return result;
}

// Fetch British players in Big 5 leagues (ex EPL)
async function fetchBig5BritishPlayers(supabase, metric = 'appearances') {
  const competitions = ['La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];
  const metricCol = metric === 'goals' ? 'goals' : 'appearances';

  // First, get all British players
  const { data: britishPlayers } = await supabase
    .from('players')
    .select('player_uid, player_name, normalized_player_name, nationality')
    .or(BRITISH_CODES.map(c => `nationality.ilike.%${c}%`).join(','));

  if (!britishPlayers || britishPlayers.length === 0) return [];

  const britishUids = britishPlayers.map(p => p.player_uid);
  const playerInfoMap = new Map();
  britishPlayers.forEach(p => playerInfoMap.set(p.player_uid, p));

  const allPlayers = new Map();

  for (const comp of competitions) {
    // Fetch totals for British players in this competition
    const batchSize = 500;
    for (let i = 0; i < britishUids.length; i += batchSize) {
      const batch = britishUids.slice(i, i + batchSize);
      const { data } = await supabase
        .from('player_competition_totals')
        .select('player_uid, appearances, goals, minutes, starts')
        .eq('competition', comp)
        .in('player_uid', batch)
        .gt(metricCol, 0);

      (data || []).forEach(row => {
        const existing = allPlayers.get(row.player_uid);
        const value = metric === 'goals' ? row.goals : row.appearances;

        if (existing) {
          existing.subtractValue += value;
          existing.overlay.apps += row.appearances;
          existing.overlay.goals += row.goals;
          if (!existing.competitions.includes(comp)) {
            existing.competitions.push(comp);
          }
        } else {
          const playerInfo = playerInfoMap.get(row.player_uid) || {};
          allPlayers.set(row.player_uid, {
            playerId: row.player_uid,
            name: playerInfo.player_name || 'Unknown',
            normalized: playerInfo.normalized_player_name || normalize(playerInfo.player_name || ''),
            nationality: parseNationality(playerInfo.nationality),
            subtractValue: value,
            overlay: {
              apps: row.appearances,
              goals: row.goals,
              mins: row.minutes,
              starts: row.starts,
            },
            competitions: [comp],
            clubs: [],
            clubCount: 0,
          });
        }
      });
    }
  }

  return Array.from(allPlayers.values());
}

// Fetch top clubs in a competition
async function fetchDynamicTopClubs(supabase, competition, limit = 25) {
  const competitionDbName = getCompetitionDbName(competition);

  const { data, error } = await supabase
    .from('player_club_totals')
    .select('club')
    .eq('competition', competitionDbName)
    .gt('appearances', 0);

  if (error || !data) return [];

  // Count players per club
  const clubCounts = {};
  data.forEach(row => {
    clubCounts[row.club] = (clubCounts[row.club] || 0) + 1;
  });

  // Sort by count descending
  return Object.entries(clubCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([club, count]) => ({ club, count }));
}

// ============================================================
// HANDLER
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
    const { categoryId, datasetVersion = 'v2', previewOnly = false } = body;

    console.log('[match_start] Request:', { categoryId, datasetVersion, previewOnly });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error('[match_start] Missing Supabase credentials');
      return respond(500, { error: 'Server configuration error' });
    }

    // Check cache for preview requests
    if (previewOnly) {
      const cacheKey = `preview_${categoryId}_${JSON.stringify(body)}`;
      const cached = getCached(cacheKey);
      if (cached) {
        console.log('[match_start] Cache hit for preview:', categoryId);
        return respond(200, cached);
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let eligiblePlayers = [];
    let categoryName = '';
    let categoryFlag = '';
    let metric = 'appearances';
    let metricLabel = 'Apps';
    let competition = 'EPL';

    // ============================================================
    // EPL COUNTRY CATEGORIES
    // ============================================================
    if (categoryId && EPL_COUNTRY_CATEGORIES[categoryId]) {
      const cat = EPL_COUNTRY_CATEGORIES[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      competition = cat.competition;

      eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
        supabase, competition, cat.code, 'appearances'
      );
    }

    // ============================================================
    // EPL CONTINENT CATEGORIES
    // ============================================================
    else if (categoryId && EPL_CONTINENT_CATEGORIES[categoryId]) {
      const cat = EPL_CONTINENT_CATEGORIES[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      competition = cat.competition;

      eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
        supabase, competition, cat.codes, 'appearances'
      );
    }

    // ============================================================
    // EPL POSITION CATEGORIES
    // ============================================================
    else if (categoryId && EPL_POSITION_CATEGORIES[categoryId]) {
      const cat = EPL_POSITION_CATEGORIES[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      competition = cat.competition;

      eligiblePlayers = await fetchPlayersByPosition(
        supabase, competition, cat.position, 'appearances'
      );
    }

    // ============================================================
    // EPL CLUB CATEGORIES (Apps)
    // ============================================================
    else if (categoryId && EPL_CLUB_CATEGORIES[categoryId]) {
      const cat = EPL_CLUB_CATEGORIES[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      competition = cat.competition;

      eligiblePlayers = await fetchPlayersByClub(
        supabase, competition, cat.club, cat.altClub, 'appearances'
      );
    }

    // ============================================================
    // EPL GOALS CATEGORIES
    // ============================================================
    else if (categoryId && EPL_GOALS_CATEGORIES[categoryId]) {
      const cat = EPL_GOALS_CATEGORIES[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      metric = 'goals';
      metricLabel = 'Goals';
      competition = cat.competition;

      if (cat.club) {
        eligiblePlayers = await fetchPlayersByClub(
          supabase, competition, cat.club, cat.altClub, 'goals'
        );
      } else {
        // All EPL goals
        eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
          supabase, competition, null, 'goals'
        );
      }
    }

    // ============================================================
    // UCL COUNTRY CATEGORIES
    // ============================================================
    else if (categoryId && UCL_COUNTRY_CATEGORIES[categoryId]) {
      const cat = UCL_COUNTRY_CATEGORIES[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      competition = 'UCL';

      const nationalityFilter = cat.code || null;
      eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
        supabase, competition, nationalityFilter, 'appearances'
      );
    }

    // ============================================================
    // UCL GOALS CATEGORIES
    // ============================================================
    else if (categoryId && UCL_GOALS_CATEGORIES[categoryId]) {
      const cat = UCL_GOALS_CATEGORIES[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      metric = 'goals';
      metricLabel = 'Goals';
      competition = 'UCL';

      const nationalityFilter = cat.code || null;
      eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
        supabase, competition, nationalityFilter, 'goals'
      );
    }

    // ============================================================
    // UCL CLUB CATEGORIES
    // ============================================================
    else if (categoryId && UCL_CLUB_CATEGORIES[categoryId]) {
      const cat = UCL_CLUB_CATEGORIES[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      competition = 'UCL';

      eligiblePlayers = await fetchPlayersByClub(
        supabase, competition, cat.club, cat.altClub, 'appearances'
      );
    }

    // ============================================================
    // DYNAMIC COMPETITION CLUB CATEGORIES (La Liga, Serie A, Bundesliga)
    // ============================================================
    else if (categoryId && categoryId.startsWith('laliga_club_')) {
      const clubName = categoryId.replace('laliga_club_', '').replace(/_/g, ' ');
      categoryName = clubName;
      categoryFlag = '🇪🇸';
      competition = 'LALIGA';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'appearances');
    }

    else if (categoryId && categoryId.startsWith('laliga_goals_')) {
      const clubName = categoryId.replace('laliga_goals_', '').replace(/_/g, ' ');
      categoryName = `${clubName} Goals`;
      categoryFlag = '🇪🇸';
      metric = 'goals';
      metricLabel = 'Goals';
      competition = 'LALIGA';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'goals');
    }

    else if (categoryId && categoryId.startsWith('seriea_club_')) {
      const clubName = categoryId.replace('seriea_club_', '').replace(/_/g, ' ');
      categoryName = clubName;
      categoryFlag = '🇮🇹';
      competition = 'SERIEA';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'appearances');
    }

    else if (categoryId && categoryId.startsWith('seriea_goals_')) {
      const clubName = categoryId.replace('seriea_goals_', '').replace(/_/g, ' ');
      categoryName = `${clubName} Goals`;
      categoryFlag = '🇮🇹';
      metric = 'goals';
      metricLabel = 'Goals';
      competition = 'SERIEA';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'goals');
    }

    else if (categoryId && categoryId.startsWith('bundesliga_club_')) {
      const clubName = categoryId.replace('bundesliga_club_', '').replace(/_/g, ' ');
      categoryName = clubName;
      categoryFlag = '🇩🇪';
      competition = 'BUNDESLIGA';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'appearances');
    }

    else if (categoryId && categoryId.startsWith('bundesliga_goals_')) {
      const clubName = categoryId.replace('bundesliga_goals_', '').replace(/_/g, ' ');
      categoryName = `${clubName} Goals`;
      categoryFlag = '🇩🇪';
      metric = 'goals';
      metricLabel = 'Goals';
      competition = 'BUNDESLIGA';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'goals');
    }

    // ============================================================
    // BIG 5 BRITISH PLAYERS
    // ============================================================
    else if (categoryId === 'big5_british_apps') {
      categoryName = 'Big 5 British (Apps)';
      categoryFlag = '🇬🇧';
      competition = 'Big 5 (ex EPL)';

      eligiblePlayers = await fetchBig5BritishPlayers(supabase, 'appearances');
    }

    else if (categoryId === 'big5_british_goals') {
      categoryName = 'Big 5 British (Goals)';
      categoryFlag = '🇬🇧';
      metric = 'goals';
      metricLabel = 'Goals';
      competition = 'Big 5 (ex EPL)';

      eligiblePlayers = await fetchBig5BritishPlayers(supabase, 'goals');
    }

    // ============================================================
    // GET TOP CLUBS (for dynamic category listing)
    // ============================================================
    else if (categoryId === 'get_top_clubs') {
      const comp = body.competition || 'La Liga';
      const limit = body.limit || 25;

      const topClubs = await fetchDynamicTopClubs(supabase, comp, limit);

      return respond(200, {
        competition: comp,
        clubs: topClubs,
      });
    }

    // ============================================================
    // CUSTOM GAME (with intersection support)
    // ============================================================
    else if (categoryId === 'custom') {
      const customMetric = body.metric === 'goals' || body.metric === 'goals_total' ? 'goals' : 'appearances';
      const nationalities = body.nationalities || null;
      const clubs = body.clubs || null;
      const customCompetition = body.competition || 'EPL';

      metric = customMetric;
      metricLabel = customMetric === 'goals' ? 'Goals' : 'Apps';
      categoryName = 'Custom Game';
      categoryFlag = '🎮';
      competition = customCompetition;

      const hasNatFilter = nationalities && nationalities.length > 0;
      const hasClubFilter = clubs && clubs.length > 0;

      if (!hasNatFilter && !hasClubFilter) {
        // All players in competition
        eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
          supabase, competition, null, customMetric
        );
      } else if (hasNatFilter && !hasClubFilter) {
        // Nationality filter only
        eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
          supabase, competition, nationalities, customMetric
        );
      } else {
        // Club filter (with optional nationality intersection)
        const competitionDbName = getCompetitionDbName(competition);
        const metricCol = customMetric === 'goals' ? 'goals' : 'appearances';
        const playerMap = new Map();

        for (const clubName of clubs) {
          const resolvedClub = resolveClubName(clubName);

          const { data, error } = await supabase
            .from('player_club_totals')
            .select('player_uid, club, appearances, goals, minutes, starts')
            .eq('competition', competitionDbName)
            .eq('club', resolvedClub)
            .gt(metricCol, 0);

          if (error) continue;

          // Get player info for these
          const uids = (data || []).map(r => r.player_uid);
          const { data: playersData } = await supabase
            .from('players')
            .select('player_uid, player_name, normalized_player_name, nationality')
            .in('player_uid', uids);

          const playerInfoMap = new Map();
          (playersData || []).forEach(p => playerInfoMap.set(p.player_uid, p));

          (data || []).forEach(row => {
            const playerInfo = playerInfoMap.get(row.player_uid) || {};
            const parsedNat = parseNationality(playerInfo.nationality);

            // Check nationality filter
            if (hasNatFilter && !nationalities.includes(parsedNat)) {
              return;
            }

            const value = customMetric === 'goals' ? row.goals : row.appearances;
            const existing = playerMap.get(row.player_uid);

            if (existing) {
              existing.subtractValue += value;
              existing.overlay.apps += row.appearances;
              existing.overlay.goals += row.goals;
              if (!existing.clubs.includes(row.club)) {
                existing.clubs.push(row.club);
              }
            } else {
              playerMap.set(row.player_uid, {
                playerId: row.player_uid,
                name: playerInfo.player_name || 'Unknown',
                normalized: playerInfo.normalized_player_name || normalize(playerInfo.player_name || ''),
                nationality: parsedNat,
                subtractValue: value,
                overlay: {
                  apps: row.appearances,
                  goals: row.goals,
                  mins: row.minutes,
                  starts: row.starts,
                },
                clubs: [row.club],
                clubCount: 1,
              });
            }
          });
        }

        eligiblePlayers = Array.from(playerMap.values());
        eligiblePlayers.forEach(p => p.clubCount = p.clubs.length);
      }
    }

    // ============================================================
    // CHAT BUILDER
    // ============================================================
    else if (categoryId === 'chat_builder') {
      const chatText = body.text || '';
      const parsed = parseChatQuery(chatText);

      metric = parsed.metric;
      metricLabel = parsed.metric === 'goals' ? 'Goals' : 'Apps';
      // Map competition back to code for internal use
      competition = Object.keys(COMPETITIONS).find(k => COMPETITIONS[k].dbName === parsed.competition) || 'EPL';
      categoryName = 'Chat Built Game';
      categoryFlag = '💬';

      const hasNatFilter = parsed.nationalities && parsed.nationalities.length > 0;
      const hasClubFilter = parsed.clubs && parsed.clubs.length > 0;

      if (!hasNatFilter && !hasClubFilter) {
        eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
          supabase, competition, null, parsed.metric
        );
      } else if (hasNatFilter && !hasClubFilter) {
        eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
          supabase, competition, parsed.nationalities, parsed.metric
        );
      } else {
        // Handle club filter with optional nationality intersection
        const competitionDbName = parsed.competition;
        const metricCol = parsed.metric === 'goals' ? 'goals' : 'appearances';
        const playerMap = new Map();

        for (const clubName of parsed.clubs) {
          const { data } = await supabase
            .from('player_club_totals')
            .select('player_uid, club, appearances, goals')
            .eq('competition', competitionDbName)
            .eq('club', clubName)
            .gt(metricCol, 0);

          const uids = (data || []).map(r => r.player_uid);
          const { data: playersData } = await supabase
            .from('players')
            .select('player_uid, player_name, normalized_player_name, nationality')
            .in('player_uid', uids);

          const playerInfoMap = new Map();
          (playersData || []).forEach(p => playerInfoMap.set(p.player_uid, p));

          (data || []).forEach(row => {
            const playerInfo = playerInfoMap.get(row.player_uid) || {};
            const parsedNat = parseNationality(playerInfo.nationality);

            if (hasNatFilter && !parsed.nationalities.includes(parsedNat)) {
              return;
            }

            const value = parsed.metric === 'goals' ? row.goals : row.appearances;
            const existing = playerMap.get(row.player_uid);

            if (existing) {
              existing.subtractValue += value;
              if (!existing.clubs.includes(row.club)) {
                existing.clubs.push(row.club);
              }
            } else {
              playerMap.set(row.player_uid, {
                playerId: row.player_uid,
                name: playerInfo.player_name || 'Unknown',
                normalized: playerInfo.normalized_player_name || normalize(playerInfo.player_name || ''),
                nationality: parsedNat,
                subtractValue: value,
                overlay: { apps: row.appearances, goals: row.goals },
                clubs: [row.club],
                clubCount: 1,
              });
            }
          });
        }

        eligiblePlayers = Array.from(playerMap.values());
      }

      // Return parsed query info for preview mode
      if (previewOnly) {
        const response = {
          meta: {
            categoryId: 'chat_builder',
            categoryName,
            categoryFlag,
            competition: parsed.competition,
            metric,
            metricLabel,
            eligibleCount: eligiblePlayers.length,
            parsed,
          },
          eligibleCount: eligiblePlayers.length,
          parsed,
        };

        // Cache preview response
        const cacheKey = `preview_${categoryId}_${JSON.stringify(body)}`;
        setCache(cacheKey, response);

        return respond(200, response);
      }
    }

    // ============================================================
    // LEGACY CATEGORIES (backward compatibility)
    // ============================================================
    else if (categoryId && categoryId.startsWith('country_')) {
      // Map old format to new
      const code = categoryId.replace('country_', '');
      const newCatId = `epl_country_${code}`;
      if (EPL_COUNTRY_CATEGORIES[newCatId]) {
        const cat = EPL_COUNTRY_CATEGORIES[newCatId];
        categoryName = cat.name;
        categoryFlag = cat.flag;
        competition = 'EPL';
        eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
          supabase, competition, cat.code, 'appearances'
        );
      }
    }

    else if (categoryId && categoryId.startsWith('continent_')) {
      const key = categoryId.replace('continent_', '');
      const newCatId = `epl_continent_${key}`;
      if (EPL_CONTINENT_CATEGORIES[newCatId]) {
        const cat = EPL_CONTINENT_CATEGORIES[newCatId];
        categoryName = cat.name;
        categoryFlag = cat.flag;
        competition = 'EPL';
        eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
          supabase, competition, cat.codes, 'appearances'
        );
      }
    }

    // Old club categories
    else if (categoryId && categoryId.startsWith('club_') && EPL_CLUB_CATEGORIES[categoryId]) {
      const cat = EPL_CLUB_CATEGORIES[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      competition = 'EPL';
      eligiblePlayers = await fetchPlayersByClub(
        supabase, competition, cat.club, cat.altClub, 'appearances'
      );
    }

    // Old goals categories
    else if (categoryId && categoryId.startsWith('goals_') && EPL_GOALS_CATEGORIES[categoryId]) {
      const cat = EPL_GOALS_CATEGORIES[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      metric = 'goals';
      metricLabel = 'Goals';
      competition = 'EPL';

      if (cat.club) {
        eligiblePlayers = await fetchPlayersByClub(
          supabase, competition, cat.club, cat.altClub, 'goals'
        );
      } else {
        eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
          supabase, competition, null, 'goals'
        );
      }
    }

    // ============================================================
    // UNKNOWN CATEGORY
    // ============================================================
    else {
      return respond(400, {
        error: `Unknown categoryId: ${categoryId}`,
        hint: 'Valid prefixes: epl_country_, epl_continent_, epl_position_, club_, goals_, ucl_country_, ucl_goals_, ucl_club_, laliga_club_, seriea_club_, bundesliga_club_, big5_british_, chat_builder, custom',
      });
    }

    // ============================================================
    // FILTER & SORT
    // ============================================================
    eligiblePlayers = eligiblePlayers.filter(p => p.subtractValue > 0);
    eligiblePlayers.sort((a, b) => b.subtractValue - a.subtractValue);

    console.log('[match_start] Returning', eligiblePlayers.length, 'eligible players');

    const responseData = {
      meta: {
        categoryId,
        categoryName,
        categoryFlag,
        competition: getCompetitionDbName(competition),
        metric,
        metricLabel,
        eligibleCount: eligiblePlayers.length,
        datasetVersion,
      },
    };

    if (previewOnly) {
      responseData.eligibleCount = eligiblePlayers.length;

      // Cache preview response
      const cacheKey = `preview_${categoryId}_${JSON.stringify(body)}`;
      setCache(cacheKey, responseData);

      return respond(200, responseData);
    }

    responseData.meta.hintBlurb = HINTS[categoryId] || null;
    responseData.meta.trivia = TRIVIA[categoryId] || [];
    responseData.eligiblePlayers = eligiblePlayers;

    return respond(200, responseData);

  } catch (err) {
    console.error('[match_start] Error:', err);
    return respond(500, { error: err.message });
  }
};
