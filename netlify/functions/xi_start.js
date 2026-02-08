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
      { idx: 1, role: 'LB',  bucket: 'DEF', label: 'LB',  row: 1 },
      { idx: 2, role: 'CB',  bucket: 'DEF', label: 'CB',  row: 1 },
      { idx: 3, role: 'CB',  bucket: 'DEF', label: 'CB',  row: 1 },
      { idx: 4, role: 'RB',  bucket: 'DEF', label: 'RB',  row: 1 },
      { idx: 5, role: 'LM',  bucket: 'MID', label: 'LM',  row: 2 },
      { idx: 6, role: 'CM',  bucket: 'MID', label: 'CM',  row: 2 },
      { idx: 7, role: 'CM',  bucket: 'MID', label: 'CM',  row: 2 },
      { idx: 8, role: 'RM',  bucket: 'MID', label: 'RM',  row: 2 },
      { idx: 9, role: 'ST',  bucket: 'FWD', label: 'ST',  row: 3 },
      { idx: 10, role: 'ST', bucket: 'FWD', label: 'ST',  row: 3 },
    ],
  },
  '4-3-3': {
    label: '4-3-3',
    slots: [
      { idx: 0, role: 'GK',  bucket: 'GK',  label: 'GK',  row: 0 },
      { idx: 1, role: 'LB',  bucket: 'DEF', label: 'LB',  row: 1 },
      { idx: 2, role: 'CB',  bucket: 'DEF', label: 'CB',  row: 1 },
      { idx: 3, role: 'CB',  bucket: 'DEF', label: 'CB',  row: 1 },
      { idx: 4, role: 'RB',  bucket: 'DEF', label: 'RB',  row: 1 },
      { idx: 5, role: 'CM',  bucket: 'MID', label: 'CM',  row: 2 },
      { idx: 6, role: 'CM',  bucket: 'MID', label: 'CM',  row: 2 },
      { idx: 7, role: 'CM',  bucket: 'MID', label: 'CM',  row: 2 },
      { idx: 8, role: 'LW',  bucket: 'FWD', label: 'LW',  row: 3 },
      { idx: 9, role: 'ST',  bucket: 'FWD', label: 'ST',  row: 3 },
      { idx: 10, role: 'RW', bucket: 'FWD', label: 'RW',  row: 3 },
    ],
  },
  '4-2-3-1': {
    label: '4-2-3-1',
    slots: [
      { idx: 0, role: 'GK',   bucket: 'GK',  label: 'GK',   row: 0 },
      { idx: 1, role: 'LB',   bucket: 'DEF', label: 'LB',   row: 1 },
      { idx: 2, role: 'CB',   bucket: 'DEF', label: 'CB',   row: 1 },
      { idx: 3, role: 'CB',   bucket: 'DEF', label: 'CB',   row: 1 },
      { idx: 4, role: 'RB',   bucket: 'DEF', label: 'RB',   row: 1 },
      { idx: 5, role: 'CDM',  bucket: 'MID', label: 'CDM',  row: 2 },
      { idx: 6, role: 'CDM',  bucket: 'MID', label: 'CDM',  row: 2 },
      { idx: 7, role: 'LAM',  bucket: 'MID', label: 'LAM',  row: 3 },
      { idx: 8, role: 'CAM',  bucket: 'MID', label: 'CAM',  row: 3 },
      { idx: 9, role: 'RAM',  bucket: 'MID', label: 'RAM',  row: 3 },
      { idx: 10, role: 'ST',  bucket: 'FWD', label: 'ST',   row: 4 },
    ],
  },
  '3-5-2': {
    label: '3-5-2',
    slots: [
      { idx: 0, role: 'GK',   bucket: 'GK',  label: 'GK',  row: 0 },
      { idx: 1, role: 'CB',   bucket: 'DEF', label: 'CB',  row: 1 },
      { idx: 2, role: 'CB',   bucket: 'DEF', label: 'CB',  row: 1 },
      { idx: 3, role: 'CB',   bucket: 'DEF', label: 'CB',  row: 1 },
      { idx: 4, role: 'LWB',  bucket: 'MID', label: 'LWB', row: 2 },
      { idx: 5, role: 'CM',   bucket: 'MID', label: 'CM',  row: 2 },
      { idx: 6, role: 'CM',   bucket: 'MID', label: 'CM',  row: 2 },
      { idx: 7, role: 'CM',   bucket: 'MID', label: 'CM',  row: 2 },
      { idx: 8, role: 'RWB',  bucket: 'MID', label: 'RWB', row: 2 },
      { idx: 9, role: 'ST',   bucket: 'FWD', label: 'ST',  row: 3 },
      { idx: 10, role: 'ST',  bucket: 'FWD', label: 'ST',  row: 3 },
    ],
  },
  '3-4-3': {
    label: '3-4-3',
    slots: [
      { idx: 0, role: 'GK',   bucket: 'GK',  label: 'GK',  row: 0 },
      { idx: 1, role: 'CB',   bucket: 'DEF', label: 'CB',  row: 1 },
      { idx: 2, role: 'CB',   bucket: 'DEF', label: 'CB',  row: 1 },
      { idx: 3, role: 'CB',   bucket: 'DEF', label: 'CB',  row: 1 },
      { idx: 4, role: 'LM',   bucket: 'MID', label: 'LM',  row: 2 },
      { idx: 5, role: 'CM',   bucket: 'MID', label: 'CM',  row: 2 },
      { idx: 6, role: 'CM',   bucket: 'MID', label: 'CM',  row: 2 },
      { idx: 7, role: 'RM',   bucket: 'MID', label: 'RM',  row: 2 },
      { idx: 8, role: 'LW',   bucket: 'FWD', label: 'LW',  row: 3 },
      { idx: 9, role: 'ST',   bucket: 'FWD', label: 'ST',  row: 3 },
      { idx: 10, role: 'RW',  bucket: 'FWD', label: 'RW',  row: 3 },
    ],
  },
};

