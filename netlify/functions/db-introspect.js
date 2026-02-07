// netlify/functions/db-introspect.js
// Introspection endpoint to verify Supabase schema structure
// Only runs in development/admin mode

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

  // Basic security - require admin token
  const qs = event.queryStringParameters || {};
  const adminToken = qs.token || '';
  const expectedToken = process.env.ADMIN_TOKEN || 'dev';

  if (adminToken !== expectedToken && process.env.NODE_ENV === 'production') {
    return respond(403, { error: 'Unauthorized' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { error: 'Missing Supabase credentials' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const results = {};

  try {
    // 1. Get list of all tables
    const { data: tables, error: tablesError } = await supabase
      .rpc('get_tables', {})
      .catch(() => ({ data: null, error: { message: 'RPC not available' } }));

    // Try information_schema instead if RPC fails
    const { data: schemaData, error: schemaError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .limit(50);

    // Get columns for key tables
    const tablesToInspect = [
      'players',
      'clubs',
      'competitions',
      'player_season_stats',
      'player_club_totals',
      'player_competition_totals',
      'player_club_totals_competition',
      'season_stats_staging'
    ];

    for (const tableName of tablesToInspect) {
      try {
        // Get columns via select with limit 0
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .limit(1);

        if (error) {
          results[tableName] = { exists: false, error: error.message };
        } else {
          const sampleRow = data && data[0];
          results[tableName] = {
            exists: true,
            columns: sampleRow ? Object.keys(sampleRow) : [],
            sample: sampleRow || null
          };
        }
      } catch (e) {
        results[tableName] = { exists: false, error: e.message };
      }
    }

    // 2. Get distinct competition values
    try {
      const { data: compData } = await supabase
        .from('player_season_stats')
        .select('competition')
        .limit(1000);

      if (compData) {
        const uniqueComps = [...new Set(compData.map(r => r.competition))].filter(Boolean);
        results.competition_values = uniqueComps;
      }
    } catch (e) {
      results.competition_values = { error: e.message };
    }

    // 3. Get distinct nationality values (sample)
    try {
      const { data: natData } = await supabase
        .from('players')
        .select('nationality')
        .limit(2000);

      if (natData) {
        const uniqueNats = [...new Set(natData.map(r => r.nationality))].filter(Boolean).sort();
        results.nationality_values = uniqueNats;
      }
    } catch (e) {
      results.nationality_values = { error: e.message };
    }

    // 4. Get distinct club values (sample)
    try {
      const { data: clubData } = await supabase
        .from('player_club_totals')
        .select('club, competition')
        .limit(5000);

      if (clubData) {
        // Group by competition
        const clubsByComp = {};
        for (const row of clubData) {
          const comp = row.competition || 'unknown';
          if (!clubsByComp[comp]) clubsByComp[comp] = new Set();
          clubsByComp[comp].add(row.club);
        }
        // Convert sets to sorted arrays
        for (const comp in clubsByComp) {
          clubsByComp[comp] = [...clubsByComp[comp]].sort();
        }
        results.clubs_by_competition = clubsByComp;
      }
    } catch (e) {
      results.clubs_by_competition = { error: e.message };
    }

    // 5. Count players per competition
    try {
      const { data: countData } = await supabase
        .from('player_competition_totals')
        .select('competition, player_id')
        .limit(10000);

      if (countData) {
        const countByComp = {};
        for (const row of countData) {
          const comp = row.competition || 'unknown';
          countByComp[comp] = (countByComp[comp] || 0) + 1;
        }
        results.player_count_by_competition = countByComp;
      }
    } catch (e) {
      results.player_count_by_competition = { error: e.message };
    }

    // 6. Check for position data
    try {
      const { data: posData } = await supabase
        .from('players')
        .select('*')
        .limit(1);

      if (posData && posData[0]) {
        const columns = Object.keys(posData[0]);
        results.player_position_columns = columns.filter(c =>
          c.toLowerCase().includes('position') ||
          c.toLowerCase().includes('pos') ||
          c.toLowerCase().includes('role')
        );
      }
    } catch (e) {
      results.player_position_columns = { error: e.message };
    }

    // 7. Check for age data
    try {
      const { data: ageData } = await supabase
        .from('player_season_stats')
        .select('*')
        .limit(1);

      if (ageData && ageData[0]) {
        const columns = Object.keys(ageData[0]);
        results.age_related_columns = columns.filter(c =>
          c.toLowerCase().includes('age') ||
          c.toLowerCase().includes('birth') ||
          c.toLowerCase().includes('u19') ||
          c.toLowerCase().includes('u21') ||
          c.toLowerCase().includes('35')
        );
      }
    } catch (e) {
      results.age_related_columns = { error: e.message };
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
