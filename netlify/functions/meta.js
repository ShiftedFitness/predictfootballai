/**
 * meta.js — Returns ingestion metadata (last updated timestamps etc.)
 *
 * GET or POST → Returns { current_season_last_updated: "2025-02-15T10:30:00Z" }
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

function respond(code, body) {
  return {
    statusCode: code,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async () => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return respond(500, { error: 'Missing Supabase config' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data, error } = await supabase
      .from('ingestion_meta')
      .select('key, value, updated_at');

    if (error) {
      return respond(500, { error: error.message });
    }

    // Convert array to key-value object
    const meta = {};
    for (const row of (data || [])) {
      meta[row.key] = {
        value: row.value,
        updated_at: row.updated_at,
      };
    }

    return respond(200, meta);
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
