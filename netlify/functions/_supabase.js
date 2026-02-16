/**
 * _supabase.js — Supabase service-role client for Netlify Functions
 *
 * Replaces _adalo.js. All admin Netlify functions use this module to
 * read/write the predict_* tables via the Supabase service-role key
 * (which bypasses Row-Level Security).
 *
 * Environment variables required:
 *   SUPABASE_URL              – e.g. https://cifnegfabbcywcxhtpfn.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY – service-role secret (NOT the anon key)
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.Supabase_Service_Role;

let _sb = null;

/**
 * Returns a Supabase client using the service-role key.
 * Lazily initialised on first call.
 */
function sb() {
  if (!_sb) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error(
        '_supabase.js: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars'
      );
    }
    _sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return _sb;
}

/**
 * Standard JSON response helper.
 */
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-secret'
    },
    body: JSON.stringify(typeof body === 'string' ? { error: body } : body)
  };
}

/**
 * Validate admin secret from request headers.
 * Returns null if valid, or an error response if invalid.
 */
function requireAdmin(event) {
  const secret = (
    event.headers['x-admin-secret'] ||
    event.headers['X-Admin-Secret'] ||
    ''
  ).trim();
  const expected = (process.env.ADMIN_SECRET || '').trim();
  if (!expected || secret !== expected) {
    return respond(401, 'Unauthorised – invalid or missing x-admin-secret');
  }
  return null; // OK
}

/**
 * Handle CORS preflight.
 */
function handleOptions(event) {
  if (event.httpMethod === 'OPTIONS') {
    return respond(204, '');
  }
  return null;
}

module.exports = { sb, respond, requireAdmin, handleOptions };
