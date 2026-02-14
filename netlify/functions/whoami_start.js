/**
 * whoami_start.js — "Who Am I?" Football Trivia Game
 *
 * Endpoints (via `action` field in POST body):
 *   start_game    → Pick a random player for a scope, return blanks + clues
 *   check_answer  → Check a user's guess against the hidden player
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

// Shared secret for encrypting player IDs (falls back to service key)
const ENCRYPTION_SECRET = process.env.WHOAMI_SECRET || SUPABASE_SERVICE_KEY;

// ============================================================
// HELPERS
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

/**
 * Fetch all rows from a Supabase query, paginating past the 1000-row default.
 */
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

/**
 * Fix mojibake: re-decode UTF-8 bytes stored as Latin-1
 */
function fixMojibake(str) {
  if (!str) return str;
  try {
    if (/[\xC0-\xDF][\x80-\xBF]/.test(str)) {
      const bytes = new Uint8Array([...str].map(c => c.charCodeAt(0)));
      const decoded = new TextDecoder('utf-8').decode(bytes);
      if (decoded && !decoded.includes('\uFFFD')) return decoded;
    }
  } catch (_) { /* ignore */ }
  return str;
}

/**
 * Normalize player name for fuzzy matching
 */
function normalize(name) {
  if (!name) return '';
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Encrypt a player_uid so the client cannot trivially read it.
 * Uses AES-256-CBC with a deterministic IV derived from the key
 * so we can decrypt later without storing state.
 */
function encryptPlayerId(playerUid) {
  const key = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();
  const iv = crypto.createHash('md5').update(ENCRYPTION_SECRET).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(String(playerUid), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

/**
 * Decrypt a previously encrypted player_uid.
 */
function decryptPlayerId(encrypted) {
  const key = crypto.createHash('sha256').update(ENCRYPTION_SECRET).digest();
  const iv = crypto.createHash('md5').update(ENCRYPTION_SECRET).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================
// SCOPE DEFINITIONS
// ============================================================

const SCOPES = [
  { id: 'epl_alltime', label: 'Premier League (All-time)', type: 'league', clubName: null },
  { id: 'club_arsenal',     label: 'Arsenal',        type: 'club', clubName: 'Arsenal' },
  { id: 'club_astonvilla',  label: 'Aston Villa',    type: 'club', clubName: 'Aston Villa' },
  { id: 'club_blackburn',   label: 'Blackburn',      type: 'club', clubName: 'Blackburn Rovers' },
  { id: 'club_bolton',      label: 'Bolton',         type: 'club', clubName: 'Bolton Wanderers' },
  { id: 'club_bournemouth', label: 'Bournemouth',    type: 'club', clubName: 'Bournemouth' },
  { id: 'club_brentford',   label: 'Brentford',      type: 'club', clubName: 'Brentford' },
  { id: 'club_brighton',    label: 'Brighton',       type: 'club', clubName: 'Brighton' },
  { id: 'club_burnley',     label: 'Burnley',        type: 'club', clubName: 'Burnley' },
  { id: 'club_charlton',    label: 'Charlton',       type: 'club', clubName: 'Charlton Athletic' },
  { id: 'club_chelsea',     label: 'Chelsea',        type: 'club', clubName: 'Chelsea' },
  { id: 'club_coventry',    label: 'Coventry',       type: 'club', clubName: 'Coventry City' },
  { id: 'club_crystalpalace', label: 'Crystal Palace', type: 'club', clubName: 'Crystal Palace' },
  { id: 'club_derby',       label: 'Derby',          type: 'club', clubName: 'Derby County' },
  { id: 'club_everton',     label: 'Everton',        type: 'club', clubName: 'Everton' },
  { id: 'club_fulham',      label: 'Fulham',         type: 'club', clubName: 'Fulham' },
  { id: 'club_ipswich',     label: 'Ipswich',        type: 'club', clubName: 'Ipswich Town' },
  { id: 'club_leeds',       label: 'Leeds',          type: 'club', clubName: 'Leeds United' },
  { id: 'club_leicester',   label: 'Leicester',      type: 'club', clubName: 'Leicester City' },
  { id: 'club_liverpool',   label: 'Liverpool',      type: 'club', clubName: 'Liverpool' },
  { id: 'club_mancity',     label: 'Man City',       type: 'club', clubName: 'Manchester City' },
  { id: 'club_manutd',      label: 'Man Utd',        type: 'club', clubName: 'Manchester United' },
  { id: 'club_middlesbrough', label: 'Middlesbrough', type: 'club', clubName: 'Middlesbrough' },
  { id: 'club_newcastle',   label: 'Newcastle',      type: 'club', clubName: 'Newcastle United' },
  { id: 'club_norwich',     label: 'Norwich',        type: 'club', clubName: 'Norwich City' },
  { id: 'club_nottmforest', label: 'Nottm Forest',   type: 'club', clubName: 'Nottingham Forest' },
  { id: 'club_portsmouth',  label: 'Portsmouth',     type: 'club', clubName: 'Portsmouth' },
  { id: 'club_qpr',         label: 'QPR',            type: 'club', clubName: 'Queens Park Rangers' },
  { id: 'club_reading',     label: 'Reading',        type: 'club', clubName: 'Reading' },
  { id: 'club_sheffutd',    label: 'Sheff Utd',      type: 'club', clubName: 'Sheffield United' },
  { id: 'club_sheffwed',    label: 'Sheff Wed',      type: 'club', clubName: 'Sheffield Wednesday' },
  { id: 'club_southampton', label: 'Southampton',    type: 'club', clubName: 'Southampton' },
  { id: 'club_stoke',       label: 'Stoke',          type: 'club', clubName: 'Stoke City' },
  { id: 'club_sunderland',  label: 'Sunderland',     type: 'club', clubName: 'Sunderland' },
  { id: 'club_swansea',     label: 'Swansea',        type: 'club', clubName: 'Swansea City' },
  { id: 'club_tottenham',   label: 'Spurs',          type: 'club', clubName: 'Tottenham Hotspur' },
  { id: 'club_watford',     label: 'Watford',        type: 'club', clubName: 'Watford' },
  { id: 'club_westbrom',    label: 'West Brom',      type: 'club', clubName: 'West Bromwich Albion' },
  { id: 'club_westham',     label: 'West Ham',       type: 'club', clubName: 'West Ham United' },
  { id: 'club_wigan',       label: 'Wigan',          type: 'club', clubName: 'Wigan Athletic' },
  { id: 'club_wimbledon',   label: 'Wimbledon',      type: 'club', clubName: 'Wimbledon' },
  { id: 'club_wolves',      label: 'Wolves',         type: 'club', clubName: 'Wolverhampton Wanderers' },
];

// Min appearance thresholds for Who Am I (slightly higher to ensure recognizable players)
const MIN_APPS_LEAGUE = 50;
const MIN_APPS_CLUB = 30;

// ============================================================
// NATIONALITY CODE → ADJECTIVE MAPPING
// ============================================================

const NATIONALITY_ADJECTIVES = {
  'ENG': 'English', 'SCO': 'Scottish', 'WAL': 'Welsh', 'NIR': 'Northern Irish',
  'IRL': 'Irish', 'FRA': 'French', 'ESP': 'Spanish', 'GER': 'German',
  'ITA': 'Italian', 'NED': 'Dutch', 'POR': 'Portuguese', 'BRA': 'Brazilian',
  'ARG': 'Argentine', 'URU': 'Uruguayan', 'CHI': 'Chilean', 'COL': 'Colombian',
  'ECU': 'Ecuadorian', 'PAR': 'Paraguayan', 'PER': 'Peruvian', 'VEN': 'Venezuelan',
  'MEX': 'Mexican', 'USA': 'American', 'CAN': 'Canadian', 'JAM': 'Jamaican',
  'TTO': 'Trinidadian', 'CRI': 'Costa Rican', 'HND': 'Honduran',
  'AUS': 'Australian', 'NZL': 'New Zealander', 'JPN': 'Japanese',
  'KOR': 'South Korean', 'CHN': 'Chinese', 'IRN': 'Iranian', 'ISR': 'Israeli',
  'NGA': 'Nigerian', 'GHA': 'Ghanaian', 'CIV': 'Ivorian', 'SEN': 'Senegalese',
  'CMR': 'Cameroonian', 'MAR': 'Moroccan', 'DZA': 'Algerian', 'ALG': 'Algerian',
  'TUN': 'Tunisian', 'EGY': 'Egyptian', 'ZAF': 'South African', 'RSA': 'South African',
  'COD': 'Congolese', 'MLI': 'Malian', 'GUI': 'Guinean', 'ZWE': 'Zimbabwean',
  'ZMB': 'Zambian', 'BFA': 'Burkinabe', 'GAB': 'Gabonese', 'TOG': 'Togolese',
  'BEN': 'Beninese', 'MDG': 'Malagasy', 'MOZ': 'Mozambican', 'TZA': 'Tanzanian',
  'UGA': 'Ugandan', 'KEN': 'Kenyan', 'RWA': 'Rwandan', 'SLE': 'Sierra Leonean',
  'LBR': 'Liberian', 'GNB': 'Bissau-Guinean', 'CPV': 'Cape Verdean',
  'SWE': 'Swedish', 'NOR': 'Norwegian', 'DEN': 'Danish', 'FIN': 'Finnish',
  'ISL': 'Icelandic', 'BEL': 'Belgian', 'SUI': 'Swiss', 'AUT': 'Austrian',
  'CZE': 'Czech', 'SVK': 'Slovak', 'POL': 'Polish', 'HUN': 'Hungarian',
  'ROU': 'Romanian', 'BUL': 'Bulgarian', 'CRO': 'Croatian', 'SRB': 'Serbian',
  'SVN': 'Slovenian', 'BIH': 'Bosnian', 'MNE': 'Montenegrin', 'MKD': 'North Macedonian',
  'ALB': 'Albanian', 'KOS': 'Kosovan', 'GRE': 'Greek', 'TUR': 'Turkish',
  'GEO': 'Georgian', 'ARM': 'Armenian', 'UKR': 'Ukrainian', 'RUS': 'Russian',
  'BLR': 'Belarusian', 'LTU': 'Lithuanian', 'LVA': 'Latvian', 'EST': 'Estonian',
  'CYP': 'Cypriot', 'LUX': 'Luxembourgish', 'MLT': 'Maltese',
  'SAU': 'Saudi', 'ARE': 'Emirati', 'QAT': 'Qatari', 'IND': 'Indian',
  'PAK': 'Pakistani', 'THA': 'Thai', 'MYS': 'Malaysian', 'SGP': 'Singaporean',
  'PAN': 'Panamanian', 'GTM': 'Guatemalan', 'SLV': 'Salvadoran',
  'HTI': 'Haitian', 'CUB': 'Cuban', 'DOM': 'Dominican',
  'BOL': 'Bolivian',
};

/**
 * Get the nationality adjective for a code, with fallback
 */
function getNationalityAdjective(code) {
  if (!code) return 'Unknown nationality';
  const upper = code.toUpperCase();
  return NATIONALITY_ADJECTIVES[upper] || upper;
}

// ============================================================
// DATA FETCHING
// ============================================================

/**
 * Get club_id for a club name (with alias support).
 */
async function getClubId(supabase, clubName) {
  let { data } = await supabase
    .from('clubs')
    .select('club_id')
    .eq('club_name', clubName)
    .single();
  if (data) return data.club_id;

  // Try case-insensitive
  ({ data } = await supabase
    .from('clubs')
    .select('club_id')
    .ilike('club_name', clubName)
    .limit(1));
  if (data && data.length > 0) return data[0].club_id;

  // Common aliases
  const CLUB_NAME_ALIASES = {
    'Manchester United': ['Manchester Utd', 'Man United', 'Man Utd'],
    'Manchester City': ['Man City'],
    'Newcastle United': ['Newcastle Utd', 'Newcastle'],
    'Tottenham Hotspur': ['Tottenham', 'Spurs'],
    'West Ham United': ['West Ham'],
    'West Bromwich Albion': ['West Brom'],
    'Sheffield United': ['Sheffield Utd', 'Sheff Utd'],
    'Sheffield Wednesday': ['Sheffield Weds', 'Sheff Wed', 'Sheffield Wed'],
    'Wolverhampton Wanderers': ['Wolves'],
    'Brighton & Hove Albion': ['Brighton', 'Brighton and Hove Albion'],
    'AFC Bournemouth': ['Bournemouth'],
    'Blackburn Rovers': ['Blackburn'],
    'Bolton Wanderers': ['Bolton'],
    'Charlton Athletic': ['Charlton'],
    'Coventry City': ['Coventry'],
    'Derby County': ['Derby'],
    'Ipswich Town': ['Ipswich'],
    'Leeds United': ['Leeds'],
    'Leicester City': ['Leicester'],
    'Norwich City': ['Norwich'],
    'Nottingham Forest': ['Nottm Forest', "Nott'm Forest"],
    'Queens Park Rangers': ['QPR'],
    'Stoke City': ['Stoke'],
    'Swansea City': ['Swansea'],
    'Wigan Athletic': ['Wigan'],
  };

  const aliases = CLUB_NAME_ALIASES[clubName] || [];
  for (const alias of aliases) {
    ({ data } = await supabase
      .from('clubs')
      .select('club_id')
      .ilike('club_name', alias)
      .limit(1));
    if (data && data.length > 0) return data[0].club_id;
  }

  // Partial match as last resort
  ({ data } = await supabase
    .from('clubs')
    .select('club_id, club_name')
    .ilike('club_name', `%${clubName}%`)
    .limit(1));
  if (data && data.length > 0) return data[0].club_id;

  return null;
}

/**
 * Get EPL competition_id
 */
async function getEplCompId(supabase) {
  const { data } = await supabase
    .from('competitions')
    .select('competition_id')
    .eq('competition_name', 'Premier League')
    .single();
  return data ? data.competition_id : null;
}

/**
 * Build the blanks pattern from a player name.
 * Each letter becomes "_", spaces are preserved as double-space gaps,
 * hyphens are shown as "-".
 * Example: "Dennis Bergkamp" -> "_ _ _ _ _ _  _ _ _ _ _ _ _ _"
 */
function buildBlanks(name) {
  if (!name) return '';
  return name
    .split('')
    .map(ch => {
      if (ch === ' ') return '  '; // double space between name parts
      if (ch === '-') return '-';
      if (ch === "'") return "'";
      return '_';
    })
    .join(' ')
    // Collapse triple+ spaces down to double (space-between-underscores + word gap)
    .replace(/   +/g, '   ');
}

/**
 * Count the letters (non-space, non-punctuation) in a name for display.
 */
function letterCount(name) {
  if (!name) return 0;
  return name.replace(/[\s\-']/g, '').length;
}

/**
 * Fetch all eligible players for a given scope, aggregate stats,
 * and return enriched player objects.
 */
async function fetchEligiblePlayers(supabase, scope, competitionId) {
  const minApps = scope.type === 'club' ? MIN_APPS_CLUB : MIN_APPS_LEAGUE;

  // Fetch season-level stats for all players in scope
  const buildQuery = () => {
    let q = supabase
      .from('player_season_stats')
      .select('player_uid, club_id, season_start_year, appearances, goals, assists, minutes, position_bucket, age')
      .eq('competition_id', competitionId)
      .gt('appearances', 0);
    if (scope.type === 'club' && scope.clubId) {
      q = q.eq('club_id', scope.clubId);
    }
    return q;
  };

  let stats;
  try {
    stats = await fetchAll(buildQuery);
  } catch (err) {
    console.error('[fetchEligiblePlayers] fetchAll error:', err);
    return [];
  }
  if (!stats || stats.length === 0) return [];

  // Aggregate by player_uid
  const aggMap = new Map();
  for (const row of stats) {
    let existing = aggMap.get(row.player_uid);
    if (!existing) {
      existing = {
        player_uid: row.player_uid,
        totalAppearances: 0,
        totalGoals: 0,
        totalAssists: 0,
        totalMinutes: 0,
        clubIds: new Set(),
        seasons: new Set(),
        positions: new Map(), // position_bucket -> total appearances in that position
      };
      aggMap.set(row.player_uid, existing);
    }
    existing.totalAppearances += row.appearances || 0;
    existing.totalGoals += row.goals || 0;
    existing.totalAssists += row.assists || 0;
    existing.totalMinutes += row.minutes || 0;
    if (row.club_id) existing.clubIds.add(row.club_id);
    if (row.season_start_year != null) existing.seasons.add(row.season_start_year);
    if (row.position_bucket) {
      const prev = existing.positions.get(row.position_bucket) || 0;
      existing.positions.set(row.position_bucket, prev + (row.appearances || 0));
    }
  }

  // Filter by minimum appearances
  const eligible = Array.from(aggMap.values()).filter(p => p.totalAppearances >= minApps);

  if (eligible.length === 0) return [];

  // ──────────────────────────────────────────────────────────────
  // For CLUB scopes: fetch FULL Premier League career data for
  // eligible players so clues reflect their entire PL career,
  // not just their time at this one club.
  // ──────────────────────────────────────────────────────────────
  let fullCareerMap = null; // null means "use aggMap as-is" (league scope)
  if (scope.type === 'club' && scope.clubId) {
    const eligibleUids = eligible.map(p => p.player_uid);
    fullCareerMap = new Map();

    // Fetch all PL rows (no club filter) for these players in batches
    const uidBatch = 200;
    for (let i = 0; i < eligibleUids.length; i += uidBatch) {
      const batch = eligibleUids.slice(i, i + uidBatch);
      const buildFullQuery = () => supabase
        .from('player_season_stats')
        .select('player_uid, club_id, season_start_year, appearances, goals, assists, minutes, position_bucket')
        .eq('competition_id', competitionId)
        .gt('appearances', 0)
        .in('player_uid', batch);

      let fullStats;
      try {
        fullStats = await fetchAll(buildFullQuery);
      } catch (err) {
        console.error('[fetchEligiblePlayers] full career fetch error:', err);
        fullStats = [];
      }

      for (const row of fullStats) {
        let existing = fullCareerMap.get(row.player_uid);
        if (!existing) {
          existing = {
            totalAppearances: 0,
            totalGoals: 0,
            totalAssists: 0,
            totalMinutes: 0,
            clubIds: new Set(),
            seasons: new Set(),
            positions: new Map(),
          };
          fullCareerMap.set(row.player_uid, existing);
        }
        existing.totalAppearances += row.appearances || 0;
        existing.totalGoals += row.goals || 0;
        existing.totalAssists += row.assists || 0;
        existing.totalMinutes += row.minutes || 0;
        if (row.club_id) existing.clubIds.add(row.club_id);
        if (row.season_start_year != null) existing.seasons.add(row.season_start_year);
        if (row.position_bucket) {
          const prev = existing.positions.get(row.position_bucket) || 0;
          existing.positions.set(row.position_bucket, prev + (row.appearances || 0));
        }
      }
    }
  }

  // Fetch player names and nationalities in batches
  const uids = eligible.map(p => p.player_uid);
  const playerInfoMap = new Map();
  const batchSize = 500;
  for (let i = 0; i < uids.length; i += batchSize) {
    const batch = uids.slice(i, i + batchSize);
    const { data: players } = await supabase
      .from('players')
      .select('player_uid, player_name, nationality_norm')
      .in('player_uid', batch);
    if (players) {
      for (const p of players) playerInfoMap.set(p.player_uid, p);
    }
  }

  // Fetch club names for all referenced club_ids (from both scoped + full career)
  const allClubIds = new Set();
  for (const p of eligible) {
    for (const cid of p.clubIds) allClubIds.add(cid);
  }
  if (fullCareerMap) {
    for (const fc of fullCareerMap.values()) {
      for (const cid of fc.clubIds) allClubIds.add(cid);
    }
  }
  const clubNameMap = new Map();
  const clubIdArr = Array.from(allClubIds);
  for (let i = 0; i < clubIdArr.length; i += batchSize) {
    const batch = clubIdArr.slice(i, i + batchSize);
    const { data: clubs } = await supabase
      .from('clubs')
      .select('club_id, club_name')
      .in('club_id', batch);
    if (clubs) {
      for (const c of clubs) clubNameMap.set(c.club_id, c.club_name);
    }
  }

  // Map position bucket to readable label
  const positionLabels = {
    'GK': 'Goalkeeper',
    'DEF': 'Defender',
    'MID': 'Midfielder',
    'FWD': 'Forward',
  };

  // Enrich eligible players
  const enriched = [];
  for (const agg of eligible) {
    const info = playerInfoMap.get(agg.player_uid);
    if (!info || !info.player_name) continue;

    const displayName = fixMojibake(info.player_name);
    // Skip players with very short names (probably data quality issues)
    if (displayName.length < 3) continue;

    // Use full career data for clues if available, otherwise use scoped data
    const full = fullCareerMap ? fullCareerMap.get(agg.player_uid) : null;
    const careerData = full || agg;

    // Determine primary position from FULL career (most appearances)
    let primaryPosition = 'Unknown';
    let maxPosApps = 0;
    for (const [pos, apps] of careerData.positions) {
      if (apps > maxPosApps) {
        maxPosApps = apps;
        primaryPosition = pos;
      }
    }

    // Get club names from FULL career
    const clubNames = [];
    for (const cid of careerData.clubIds) {
      const name = clubNameMap.get(cid);
      if (name) clubNames.push(name);
    }

    // Season span from FULL career
    const seasonsArr = Array.from(careerData.seasons).sort((a, b) => a - b);
    const firstSeason = seasonsArr[0];
    const lastSeason = seasonsArr[seasonsArr.length - 1];
    const seasonCount = seasonsArr.length;

    // Club-specific stats (for club scope clues)
    const clubAppearances = agg.totalAppearances;
    const clubGoals = agg.totalGoals;
    const clubSeasonsArr = Array.from(agg.seasons).sort((a, b) => a - b);
    const clubSeasonCount = clubSeasonsArr.length;
    const clubFirstSeason = clubSeasonsArr[0];
    const clubLastSeason = clubSeasonsArr[clubSeasonsArr.length - 1];

    enriched.push({
      player_uid: agg.player_uid,
      name: displayName,
      nationality: (info.nationality_norm || '').toUpperCase(),
      // Full PL career stats (used for clues)
      totalAppearances: careerData.totalAppearances,
      totalGoals: careerData.totalGoals,
      totalAssists: careerData.totalAssists,
      totalMinutes: careerData.totalMinutes,
      clubNames,
      clubCount: clubNames.length,
      primaryPosition: positionLabels[primaryPosition] || primaryPosition,
      firstSeason,
      lastSeason,
      seasonCount,
      // Club-specific stats (used for club scope clues)
      clubAppearances,
      clubGoals,
      clubSeasonCount,
      clubFirstSeason,
      clubLastSeason,
    });
  }

  return enriched;
}

/**
 * Generate 5 clues for a player, from hardest to easiest.
 * Uses full PL career stats so clues are accurate even in club-scoped games.
 * For club scopes, also weaves in club-specific context where helpful.
 */
function generateClues(player, scopeType, scopeClubName) {
  const clues = [];

  // Clue 1 (hardest): Number of PL clubs and which clubs
  if (scopeType === 'league') {
    if (player.clubCount === 1) {
      clues.push(`I played for just 1 Premier League club: ${player.clubNames[0]}`);
    } else {
      clues.push(`I played for ${player.clubCount} Premier League clubs: ${player.clubNames.join(', ')}`);
    }
  } else {
    // For club scope — show all their PL clubs
    if (player.clubCount === 1) {
      clues.push(`${player.clubNames[0]} was my only Premier League club`);
    } else {
      const otherClubs = player.clubNames.filter(c => c !== scopeClubName);
      clues.push(`I played for ${player.clubCount} Premier League clubs — also: ${otherClubs.join(', ')}`);
    }
  }

  // Clue 2: Career span (full PL career)
  if (player.firstSeason && player.lastSeason) {
    const startDisplay = `${player.firstSeason}/${String(player.firstSeason + 1).slice(2)}`;
    const endDisplay = `${player.lastSeason}/${String(player.lastSeason + 1).slice(2)}`;
    if (player.seasonCount === 1) {
      clues.push(`My Premier League career lasted just 1 season (${startDisplay})`);
    } else if (player.firstSeason === player.lastSeason) {
      clues.push(`My Premier League career spanned ${player.seasonCount} seasons from ${startDisplay}`);
    } else {
      clues.push(`My Premier League career spanned ${player.seasonCount} seasons (${startDisplay} to ${endDisplay})`);
    }
  } else {
    clues.push(`I played ${player.seasonCount} Premier League seasons`);
  }

  // Clue 3: Position
  clues.push(`I played as a ${player.primaryPosition}`);

  // Clue 4: Stats — use full PL career totals, plus club-specific context for club scopes
  if (player.primaryPosition === 'Goalkeeper') {
    let clue = `I made ${player.totalAppearances} Premier League appearances`;
    if (scopeType === 'club' && player.clubAppearances !== player.totalAppearances) {
      clue += ` (${player.clubAppearances} for ${scopeClubName})`;
    }
    clues.push(clue);
  } else if (player.totalGoals === 0) {
    let clue = `I made ${player.totalAppearances} Premier League appearances without scoring`;
    if (scopeType === 'club' && player.clubAppearances !== player.totalAppearances) {
      clue += ` (${player.clubAppearances} for ${scopeClubName})`;
    }
    clues.push(clue);
  } else {
    let clue = `I scored ${player.totalGoals} Premier League goal${player.totalGoals !== 1 ? 's' : ''}`;
    if (scopeType === 'club' && player.clubGoals !== player.totalGoals) {
      clue += ` (${player.clubGoals} for ${scopeClubName})`;
    }
    clues.push(clue);
  }

  // Clue 5 (easiest): Nationality
  const adj = getNationalityAdjective(player.nationality);
  clues.push(`I am ${adj}`);

  return clues;
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
    const { action } = body;

    console.log('[whoami_start] Action:', action);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return respond(500, { error: 'Missing Supabase config' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ============================================================
    // GET SCOPES — return available scopes for the game
    // ============================================================
    if (action === 'get_scopes') {
      return respond(200, {
        scopes: SCOPES.map(s => ({ id: s.id, label: s.label, type: s.type })),
      });
    }

    // ============================================================
    // START GAME — pick a random player, return blanks + clues
    // ============================================================
    if (action === 'start_game') {
      const { scopeId } = body;

      if (!scopeId) {
        return respond(400, { error: 'Missing scopeId' });
      }

      const scopeDef = SCOPES.find(s => s.id === scopeId);
      if (!scopeDef) {
        return respond(400, { error: `Unknown scope: ${scopeId}` });
      }

      const competitionId = await getEplCompId(supabase);
      if (!competitionId) {
        return respond(500, { error: 'Premier League competition not found' });
      }

      // Resolve club_id if needed
      const scope = { ...scopeDef };
      if (scope.type === 'club' && scope.clubName) {
        scope.clubId = await getClubId(supabase, scope.clubName);
        if (!scope.clubId) {
          return respond(400, { error: `Club not found: ${scope.clubName}` });
        }
      }

      // Fetch all eligible players
      const eligible = await fetchEligiblePlayers(supabase, scope, competitionId);

      if (eligible.length === 0) {
        return respond(404, { error: 'No eligible players found for this scope' });
      }

      console.log(`[whoami_start] ${eligible.length} eligible players for scope ${scopeId}`);

      // Filter by difficulty based on season count
      // For club scopes, use club-specific season count (how long at THAT club)
      // For league scope, use full PL career season count
      // Easy: well-known players with long careers (8+ seasons)
      // Medium: moderate careers (4-7 seasons)
      // Hard: short-stint players (1-3 seasons) — the obscure ones
      const { difficulty } = body;
      let pool = eligible;
      const getDifficultySeason = (p) => scope.type === 'club' ? p.clubSeasonCount : p.seasonCount;

      if (difficulty === 'easy') {
        pool = eligible.filter(p => getDifficultySeason(p) >= 8);
        if (pool.length < 5) pool = eligible.filter(p => getDifficultySeason(p) >= 6);
        if (pool.length < 5) pool = eligible;
      } else if (difficulty === 'medium') {
        pool = eligible.filter(p => getDifficultySeason(p) >= 4 && getDifficultySeason(p) <= 7);
        if (pool.length < 5) pool = eligible.filter(p => getDifficultySeason(p) >= 3 && getDifficultySeason(p) <= 8);
        if (pool.length < 5) pool = eligible;
      } else if (difficulty === 'hard') {
        pool = eligible.filter(p => getDifficultySeason(p) <= 3);
        if (pool.length < 5) pool = eligible.filter(p => getDifficultySeason(p) <= 4);
        if (pool.length < 5) pool = eligible;
      }

      console.log(`[whoami_start] Difficulty "${difficulty || 'any'}" → pool size: ${pool.length}`);

      // Pick a random player from the filtered pool
      const randomIndex = Math.floor(Math.random() * pool.length);
      const player = pool[randomIndex];

      // Build blanks pattern
      const blanks = buildBlanks(player.name);
      const letters = letterCount(player.name);

      // Generate clues
      const clues = generateClues(player, scope.type, scope.clubName);

      // Encrypt the player_uid
      const encryptedId = encryptPlayerId(player.player_uid);

      return respond(200, {
        blanks,
        letterCount: letters,
        clues,
        playerId: encryptedId,
        scope: { id: scope.id, label: scope.label, type: scope.type },
        eligibleCount: eligible.length,
      });
    }

    // ============================================================
    // SEARCH PLAYERS — typeahead suggestions for the guess input
    // ============================================================
    if (action === 'search_players') {
      const { scopeId, query } = body;

      if (!scopeId || !query || query.trim().length < 2) {
        return respond(400, { error: 'Missing scopeId or query (min 2 chars)' });
      }

      const scopeDef = SCOPES.find(s => s.id === scopeId);
      if (!scopeDef) {
        return respond(400, { error: `Unknown scope: ${scopeId}` });
      }

      const competitionId = await getEplCompId(supabase);
      if (!competitionId) {
        return respond(500, { error: 'Premier League competition not found' });
      }

      const scope = { ...scopeDef };
      if (scope.type === 'club' && scope.clubName) {
        scope.clubId = await getClubId(supabase, scope.clubName);
        if (!scope.clubId) {
          return respond(400, { error: `Club not found: ${scope.clubName}` });
        }
      }

      // Fetch all eligible players (same pool used for the game)
      const eligible = await fetchEligiblePlayers(supabase, scope, competitionId);

      // Filter by query — match against full name and individual name parts
      const normalizedQuery = normalize(query.trim());
      const results = [];

      for (const player of eligible) {
        const normalizedName = normalize(player.name);
        const nameParts = normalizedName.split(/\s+/);

        const fullMatch = normalizedName.includes(normalizedQuery);
        const partMatch = nameParts.some(part => part.includes(normalizedQuery));
        const partStartMatch = nameParts.some(part => part.startsWith(normalizedQuery));

        if (!fullMatch && !partMatch) continue;

        results.push({
          name: player.name,
          nationality: player.nationality,
          appearances: player.totalAppearances,
          goals: player.totalGoals,
          _normalized: normalizedName,
          _surnameStartMatch: nameParts.length > 1 && nameParts[nameParts.length - 1].startsWith(normalizedQuery),
          _partStartMatch: partStartMatch,
        });
      }

      // Sort: surname start match → part start → full name start → by appearances
      results.sort((a, b) => {
        if (a._surnameStartMatch !== b._surnameStartMatch) return a._surnameStartMatch ? -1 : 1;
        if (a._partStartMatch !== b._partStartMatch) return a._partStartMatch ? -1 : 1;
        const aStarts = a._normalized.startsWith(normalizedQuery) ? 0 : 1;
        const bStarts = b._normalized.startsWith(normalizedQuery) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return b.appearances - a.appearances;
      });

      // Return top 8, strip internal fields
      const top = results.slice(0, 8).map(({ _normalized, _surnameStartMatch, _partStartMatch, ...rest }) => rest);

      return respond(200, { players: top });
    }

    // ============================================================
    // CHECK ANSWER — verify a guess against the hidden player
    // ============================================================
    if (action === 'check_answer') {
      const { playerId, guess, scopeId, giveUp } = body;

      if (!playerId || (!guess && !giveUp)) {
        return respond(400, { error: 'Missing playerId or guess' });
      }

      // Decrypt the player_uid
      let decryptedUid;
      try {
        decryptedUid = decryptPlayerId(playerId);
      } catch (err) {
        console.error('[whoami_start] Decryption error:', err.message);
        return respond(400, { error: 'Invalid playerId' });
      }

      // Look up the actual player
      const { data: playerData, error: playerErr } = await supabase
        .from('players')
        .select('player_uid, player_name, nationality_norm')
        .eq('player_uid', decryptedUid)
        .single();

      if (playerErr || !playerData) {
        return respond(404, { error: 'Player not found' });
      }

      const actualName = fixMojibake(playerData.player_name);
      const normalizedActual = normalize(actualName);
      const normalizedGuess = normalize(guess);

      // Fuzzy match: compare normalized forms
      // Also try matching against individual name parts (first name, last name)
      const actualParts = normalizedActual.split(/\s+/);
      const guessParts = normalizedGuess.split(/\s+/);

      // Exact full-name match (normalized)
      let isCorrect = normalizedGuess === normalizedActual;

      // If not exact, try matching with reordered parts
      // (e.g. "Bergkamp Dennis" should match "Dennis Bergkamp")
      if (!isCorrect && guessParts.length >= 2 && actualParts.length >= 2) {
        const guessSet = new Set(guessParts);
        const actualSet = new Set(actualParts);
        if (guessSet.size === actualSet.size) {
          isCorrect = [...guessSet].every(p => actualSet.has(p));
        }
      }

      // Allow matching just the surname if player has multi-part name
      // and the surname is distinctive enough (>= 4 chars)
      if (!isCorrect && actualParts.length >= 2) {
        const surname = actualParts[actualParts.length - 1];
        if (surname.length >= 4 && normalizedGuess === surname) {
          // Only allow surname match if it's reasonably unique
          // (just a best-effort convenience)
          isCorrect = true;
        }
      }

      const result = {
        correct: isCorrect,
        guess: guess.trim(),
      };

      if (isCorrect || giveUp) {
        // Fetch full stats for the reveal
        const competitionId = await getEplCompId(supabase);
        let playerStats = null;

        if (competitionId) {
          const scopeDef = scopeId ? SCOPES.find(s => s.id === scopeId) : null;
          const scope = scopeDef ? { ...scopeDef } : null;

          if (scope && scope.type === 'club' && scope.clubName) {
            scope.clubId = await getClubId(supabase, scope.clubName);
          }

          const buildStatsQuery = () => {
            let q = supabase
              .from('player_season_stats')
              .select('club_id, season_start_year, appearances, goals, assists, minutes, position_bucket')
              .eq('player_uid', decryptedUid)
              .eq('competition_id', competitionId)
              .gt('appearances', 0);
            if (scope && scope.type === 'club' && scope.clubId) {
              q = q.eq('club_id', scope.clubId);
            }
            return q;
          };

          try {
            const seasonRows = await fetchAll(buildStatsQuery);
            if (seasonRows && seasonRows.length > 0) {
              let totalApps = 0, totalGoals = 0, totalAssists = 0, totalMinutes = 0;
              const clubIds = new Set();
              const seasons = new Set();

              for (const row of seasonRows) {
                totalApps += row.appearances || 0;
                totalGoals += row.goals || 0;
                totalAssists += row.assists || 0;
                totalMinutes += row.minutes || 0;
                if (row.club_id) clubIds.add(row.club_id);
                if (row.season_start_year != null) seasons.add(row.season_start_year);
              }

              // Resolve club names
              const clubNameList = [];
              const cidArr = Array.from(clubIds);
              if (cidArr.length > 0) {
                const { data: clubs } = await supabase
                  .from('clubs')
                  .select('club_id, club_name')
                  .in('club_id', cidArr);
                if (clubs) {
                  for (const c of clubs) clubNameList.push(c.club_name);
                }
              }

              playerStats = {
                appearances: totalApps,
                goals: totalGoals,
                assists: totalAssists,
                minutes: totalMinutes,
                clubs: clubNameList,
                seasonCount: seasons.size,
              };
            }
          } catch (err) {
            console.error('[whoami_start] Stats fetch error:', err.message);
          }
        }

        result.player = {
          name: actualName,
          nationality: (playerData.nationality_norm || '').toUpperCase(),
          nationalityLabel: getNationalityAdjective(playerData.nationality_norm),
          stats: playerStats,
        };
      }

      return respond(200, result);
    }

    return respond(400, { error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('[whoami_start] Error:', err);
    return respond(500, { error: err.message, stack: err.stack });
  }
};