// Supported scopes
const SCOPES = [
  { id: 'epl_alltime', label: 'Premier League (All-time)', type: 'league', clubName: null },
  { id: 'club_sunderland', label: 'Sunderland', type: 'club', clubName: 'Sunderland' },
  { id: 'club_manutd', label: 'Manchester United', type: 'club', clubName: 'Manchester United' },
  { id: 'club_arsenal', label: 'Arsenal', type: 'club', clubName: 'Arsenal' },
  { id: 'club_liverpool', label: 'Liverpool', type: 'club', clubName: 'Liverpool' },
  { id: 'club_chelsea', label: 'Chelsea', type: 'club', clubName: 'Chelsea' },
];

// Min appearance thresholds
const MIN_APPS_LEAGUE = 40;
const MIN_APPS_CLUB = 20;

// ============================================================
// DATA FETCHING
// ============================================================

/**
 * Get club_id for a club name
 */
async function getClubId(supabase, clubName) {
  const { data, error } = await supabase
    .from('clubs')
    .select('club_id')
    .eq('club_name', clubName)
    .single();
  if (error || !data) return null;
  return data.club_id;
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

  let dbQuery = supabase
    .from('player_season_stats')
    .select('player_uid, appearances, goals, assists, minutes')
    .eq('competition_id', competitionId)
    .eq('position_bucket', positionBucket)
    .gt('appearances', 0);

  if (scope.type === 'club' && scope.clubId) {
    dbQuery = dbQuery.eq('club_id', scope.clubId);
  }

  const { data: stats, error } = await dbQuery;
  if (error || !stats || stats.length === 0) return [];

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

  // Apply min threshold
  const minApps = scope.type === 'club' ? MIN_APPS_CLUB : MIN_APPS_LEAGUE;
  const eligible = Array.from(aggMap.values()).filter(p => p.appearances >= minApps);

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

  // Filter by name match and format results
  const results = [];
  for (const agg of eligible) {
    const player = playerNames.get(agg.player_uid);
    if (!player) continue;

    const displayName = fixMojibake(player.player_name);
    const normalizedName = normalize(player.player_name);

    if (!normalizedName.includes(normalizedQuery)) continue;

    results.push({
      playerId: agg.player_uid,
      name: displayName,
      normalized: normalizedName,
      nationality: (player.nationality_norm || '').toUpperCase(),
      appearances: agg.appearances,
      goals: agg.goals,
      assists: agg.assists,
      minutes: agg.minutes,
    });
  }

  // Sort: exact start match first, then by appearances desc
  results.sort((a, b) => {
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
      let query = supabase
        .from('player_performance_scores')
        .select('player_uid, player_name, nationality, appearances, goals, assists, minutes, performance_score')
        .eq('position_bucket', bucket)
        .eq('scope_type', scope.type);

      if (scope.type === 'club' && scope.clubId) {
        query = query.eq('scope_id', scope.clubId);
      } else {
        query = query.is('scope_id', null);
      }

      query = query
        .order('performance_score', { ascending: false })
        .order('appearances', { ascending: false })
        .order('minutes', { ascending: false })
        .order('player_name', { ascending: true })
        .limit(count);

      const { data, error } = await query;
      if (error) {
        console.error(`[computeBestXI] Error fetching ${bucket}:`, error);
        continue;
      }

      if (data) {
        for (const row of data) {
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
      let query = supabase
        .from('player_season_stats')
        .select('player_uid, appearances, goals, assists, minutes')
        .eq('competition_id', competitionId)
        .eq('position_bucket', bucket)
        .gt('appearances', 0);

      if (scope.type === 'club' && scope.clubId) {
        query = query.eq('club_id', scope.clubId);
      }

      const { data: stats, error } = await query;
      if (error || !stats) continue;

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

      // Apply min threshold
      const minApps = scope.type === 'club' ? MIN_APPS_CLUB : MIN_APPS_LEAGUE;
      let eligible = Array.from(aggMap.values()).filter(p => p.appearances >= minApps);

      // Fetch player names for ALL eligible (needed for alphabetical tiebreak)
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
        scopes: SCOPES.map(s => ({ id: s.id, label: s.label, type: s.type })),
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

      // Resolve club_id if needed
      const scope = { ...scopeDef };
      if (scope.type === 'club' && scope.clubName) {
        scope.clubId = await getClubId(supabase, scope.clubName);
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

      // Resolve club_id
      const scope = { ...scopeDef };
      if (scope.type === 'club' && scope.clubName) {
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
