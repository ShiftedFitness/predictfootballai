/**
 * hol_start.js — Higher or Lower game backend
 *
 * Endpoints (via `action` field in POST body):
 *   get_scopes     → Returns available scopes (clubs)
 *   get_players    → Returns shuffled list of players for a scope + stat type
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

function respond(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

const SCOPES = [
  { id: 'epl_alltime', label: 'Premier League (All-time)', type: 'league', clubName: null },
  { id: 'club_liverpool',   label: 'Liverpool',      type: 'club', clubName: 'Liverpool' },
  { id: 'club_arsenal',     label: 'Arsenal',        type: 'club', clubName: 'Arsenal' },
  { id: 'club_chelsea',     label: 'Chelsea',        type: 'club', clubName: 'Chelsea' },
  { id: 'club_manutd',      label: 'Man Utd',        type: 'club', clubName: 'Manchester United' },
  { id: 'club_sunderland',  label: 'Sunderland',     type: 'club', clubName: 'Sunderland' },
];

const CLUB_NAME_ALIASES = {
  'Manchester United': ['Manchester Utd', 'Man United', 'Man Utd'],
};

async function getClubId(supabase, clubName) {
  let { data } = await supabase
    .from('clubs')
    .select('club_id')
    .eq('club_name', clubName)
    .single();
  if (data) return data.club_id;

  ({ data } = await supabase
    .from('clubs')
    .select('club_id')
    .ilike('club_name', clubName)
    .limit(1));
  if (data && data.length > 0) return data[0].club_id;

  const aliases = CLUB_NAME_ALIASES[clubName] || [];
  for (const alias of aliases) {
    ({ data } = await supabase
      .from('clubs')
      .select('club_id')
      .ilike('club_name', alias)
      .limit(1));
    if (data && data.length > 0) return data[0].club_id;
  }
  return null;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

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

async function fetchAll(queryFn) {
  const PAGE = 1000;
  let all = [], offset = 0;
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

async function fetchPlayerNames(supabase, uids) {
  const nameMap = new Map();
  const batchSize = 200;
  for (let i = 0; i < uids.length; i += batchSize) {
    const batch = uids.slice(i, i + batchSize);
    const { data: players } = await supabase
      .from('players')
      .select('player_uid, player_name')
      .in('player_uid', batch);
    if (players) {
      for (const p of players) {
        nameMap.set(p.player_uid, fixMojibake(p.player_name));
      }
    }
  }
  return nameMap;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return respond(400, { error: 'Bad JSON' }); }

  const { action } = body;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  if (action === 'get_scopes') {
    return respond(200, {
      scopes: SCOPES.map(s => ({ id: s.id, label: s.label, type: s.type })),
    });
  }

  if (action === 'get_players') {
    const { scopeId, statType } = body; // statType: 'appearances' or 'goals'
    if (!scopeId || !statType) return respond(400, { error: 'Missing scopeId or statType' });

    const scope = SCOPES.find(s => s.id === scopeId);
    if (!scope) return respond(400, { error: 'Unknown scope' });

    try {
      let clubId = null;
      if (scope.type === 'club') {
        clubId = await getClubId(supabase, scope.clubName);
        if (!clubId) return respond(400, { error: `Club not found: ${scope.clubName}` });
      }

      // Query player_season_stats by player_uid (player_name is in players table)
      const buildQuery = () => {
        let q = supabase
          .from('player_season_stats')
          .select('player_uid, appearances, goals')
          .eq('competition_id', 7);
        if (clubId) q = q.eq('club_id', clubId);
        return q;
      };

      const rows = await fetchAll(buildQuery);

      // Aggregate per player_uid
      const playerMap = {};
      for (const row of rows) {
        const uid = row.player_uid;
        if (!uid) continue;
        if (!playerMap[uid]) {
          playerMap[uid] = { uid, appearances: 0, goals: 0 };
        }
        playerMap[uid].appearances += row.appearances || 0;
        playerMap[uid].goals += row.goals || 0;
      }

      // Filter: min 5 apps for club, 20 for league
      const minApps = scope.type === 'club' ? 5 : 20;
      let players = Object.values(playerMap).filter(p => p.appearances >= minApps);
      if (statType === 'goals') {
        players = players.filter(p => p.goals >= 1);
      }

      // Sort by stat descending
      players.sort((a, b) => b[statType] - a[statType]);

      // Take top 100, then shuffle
      const pool = players.slice(0, Math.min(100, players.length));
      shuffle(pool);

      // Fetch player names from players table
      const uids = pool.map(p => p.uid);
      const nameMap = await fetchPlayerNames(supabase, uids);

      return respond(200, {
        players: pool.map(p => ({
          name: nameMap.get(p.uid) || 'Unknown',
          appearances: p.appearances,
          goals: p.goals,
        })).filter(p => p.name !== 'Unknown'),
      });
    } catch (err) {
      console.error('HoL get_players error:', err);
      return respond(500, { error: 'Failed to load players: ' + (err.message || err) });
    }
  }

  return respond(400, { error: 'Unknown action' });
};
