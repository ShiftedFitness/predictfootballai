/**
 * xi_start.js — Starting XI backend
 *
 * Endpoints (via `action` field in POST body):
 *   get_scopes       → Returns available scopes (league + clubs)
 *   search_players   → Player search/suggestions for a slot
 *   compute_best_xi  → Computes the optimal XI (server-side, not exposed to client until reveal)
 *   get_best_xi      → Returns the best XI for scoring (called by xi_score.js or internally)
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

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
 * queryFn: a function that accepts (offset, limit) and returns a Supabase query builder.
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
    // Detect mojibake pattern (Ã followed by another char)
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

// ============================================================
// FORMATION DEFINITIONS
// ============================================================

const FORMATIONS = {
  '4-4-2': {
    label: '4-4-2',
    slots: [
      { idx: 0, role: 'GK',  bucket: 'GK',  label: 'GK',  row: 0 },
      { idx: 1, role: 'LB',  bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 2, role: 'CB',  bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 3, role: 'CB',  bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 4, role: 'RB',  bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 5, role: 'LM',  bucket: 'MID', label: 'MF', row: 2 },
      { idx: 6, role: 'CM',  bucket: 'MID', label: 'MF', row: 2 },
      { idx: 7, role: 'CM',  bucket: 'MID', label: 'MF', row: 2 },
      { idx: 8, role: 'RM',  bucket: 'MID', label: 'MF', row: 2 },
      { idx: 9, role: 'ST',  bucket: 'FWD', label: 'FW', row: 3 },
      { idx: 10, role: 'ST', bucket: 'FWD', label: 'FW', row: 3 },
    ],
  },
  '4-3-3': {
    label: '4-3-3',
    slots: [
      { idx: 0, role: 'GK',  bucket: 'GK',  label: 'GK',  row: 0 },
      { idx: 1, role: 'LB',  bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 2, role: 'CB',  bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 3, role: 'CB',  bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 4, role: 'RB',  bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 5, role: 'CM',  bucket: 'MID', label: 'MF', row: 2 },
      { idx: 6, role: 'CM',  bucket: 'MID', label: 'MF', row: 2 },
      { idx: 7, role: 'CM',  bucket: 'MID', label: 'MF', row: 2 },
      { idx: 8, role: 'LW',  bucket: 'FWD', label: 'FW', row: 3 },
      { idx: 9, role: 'ST',  bucket: 'FWD', label: 'FW', row: 3 },
      { idx: 10, role: 'RW', bucket: 'FWD', label: 'FW', row: 3 },
    ],
  },
  '3-5-2': {
    label: '3-5-2',
    slots: [
      { idx: 0, role: 'GK',   bucket: 'GK',  label: 'GK',  row: 0 },
      { idx: 1, role: 'CB',   bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 2, role: 'CB',   bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 3, role: 'CB',   bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 4, role: 'LWB',  bucket: 'MID', label: 'MF', row: 2 },
      { idx: 5, role: 'CM',   bucket: 'MID', label: 'MF', row: 2 },
      { idx: 6, role: 'CM',   bucket: 'MID', label: 'MF', row: 2 },
      { idx: 7, role: 'CM',   bucket: 'MID', label: 'MF', row: 2 },
      { idx: 8, role: 'RWB',  bucket: 'MID', label: 'MF', row: 2 },
      { idx: 9, role: 'ST',   bucket: 'FWD', label: 'FW', row: 3 },
      { idx: 10, role: 'ST',  bucket: 'FWD', label: 'FW', row: 3 },
    ],
  },
  '3-4-3': {
    label: '3-4-3',
    slots: [
      { idx: 0, role: 'GK',   bucket: 'GK',  label: 'GK',  row: 0 },
      { idx: 1, role: 'CB',   bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 2, role: 'CB',   bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 3, role: 'CB',   bucket: 'DEF', label: 'DF', row: 1 },
      { idx: 4, role: 'LM',   bucket: 'MID', label: 'MF', row: 2 },
      { idx: 5, role: 'CM',   bucket: 'MID', label: 'MF', row: 2 },
      { idx: 6, role: 'CM',   bucket: 'MID', label: 'MF', row: 2 },
      { idx: 7, role: 'RM',   bucket: 'MID', label: 'MF', row: 2 },
      { idx: 8, role: 'LW',   bucket: 'FWD', label: 'FW', row: 3 },
      { idx: 9, role: 'ST',   bucket: 'FWD', label: 'FW', row: 3 },
      { idx: 10, role: 'RW',  bucket: 'FWD', label: 'FW', row: 3 },
    ],
  },
};

// Supported scopes — all 41 EPL clubs + league-wide + nationality + wonders
// clubId is the direct database ID (avoids fragile name lookups)
const SCOPES = [
  // Combined
  { id: 'epl_alltime',      label: 'Premier League (All-time)', type: 'league', clubName: null, category: 'combined' },
  // Wonders
  { id: 'wonder_onematch',  label: 'One Match Wonders', type: 'wonder', wonderType: 'match', category: 'wonders', visibleObjectives: ['appearances'] },
  { id: 'wonder_onegoal',   label: 'One Goal Wonders',  type: 'wonder', wonderType: 'goal',  category: 'wonders', visibleObjectives: ['goals'] },
  // Nationality XIs
  { id: 'nat_english',  label: 'English XI',  type: 'nationality', nationalityCode: 'ENG', category: 'nationality' },
  { id: 'nat_spanish',  label: 'Spanish XI',  type: 'nationality', nationalityCode: 'ESP', category: 'nationality' },
  { id: 'nat_french',   label: 'French XI',   type: 'nationality', nationalityCode: 'FRA', category: 'nationality' },
  { id: 'nat_scottish', label: 'Scottish XI', type: 'nationality', nationalityCode: 'SCO', category: 'nationality' },
  { id: 'nat_irish',    label: 'Irish XI',    type: 'nationality', nationalityCode: 'IRL', category: 'nationality' },
  { id: 'nat_welsh',    label: 'Welsh XI',    type: 'nationality', nationalityCode: 'WAL', category: 'nationality' },
  { id: 'nat_nirish',   label: 'N. Irish XI', type: 'nationality', nationalityCode: 'NIR', category: 'nationality' },
  // Clubs
  { id: 'club_arsenal',     label: 'Arsenal',          type: 'club', category: 'clubs', clubName: 'Arsenal',              clubId: 94  },
  { id: 'club_astonvilla',  label: 'Aston Villa',      type: 'club', category: 'clubs', clubName: 'Aston Villa',          clubId: 295 },
  { id: 'club_blackburn',   label: 'Blackburn',        type: 'club', category: 'clubs', clubName: 'Blackburn Rovers',     clubId: 24  },
  { id: 'club_bolton',      label: 'Bolton',           type: 'club', category: 'clubs', clubName: 'Bolton Wanderers',     clubId: 158 },
  { id: 'club_bournemouth', label: 'Bournemouth',      type: 'club', category: 'clubs', clubName: 'Bournemouth',          clubId: 117 },
  { id: 'club_brentford',   label: 'Brentford',        type: 'club', category: 'clubs', clubName: 'Brentford',            clubId: 336 },
  { id: 'club_brighton',    label: 'Brighton',         type: 'club', category: 'clubs', clubName: 'Brighton',              clubId: 483 },
  { id: 'club_burnley',     label: 'Burnley',          type: 'club', category: 'clubs', clubName: 'Burnley',              clubId: 535 },
  { id: 'club_charlton',    label: 'Charlton',         type: 'club', category: 'clubs', clubName: 'Charlton Athletic',    clubId: 407 },
  { id: 'club_chelsea',     label: 'Chelsea',          type: 'club', category: 'clubs', clubName: 'Chelsea',              clubId: 75  },
  { id: 'club_coventry',    label: 'Coventry',         type: 'club', category: 'clubs', clubName: 'Coventry City',        clubId: 501 },
  { id: 'club_crystalpalace', label: 'Crystal Palace', type: 'club', category: 'clubs', clubName: 'Crystal Palace',       clubId: 57  },
  { id: 'club_derby',       label: 'Derby',            type: 'club', category: 'clubs', clubName: 'Derby County',         clubId: 218 },
  { id: 'club_everton',     label: 'Everton',          type: 'club', category: 'clubs', clubName: 'Everton',              clubId: 22  },
  { id: 'club_fulham',      label: 'Fulham',           type: 'club', category: 'clubs', clubName: 'Fulham',               clubId: 356 },
  { id: 'club_ipswich',     label: 'Ipswich',          type: 'club', category: 'clubs', clubName: 'Ipswich Town',         clubId: 348 },
  { id: 'club_leeds',       label: 'Leeds',            type: 'club', category: 'clubs', clubName: 'Leeds United',         clubId: 559 },
  { id: 'club_leicester',   label: 'Leicester',        type: 'club', category: 'clubs', clubName: 'Leicester City',       clubId: 68  },
  { id: 'club_liverpool',   label: 'Liverpool',        type: 'club', category: 'clubs', clubName: 'Liverpool',            clubId: 28  },
  { id: 'club_mancity',     label: 'Man City',         type: 'club', category: 'clubs', clubName: 'Manchester City',      clubId: 278 },
  { id: 'club_manutd',      label: 'Man Utd',          type: 'club', category: 'clubs', clubName: 'Manchester Utd',       clubId: 592 },
  { id: 'club_middlesbrough', label: 'Middlesbrough',  type: 'club', category: 'clubs', clubName: 'Middlesbrough',        clubId: 534 },
  { id: 'club_newcastle',   label: 'Newcastle',        type: 'club', category: 'clubs', clubName: 'Newcastle United',     clubId: 520 },
  { id: 'club_norwich',     label: 'Norwich',          type: 'club', category: 'clubs', clubName: 'Norwich City',         clubId: 137 },
  { id: 'club_nottmforest', label: 'Nottm Forest',     type: 'club', category: 'clubs', clubName: 'Nottingham Forest',    clubId: 213 },
  { id: 'club_portsmouth',  label: 'Portsmouth',       type: 'club', category: 'clubs', clubName: 'Portsmouth',           clubId: 493 },
  { id: 'club_qpr',         label: 'QPR',              type: 'club', category: 'clubs', clubName: 'Queens Park Rangers',  clubId: 543 },
  { id: 'club_reading',     label: 'Reading',          type: 'club', category: 'clubs', clubName: 'Reading',              clubId: 344 },
  { id: 'club_sheffutd',    label: 'Sheff Utd',        type: 'club', category: 'clubs', clubName: 'Sheffield United',     clubId: 371 },
  { id: 'club_sheffwed',    label: 'Sheff Wed',        type: 'club', category: 'clubs', clubName: 'Sheffield Weds',       clubId: 496 },
  { id: 'club_southampton', label: 'Southampton',      type: 'club', category: 'clubs', clubName: 'Southampton',          clubId: 208 },
  { id: 'club_stoke',       label: 'Stoke',            type: 'club', category: 'clubs', clubName: 'Stoke City',           clubId: 121 },
  { id: 'club_sunderland',  label: 'Sunderland',       type: 'club', category: 'clubs', clubName: 'Sunderland',           clubId: 12  },
  { id: 'club_swansea',     label: 'Swansea',          type: 'club', category: 'clubs', clubName: 'Swansea City',         clubId: 548 },
  { id: 'club_tottenham',   label: 'Spurs',            type: 'club', category: 'clubs', clubName: 'Tottenham Hotspur',    clubId: 239 },
  { id: 'club_watford',     label: 'Watford',          type: 'club', category: 'clubs', clubName: 'Watford',              clubId: 71  },
  { id: 'club_westbrom',    label: 'West Brom',        type: 'club', category: 'clubs', clubName: 'West Bromwich Albion', clubId: 9   },
  { id: 'club_westham',     label: 'West Ham',         type: 'club', category: 'clubs', clubName: 'West Ham United',      clubId: 153 },
  { id: 'club_wigan',       label: 'Wigan',            type: 'club', category: 'clubs', clubName: 'Wigan Athletic',       clubId: 564 },
  { id: 'club_wimbledon',   label: 'Wimbledon',        type: 'club', category: 'clubs', clubName: 'Wimbledon',            clubId: 140 },
  { id: 'club_wolves',      label: 'Wolves',           type: 'club', category: 'clubs', clubName: 'Wolves',               clubId: 577 },
];

// Min appearance thresholds
const MIN_APPS_LEAGUE = 40;
const MIN_APPS_CLUB = 20;

// ============================================================
// DATA FETCHING
// ============================================================

/**
 * Get club_id for a club name.
 * Tries exact match first, then case-insensitive, then common aliases.
 */
