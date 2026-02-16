// netlify/functions/match_start.js
// Football 501 - Match Start API
// ALL queries use v_game_player_club_comp view (player_competition_totals is empty)
// Also queries player_season_stats for position/age categories

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
      'Content-Type': 'application/json; charset=utf-8',
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

/**
 * Fix mojibake player names (UTF-8 bytes stored as Latin-1).
 * e.g. "Cesc FÃ bregas" → "Cesc Fàbregas"
 */
function fixMojibake(str) {
  if (!str) return str;
  try {
    // Detect mojibake: Ã followed by another char is a common sign
    if (/[\xC3\xC2]/.test(str)) {
      // Convert each char to its Latin-1 byte, then decode as UTF-8
      const bytes = new Uint8Array([...str].map(c => c.charCodeAt(0)));
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return decoded;
    }
  } catch (e) {
    // If decoding fails, return original
  }
  return str;
}

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

// EPL Club categories - must match club_name values in DB
const CLUB_CATS = {
  club_Arsenal: { club: 'Arsenal', label: 'Arsenal' },
  club_AstonVilla: { club: 'Aston Villa', label: 'Aston Villa' },
  club_Blackburn: { club: 'Blackburn Rovers', label: 'Blackburn' },
  club_Bolton: { club: 'Bolton Wanderers', label: 'Bolton' },
  club_Bournemouth: { club: 'Bournemouth', aliases: ['AFC Bournemouth'], label: 'Bournemouth' },
  club_Brentford: { club: 'Brentford', label: 'Brentford' },
  club_Brighton: { club: 'Brighton & Hove Albion', aliases: ['Brighton'], label: 'Brighton' },
  club_Burnley: { club: 'Burnley', label: 'Burnley' },
  club_Charlton: { club: 'Charlton Athletic', label: 'Charlton' },
  club_Chelsea: { club: 'Chelsea', label: 'Chelsea' },
  club_Coventry: { club: 'Coventry City', label: 'Coventry' },
  club_CrystalPalace: { club: 'Crystal Palace', label: 'Crystal Palace' },
  club_Derby: { club: 'Derby County', label: 'Derby' },
  club_Everton: { club: 'Everton', label: 'Everton' },
  club_Fulham: { club: 'Fulham', label: 'Fulham' },
  club_Ipswich: { club: 'Ipswich Town', label: 'Ipswich' },
  club_Leeds: { club: 'Leeds United', label: 'Leeds' },
  club_Leicester: { club: 'Leicester City', label: 'Leicester' },
  club_Liverpool: { club: 'Liverpool', label: 'Liverpool' },
  club_ManCity: { club: 'Manchester City', label: 'Man City' },
  club_ManUtd: { club: 'Manchester United', aliases: ['Manchester Utd'], label: 'Man Utd' },
  club_Middlesbrough: { club: 'Middlesbrough', label: 'Middlesbrough' },
  club_Newcastle: { club: 'Newcastle United', aliases: ['Newcastle Utd'], label: 'Newcastle' },
  club_Norwich: { club: 'Norwich City', label: 'Norwich' },
  club_NottmForest: { club: 'Nottingham Forest', aliases: ['Nottm Forest'], label: 'Nottm Forest' },
  club_Portsmouth: { club: 'Portsmouth', label: 'Portsmouth' },
  club_QPR: { club: 'Queens Park Rangers', aliases: ['QPR'], label: 'QPR' },
  club_Reading: { club: 'Reading', label: 'Reading' },
  club_SheffUtd: { club: 'Sheffield United', aliases: ['Sheffield Utd'], label: 'Sheff Utd' },
  club_SheffWed: { club: 'Sheffield Weds', aliases: ['Sheffield Wednesday'], label: 'Sheff Wed' },
  club_Southampton: { club: 'Southampton', label: 'Southampton' },
  club_Stoke: { club: 'Stoke City', label: 'Stoke' },
  club_Sunderland: { club: 'Sunderland', label: 'Sunderland' },
  club_Swansea: { club: 'Swansea City', label: 'Swansea' },
  club_Tottenham: { club: 'Tottenham Hotspur', aliases: ['Tottenham'], label: 'Spurs' },
  club_Watford: { club: 'Watford', label: 'Watford' },
  club_WestBrom: { club: 'West Bromwich Albion', aliases: ['West Brom'], label: 'West Brom' },
  club_WestHam: { club: 'West Ham United', aliases: ['West Ham'], label: 'West Ham' },
  club_Wigan: { club: 'Wigan Athletic', label: 'Wigan' },
  club_Wimbledon: { club: 'Wimbledon', label: 'Wimbledon' },
  club_Wolves: { club: 'Wolves', aliases: ['Wolverhampton Wanderers'], label: 'Wolves' },
};

const GOALS_CATS = {
  goals_overall: { label: 'All EPL Goals' },
  goals_Arsenal: { club: 'Arsenal', label: 'Arsenal Goals' },
  goals_AstonVilla: { club: 'Aston Villa', label: 'Aston Villa Goals' },
  goals_Chelsea: { club: 'Chelsea', label: 'Chelsea Goals' },
  goals_Everton: { club: 'Everton', label: 'Everton Goals' },
  goals_Leeds: { club: 'Leeds United', label: 'Leeds Goals' },
  goals_Leicester: { club: 'Leicester City', label: 'Leicester Goals' },
  goals_Liverpool: { club: 'Liverpool', label: 'Liverpool Goals' },
  goals_ManCity: { club: 'Manchester City', label: 'Man City Goals' },
  goals_ManUtd: { club: 'Manchester United', aliases: ['Manchester Utd'], label: 'Man Utd Goals' },
  goals_Newcastle: { club: 'Newcastle United', aliases: ['Newcastle Utd'], label: 'Newcastle Goals' },
  goals_Southampton: { club: 'Southampton', label: 'Southampton Goals' },
  goals_Sunderland: { club: 'Sunderland', label: 'Sunderland Goals' },
  goals_Tottenham: { club: 'Tottenham Hotspur', aliases: ['Tottenham'], label: 'Spurs Goals' },
  goals_WestHam: { club: 'West Ham United', aliases: ['West Ham'], label: 'West Ham Goals' },
};

