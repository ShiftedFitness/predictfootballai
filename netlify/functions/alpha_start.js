/**
 * alpha_start.js — Player Alphabet game backend
 *
 * Endpoints (via `action` field in POST body):
 *   get_scopes      → Returns available scopes (clubs)
 *   get_alphabet     → Returns available letters + player counts + players per letter
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
  let { data } = await supabase.from('clubs').select('club_id').eq('club_name', clubName).single();
  if (data) return data.club_id;
  ({ data } = await supabase.from('clubs').select('club_id').ilike('club_name', clubName).limit(1));
  if (data && data.length > 0) return data[0].club_id;
  const aliases = CLUB_NAME_ALIASES[clubName] || [];
  for (const alias of aliases) {
    ({ data } = await supabase.from('clubs').select('club_id').ilike('club_name', alias).limit(1));
    if (data && data.length > 0) return data[0].club_id;
  }
  return null;
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

/**
 * Get the surname (last word) from a player name
 */
function getSurname(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1];
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

  if (action === 'get_alphabet') {
    const { scopeId } = body;
    if (!scopeId) return respond(400, { error: 'Missing scopeId' });

    const scope = SCOPES.find(s => s.id === scopeId);
    if (!scope) return respond(400, { error: 'Unknown scope' });

    try {
      let clubId = null;
      if (scope.type === 'club') {
        clubId = await getClubId(supabase, scope.clubName);
        if (!clubId) return respond(400, { error: `Club not found: ${scope.clubName}` });
      }

      const buildQuery = () => {
        let q = supabase
          .from('player_season_stats')
          .select('player_name, appearances')
          .eq('competition_id', 7);
        if (clubId) q = q.eq('club_id', clubId);
        return q;
      };

      const rows = await fetchAll(buildQuery);

      // Aggregate by player
      const playerMap = {};
      for (const row of rows) {
        const name = row.player_name;
        if (!name) continue;
        if (!playerMap[name]) playerMap[name] = { name, apps: 0 };
        playerMap[name].apps += row.appearances || 0;
      }

      // Min apps filter
      const minApps = scope.type === 'club' ? 3 : 10;
      const allPlayers = Object.values(playerMap).filter(p => p.apps >= minApps);

      // Group by first letter of surname
      const alphabet = {};
      for (const p of allPlayers) {
        const surname = getSurname(p.name);
        const letter = surname.charAt(0).toUpperCase();
        if (letter < 'A' || letter > 'Z') continue;
        if (!alphabet[letter]) alphabet[letter] = [];
        alphabet[letter].push({ name: p.name, apps: p.apps });
      }

      // Sort each letter's players by apps descending
      for (const letter of Object.keys(alphabet)) {
        alphabet[letter].sort((a, b) => b.apps - a.apps);
      }

      // Build response: for each letter A-Z, return list or empty
      const letters = [];
      for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode(65 + i);
        const players = alphabet[letter] || [];
        letters.push({
          letter,
          count: players.length,
          players: players.map(p => p.name), // all valid player names for this letter
        });
      }

      return respond(200, { letters });
    } catch (err) {
      console.error('Alpha get_alphabet error:', err);
      return respond(500, { error: 'Failed to load alphabet' });
    }
  }

  return respond(400, { error: 'Unknown action' });
};