async function getClubId(supabase, clubName) {
  // Try exact match first
  let { data, error } = await supabase
    .from('clubs')
    .select('club_id')
    .eq('club_name', clubName)
    .single();
  if (data) return data.club_id;

  // Try case-insensitive match
  ({ data, error } = await supabase
    .from('clubs')
    .select('club_id')
    .ilike('club_name', clubName)
    .limit(1));
  if (data && data.length > 0) return data[0].club_id;

  // Try common aliases
  const CLUB_NAME_ALIASES = {
    'Manchester United': ['Manchester Utd', 'Man United', 'Man Utd'],
    'Manchester City': ['Manchester City', 'Man City'],
    'Newcastle United': ['Newcastle Utd'],
    'Tottenham Hotspur': ['Tottenham', 'Spurs'],
    'West Ham United': ['West Ham'],
    'West Bromwich Albion': ['West Brom'],
    'Sheffield United': ['Sheffield Utd'],
    'Wolverhampton Wanderers': ['Wolves'],
    'Brighton & Hove Albion': ['Brighton'],
    'AFC Bournemouth': ['Bournemouth'],
  };

  const aliases = CLUB_NAME_ALIASES[clubName] || [];
  for (const alias of aliases) {
    ({ data, error } = await supabase
      .from('clubs')
      .select('club_id')
      .ilike('club_name', alias)
      .limit(1));
    if (data && data.length > 0) return data[0].club_id;
  }

  // Try partial match as last resort
  ({ data, error } = await supabase
    .from('clubs')
    .select('club_id, club_name')
    .ilike('club_name', `%${clubName}%`)
    .limit(1));
  if (data && data.length > 0) {
    console.log(`[getClubId] Fuzzy matched "${clubName}" → "${data[0].club_name}"`);
    return data[0].club_id;
  }

  return null;
}