// UCL country categories
const UCL_COUNTRY_CATS = {
  ucl_country_ALL: { code: null, name: 'All Nationalities', flag: '🌍' },
  ucl_country_ARG: { code: 'ARG', name: 'Argentine', flag: '🇦🇷' },
  ucl_country_BRA: { code: 'BRA', name: 'Brazilian', flag: '🇧🇷' },
  ucl_country_ENG: { code: 'ENG', name: 'English', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  ucl_country_FRA: { code: 'FRA', name: 'French', flag: '🇫🇷' },
  ucl_country_GER: { code: 'GER', name: 'German', flag: '🇩🇪' },
  ucl_country_ITA: { code: 'ITA', name: 'Italian', flag: '🇮🇹' },
  ucl_country_NED: { code: 'NED', name: 'Dutch', flag: '🇳🇱' },
  ucl_country_POR: { code: 'POR', name: 'Portuguese', flag: '🇵🇹' },
  ucl_country_ESP: { code: 'ESP', name: 'Spanish', flag: '🇪🇸' },
};

// UCL goals by nationality
const UCL_GOALS_CATS = {
  ucl_goals_ALL: { code: null, name: 'All UCL Goals', flag: '⚽' },
  ucl_goals_ENG: { code: 'ENG', name: 'English Goals', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  ucl_goals_FRA: { code: 'FRA', name: 'French Goals', flag: '🇫🇷' },
  ucl_goals_ESP: { code: 'ESP', name: 'Spanish Goals', flag: '🇪🇸' },
  ucl_goals_ITA: { code: 'ITA', name: 'Italian Goals', flag: '🇮🇹' },
  ucl_goals_NED: { code: 'NED', name: 'Dutch Goals', flag: '🇳🇱' },
};

// UCL club categories
const UCL_CLUB_CATS = {
  ucl_club_ACMilan: { club: 'Milan', aliases: ['AC Milan'], label: 'AC Milan' },
  ucl_club_Arsenal: { club: 'eng Arsenal', aliases: ['Arsenal'], label: 'Arsenal' },
  ucl_club_Barcelona: { club: 'Barcelona', label: 'Barcelona' },
  ucl_club_Bayern: { club: 'Bayern Munich', label: 'Bayern Munich' },
  ucl_club_Chelsea: { club: 'eng Chelsea', aliases: ['Chelsea'], label: 'Chelsea' },
  ucl_club_Inter: { club: 'Inter', aliases: ['Inter Milan'], label: 'Inter Milan' },
  ucl_club_Juventus: { club: 'Juventus', label: 'Juventus' },
  ucl_club_Liverpool: { club: 'eng Liverpool', aliases: ['Liverpool'], label: 'Liverpool' },
  ucl_club_ManCity: { club: 'eng Manchester City', aliases: ['Manchester City', 'Man City'], label: 'Man City' },
  ucl_club_ManUtd: { club: 'eng Manchester Utd', aliases: ['Manchester United', 'Manchester Utd'], label: 'Man Utd' },
  ucl_club_PSG: { club: 'Paris Saint-Germain', label: 'PSG' },
  ucl_club_RealMadrid: { club: 'Real Madrid', label: 'Real Madrid' },
};

// British nationality codes for Big 5 British
const BRITISH_CODES = ['ENG', 'SCO', 'WAL', 'NIR'];
const BIG5_NON_EPL = ['La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];

// Position bucket mapping
const POSITION_CATS = {
  epl_position_GK: { bucket: 'GK', name: 'Goalkeepers', flag: '🧤' },
  epl_position_DF: { bucket: 'DEF', name: 'Defenders', flag: '🛡️' },
  epl_position_MF: { bucket: 'MID', name: 'Midfielders', flag: '⚙️' },
  epl_position_FW: { bucket: 'FWD', name: 'Forwards', flag: '⚡' },
};

// Age bucket categories — use age column directly (is_u19/u21/35plus are all NULL)
const AGE_CATS = {
  epl_age_u19: { maxAge: 19, name: 'Age 19 and Below', flag: '👶' },
  epl_age_u21: { maxAge: 21, name: 'Age 21 and Below', flag: '🧒' },
  epl_age_35plus: { minAge: 35, name: 'Age 35 and Above', flag: '👴' },
};

// Chat builder aliases — maps lowercase shorthand → DB club_name
const CLUB_ALIASES = {
  // EPL
  'man utd': 'Manchester United', 'man united': 'Manchester United', 'manchester united': 'Manchester United', 'mufc': 'Manchester United',
  'man city': 'Manchester City', 'manchester city': 'Manchester City', 'mcfc': 'Manchester City',
  'spurs': 'Tottenham Hotspur', 'tottenham': 'Tottenham Hotspur',
  'arsenal': 'Arsenal', 'liverpool': 'Liverpool', 'chelsea': 'Chelsea',
  'everton': 'Everton', 'newcastle': 'Newcastle United',
  'west ham': 'West Ham United', 'aston villa': 'Aston Villa',
  'leeds': 'Leeds United', 'leicester': 'Leicester City',
  'southampton': 'Southampton', 'sunderland': 'Sunderland',
  'wolves': 'Wolves', 'wolverhampton': 'Wolves', 'brighton': 'Brighton & Hove Albion',
  'bournemouth': 'Bournemouth', 'crystal palace': 'Crystal Palace',
  'fulham': 'Fulham', 'burnley': 'Burnley', 'watford': 'Watford',
  'west brom': 'West Bromwich Albion', 'west bromwich': 'West Bromwich Albion',
  'norwich': 'Norwich City', 'sheffield united': 'Sheffield United',
  'nottingham forest': 'Nottingham Forest', 'nottm forest': 'Nottingham Forest',
  'stoke': 'Stoke City', 'swansea': 'Swansea City',
  'middlesbrough': 'Middlesbrough', 'coventry': 'Coventry City',
  'blackburn': 'Blackburn Rovers', 'bolton': 'Bolton Wanderers',
  'wigan': 'Wigan Athletic', 'ipswich': 'Ipswich Town',
  'derby': 'Derby County', 'huddersfield': 'Huddersfield Town',
  'charlton': 'Charlton Athletic', 'hull': 'Hull City',
  'reading': 'Reading', 'portsmouth': 'Portsmouth',
  'birmingham': 'Birmingham City', 'cardiff': 'Cardiff City',
  'qpr': 'Queens Park Rangers', 'brentford': 'Brentford',
  // La Liga
  'real madrid': 'Real Madrid', 'barcelona': 'Barcelona', 'barca': 'Barcelona',
  'atletico': 'Atlético Madrid', 'atletico madrid': 'Atlético Madrid',
  'sevilla': 'Sevilla', 'valencia': 'Valencia',
  'real sociedad': 'Real Sociedad', 'sociedad': 'Real Sociedad',
  'villarreal': 'Villarreal', 'real betis': 'Real Betis', 'betis': 'Real Betis',
  'athletic bilbao': 'Athletic Club', 'athletic club': 'Athletic Club', 'bilbao': 'Athletic Club',
  'espanyol': 'Espanyol', 'celta vigo': 'Celta Vigo', 'celta': 'Celta Vigo',
  'getafe': 'Getafe', 'osasuna': 'Osasuna', 'mallorca': 'Mallorca',
  'rayo vallecano': 'Rayo Vallecano', 'rayo': 'Rayo Vallecano',
  'granada': 'Granada', 'levante': 'Levante', 'alaves': 'Alavés',
  'malaga': 'Málaga', 'zaragoza': 'Zaragoza', 'valladolid': 'Valladolid',
  // Bundesliga
  'bayern': 'Bayern Munich', 'bayern munich': 'Bayern Munich', 'bayern munchen': 'Bayern Munich',
  'dortmund': 'Dortmund', 'borussia dortmund': 'Dortmund',
  'leverkusen': 'Leverkusen', 'bayer leverkusen': 'Leverkusen',
  'gladbach': 'Gladbach', 'monchengladbach': 'Gladbach', 'borussia monchengladbach': 'Gladbach',
  'schalke': 'Schalke 04', 'schalke 04': 'Schalke 04',
  'wolfsburg': 'Wolfsburg', 'werder bremen': 'Werder Bremen', 'bremen': 'Werder Bremen',
  'stuttgart': 'Stuttgart', 'eintracht frankfurt': 'Eintracht Frankfurt', 'frankfurt': 'Eintracht Frankfurt',
  'hoffenheim': 'Hoffenheim', 'freiburg': 'Freiburg', 'augsburg': 'Augsburg',
  'hertha': 'Hertha BSC', 'hertha berlin': 'Hertha BSC',
  'koln': 'Köln', 'cologne': 'Köln', 'mainz': 'Mainz 05',
  'hamburger': 'Hamburger SV', 'hamburg': 'Hamburger SV', 'hsv': 'Hamburger SV',
  'rb leipzig': 'RB Leipzig', 'leipzig': 'RB Leipzig',
  'hannover': 'Hannover 96', 'nurnberg': 'Nürnberg',
  'bochum': 'Bochum', 'kaiserslautern': 'Kaiserslautern',
  // Serie A
  'juventus': 'Juventus', 'juve': 'Juventus',
  'ac milan': 'Milan', 'milan': 'Milan',
  'inter': 'Inter', 'inter milan': 'Inter', 'internazionale': 'Inter',
  'napoli': 'Napoli', 'roma': 'Roma', 'as roma': 'Roma',
  'lazio': 'Lazio', 'fiorentina': 'Fiorentina',
  'atalanta': 'Atalanta', 'torino': 'Torino',
  'sampdoria': 'Sampdoria', 'bologna': 'Bologna',
  'udinese': 'Udinese', 'genoa': 'Genoa', 'cagliari': 'Cagliari',
  'parma': 'Parma', 'sassuolo': 'Sassuolo', 'empoli': 'Empoli',
  'palermo': 'Palermo', 'lecce': 'Lecce', 'hellas verona': 'Hellas Verona', 'verona': 'Hellas Verona',
  // Ligue 1
  'psg': 'Paris Saint-Germain', 'paris saint germain': 'Paris Saint-Germain', 'paris': 'Paris Saint-Germain',
  'marseille': 'Marseille', 'olympique marseille': 'Marseille', 'om': 'Marseille',
  'lyon': 'Lyon', 'olympique lyon': 'Lyon', 'ol': 'Lyon',
  'monaco': 'Monaco', 'lille': 'Lille',
  'rennes': 'Rennes', 'ogc nice': 'Nice', 'nantes': 'Nantes',
  'bordeaux': 'Bordeaux', 'montpellier': 'Montpellier',
  'saint etienne': 'Saint-Étienne', 'st etienne': 'Saint-Étienne',
  'lens': 'Lens', 'strasbourg': 'Strasbourg', 'toulouse': 'Toulouse',
  'auxerre': 'Auxerre', 'metz': 'Metz', 'lorient': 'Lorient',
  'reims': 'Reims', 'angers': 'Angers', 'caen': 'Caen',
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
  'argentine': 'ARG', 'argentina': 'ARG', 'argentinian': 'ARG',
  'scottish': 'SCO', 'scotland': 'SCO',
  'welsh': 'WAL', 'wales': 'WAL',
  'irish': 'IRL', 'ireland': 'IRL',
  'austrian': 'AUT', 'austria': 'AUT',
  'belgian': 'BEL', 'belgium': 'BEL',
  'swedish': 'SWE', 'sweden': 'SWE',
  'norwegian': 'NOR', 'norway': 'NOR',
  'danish': 'DEN', 'denmark': 'DEN',
  'finnish': 'FIN', 'finland': 'FIN',
  'swiss': 'SUI', 'switzerland': 'SUI',
  'turkish': 'TUR', 'turkey': 'TUR',
  'greek': 'GRE', 'greece': 'GRE',
  'polish': 'POL', 'poland': 'POL',
  'czech': 'CZE', 'czech republic': 'CZE', 'czechia': 'CZE',
  'croatian': 'CRO', 'croatia': 'CRO',
  'serbian': 'SRB', 'serbia': 'SRB',
  'romanian': 'ROU', 'romania': 'ROU',
  'hungarian': 'HUN', 'hungary': 'HUN',
  'bulgarian': 'BUL', 'bulgaria': 'BUL',
  'ukrainian': 'UKR', 'ukraine': 'UKR',
  'russian': 'RUS', 'russia': 'RUS',
  'american': 'USA', 'usa': 'USA', 'united states': 'USA',
  'canadian': 'CAN', 'canada': 'CAN',
  'mexican': 'MEX', 'mexico': 'MEX',
  'colombian': 'COL', 'colombia': 'COL',
  'uruguayan': 'URU', 'uruguay': 'URU',
  'chilean': 'CHI', 'chile': 'CHI',
  'paraguayan': 'PAR', 'paraguay': 'PAR',
  'peruvian': 'PER', 'peru': 'PER',
  'japanese': 'JPN', 'japan': 'JPN',
  'south korean': 'KOR', 'korean': 'KOR', 'korea': 'KOR',
  'australian': 'AUS', 'australia': 'AUS',
  'nigerian': 'NGA', 'nigeria': 'NGA',
  'ghanaian': 'GHA', 'ghana': 'GHA',
  'senegalese': 'SEN', 'senegal': 'SEN',
  'cameroonian': 'CMR', 'cameroon': 'CMR',
  'ivorian': 'CIV', 'ivory coast': 'CIV', "cote d'ivoire": 'CIV',
  'egyptian': 'EGY', 'egypt': 'EGY',
  'moroccan': 'MAR', 'morocco': 'MAR',
  'algerian': 'ALG', 'algeria': 'ALG',
  'tunisian': 'TUN', 'tunisia': 'TUN',
  'south african': 'RSA', 'south africa': 'RSA',
  'jamaican': 'JAM', 'jamaica': 'JAM',
  'northern irish': 'NIR', 'northern ireland': 'NIR',
  'icelandic': 'ISL', 'iceland': 'ISL',
  'slovenian': 'SVN', 'slovenia': 'SVN',
  'slovakian': 'SVK', 'slovakia': 'SVK', 'slovak': 'SVK',
  'bosnian': 'BIH', 'bosnia': 'BIH',
  'montenegrin': 'MNE', 'montenegro': 'MNE',
  'albanian': 'ALB', 'albania': 'ALB',
  'north macedonian': 'MKD', 'north macedonia': 'MKD',
  'kosovan': 'KOS', 'kosovo': 'KOS',
  'ecuadorian': 'ECU', 'ecuador': 'ECU',
  'venezuelan': 'VEN', 'venezuela': 'VEN',
  'bolivian': 'BOL', 'bolivia': 'BOL',
  'chinese': 'CHN', 'china': 'CHN',
  'indian': 'IND', 'india': 'IND',
  'iranian': 'IRN', 'iran': 'IRN',
  'israeli': 'ISR', 'israel': 'ISR',
  'congolese': 'COD', 'congo': 'COD',
  'malian': 'MLI', 'mali': 'MLI',
  'guinean': 'GUI', 'guinea': 'GUI',
};

// ============================================================
// CURATED LEAGUE CLUB LISTS (top 25, in display order)
// Club names must match DB club_name values exactly
// ============================================================
const LALIGA_CLUBS = [
  'Athletic Club', 'Valencia', 'Barcelona', 'Real Madrid', 'Atlético Madrid',
  'Sevilla', 'Real Sociedad', 'Espanyol', 'Real Betis', 'Celta Vigo',
  'Villarreal', 'Dep La Coruña', 'Osasuna', 'Mallorca', 'Valladolid',
  'Getafe', 'Zaragoza', 'Rayo Vallecano', 'Racing Sant', 'Málaga',
  'Alavés', 'Levante', 'Sporting Gijón', 'Granada', 'Tenerife',
];

const BUNDESLIGA_CLUBS = [
  'Bayern Munich', 'Dortmund', 'Leverkusen', 'Werder Bremen', 'Stuttgart',
  'Gladbach', 'Schalke 04', 'Wolfsburg', 'Eintracht Frankfurt', 'Hamburger SV',
  'Freiburg', 'Hertha BSC', 'Köln', 'Mainz 05', 'Hoffenheim',
  'Bochum', 'Hannover 96', 'Nürnberg', 'Augsburg', 'Kaiserslautern',
  'Arminia', 'Hansa Rostock', '1860 Munich', 'RB Leipzig', 'MSV Duisburg',
];

const SERIEA_CLUBS = [
  'Lazio', 'Inter', 'Milan', 'Roma', 'Udinese',
  'Juventus', 'Fiorentina', 'Atalanta', 'Cagliari', 'Sampdoria',
  'Bologna', 'Napoli', 'Parma', 'Torino', 'Genoa',
  'Chievo', 'Empoli', 'Lecce', 'Hellas Verona', 'Palermo',
  'Sassuolo', 'Brescia', 'Siena', 'Reggina', 'Catania',
];

const LIGUE1_CLUBS = [
  'Rennes', 'Lyon', 'Paris Saint-Germain', 'Marseille', 'Monaco',
  'Lille', 'Bordeaux', 'Nice', 'Nantes', 'Montpellier',
  'Toulouse', 'Saint-Étienne', 'Lens', 'Strasbourg', 'Auxerre',
  'Metz', 'Lorient', 'Bastia', 'Sochaux', 'Guingamp',
  'Nancy', 'Reims', 'Caen', 'Troyes', 'Angers',
];

const CURATED_LEAGUE_CLUBS = {
  'La Liga': LALIGA_CLUBS,
  'Bundesliga': BUNDESLIGA_CLUBS,
  'Serie A': SERIEA_CLUBS,
  'Ligue 1': LIGUE1_CLUBS,
};

// ============================================================
// PAGINATION HELPER — fetch all rows past the 1000-row default
// ============================================================
async function fetchAll(queryFn) {
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFn().range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ============================================================
// DATA FETCHING - ALL via v_game_player_club_comp view
// (player_competition_totals table is empty)
// ============================================================

/**
 * Query v_game_player_club_comp view.
 * View columns: player_uid, player_name, nationality_norm, competition_id,
 *               competition_name, club_id, club_name, appearances, goals,
 *               assists, minutes, seasons, first_season_start_year, last_season_start_year
 *
 * When clubName is null, aggregates across all clubs for that competition.
 */
async function fetchFromView(supabase, competitionName, clubName = null, nationalityCodes = null, metric = 'appearances') {
  console.log('[fetchFromView]', { competitionName, clubName, nationalityCodes, metric });

  const buildQuery = () => {
    let query = supabase
      .from('v_game_player_club_comp')
      .select('player_uid, player_name, nationality_norm, competition_name, club_name, appearances, goals, assists, minutes, seasons')
      .eq('competition_name', competitionName)
      .gt(metric === 'goals' ? 'goals' : 'appearances', 0);

    if (clubName) {
      if (Array.isArray(clubName)) {
        query = query.in('club_name', clubName);
      } else {
        query = query.eq('club_name', clubName);
      }
    }

    // Apply nationality filter at the DB level if possible (single code)
    if (nationalityCodes && !Array.isArray(nationalityCodes)) {
      query = query.eq('nationality_norm', nationalityCodes);
    } else if (nationalityCodes && Array.isArray(nationalityCodes) && nationalityCodes.length <= 15) {
      query = query.in('nationality_norm', nationalityCodes);
    }

    return query;
  };

  let data;
  try {
    data = await fetchAll(buildQuery);
  } catch (error) {
    console.error('[fetchFromView] Error:', error);
    throw new Error(error.message);
  }

  console.log('[fetchFromView] Raw rows:', data?.length || 0);

  if (!data || data.length === 0) return [];

  // Aggregate by player_uid (a player may have multiple club rows)
  const playerMap = new Map();

  for (const row of data) {
    const nat = (row.nationality_norm || '').toUpperCase();

    // Apply nationality filter (for arrays > 15 that weren't filtered at DB level)
    if (nationalityCodes && Array.isArray(nationalityCodes) && nationalityCodes.length > 15) {
      if (!nationalityCodes.includes(nat)) continue;
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
      const displayName = fixMojibake(row.player_name);
      playerMap.set(row.player_uid, {
        playerId: row.player_uid,
        name: displayName,
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
 * Fetch from view across MULTIPLE competitions (for Big 5 British etc.)
 */
async function fetchFromViewMultiComp(supabase, competitionNames, nationalityCodes = null, metric = 'appearances') {
  console.log('[fetchFromViewMultiComp]', { competitionNames, nationalityCodes, metric });

  const buildQuery = () => {
    let query = supabase
      .from('v_game_player_club_comp')
      .select('player_uid, player_name, nationality_norm, competition_name, club_name, appearances, goals, assists, minutes, seasons')
      .in('competition_name', competitionNames)
      .gt(metric === 'goals' ? 'goals' : 'appearances', 0);

    if (nationalityCodes) {
      const codes = Array.isArray(nationalityCodes) ? nationalityCodes : [nationalityCodes];
      query = query.in('nationality_norm', codes);
    }

    return query;
  };

  let data;
  try {
    data = await fetchAll(buildQuery);
  } catch (error) {
    console.error('[fetchFromViewMultiComp] Error:', error);
    throw new Error(error.message);
  }

  if (!data || data.length === 0) return [];

  const playerMap = new Map();

  for (const row of data) {
    const nat = (row.nationality_norm || '').toUpperCase();
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
      const displayName = fixMojibake(row.player_name);
      playerMap.set(row.player_uid, {
        playerId: row.player_uid,
        name: displayName,
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
  return result;
}

/**
 * Fetch position-based players from player_season_stats.
 * Aggregates across seasons, joins with players table via two-step query.
 */
async function fetchByPosition(supabase, competitionName, positionBucket, metric = 'appearances') {
  console.log('[fetchByPosition]', { competitionName, positionBucket });

  // Get competition_id
  const { data: compData, error: compErr } = await supabase
    .from('competitions')
    .select('competition_id')
    .eq('competition_name', competitionName)
    .single();

  if (compErr || !compData) return [];

  // Get season stats filtered by position (paginated)
  let stats;
  try {
    stats = await fetchAll(() =>
      supabase
        .from('v_all_player_season_stats')
        .select('player_uid, appearances, goals, assists, minutes')
        .eq('competition_id', compData.competition_id)
        .eq('position_bucket', positionBucket)
        .gt(metric === 'goals' ? 'goals' : 'appearances', 0)
    );
  } catch (err) {
    console.error('[fetchByPosition] fetchAll error:', err);
    return [];
  }

  if (!stats || stats.length === 0) return [];

  // Aggregate by player_uid
  const aggMap = new Map();
  for (const row of stats) {
    const existing = aggMap.get(row.player_uid);
    if (existing) {
      existing.appearances += row.appearances || 0;
      existing.goals += row.goals || 0;
      existing.assists += row.assists || 0;
      existing.minutes += row.minutes || 0;
    } else {
      aggMap.set(row.player_uid, {
        player_uid: row.player_uid,
        appearances: row.appearances || 0,
        goals: row.goals || 0,
        assists: row.assists || 0,
        minutes: row.minutes || 0,
      });
    }
  }

  // Fetch player names in batches
  const uids = Array.from(aggMap.keys());
  const playerNames = new Map();
  const batchSize = 500;
  for (let i = 0; i < uids.length; i += batchSize) {
    const batch = uids.slice(i, i + batchSize);
    const { data: players } = await supabase
      .from('players')
      .select('player_uid, player_name, nationality_norm')
      .in('player_uid', batch);
    if (players) {
      for (const p of players) playerNames.set(p.player_uid, p);
    }
  }

  const result = [];
  for (const [uid, agg] of aggMap) {
    const player = playerNames.get(uid);
    if (!player) continue;
    const value = metric === 'goals' ? agg.goals : agg.appearances;
    if (value <= 0) continue;
    result.push({
      playerId: uid,
      name: fixMojibake(player.player_name),
      normalized: normalize(player.player_name),
      nationality: (player.nationality_norm || '').toUpperCase(),
      subtractValue: value,
      overlay: { apps: agg.appearances, goals: agg.goals, mins: agg.minutes },
      clubs: [],
      clubCount: 0,
      seasons: 0,
    });
  }

  return result;
}

/**
 * Fetch age-bucket players from player_season_stats.
 */
async function fetchByAgeBucket(supabase, competitionName, ageCat, metric = 'appearances') {
  console.log('[fetchByAgeBucket]', { competitionName, ageCat });

  const { data: compData, error: compErr } = await supabase
    .from('competitions')
    .select('competition_id')
    .eq('competition_name', competitionName)
    .single();

  if (compErr || !compData) return [];

  // Use age column directly since is_u19/u21/35plus are all NULL (paginated)
  let stats;
  try {
    stats = await fetchAll(() => {
      let q = supabase
        .from('v_all_player_season_stats')
        .select('player_uid, appearances, goals, assists, minutes')
        .eq('competition_id', compData.competition_id)
        .not('age', 'is', null)
        .gt(metric === 'goals' ? 'goals' : 'appearances', 0);

      if (ageCat.maxAge) {
        q = q.lte('age', ageCat.maxAge);
      }
      if (ageCat.minAge) {
        q = q.gte('age', ageCat.minAge);
      }

      return q;
    });
  } catch (err) {
    console.error('[fetchByAgeBucket] fetchAll error:', err);
    return [];
  }

  if (!stats || stats.length === 0) return [];

  // Aggregate by player_uid
  const aggMap = new Map();
  for (const row of stats) {
    const existing = aggMap.get(row.player_uid);
    if (existing) {
      existing.appearances += row.appearances || 0;
      existing.goals += row.goals || 0;
      existing.assists += row.assists || 0;
      existing.minutes += row.minutes || 0;
    } else {
      aggMap.set(row.player_uid, {
        player_uid: row.player_uid,
        appearances: row.appearances || 0,
        goals: row.goals || 0,
        assists: row.assists || 0,
        minutes: row.minutes || 0,
      });
    }
  }

  // Fetch player names
  const uids = Array.from(aggMap.keys());
  const playerNames = new Map();
  const batchSize = 500;
  for (let i = 0; i < uids.length; i += batchSize) {
    const batch = uids.slice(i, i + batchSize);
    const { data: players } = await supabase
      .from('players')
      .select('player_uid, player_name, nationality_norm')
      .in('player_uid', batch);
    if (players) {
      for (const p of players) playerNames.set(p.player_uid, p);
    }
  }

  const result = [];
  for (const [uid, agg] of aggMap) {
    const player = playerNames.get(uid);
    if (!player) continue;
    const value = metric === 'goals' ? agg.goals : agg.appearances;
    if (value <= 0) continue;
    result.push({
      playerId: uid,
      name: fixMojibake(player.player_name),
      normalized: normalize(player.player_name),
      nationality: (player.nationality_norm || '').toUpperCase(),
      subtractValue: value,
      overlay: { apps: agg.appearances, goals: agg.goals, mins: agg.minutes },
      clubs: [],
      clubCount: 0,
      seasons: 0,
    });
  }

  return result;
}

/**
 * Get top N clubs by player count for a competition (for dynamic league categories)
 */
async function getTopClubs(supabase, competitionName, limit = 25) {
  console.log('[getTopClubs]', { competitionName, limit });

  let data;
  try {
    data = await fetchAll(() =>
      supabase
        .from('v_game_player_club_comp')
        .select('club_name, player_uid')
        .eq('competition_name', competitionName)
        .gt('appearances', 0)
    );
  } catch (err) {
    console.error('[getTopClubs] fetchAll error:', err);
    return [];
  }

  if (!data || data.length === 0) return [];

  // Count unique players per club
  const clubMap = new Map();
  for (const row of data) {
    if (!row.club_name) continue;
    if (!clubMap.has(row.club_name)) {
      clubMap.set(row.club_name, new Set());
    }
    clubMap.get(row.club_name).add(row.player_uid);
  }

  const clubs = Array.from(clubMap.entries())
    .map(([club, players]) => ({ club, count: players.size }))
    .sort((a, b) => b.count - a.count || a.club.localeCompare(b.club))
    .slice(0, limit);

  return clubs;
}

// Position aliases for chat builder
const POSITION_ALIASES = {
  'goalkeeper': 'GK', 'goalkeepers': 'GK', 'keeper': 'GK', 'keepers': 'GK', 'gk': 'GK',
  'defender': 'DEF', 'defenders': 'DEF', 'centre back': 'DEF', 'center back': 'DEF',
  'centre backs': 'DEF', 'center backs': 'DEF', 'full back': 'DEF', 'full backs': 'DEF',
  'left back': 'DEF', 'right back': 'DEF', 'cb': 'DEF', 'cbs': 'DEF',
  'midfielder': 'MID', 'midfielders': 'MID', 'midfield': 'MID',
  'central midfielder': 'MID', 'central midfielders': 'MID', 'cm': 'MID',
  'attacking midfielder': 'MID', 'defensive midfielder': 'MID',
  'winger': 'MID', 'wingers': 'MID',
  'forward': 'FWD', 'forwards': 'FWD', 'striker': 'FWD', 'strikers': 'FWD',
  'attacker': 'FWD', 'attackers': 'FWD', 'centre forward': 'FWD', 'center forward': 'FWD',
  'cf': 'FWD', 'st': 'FWD',
};

// Competition name patterns (ordered by specificity for regex matching)
const COMP_PATTERNS = [
  { regex: /champions\s*league|ucl|european\s*cup/i, name: 'Champions League' },
  { regex: /la\s*liga|spanish\s*league/i, name: 'La Liga' },
  { regex: /serie\s*a|italian\s*league/i, name: 'Serie A' },
  { regex: /bund[ea]s?\s*liga|german\s*league/i, name: 'Bundesliga' },
  { regex: /ligue\s*1|french\s*league/i, name: 'Ligue 1' },
  { regex: /premier\s*league|epl|prem\b|english\s*league/i, name: 'Premier League' },
];

/**
 * Parse chat builder query — enhanced with multi-league, position, age,
 * exclusion, and minimum threshold support.
 */
function parseChatQuery(text) {
  const lower = text.toLowerCase();

  // ----- Metric -----
  let metric = 'appearances';
  if (/\bgoals?\b|\bscor/.test(lower)) metric = 'goals';

  // ----- Competitions (multi-league support) -----
  const competitions = [];

  // Detect "all leagues" / "every league" / "all competitions" — includes all supported leagues
  if (/\ball\s+leagues?\b|\bevery\s+league\b|\ball\s+competitions?\b|\bacross\s+all\s+leagues?\b|\bin\s+all\s+leagues?\b/.test(lower)) {
    for (const cp of COMP_PATTERNS) {
      if (!competitions.includes(cp.name)) competitions.push(cp.name);
    }
  } else {
    for (const cp of COMP_PATTERNS) {
      if (cp.regex.test(lower) && !competitions.includes(cp.name)) {
        competitions.push(cp.name);
      }
    }
  }
  // Default to Premier League if none detected
  if (competitions.length === 0) competitions.push('Premier League');

  // ----- Exclusion / negation detection -----
  // Detect patterns like "non english", "non-english", "not english",
  // "excluding english", "exclude english", "no english"
  const excludeNationalities = [];
  const excludePatterns = [
    /\bnon[- ](\w+)/g,
    /\bnot\s+(\w+)/g,
    /\bexclud(?:e|ing)\s+(\w+)/g,
    /\bno\s+(\w+)\s+(?:players?|nationali)/g,
    /\bwithout\s+(\w+)/g,
  ];
  const excludeWords = new Set();
  for (const pat of excludePatterns) {
    let m;
    while ((m = pat.exec(lower)) !== null) {
      const word = m[1].trim();
      if (NAT_ALIASES[word]) {
        const code = NAT_ALIASES[word];
        if (!excludeNationalities.includes(code)) excludeNationalities.push(code);
        excludeWords.add(word);
      }
    }
  }

  // ----- Nationalities (include — skip any that were flagged as exclude) -----
  const nationalities = [];
  // Sort aliases by length descending so longer phrases match first
  const sortedNatAliases = Object.entries(NAT_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, code] of sortedNatAliases) {
    if (excludeWords.has(alias)) continue; // skip excluded nationalities
    if (lower.includes(alias) && !nationalities.includes(code)) {
      // Make sure this is not part of a negation phrase we missed
      const idx = lower.indexOf(alias);
      const before = lower.substring(Math.max(0, idx - 5), idx).trim();
      if (/\bnon-?$|\bnot$|\bexclud\w*$|\bno$|\bwithout$/.test(before)) {
        if (!excludeNationalities.includes(code)) excludeNationalities.push(code);
        continue;
      }
      nationalities.push(code);
    }
  }

  // ----- Clubs -----
  const clubs = [];
  // Sort aliases by length descending so longer phrases match first (e.g. "man city" before "city")
  const sortedClubAliases = Object.entries(CLUB_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, club] of sortedClubAliases) {
    // Use word boundary regex to avoid partial matches (e.g. "inter" in "international")
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const clubRegex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (clubRegex.test(lower) && !clubs.includes(club)) {
      clubs.push(club);
    }
  }

  // ----- Position -----
  let position = null;
  // Sort by length descending so multi-word positions match first
  const sortedPosAliases = Object.entries(POSITION_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, bucket] of sortedPosAliases) {
    // Use word boundary matching for short aliases
    const regex = alias.length <= 3
      ? new RegExp(`\\b${alias}\\b`, 'i')
      : new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (regex.test(lower)) {
      position = bucket;
      break;
    }
  }

  // ----- Age filter -----
  let ageFilter = null;
  // "18 years old or younger", "under 21", "u19", "age 19 and below"
  // Negative lookahead prevents matching age patterns that are actually thresholds
  // (e.g. "over 35 games" should be threshold, not age)
  const gameUnits = '(?!\\s+(?:\\w+\\s+)*(?:games?|appearances?|apps?|goals?|matches?|caps?))';
  const ageUnder = lower.match(new RegExp(`(?:under|below|younger\\s*than|u)\\s*(\\d{1,2})${gameUnits}`));
  const ageOrYounger = lower.match(/(\d{1,2})\s*(?:years?\s*old\s*)?(?:or\s*younger|and\s*(?:below|under|younger))/);
  const ageOver = lower.match(new RegExp(`(?:over|above|older\\s*than)\\s*(\\d{1,2})${gameUnits}`));
  const ageOrOlder = lower.match(/(\d{1,2})\s*(?:years?\s*old\s*)?(?:or\s*older|and\s*(?:above|over|older)|plus|\+)/);

  if (ageUnder) {
    ageFilter = { maxAge: parseInt(ageUnder[1]) };
  } else if (ageOrYounger) {
    ageFilter = { maxAge: parseInt(ageOrYounger[1]) };
  } else if (ageOver) {
    ageFilter = { minAge: parseInt(ageOver[1]) };
  } else if (ageOrOlder) {
    ageFilter = { minAge: parseInt(ageOrOlder[1]) };
  }

  // ----- Minimum appearances/goals threshold -----
  let minThreshold = null;
  // "more than 40 games", "at least 50 appearances", "over 100 goals", "40+ apps"
  // Allow up to 4 words between number and unit (e.g. "more than 40 premier league games")
  const thresholdMatch = lower.match(
    /(?:more\s*than|at\s*least|over|minimum|min)\s*(\d+)(?:\s+\w+){0,4}\s+(?:games?|appearances?|apps?|goals?|matches?|caps?)/
  );
  const thresholdPlus = lower.match(
    /(\d+)\+?\s*(?:games?|appearances?|apps?|goals?|matches?|caps?)\s*(?:or\s*more)?/
  );
  if (thresholdMatch) {
    minThreshold = parseInt(thresholdMatch[1]);
  } else if (thresholdPlus && parseInt(thresholdPlus[1]) >= 5) {
    // Only treat as threshold if >= 5 to avoid false positives like "1 game"
    minThreshold = parseInt(thresholdPlus[1]);
  }

  return {
    metric,
    competitions,
    competition: competitions[0], // backward compat — primary competition
    nationalities: nationalities.length > 0 ? nationalities : null,
    excludeNationalities: excludeNationalities.length > 0 ? excludeNationalities : null,
    clubs: clubs.length > 0 ? clubs : null,
    position,
    ageFilter,
    minThreshold,
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
    // GET TOP CLUBS (for league category cards)
    // Uses curated lists for non-EPL leagues, dynamic for EPL
    // ============================================================
    if (categoryId === 'get_top_clubs') {
      const comp = body.competition || 'Premier League';
      const curated = CURATED_LEAGUE_CLUBS[comp];
      if (curated) {
        // Return curated list as { club, count } objects (count not needed but keeps format consistent)
        const clubs = curated.map((club, i) => ({ club, count: curated.length - i }));
        return respond(200, { clubs });
      }
      // Fallback to dynamic query for EPL or any unlisted league
      const limit = body.limit || 25;
      const clubs = await getTopClubs(supabase, comp, limit);
      return respond(200, { clubs });
    }

    // ============================================================
    // EPL COUNTRY - uses view, aggregated across all clubs
    // ============================================================
    else if (categoryId && COUNTRY_CATS[categoryId]) {
      const cat = COUNTRY_CATS[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      players = await fetchFromView(supabase, 'Premier League', null, cat.code, 'appearances');
    }

    // ============================================================
    // EPL CONTINENT
    // ============================================================
    else if (categoryId && CONTINENT_CATS[categoryId]) {
      const cat = CONTINENT_CATS[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      players = await fetchFromView(supabase, 'Premier League', null, cat.codes, 'appearances');
    }

    // ============================================================
    // EPL CLUB (Apps) - uses view with club filter
    // ============================================================
    else if (categoryId && CLUB_CATS[categoryId]) {
      const cat = CLUB_CATS[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      const clubNames = cat.aliases ? [cat.club, ...cat.aliases] : cat.club;
      players = await fetchFromView(supabase, 'Premier League', clubNames, null, 'appearances');
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
        const clubNames = cat.aliases ? [cat.club, ...cat.aliases] : cat.club;
        players = await fetchFromView(supabase, 'Premier League', clubNames, null, 'goals');
      } else {
        // All EPL goals - no club filter
        players = await fetchFromView(supabase, 'Premier League', null, null, 'goals');
      }
    }

    // ============================================================
    // EPL POSITION
    // ============================================================
    else if (categoryId && POSITION_CATS[categoryId]) {
      const cat = POSITION_CATS[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      players = await fetchByPosition(supabase, 'Premier League', cat.bucket, 'appearances');
    }

    // ============================================================
    // EPL AGE BUCKET
    // ============================================================
    else if (categoryId && AGE_CATS[categoryId]) {
      const cat = AGE_CATS[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      players = await fetchByAgeBucket(supabase, 'Premier League', cat, 'appearances');
    }

    // ============================================================
    // UCL APPEARANCES BY NATIONALITY
    // ============================================================
    else if (categoryId && UCL_COUNTRY_CATS[categoryId]) {
      const cat = UCL_COUNTRY_CATS[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      competition = 'Champions League';
      players = await fetchFromView(supabase, 'Champions League', null, cat.code, 'appearances');
    }

    // ============================================================
    // UCL GOALS BY NATIONALITY
    // ============================================================
    else if (categoryId && UCL_GOALS_CATS[categoryId]) {
      const cat = UCL_GOALS_CATS[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;
      competition = 'Champions League';
      metric = 'goals';
      metricLabel = 'Goals';
      players = await fetchFromView(supabase, 'Champions League', null, cat.code, 'goals');
    }

    // ============================================================
    // UCL CLUB APPS
    // ============================================================
    else if (categoryId && UCL_CLUB_CATS[categoryId]) {
      const cat = UCL_CLUB_CATS[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';
      competition = 'Champions League';
      const clubNames = cat.aliases ? [cat.club, ...cat.aliases] : cat.club;
      players = await fetchFromView(supabase, 'Champions League', clubNames, null, 'appearances');
    }

    // ============================================================
    // DYNAMIC LEAGUE CLUB CATEGORIES (La Liga, Serie A, Bundesliga)
    // e.g. laliga_club_Real_Madrid, seriea_club_Juventus, bundesliga_goals_Bayern_Munich
    // ============================================================
    else if (categoryId && /^(laliga|seriea|bundesliga|ligue1)_(club|goals)_/.test(categoryId)) {
      const match = categoryId.match(/^(laliga|seriea|bundesliga|ligue1)_(club|goals)_(.+)$/);
      if (match) {
        const leagueKey = match[1];
        const modeType = match[2];
        const clubSlug = match[3].replace(/_/g, ' ');

        const compMap = {
          laliga: 'La Liga',
          seriea: 'Serie A',
          bundesliga: 'Bundesliga',
          ligue1: 'Ligue 1',
        };

        competition = compMap[leagueKey] || 'Premier League';
        categoryName = modeType === 'goals' ? `${clubSlug} Goals` : clubSlug;
        categoryFlag = modeType === 'goals' ? '⚽' : '🏟️';

        if (modeType === 'goals') {
          metric = 'goals';
          metricLabel = 'Goals';
        }

        players = await fetchFromView(supabase, competition, clubSlug, null, metric);

        // If exact match fails, try case-insensitive search
        if (players.length === 0) {
          const { data: clubMatch } = await supabase
            .from('v_game_player_club_comp')
            .select('club_name')
            .eq('competition_name', competition)
            .ilike('club_name', clubSlug)
            .limit(1);

          if (clubMatch && clubMatch[0]) {
            players = await fetchFromView(supabase, competition, clubMatch[0].club_name, null, metric);
            categoryName = modeType === 'goals' ? `${clubMatch[0].club_name} Goals` : clubMatch[0].club_name;
          }
        }
      }
    }

    // ============================================================
    // BIG 5 BRITISH (ex EPL)
    // ============================================================
    else if (categoryId === 'big5_british_apps') {
      categoryName = 'Big 5 British (Apps)';
      categoryFlag = '🇬🇧';
      players = await fetchFromViewMultiComp(supabase, BIG5_NON_EPL, BRITISH_CODES, 'appearances');
    }
    else if (categoryId === 'big5_british_goals') {
      categoryName = 'Big 5 British (Goals)';
      categoryFlag = '🇬🇧';
      metric = 'goals';
      metricLabel = 'Goals';
      players = await fetchFromViewMultiComp(supabase, BIG5_NON_EPL, BRITISH_CODES, 'goals');
    }

    // ============================================================
    // CUSTOM (chip-based builder)
    // ============================================================
    else if (categoryId === 'custom') {
      categoryName = 'Custom Game';
      categoryFlag = '🎮';
      const reqMetric = (body.metric || 'appearances').includes('goals') ? 'goals' : 'appearances';
      metric = reqMetric;
      metricLabel = reqMetric === 'goals' ? 'Goals' : 'Apps';

      const natCodes = body.nationalities || null;
      const clubNames = body.clubs || null;

      if (clubNames && clubNames.length > 0) {
        const playerMap = new Map();
        for (const clubName of clubNames) {
          const clubPlayers = await fetchFromView(supabase, 'Premier League', clubName, natCodes, reqMetric);
          for (const p of clubPlayers) {
            const existing = playerMap.get(p.playerId);
            if (existing) {
              existing.subtractValue += p.subtractValue;
              existing.overlay.apps += p.overlay.apps;
              existing.overlay.goals += p.overlay.goals;
              existing.overlay.mins += p.overlay.mins;
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
        players = await fetchFromView(supabase, 'Premier League', null, natCodes, reqMetric);
      }
    }

    // ============================================================
    // CHAT BUILDER — enhanced: multi-league, position, age,
    // exclusions, min threshold
    // ============================================================
    else if (categoryId === 'chat_builder') {
      const text = body.text || '';
      console.log('[chat_builder] Input text:', text);

      const parsed = parseChatQuery(text);
      console.log('[chat_builder] Parsed:', JSON.stringify(parsed));

      metric = parsed.metric;
      metricLabel = parsed.metric === 'goals' ? 'Goals' : 'Apps';
      competition = parsed.competitions.join(' + ');
      categoryName = 'Chat Built Game';
      categoryFlag = '💬';

      // --- Determine if we need position-based or age-based fetching ---
      const usePositionFilter = !!parsed.position;
      const useAgeFilter = !!parsed.ageFilter;

      // --- STEP 1: Fetch base player data ---
      if (parsed.clubs && parsed.clubs.length > 0) {
        // Club-specific query: fetch per-club and merge
        const playerMap = new Map();

        for (const clubName of parsed.clubs) {
          // For club queries, use all detected competitions (or use first if single)
          for (const comp of parsed.competitions) {
            const clubPlayers = await fetchFromView(supabase, comp, clubName, parsed.nationalities, parsed.metric);
            for (const p of clubPlayers) {
              const existing = playerMap.get(p.playerId);
              if (existing) {
                existing.subtractValue += p.subtractValue;
                existing.overlay.apps += p.overlay.apps;
                existing.overlay.goals += p.overlay.goals;
                existing.overlay.mins += p.overlay.mins;
                for (const c of p.clubs) {
                  if (!existing.clubs.includes(c)) existing.clubs.push(c);
                }
              } else {
                playerMap.set(p.playerId, { ...p, clubs: [...p.clubs] });
              }
            }
          }
        }
        players = Array.from(playerMap.values());

      } else if (usePositionFilter) {
        // Position-based fetch (uses player_season_stats)
        const playerMap = new Map();
        for (const comp of parsed.competitions) {
          const posPlayers = await fetchByPosition(supabase, comp, parsed.position, parsed.metric);
          for (const p of posPlayers) {
            const existing = playerMap.get(p.playerId);
            if (existing) {
              existing.subtractValue += p.subtractValue;
              existing.overlay.apps += p.overlay.apps;
              existing.overlay.goals += p.overlay.goals;
              existing.overlay.mins += p.overlay.mins;
            } else {
              playerMap.set(p.playerId, { ...p });
            }
          }
        }
        players = Array.from(playerMap.values());

      } else if (useAgeFilter) {
        // Age-based fetch (uses player_season_stats)
        const playerMap = new Map();
        for (const comp of parsed.competitions) {
          const agePlayers = await fetchByAgeBucket(supabase, comp, parsed.ageFilter, parsed.metric);
          for (const p of agePlayers) {
            const existing = playerMap.get(p.playerId);
            if (existing) {
              existing.subtractValue += p.subtractValue;
              existing.overlay.apps += p.overlay.apps;
              existing.overlay.goals += p.overlay.goals;
              existing.overlay.mins += p.overlay.mins;
            } else {
              playerMap.set(p.playerId, { ...p });
            }
          }
        }
        players = Array.from(playerMap.values());

      } else if (parsed.competitions.length > 1) {
        // Multi-competition query — use fetchFromViewMultiComp
        players = await fetchFromViewMultiComp(supabase, parsed.competitions, parsed.nationalities, parsed.metric);

      } else {
        // Single competition, no clubs, no position, no age
        players = await fetchFromView(supabase, parsed.competitions[0], null, parsed.nationalities, parsed.metric);
      }

      // --- STEP 2: Apply exclusion filter (e.g. "non english") ---
      if (parsed.excludeNationalities && parsed.excludeNationalities.length > 0) {
        console.log('[chat_builder] Excluding nationalities:', parsed.excludeNationalities);
        players = players.filter(p => !parsed.excludeNationalities.includes(p.nationality));
      }

      // --- STEP 3: Apply nationality include filter for position/age queries ---
      // (fetchByPosition/fetchByAgeBucket don't take nationality params,
      //  so we filter after fetching)
      if ((usePositionFilter || useAgeFilter) && parsed.nationalities && parsed.nationalities.length > 0) {
        players = players.filter(p => parsed.nationalities.includes(p.nationality));
      }

      // --- STEP 4: Apply minimum threshold filter ---
      if (parsed.minThreshold) {
        console.log('[chat_builder] Applying min threshold:', parsed.minThreshold);
        players = players.filter(p => p.subtractValue >= parsed.minThreshold);
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
            excludeNationalities: parsed.excludeNationalities,
            clubs: parsed.clubs,
            position: parsed.position,
            ageFilter: parsed.ageFilter,
            minThreshold: parsed.minThreshold,
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
