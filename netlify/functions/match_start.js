// netlify/functions/match_start.js
// Supabase-backed match start API for Football 501
// Returns eligible players for a category (country or club filter)

const { createClient } = require('@supabase/supabase-js');

// Environment variables (Netlify)
const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

// Category definitions
const CATEGORIES = {
  // Country categories - filter by nationality code
  country_FRA: { type: 'country', code: 'FRA', name: 'France', flag: '🇫🇷' },
  country_ESP: { type: 'country', code: 'ESP', name: 'Spain', flag: '🇪🇸' },
  country_ARG: { type: 'country', code: 'ARG', name: 'Argentina', flag: '🇦🇷' },
  country_NED: { type: 'country', code: 'NED', name: 'Netherlands', flag: '🇳🇱' },
  country_POR: { type: 'country', code: 'POR', name: 'Portugal', flag: '🇵🇹' },

  // Club categories - filter by club name (use exact DB values)
  club_Arsenal: { type: 'club', club: 'Arsenal', name: 'Arsenal', flag: '🔴' },
  club_ManUtd: { type: 'club', club: 'Manchester United', name: 'Manchester United', flag: '🟥' },
  club_Liverpool: { type: 'club', club: 'Liverpool', name: 'Liverpool', flag: '🔴' },
  club_Leicester: { type: 'club', club: 'Leicester City', name: 'Leicester City', flag: '🦊' },
  club_Sunderland: { type: 'club', club: 'Sunderland', name: 'Sunderland', flag: '🔴⚪' },
};

// Hints for each category (non-spoiler)
const HINTS = {
  country_FRA: 'French players have been a staple of the Premier League since 1992. Some of the most decorated midfielders came from France.',
  country_ESP: 'Spanish flair has graced the EPL since the early 2000s, with peak representation in the 2010s.',
  country_ARG: 'Argentine players have a rich history in England, particularly in attack.',
  country_NED: 'Dutch players were among the earliest foreign imports to the Premier League.',
  country_POR: 'Portuguese players have made significant impacts, especially since 2003.',
  club_Arsenal: 'The Gunners have featured over 200 players in Premier League history.',
  club_ManUtd: 'Manchester United have the most Premier League titles and a vast player history.',
  club_Liverpool: 'Liverpool FC has seen many legendary players across all eras.',
  club_Leicester: 'From survival specialists to champions in 2016, Leicester have had a diverse squad.',
  club_Sunderland: 'The Black Cats have yo-yoed between divisions, giving chances to many players.',
};

// Trivia questions (2-4 per category, hardcoded for now)
const TRIVIA = {
  country_FRA: [
    { q: 'Which French player has the most Premier League appearances?', options: ['Patrice Evra', 'Thierry Henry', 'Sylvain Distin', 'N\'Golo Kanté'], answer: 2 },
    { q: 'How many French players have won the PL Golden Boot?', options: ['1', '2', '3', '4'], answer: 1 },
  ],
  country_ESP: [
    { q: 'Which Spanish player scored the first EPL goal for Spain?', options: ['Mikel Arteta', 'Albert Ferrer', 'Pepe Reina', 'Cesc Fàbregas'], answer: 1 },
    { q: 'What club has had the most Spanish players?', options: ['Arsenal', 'Chelsea', 'Man City', 'Liverpool'], answer: 2 },
  ],
  country_ARG: [
    { q: 'Which Argentine has the most EPL goals?', options: ['Carlos Tevez', 'Sergio Agüero', 'Pablo Zabaleta', 'Juan Pablo Ángel'], answer: 1 },
    { q: 'How many Argentine players have won the PL?', options: ['5', '10', '15', '20+'], answer: 3 },
  ],
  country_NED: [
    { q: 'Which Dutch player has the most EPL assists?', options: ['Dennis Bergkamp', 'Arjen Robben', 'Robin van Persie', 'Marc Overmars'], answer: 0 },
    { q: 'What year did the first Dutch player appear in EPL?', options: ['1992', '1993', '1994', '1995'], answer: 0 },
  ],
  country_POR: [
    { q: 'Which Portuguese player has the most EPL appearances?', options: ['José Fonte', 'Cristiano Ronaldo', 'Rui Patrício', 'Bernardo Silva'], answer: 0 },
    { q: 'How many Portuguese players have won PL Player of the Month?', options: ['3', '5', '7', '10+'], answer: 3 },
  ],
  club_Arsenal: [
    { q: 'Who has the most EPL appearances for Arsenal?', options: ['Tony Adams', 'David Seaman', 'Ray Parlour', 'Thierry Henry'], answer: 0 },
    { q: 'In what year did Arsenal go unbeaten?', options: ['2002', '2003', '2004', '2005'], answer: 2 },
  ],
  club_ManUtd: [
    { q: 'Who has the most Man Utd EPL appearances?', options: ['Ryan Giggs', 'Paul Scholes', 'Gary Neville', 'Wayne Rooney'], answer: 0 },
    { q: 'How many EPL titles has Man Utd won?', options: ['10', '13', '15', '20'], answer: 1 },
  ],
  club_Liverpool: [
    { q: 'Who has the most Liverpool EPL appearances?', options: ['Steven Gerrard', 'Jamie Carragher', 'Sami Hyypiä', 'Jordan Henderson'], answer: 1 },
    { q: 'What year did Liverpool win their first EPL title?', options: ['2019', '2020', '2021', '2022'], answer: 1 },
  ],
  club_Leicester: [
    { q: 'Who scored the most goals in Leicester\'s title season?', options: ['Riyad Mahrez', 'Jamie Vardy', 'Leonardo Ulloa', 'Shinji Okazaki'], answer: 1 },
    { q: 'How many points did Leicester get in 2015-16?', options: ['77', '81', '85', '87'], answer: 1 },
  ],
  club_Sunderland: [
    { q: 'Who has the most Sunderland EPL appearances?', options: ['John O\'Shea', 'Lee Cattermole', 'Wes Brown', 'Jermain Defoe'], answer: 0 },
    { q: 'How many EPL seasons did Sunderland have?', options: ['14', '16', '18', '20'], answer: 1 },
  ],
};