/**
 * Get EPL competition_id
 */
async function getEplCompId(supabase) {
  const { data, error } = await supabase
    .from('competitions')
    .select('competition_id')
    .eq('competition_name', 'Premier League')
    .single();
  if (error || !data) return null;
  return data.competition_id;
}

/**
 * Search players by name for a given scope and position bucket.
 * Returns top 10 matches.
 */
async function searchPlayers(supabase, query, positionBucket, scope, competitionId) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery || normalizedQuery.length < 2) return [];

  // Only show players that match the slot's position bucket
  const bucketsToSearch = [positionBucket];

  const buildQuery = () => {
    let q = supabase
      .from('v_all_player_season_stats')
      .select('player_uid, appearances, goals, assists, minutes')
      .eq('competition_id', competitionId)
      .in('position_bucket', bucketsToSearch)
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
    console.error('[searchPlayers] fetchAll error:', err);
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

  // Apply min threshold (wonders have no min)
  const minApps = scope.type === 'wonder' ? 0 : (scope.type === 'club' ? MIN_APPS_CLUB : MIN_APPS_LEAGUE);
  let eligible = Array.from(aggMap.values()).filter(p => p.appearances >= minApps);

  // Apply wonder filters
  if (scope.type === 'wonder') {
    if (scope.wonderType === 'match') eligible = eligible.filter(p => p.appearances === 1);
    else if (scope.wonderType === 'goal') eligible = eligible.filter(p => p.goals === 1);
  }

  // Fetch player names
  const uids = eligible.map(p => p.player_uid);
  if (uids.length === 0) return [];

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

  // Apply nationality filter after fetching player info
  if (scope.type === 'nationality' && scope.nationalityCode) {
    const natCode = scope.nationalityCode.toUpperCase();
    const natUids = new Set();
    for (const [uid, p] of playerNames) {
      if ((p.nationality_norm || '').toUpperCase() === natCode) natUids.add(uid);
    }
    eligible = eligible.filter(p => natUids.has(p.player_uid));
  }

  // Filter by name match and format results
  // Match against full name AND individual name parts (first/last)
  const results = [];
  for (const agg of eligible) {
    const player = playerNames.get(agg.player_uid);
    if (!player) continue;

    const displayName = fixMojibake(player.player_name);
    const normalizedName = normalize(displayName);
    const nameParts = normalizedName.split(/\s+/);

    // Check if query matches full name or any individual name part
    const fullMatch = normalizedName.includes(normalizedQuery);
    const partMatch = nameParts.some(part => part.includes(normalizedQuery));
    // Also check if query matches start of any part (for partial typing)
    const partStartMatch = nameParts.some(part => part.startsWith(normalizedQuery));

    if (!fullMatch && !partMatch) continue;

    results.push({
      playerId: agg.player_uid,
      name: displayName,
      normalized: normalizedName,
      nationality: (player.nationality_norm || '').toUpperCase(),
      appearances: agg.appearances,
      goals: agg.goals,
      assists: agg.assists,
      minutes: agg.minutes,
      _surnameStartMatch: nameParts.length > 1 && nameParts[nameParts.length - 1].startsWith(normalizedQuery),
      _partStartMatch: partStartMatch,
    });
  }

  // Sort: surname start match first, then any part start match, then full name start, then by appearances desc
  results.sort((a, b) => {
    // Surname match is highest priority (users typically search by surname)
    if (a._surnameStartMatch !== b._surnameStartMatch) return a._surnameStartMatch ? -1 : 1;
    if (a._partStartMatch !== b._partStartMatch) return a._partStartMatch ? -1 : 1;
    const aStarts = a.normalized.startsWith(normalizedQuery) ? 0 : 1;
    const bStarts = b.normalized.startsWith(normalizedQuery) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return b.appearances - a.appearances;
  });

  return results.slice(0, 10);
}

