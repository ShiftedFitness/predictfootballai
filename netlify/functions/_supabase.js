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
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-secret, Authorization'
    },
    body: JSON.stringify(typeof body === 'string' ? { error: body } : body)
  };
}

/**
 * Validate admin access via ADMIN_SECRET header or Supabase JWT.
 *
 * Checks (in order):
 *   1. x-admin-secret header matches ADMIN_SECRET env var → OK
 *   2. Authorization: Bearer <jwt> → verify JWT, look up predict_users.is_admin
 *
 * Returns null if valid, or an error response if invalid.
 */
async function requireAdmin(event) {
  // 1. Legacy: x-admin-secret header
  const secret = (
    event.headers['x-admin-secret'] ||
    event.headers['X-Admin-Secret'] ||
    ''
  ).trim();
  const expected = (process.env.ADMIN_SECRET || '').trim();
  if (expected && secret === expected) {
    return null; // OK — legacy secret matches
  }

  // 2. Supabase JWT in Authorization header
  const authHeader = (event.headers['authorization'] || event.headers['Authorization'] || '').trim();
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const supabase = sb();
      // Verify the JWT and get the user
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) {
        return respond(401, 'Unauthorised – invalid token');
      }
      // Look up predict_users to check is_admin
      const email = user.email;
      if (!email) return respond(401, 'Unauthorised – no email in token');

      // Normalise gmail/googlemail variants
      const variants = [email];
      if (email.endsWith('@googlemail.com')) {
        variants.push(email.replace('@googlemail.com', '@gmail.com'));
      } else if (email.endsWith('@gmail.com')) {
        variants.push(email.replace('@gmail.com', '@googlemail.com'));
      }

      const { data: row } = await supabase
        .from('predict_users')
        .select('id, is_admin')
        .in('email', variants)
        .maybeSingle();

      if (row && row.is_admin) {
        return null; // OK — verified admin via Supabase JWT
      }
      return respond(403, 'Forbidden – user is not an admin');
    } catch (e) {
      console.error('JWT admin check failed:', e.message);
      return respond(401, 'Unauthorised – token verification failed');
    }
  }

  return respond(401, 'Unauthorised – missing credentials');
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
