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

const CLUB_NAME_ALIASES = {
  'Manchester United': ['Manchester Utd', 'Man United', 'Man Utd'],
  'Manchester City': ['Man City'],
  'Newcastle United': ['Newcastle Utd', 'Newcastle'],
  'Tottenham Hotspur': ['Tottenham', 'Spurs'],
  'West Ham United': ['West Ham'],
  'West Bromwich Albion': ['West Brom'],
  'Sheffield United': ['Sheffield Utd', 'Sheff Utd'],
  'Sheffield Wednesday': ['Sheffield Weds', 'Sheff Wed'],
  'Wolverhampton Wanderers': ['Wolves'],
  'Brighton & Hove Albion': ['Brighton'],
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
  'Nottingham Forest': ['Nottm Forest'],
  'Queens Park Rangers': ['QPR'],
  'Stoke City': ['Stoke'],
  'Swansea City': ['Swansea'],
  'Wigan Athletic': ['Wigan'],
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

async function fetchAll(queryBuilder) {
  const PAGE = 1000;
  let all = [], offset = 0;
  while (true) {
    const { data, error } = await queryBuilder.range(offset, offset + PAGE - 1);
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

      let query = supabase
        .from('player_season_stats')
        .select('player_name, appearances')
        .eq('competition_id', 7);

      if (clubId) {
        query = query.eq('club_id', clubId);
      }

      const rows = await fetchAll(query);

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