// Normalize player name for matching
function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.-]/g, '').trim();
}

// Build response JSON
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

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'POST only' });
  }

  try {
    // Parse request
    const body = JSON.parse(event.body || '{}');
    const { categoryId, metric = 'apps_total', datasetVersion = 'epl_v1' } = body;

    console.log('[match_start] Request:', { categoryId, metric, datasetVersion });

    if (!categoryId || !CATEGORIES[categoryId]) {
      return respond(400, { error: `Unknown categoryId: ${categoryId}. Available: ${Object.keys(CATEGORIES).join(', ')}` });
    }

    const category = CATEGORIES[categoryId];

    // Initialize Supabase client with service role (server-side only)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error('[match_start] Missing Supabase credentials');
      return respond(500, { error: 'Server configuration error' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let eligiblePlayers = [];

    if (category.type === 'country') {
      // Query player_competition_totals joined with players table
      // Filter by nationality and competition = 'EPL'
      console.log('[match_start] Fetching country data for:', category.code);

      const { data, error } = await supabase
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
            player_key,
            name,
            normalized_name,
            nationality
          )
        `)
        .eq('competition', 'EPL')
        .eq('players.nationality', category.code)
        .gt('apps_total', 0);

      if (error) {
        console.error('[match_start] Supabase error (country):', error);
        return respond(500, { error: error.message });
      }

      console.log('[match_start] Found', data?.length, 'records for country', category.code);

      eligiblePlayers = (data || []).map(row => ({
        playerId: row.player_id,
        name: row.players.name,
        normalized: row.players.normalized_name || normalize(row.players.name),
        nationality: row.players.nationality,
        subtractValue: row.apps_total,
        overlay: {
          apps: row.apps_total,
          goals: row.goals_total,
          mins: row.mins_total,
          starts: row.starts_total,
          club: null,
        },
      }));

    } else if (category.type === 'club') {
      // Query player_club_totals joined with players table
      // Filter by club and competition = 'EPL'
      console.log('[match_start] Fetching club data for:', category.club);

      const { data, error } = await supabase
        .from('player_club_totals')
        .select(`
          player_id,
          competition,
          club,
          apps_total,
          goals_total,
          mins_total,
          starts_total,
          players!inner (
            player_id,
            player_key,
            name,
            normalized_name,
            nationality
          )
        `)
        .eq('competition', 'EPL')
        .eq('club', category.club)
        .gt('apps_total', 0);

      if (error) {
        console.error('[match_start] Supabase error (club):', error);
        return respond(500, { error: error.message });
      }

      console.log('[match_start] Found', data?.length, 'records for club', category.club);

      eligiblePlayers = (data || []).map(row => ({
        playerId: row.player_id,
        name: row.players.name,
        normalized: row.players.normalized_name || normalize(row.players.name),
        nationality: row.players.nationality,
        subtractValue: row.apps_total,
        overlay: {
          apps: row.apps_total,
          goals: row.goals_total,
          mins: row.mins_total,
          starts: row.starts_total,
          club: row.club,
        },
      }));
    }

    // Filter out any with subtractValue <= 0
    eligiblePlayers = eligiblePlayers.filter(p => p.subtractValue > 0);

    // Sort by subtractValue descending (highest appearances first)
    eligiblePlayers.sort((a, b) => b.subtractValue - a.subtractValue);

    console.log('[match_start] Returning', eligiblePlayers.length, 'eligible players');

    return respond(200, {
      meta: {
        categoryId,
        categoryName: category.name,
        categoryFlag: category.flag,
        competition: 'EPL',
        metric: metric,
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
