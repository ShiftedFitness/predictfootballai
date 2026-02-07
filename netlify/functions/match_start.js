// netlify/functions/match_start.js
// Supabase-backed match start API for Football 501
// Supports multiple competitions: EPL, UCL, La Liga, Serie A, Bundesliga, Ligue 1

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

// ============================================================
// COMPETITION MAPPING
// ============================================================
const COMPETITIONS = {
  EPL: { code: 'EPL', name: 'Premier League', aliases: ['premier league', 'epl', 'pl', 'prem'] },
  UCL: { code: 'UCL', name: 'Champions League', aliases: ['champions league', 'ucl', 'cl'] },
  LALIGA: { code: 'La Liga', name: 'La Liga', aliases: ['la liga', 'laliga', 'spain', 'spanish league'] },
  SERIEA: { code: 'Serie A', name: 'Serie A', aliases: ['serie a', 'seriea', 'italy', 'italian league'] },
  BUNDESLIGA: { code: 'Bundesliga', name: 'Bundesliga', aliases: ['bundesliga', 'germany', 'german league'] },
  LIGUE1: { code: 'Ligue 1', name: 'Ligue 1', aliases: ['ligue 1', 'ligue1', 'france', 'french league'] },
};

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

// EPL Age categories
const EPL_AGE_CATEGORIES = {
  epl_age_u19: { age: 'u19', name: 'Age 19 and Below', flag: '👶', competition: 'EPL' },
  epl_age_u21: { age: 'u21', name: 'Age 21 and Below', flag: '🧒', competition: 'EPL' },
  epl_age_35plus: { age: '35plus', name: 'Age 35 and Above', flag: '👴', competition: 'EPL' },
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

// Big 5 (ex EPL) British Players
const BIG5_BRITISH_CATEGORIES = {
  big5_british_apps: { name: 'Big 5 British (Apps)', flag: '🇬🇧', metric: 'apps' },
  big5_british_goals: { name: 'Big 5 British (Goals)', flag: '🇬🇧', metric: 'goals' },
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
  let metric = 'apps_total';
  if (/goals?|scor/.test(normalized)) {
    metric = 'goals_total';
  }

  // Determine competition
  let competition = 'EPL'; // Default
  for (const [key, comp] of Object.entries(COMPETITIONS)) {
    for (const alias of comp.aliases) {
      if (normalized.includes(alias)) {
        competition = comp.code;
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
// DATA FETCHING HELPERS
// ============================================================
async function fetchPlayersByCompetitionAndNationality(supabase, competition, nationalityCodes, metric = 'apps_total') {
  const metricCol = metric === 'goals_total' ? 'goals_total' : 'apps_total';
  const isMultiNat = Array.isArray(nationalityCodes);

  let query = supabase
    .from('player_competition_totals')
    .select(`
      player_id,
      apps_total,
      goals_total,
      mins_total,
      starts_total,
      players!inner (
        player_id,
        name,
        normalized_name,
        nationality
      )
    `)
    .eq('competition', competition)
    .gt(metricCol, 0);

  if (isMultiNat && nationalityCodes.length > 0) {
    query = query.in('players.nationality', nationalityCodes);
  } else if (nationalityCodes && !isMultiNat) {
    query = query.eq('players.nationality', nationalityCodes);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Get clubs for these players
  const playerIds = (data || []).map(r => r.player_id);
  const clubsMap = await getClubsForPlayers(supabase, playerIds, competition);
  const seasonsMap = await getSeasonsForPlayers(supabase, playerIds, competition);

  return (data || []).map(row => ({
    playerId: row.player_id,
    name: row.players.name,
    normalized: row.players.normalized_name || normalize(row.players.name),
    nationality: row.players.nationality,
    subtractValue: metric === 'goals_total' ? row.goals_total : row.apps_total,
    overlay: {
      apps: row.apps_total,
      goals: row.goals_total,
      mins: row.mins_total,
      starts: row.starts_total,
    },
    clubs: (clubsMap[row.player_id] || []).slice(0, 5),
    clubCount: (clubsMap[row.player_id] || []).length,
    seasonsCount: seasonsMap[row.player_id] || null,
  }));
}

async function fetchPlayersByClub(supabase, competition, clubName, altClubName, metric = 'apps_total') {
  const metricCol = metric === 'goals_total' ? 'goals_total' : 'apps_total';

  let { data, error } = await supabase
    .from('player_club_totals')
    .select(`
      player_id,
      club,
      apps_total,
      goals_total,
      mins_total,
      starts_total,
      players!inner (
        player_id,
        name,
        normalized_name,
        nationality
      )
    `)
    .eq('competition', competition)
    .eq('club', clubName)
    .gt(metricCol, 0);

  if (error) throw error;

  // Try alt club if no results
  if ((!data || data.length === 0) && altClubName) {
    const altResult = await supabase
      .from('player_club_totals')
      .select(`
        player_id,
        club,
        apps_total,
        goals_total,
        mins_total,
        starts_total,
        players!inner (
          player_id,
          name,
          normalized_name,
          nationality
        )
      `)
      .eq('competition', competition)
      .eq('club', altClubName)
      .gt(metricCol, 0);

    if (!altResult.error && altResult.data) {
      data = altResult.data;
    }
  }

  // Get all clubs for these players
  const playerIds = (data || []).map(r => r.player_id);
  const clubsMap = await getClubsForPlayers(supabase, playerIds, competition);
  const seasonsMap = await getSeasonsForPlayers(supabase, playerIds, competition);

  return (data || []).map(row => {
    const clubs = clubsMap[row.player_id] || [row.club];
    return {
      playerId: row.player_id,
      name: row.players.name,
      normalized: row.players.normalized_name || normalize(row.players.name),
      nationality: row.players.nationality,
      subtractValue: metric === 'goals_total' ? row.goals_total : row.apps_total,
      overlay: {
        apps: row.apps_total,
        goals: row.goals_total,
        mins: row.mins_total,
        starts: row.starts_total,
        club: row.club,
      },
      clubs: clubs.slice(0, 5),
      clubCount: clubs.length,
      seasonsCount: seasonsMap[row.player_id] || null,
    };
  });
}

async function getClubsForPlayers(supabase, playerIds, competition) {
  if (!playerIds || playerIds.length === 0) return {};

  const { data } = await supabase
    .from('player_club_totals')
    .select('player_id, club')
    .eq('competition', competition)
    .in('player_id', playerIds);

  const clubsMap = {};
  (data || []).forEach(r => {
    if (!clubsMap[r.player_id]) clubsMap[r.player_id] = [];
    if (!clubsMap[r.player_id].includes(r.club)) {
      clubsMap[r.player_id].push(r.club);
    }
  });
  return clubsMap;
}

async function getSeasonsForPlayers(supabase, playerIds, competition) {
  if (!playerIds || playerIds.length === 0) return {};

  const { data } = await supabase
    .from('player_season_stats')
    .select('player_id, season')
    .eq('competition', competition)
    .in('player_id', playerIds);

  const seasonSets = {};
  (data || []).forEach(r => {
    if (!seasonSets[r.player_id]) seasonSets[r.player_id] = new Set();
    seasonSets[r.player_id].add(r.season);
  });

  const result = {};
  for (const pid in seasonSets) {
    result[pid] = seasonSets[pid].size;
  }
  return result;
}

async function fetchPlayersByPosition(supabase, competition, position, metric = 'apps_total') {
  const metricCol = metric === 'goals_total' ? 'goals_total' : 'apps_total';

  // Try to find position in player_season_stats or players table
  const { data, error } = await supabase
    .from('player_competition_totals')
    .select(`
      player_id,
      apps_total,
      goals_total,
      mins_total,
      starts_total,
      players!inner (
        player_id,
        name,
        normalized_name,
        nationality,
        position
      )
    `)
    .eq('competition', competition)
    .eq('players.position', position)
    .gt(metricCol, 0);

  if (error) throw error;

  const playerIds = (data || []).map(r => r.player_id);
  const clubsMap = await getClubsForPlayers(supabase, playerIds, competition);

  return (data || []).map(row => ({
    playerId: row.player_id,
    name: row.players.name,
    normalized: row.players.normalized_name || normalize(row.players.name),
    nationality: row.players.nationality,
    subtractValue: metric === 'goals_total' ? row.goals_total : row.apps_total,
    overlay: {
      apps: row.apps_total,
      goals: row.goals_total,
      mins: row.mins_total,
      starts: row.starts_total,
      position: row.players.position,
    },
    clubs: (clubsMap[row.player_id] || []).slice(0, 5),
    clubCount: (clubsMap[row.player_id] || []).length,
  }));
}

async function fetchBig5BritishPlayers(supabase, metric = 'apps_total') {
  const metricCol = metric === 'goals_total' ? 'goals_total' : 'apps_total';
  const competitions = ['La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];

  const allPlayers = new Map();

  for (const comp of competitions) {
    const { data } = await supabase
      .from('player_competition_totals')
      .select(`
        player_id,
        competition,
        apps_total,
        goals_total,
        mins_total,
        starts_total,
        players!inner (
          player_id,
          name,
          normalized_name,
          nationality
        )
      `)
      .eq('competition', comp)
      .in('players.nationality', BRITISH_CODES)
      .gt(metricCol, 0);

    (data || []).forEach(row => {
      const existing = allPlayers.get(row.player_id);
      if (existing) {
        existing.subtractValue += metric === 'goals_total' ? row.goals_total : row.apps_total;
        existing.overlay.apps += row.apps_total;
        existing.overlay.goals += row.goals_total;
        if (!existing.competitions.includes(comp)) {
          existing.competitions.push(comp);
        }
      } else {
        allPlayers.set(row.player_id, {
          playerId: row.player_id,
          name: row.players.name,
          normalized: row.players.normalized_name || normalize(row.players.name),
          nationality: row.players.nationality,
          subtractValue: metric === 'goals_total' ? row.goals_total : row.apps_total,
          overlay: {
            apps: row.apps_total,
            goals: row.goals_total,
            mins: row.mins_total,
            starts: row.starts_total,
          },
          competitions: [comp],
          clubs: [],
          clubCount: 0,
        });
      }
    });
  }

  return Array.from(allPlayers.values());
}

async function fetchDynamicTopClubs(supabase, competition, limit = 25, metric = 'apps') {
  // Get clubs ordered by player count or total goals
  const orderCol = metric === 'goals' ? 'goals_total' : 'apps_total';

  const { data, error } = await supabase
    .from('player_club_totals')
    .select('club')
    .eq('competition', competition)
    .gt('apps_total', 0);

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let eligiblePlayers = [];
    let categoryName = '';
    let categoryFlag = '';
    let metric = 'apps_total';
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
        supabase, competition, cat.code, 'apps_total'
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
        supabase, competition, cat.codes, 'apps_total'
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
        supabase, competition, cat.position, 'apps_total'
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
        supabase, competition, cat.club, cat.altClub, 'apps_total'
      );
    }

    // ============================================================
    // EPL GOALS CATEGORIES
    // ============================================================
    else if (categoryId && EPL_GOALS_CATEGORIES[categoryId]) {
      const cat = EPL_GOALS_CATEGORIES[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      metric = 'goals_total';
      metricLabel = 'Goals';
      competition = cat.competition;

      if (cat.club) {
        eligiblePlayers = await fetchPlayersByClub(
          supabase, competition, cat.club, cat.altClub, 'goals_total'
        );
      } else {
        // All EPL goals
        eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
          supabase, competition, null, 'goals_total'
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
        supabase, competition, nationalityFilter, 'apps_total'
      );
    }

    // ============================================================
    // UCL GOALS CATEGORIES
    // ============================================================
    else if (categoryId && UCL_GOALS_CATEGORIES[categoryId]) {
      const cat = UCL_GOALS_CATEGORIES[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      metric = 'goals_total';
      metricLabel = 'Goals';
      competition = 'UCL';

      const nationalityFilter = cat.code || null;
      eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
        supabase, competition, nationalityFilter, 'goals_total'
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
        supabase, competition, cat.club, cat.altClub, 'apps_total'
      );
    }

    // ============================================================
    // DYNAMIC COMPETITION CLUB CATEGORIES (La Liga, Serie A, Bundesliga)
    // ============================================================
    else if (categoryId && categoryId.startsWith('laliga_club_')) {
      const clubName = categoryId.replace('laliga_club_', '').replace(/_/g, ' ');
      categoryName = clubName;
      categoryFlag = '🇪🇸';
      competition = 'La Liga';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'apps_total');
    }

    else if (categoryId && categoryId.startsWith('laliga_goals_')) {
      const clubName = categoryId.replace('laliga_goals_', '').replace(/_/g, ' ');
      categoryName = `${clubName} Goals`;
      categoryFlag = '🇪🇸';
      metric = 'goals_total';
      metricLabel = 'Goals';
      competition = 'La Liga';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'goals_total');
    }

    else if (categoryId && categoryId.startsWith('seriea_club_')) {
      const clubName = categoryId.replace('seriea_club_', '').replace(/_/g, ' ');
      categoryName = clubName;
      categoryFlag = '🇮🇹';
      competition = 'Serie A';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'apps_total');
    }

    else if (categoryId && categoryId.startsWith('seriea_goals_')) {
      const clubName = categoryId.replace('seriea_goals_', '').replace(/_/g, ' ');
      categoryName = `${clubName} Goals`;
      categoryFlag = '🇮🇹';
      metric = 'goals_total';
      metricLabel = 'Goals';
      competition = 'Serie A';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'goals_total');
    }

    else if (categoryId && categoryId.startsWith('bundesliga_club_')) {
      const clubName = categoryId.replace('bundesliga_club_', '').replace(/_/g, ' ');
      categoryName = clubName;
      categoryFlag = '🇩🇪';
      competition = 'Bundesliga';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'apps_total');
    }

    else if (categoryId && categoryId.startsWith('bundesliga_goals_')) {
      const clubName = categoryId.replace('bundesliga_goals_', '').replace(/_/g, ' ');
      categoryName = `${clubName} Goals`;
      categoryFlag = '🇩🇪';
      metric = 'goals_total';
      metricLabel = 'Goals';
      competition = 'Bundesliga';

      eligiblePlayers = await fetchPlayersByClub(supabase, competition, clubName, null, 'goals_total');
    }

    // ============================================================
    // BIG 5 BRITISH PLAYERS
    // ============================================================
    else if (categoryId === 'big5_british_apps') {
      categoryName = 'Big 5 British (Apps)';
      categoryFlag = '🇬🇧';
      competition = 'Big 5 (ex EPL)';

      eligiblePlayers = await fetchBig5BritishPlayers(supabase, 'apps_total');
    }

    else if (categoryId === 'big5_british_goals') {
      categoryName = 'Big 5 British (Goals)';
      categoryFlag = '🇬🇧';
      metric = 'goals_total';
      metricLabel = 'Goals';
      competition = 'Big 5 (ex EPL)';

      eligiblePlayers = await fetchBig5BritishPlayers(supabase, 'goals_total');
    }

    // ============================================================
    // GET TOP CLUBS (for dynamic category listing)
    // ============================================================
    else if (categoryId === 'get_top_clubs') {
      const comp = body.competition || 'La Liga';
      const limit = body.limit || 25;

      const topClubs = await fetchDynamicTopClubs(supabase, comp, limit, 'apps');

      return respond(200, {
        competition: comp,
        clubs: topClubs,
      });
    }

    // ============================================================
    // CUSTOM GAME (with intersection support)
    // ============================================================
    else if (categoryId === 'custom') {
      const customMetric = body.metric || 'apps_total';
      const nationalities = body.nationalities || null;
      const clubs = body.clubs || null;
      const customCompetition = body.competition || 'EPL';

      metric = customMetric;
      metricLabel = customMetric === 'goals_total' ? 'Goals' : 'Apps';
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
        const metricCol = customMetric === 'goals_total' ? 'goals_total' : 'apps_total';
        const playerMap = new Map();

        for (const clubName of clubs) {
          const resolvedClub = resolveClubName(clubName);

          const { data, error } = await supabase
            .from('player_club_totals')
            .select(`
              player_id,
              club,
              apps_total,
              goals_total,
              mins_total,
              starts_total,
              players!inner (
                player_id,
                name,
                normalized_name,
                nationality
              )
            `)
            .eq('competition', competition)
            .eq('club', resolvedClub)
            .gt(metricCol, 0);

          if (error) continue;

          (data || []).forEach(row => {
            // Check nationality filter
            if (hasNatFilter && !nationalities.includes(row.players.nationality)) {
              return;
            }

            const value = customMetric === 'goals_total' ? row.goals_total : row.apps_total;
            const existing = playerMap.get(row.player_id);

            if (existing) {
              existing.subtractValue += value;
              existing.overlay.apps += row.apps_total;
              existing.overlay.goals += row.goals_total;
              if (!existing.clubs.includes(row.club)) {
                existing.clubs.push(row.club);
              }
            } else {
              playerMap.set(row.player_id, {
                playerId: row.player_id,
                name: row.players.name,
                normalized: row.players.normalized_name || normalize(row.players.name),
                nationality: row.players.nationality,
                subtractValue: value,
                overlay: {
                  apps: row.apps_total,
                  goals: row.goals_total,
                  mins: row.mins_total,
                  starts: row.starts_total,
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
      metricLabel = parsed.metric === 'goals_total' ? 'Goals' : 'Apps';
      competition = parsed.competition;
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
        const metricCol = parsed.metric === 'goals_total' ? 'goals_total' : 'apps_total';
        const playerMap = new Map();

        for (const clubName of parsed.clubs) {
          const { data } = await supabase
            .from('player_club_totals')
            .select(`
              player_id,
              club,
              apps_total,
              goals_total,
              players!inner (
                player_id,
                name,
                normalized_name,
                nationality
              )
            `)
            .eq('competition', competition)
            .eq('club', clubName)
            .gt(metricCol, 0);

          (data || []).forEach(row => {
            if (hasNatFilter && !parsed.nationalities.includes(row.players.nationality)) {
              return;
            }

            const value = parsed.metric === 'goals_total' ? row.goals_total : row.apps_total;
            const existing = playerMap.get(row.player_id);

            if (existing) {
              existing.subtractValue += value;
              if (!existing.clubs.includes(row.club)) {
                existing.clubs.push(row.club);
              }
            } else {
              playerMap.set(row.player_id, {
                playerId: row.player_id,
                name: row.players.name,
                normalized: row.players.normalized_name || normalize(row.players.name),
                nationality: row.players.nationality,
                subtractValue: value,
                overlay: { apps: row.apps_total, goals: row.goals_total },
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
        return respond(200, {
          meta: {
            categoryId: 'chat_builder',
            categoryName,
            categoryFlag,
            competition,
            metric,
            metricLabel,
            eligibleCount: eligiblePlayers.length,
            parsed,
          },
          eligibleCount: eligiblePlayers.length,
          parsed,
        });
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
          supabase, competition, cat.code, 'apps_total'
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
          supabase, competition, cat.codes, 'apps_total'
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
        supabase, competition, cat.club, cat.altClub, 'apps_total'
      );
    }

    // Old goals categories
    else if (categoryId && categoryId.startsWith('goals_') && EPL_GOALS_CATEGORIES[categoryId]) {
      const cat = EPL_GOALS_CATEGORIES[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      metric = 'goals_total';
      metricLabel = 'Goals';
      competition = 'EPL';

      if (cat.club) {
        eligiblePlayers = await fetchPlayersByClub(
          supabase, competition, cat.club, cat.altClub, 'goals_total'
        );
      } else {
        eligiblePlayers = await fetchPlayersByCompetitionAndNationality(
          supabase, competition, null, 'goals_total'
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

    if (previewOnly) {
      return respond(200, {
        meta: {
          categoryId,
          categoryName,
          categoryFlag,
          competition,
          metric,
          metricLabel,
          eligibleCount: eligiblePlayers.length,
          datasetVersion,
        },
        eligibleCount: eligiblePlayers.length,
      });
    }

    return respond(200, {
      meta: {
        categoryId,
        categoryName,
        categoryFlag,
        competition,
        metric,
        metricLabel,
        eligibleCount: eligiblePlayers.length,
        datasetVersion,
        hintBlurb: HINTS[categoryId] || null,
        trivia: TRIVIA[categoryId] || [],
      },
      eligiblePlayers,
    });

  } catch (err) {
    console.error('[match_start] Error:', err);
    return respond(500, { error: err.message });
  }
};
