// netlify/functions/db-introspect.js
// Schema introspection utility - outputs actual column names for key tables

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

function respond(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(body, null, 2),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, { ok: true });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { error: 'Missing Supabase credentials' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const results = {};

  const tablesToInspect = [
    'players',
    'clubs',
    'competitions',
    'player_season_stats',
    'player_club_totals',
    'player_competition_totals',
    'player_club_competition_totals',
    'player_club_total_competition',
    'player_totals',
    'season_stats_staging'
  ];

  try {
    // Query information_schema for column info using RPC
    for (const tableName of tablesToInspect) {
      // Use a simple select with limit 1 to get column structure
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);

      if (error) {
        results[tableName] = {
          exists: false,
          error: error.message,
          code: error.code
        };
      } else {
        const sampleRow = data && data[0];
        results[tableName] = {
          exists: true,
          columns: sampleRow ? Object.keys(sampleRow) : [],
          sampleRow: sampleRow || null,
          rowCount: data ? data.length : 0
        };
      }
    }

    // Get sample data from key tables to understand structure
    // Players table - get nationality values
    try {
      const { data: playerSample } = await supabase
        .from('players')
        .select('*')
        .limit(5);
      results.players_sample = playerSample;
    } catch (e) {
      results.players_sample_error = e.message;
    }

    // Get competition values
    try {
      const { data: compSample } = await supabase
        .from('competitions')
        .select('*')
        .limit(20);
      results.competitions_sample = compSample;
    } catch (e) {
      results.competitions_sample_error = e.message;
    }

    // Get club samples
    try {
      const { data: clubSample } = await supabase
        .from('clubs')
        .select('*')
        .limit(10);
      results.clubs_sample = clubSample;
    } catch (e) {
      results.clubs_sample_error = e.message;
    }

    // Get player_club_totals sample to see structure
    try {
      const { data: pctSample } = await supabase
        .from('player_club_totals')
        .select('*')
        .limit(5);
      results.player_club_totals_sample = pctSample;
    } catch (e) {
      results.player_club_totals_sample_error = e.message;
    }

    // Get player_competition_totals sample
    try {
      const { data: pcompSample } = await supabase
        .from('player_competition_totals')
        .select('*')
        .limit(5);
      results.player_competition_totals_sample = pcompSample;
    } catch (e) {
      results.player_competition_totals_sample_error = e.message;
    }

    return respond(200, {
      success: true,
      timestamp: new Date().toISOString(),
      schema: results
    });

  } catch (err) {
    return respond(500, { error: err.message, stack: err.stack });
  }
};