/**
 * Compute the Best XI for a given scope + formation + objective.
 *
 * For apps/goals: queries player_season_stats, aggregates, sorts by metric.
 * For performance: queries player_performance_scores table.
 */
async function computeBestXI(supabase, scope, formation, objective) {
  const formationDef = FORMATIONS[formation];
  if (!formationDef) throw new Error(`Unknown formation: ${formation}`);

  const competitionId = await getEplCompId(supabase);
  if (!competitionId) throw new Error('Premier League not found');

  // Count needed per bucket
  const bucketCounts = {};
  for (const slot of formationDef.slots) {
    bucketCounts[slot.bucket] = (bucketCounts[slot.bucket] || 0) + 1;
  }

  const bestXI = [];

  if (objective === 'performance') {
    // Use pre-computed performance scores
    for (const [bucket, count] of Object.entries(bucketCounts)) {
      let scopeType = scope.type;
      let scopeId = null;

      // Nationality and wonder scopes use league-wide perf scores with extra filtering
      if (scope.type === 'nationality' || scope.type === 'wonder') {
        scopeType = 'league';
        scopeId = null;
      } else if (scope.type === 'club') {
        scopeId = scope.clubId;
      }

      // For nationality/wonder we need more results to filter from
      const fetchLimit = (scope.type === 'nationality' || scope.type === 'wonder') ? 500 : count;

      let query = supabase
        .from('player_performance_scores')
        .select('player_uid, player_name, nationality, appearances, goals, assists, minutes, performance_score')
        .eq('position_bucket', bucket)
        .eq('scope_type', scopeType);

      if (scopeId) {
        query = query.eq('scope_id', scopeId);
      } else {
        query = query.is('scope_id', null);
      }

      // Apply nationality filter at DB level
      if (scope.type === 'nationality' && scope.nationalityCode) {
        query = query.eq('nationality', scope.nationalityCode.toUpperCase());
      }

      // Apply wonder filter at DB level
      if (scope.type === 'wonder') {
        if (scope.wonderType === 'match') query = query.eq('appearances', 1);
        else if (scope.wonderType === 'goal') query = query.eq('goals', 1);
      }

      query = query
        .order('performance_score', { ascending: false })
        .order('appearances', { ascending: false })
        .order('minutes', { ascending: false })
        .order('player_name', { ascending: true })
        .limit(fetchLimit);

      const { data, error } = await query;
      if (error) {
        console.error(`[computeBestXI] Error fetching ${bucket}:`, error);
        continue;
      }

      if (data) {
        const topN = data.slice(0, count);
        for (const row of topN) {
          bestXI.push({
            playerId: row.player_uid,
            name: fixMojibake(row.player_name),
            nationality: row.nationality,
            bucket,
            appearances: row.appearances,
            goals: row.goals,
            assists: row.assists,
            minutes: row.minutes,
            score: parseFloat(row.performance_score) || 0,
          });
        }
      }
    }
  } else {
    // Apps or Goals objective — query player_season_stats
    const metric = objective === 'goals' ? 'goals' : 'appearances';

    for (const [bucket, count] of Object.entries(bucketCounts)) {
      const buildBucketQuery = () => {
        let q = supabase
          .from('v_all_player_season_stats')
          .select('player_uid, appearances, goals, assists, minutes')
          .eq('competition_id', competitionId)
          .eq('position_bucket', bucket)
          .gt('appearances', 0);
        if (scope.type === 'club' && scope.clubId) {
          q = q.eq('club_id', scope.clubId);
        }
        return q;
      };

      let stats;
      try {
        stats = await fetchAll(buildBucketQuery);
      } catch (err) {
        console.error(`[computeBestXI] fetchAll error for ${bucket}:`, err);
        continue;
      }
      if (!stats) continue;

      // Aggregate by player
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

      // Apply min threshold (wonders have no min)
      const minApps = scope.type === 'wonder' ? 0 : (scope.type === 'club' ? MIN_APPS_CLUB : MIN_APPS_LEAGUE);
      let eligible = Array.from(aggMap.values()).filter(p => p.appearances >= minApps);

      // Apply wonder filters
      if (scope.type === 'wonder') {
        if (scope.wonderType === 'match') eligible = eligible.filter(p => p.appearances === 1);
        else if (scope.wonderType === 'goal') eligible = eligible.filter(p => p.goals === 1);
      }

      // Fetch player names for ALL eligible (needed for alphabetical tiebreak + nationality filter)
      const allUids = eligible.map(p => p.player_uid);
      const nameMap = new Map();
      const batchSize = 500;
      for (let i = 0; i < allUids.length; i += batchSize) {
        const batch = allUids.slice(i, i + batchSize);
        const { data: players } = await supabase
          .from('players')
          .select('player_uid, player_name, nationality_norm')
          .in('player_uid', batch);
        if (players) {
          for (const p of players) nameMap.set(p.player_uid, p);
        }
      }

      // Apply nationality filter
      if (scope.type === 'nationality' && scope.nationalityCode) {
        const natCode = scope.nationalityCode.toUpperCase();
        eligible = eligible.filter(p => {
          const player = nameMap.get(p.player_uid);
          return player && (player.nationality_norm || '').toUpperCase() === natCode;
        });
      }

      // Attach names to eligible players
      eligible.forEach(agg => {
        const p = nameMap.get(agg.player_uid);
        agg.name = p ? fixMojibake(p.player_name) : 'Unknown';
      });

      // Sort by objective metric, then tiebreakers (including alphabetical name)
      eligible.sort((a, b) => {
        const diff = (b[metric] || 0) - (a[metric] || 0);
        if (diff !== 0) return diff;
        const appsDiff = b.appearances - a.appearances;
        if (appsDiff !== 0) return appsDiff;
        const minsDiff = b.minutes - a.minutes;
        if (minsDiff !== 0) return minsDiff;
        return (a.name || '').localeCompare(b.name || '');
      });

      const topN = eligible.slice(0, count);

      for (const agg of topN) {
        const player = nameMap.get(agg.player_uid);
        bestXI.push({
          playerId: agg.player_uid,
          name: agg.name,
          nationality: player ? (player.nationality_norm || '').toUpperCase() : '',
          bucket,
          appearances: agg.appearances,
          goals: agg.goals,
          assists: agg.assists,
          minutes: agg.minutes,
          score: agg[metric] || 0,
        });
      }
    }
  }

  // Map best XI into formation slots
  const slotAssignments = [];
  const usedByBucket = {};

  for (const slot of formationDef.slots) {
    if (!usedByBucket[slot.bucket]) usedByBucket[slot.bucket] = 0;

    const bucketPlayers = bestXI.filter(p => p.bucket === slot.bucket);
    const idx = usedByBucket[slot.bucket];
    const player = bucketPlayers[idx] || null;

    slotAssignments.push({
      slotIdx: slot.idx,
      role: slot.role,
      label: slot.label,
      bucket: slot.bucket,
      row: slot.row,
      player: player ? {
        playerId: player.playerId,
        name: player.name,
        nationality: player.nationality,
        appearances: player.appearances,
        goals: player.goals,
        assists: player.assists,
        minutes: player.minutes,
        score: player.score,
      } : null,
    });

    usedByBucket[slot.bucket]++;
  }

  return slotAssignments;
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

    console.log('[xi_start] Action:', action);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return respond(500, { error: 'Missing Supabase config' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ============================================================
    // GET SCOPES — return available scopes and formations
    // ============================================================
    if (action === 'get_scopes') {
      return respond(200, {
        scopes: SCOPES.map(s => ({ id: s.id, label: s.label, type: s.type, category: s.category || 'clubs', visibleObjectives: s.visibleObjectives || null, nationalityCode: s.nationalityCode || null, wonderType: s.wonderType || null })),
        formations: Object.entries(FORMATIONS).map(([key, val]) => ({
          id: key,
          label: val.label,
          slots: val.slots,
        })),
        objectives: [
          { id: 'appearances', label: 'Appearances', description: 'The players with the most Premier League appearances in that position.' },
          { id: 'goals', label: 'Goals', description: 'The players with the most Premier League goals in that position.' },
          { id: 'performance', label: 'Performance', description: 'Computed score based on goals, assists, defensive actions and GK stats, weighted by position and adjusted for volume.' },
        ],
      });
    }

    // ============================================================
    // SEARCH PLAYERS — autocomplete suggestions for a slot
    // ============================================================
    if (action === 'search_players') {
      const { query, positionBucket, scopeId } = body;

      if (!query || !positionBucket || !scopeId) {
        return respond(400, { error: 'Missing query, positionBucket, or scopeId' });
      }

      const scopeDef = SCOPES.find(s => s.id === scopeId);
      if (!scopeDef) {
        return respond(400, { error: `Unknown scope: ${scopeId}` });
      }

      const competitionId = await getEplCompId(supabase);
      if (!competitionId) {
        return respond(500, { error: 'Premier League competition not found' });
      }

      // Resolve club_id — use direct clubId if available, else name lookup
      const scope = { ...scopeDef };
      if (scope.type === 'club') {
        if (!scope.clubId && scope.clubName) {
          scope.clubId = await getClubId(supabase, scope.clubName);
        }
        if (!scope.clubId) {
          return respond(400, { error: `Club not found: ${scope.clubName}` });
        }
      }

      const results = await searchPlayers(supabase, query, positionBucket, scope, competitionId);
      return respond(200, { players: results });
    }

    // ============================================================
    // COMPUTE BEST XI — called when user submits their picks
    // Returns the best XI for comparison
    // ============================================================
    if (action === 'get_best_xi') {
      const { scopeId, formation, objective } = body;

      if (!scopeId || !formation || !objective) {
        return respond(400, { error: 'Missing scopeId, formation, or objective' });
      }

      const scopeDef = SCOPES.find(s => s.id === scopeId);
      if (!scopeDef) {
        return respond(400, { error: `Unknown scope: ${scopeId}` });
      }

      if (!FORMATIONS[formation]) {
        return respond(400, { error: `Unknown formation: ${formation}` });
      }

      // Resolve club_id — use direct clubId if available, else name lookup
      const scope = { ...scopeDef };
      if (scope.type === 'club' && !scope.clubId && scope.clubName) {
        scope.clubId = await getClubId(supabase, scope.clubName);
      }

      const bestXI = await computeBestXI(supabase, scope, formation, objective);

      return respond(200, {
        bestXI,
        scope: { id: scope.id, label: scope.label, type: scope.type },
        formation,
        objective,
      });
    }

    return respond(400, { error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('[xi_start] Error:', err);
    return respond(500, { error: err.message, stack: err.stack });
  }
};
