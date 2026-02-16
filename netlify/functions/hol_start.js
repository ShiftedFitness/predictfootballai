/**
 * hol_start.js — Higher or Lower game backend
 *
 * Endpoints (via `action` field in POST body):
 *   get_scopes     → Returns available scopes (clubs) grouped by league
 *   get_players    → Returns shuffled list of players for a scope + stat type
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

function respond(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// ============================================================
// CLUB LISTS PER LEAGUE (mirrors match_start.js)
// ============================================================

const EPL_CLUBS = [
  'Arsenal', 'Aston Villa', 'Blackburn Rovers', 'Bolton Wanderers', 'Bournemouth',
  'Brentford', 'Brighton', 'Burnley', 'Charlton Athletic', 'Chelsea',
  'Coventry City', 'Crystal Palace', 'Derby County', 'Everton', 'Fulham',
  'Ipswich Town', 'Leeds United', 'Leicester City', 'Liverpool', 'Manchester City',
  'Manchester United', 'Middlesbrough', 'Newcastle United', 'Norwich City',
  'Nottingham Forest', 'Portsmouth', 'Queens Park Rangers', 'Reading',
  'Sheffield United', 'Sheffield Wednesday', 'Southampton', 'Stoke City',
  'Sunderland', 'Swansea City', 'Tottenham Hotspur', 'Watford',
  'West Bromwich Albion', 'West Ham United', 'Wigan Athletic', 'Wimbledon',
  'Wolverhampton Wanderers',
];

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

// ============================================================
// SCOPE DEFINITIONS
// ============================================================

const LEAGUES = [
  { key: 'epl', name: 'Premier League', competitionName: 'Premier League', clubs: EPL_CLUBS },
  { key: 'laliga', name: 'La Liga', competitionName: 'La Liga', clubs: LALIGA_CLUBS },
  { key: 'seriea', name: 'Serie A', competitionName: 'Serie A', clubs: SERIEA_CLUBS },
  { key: 'bundesliga', name: 'Bundesliga', competitionName: 'Bundesliga', clubs: BUNDESLIGA_CLUBS },
  { key: 'ligue1', name: 'Ligue 1', competitionName: 'Ligue 1', clubs: LIGUE1_CLUBS },
];

// Build scopes dynamically
function buildScopes() {
  const scopes = [];
  for (const league of LEAGUES) {
    // League-level overall scope
    scopes.push({
      id: `${league.key}_alltime`,
      label: `${league.name} (All-time)`,
      type: 'league',
      league: league.key,
      competitionName: league.competitionName,
      clubName: null,
    });
    // Club scopes
    for (const club of league.clubs) {
      const slug = club.toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .replace(/^the/, '');
      scopes.push({
        id: `${league.key}_club_${slug}`,
        label: club.replace('Wolverhampton Wanderers', 'Wolves')
          .replace('Tottenham Hotspur', 'Spurs')
          .replace('Manchester United', 'Man Utd')
          .replace('Manchester City', 'Man City')
          .replace('Newcastle United', 'Newcastle')
          .replace('West Bromwich Albion', 'West Brom')
          .replace('West Ham United', 'West Ham')
          .replace('Sheffield Wednesday', 'Sheff Wed')
          .replace('Sheffield United', 'Sheff Utd')
          .replace('Queens Park Rangers', 'QPR')
          .replace('Nottingham Forest', 'Nottm Forest')
          .replace('Brighton & Hove Albion', 'Brighton')
          .replace('Paris Saint-Germain', 'PSG')
          .replace('Eintracht Frankfurt', 'Frankfurt')
          .replace('Atlético Madrid', 'Atlético'),
        type: 'club',
        league: league.key,
        competitionName: league.competitionName,
        clubName: club,
      });
    }
  }
  return scopes;
}

const SCOPES = buildScopes();

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
  'Brighton & Hove Albion': ['Brighton', 'Brighton and Hove Albion'],
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
  'Paris Saint-Germain': ['PSG'],
  'Atlético Madrid': ['Atletico Madrid', 'Atletico'],
  'Dep La Coruña': ['Deportivo'],
  'Eintracht Frankfurt': ['Frankfurt'],
  'Hamburger SV': ['Hamburg', 'HSV'],
};

// ============================================================
// HELPERS
// ============================================================

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

  // Fuzzy match
  ({ data } = await supabase
    .from('clubs')
    .select('club_id')
    .ilike('club_name', `%${clubName}%`)
    .limit(1));
  if (data && data.length > 0) return data[0].club_id;

  return null;
}

// Cache competition IDs for the session
const compIdCache = new Map();
async function getCompetitionId(supabase, competitionName) {
  if (compIdCache.has(competitionName)) return compIdCache.get(competitionName);
  const { data } = await supabase
    .from('competitions')
    .select('competition_id')
    .eq('competition_name', competitionName)
    .single();
  const id = data ? data.competition_id : null;
  if (id) compIdCache.set(competitionName, id);
  return id;
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

// ============================================================
// HANDLER
// ============================================================

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body); } catch { return respond(400, { error: 'Bad JSON' }); }

  const { action } = body;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  if (action === 'get_scopes') {
    return respond(200, {
      leagues: LEAGUES.map(l => ({ key: l.key, name: l.name })),
      scopes: SCOPES.map(s => ({ id: s.id, label: s.label, type: s.type, league: s.league })),
    });
  }

  if (action === 'get_players') {
    const { scopeId, statType } = body;
    if (!scopeId || !statType) return respond(400, { error: 'Missing scopeId or statType' });

    const scope = SCOPES.find(s => s.id === scopeId);
    if (!scope) return respond(400, { error: 'Unknown scope' });

    try {
      // Look up competition_id
      const competitionId = await getCompetitionId(supabase, scope.competitionName);
      if (!competitionId) return respond(400, { error: `Competition not found: ${scope.competitionName}` });

      let clubId = null;
      if (scope.type === 'club') {
        clubId = await getClubId(supabase, scope.clubName);
        if (!clubId) return respond(400, { error: `Club not found: ${scope.clubName}` });
      }

      const buildQuery = () => {
        let q = supabase
          .from('v_all_player_season_stats')
          .select('player_uid, appearances, goals')
          .eq('competition_id', competitionId);
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
