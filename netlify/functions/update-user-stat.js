/**
 * update-user-stat.js — Increment a numeric stat on ts_users
 *
 * Uses the service-role key to bypass RLS.
 *
 * POST body: { userId, field, increment }
 *   - userId:    ts_users.id
 *   - field:     Column name to increment (whitelist: games_created)
 *   - increment: Amount to add (default: 1)
 *
 * Returns: { success: true } or { error: string }
 */

const { sb, respond, handleOptions } = require('./_supabase');

// Only allow safe fields to be incremented
const ALLOWED_FIELDS = ['games_created'];

exports.handler = async (event) => {
  const cors = handleOptions(event);
  if (cors) return cors;

  if (event.httpMethod !== 'POST') return respond(405, 'POST only');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, 'Invalid JSON');
  }

  const { userId, field, increment = 1 } = body;
  if (!userId || !field) return respond(400, 'Missing userId or field');
  if (!ALLOWED_FIELDS.includes(field)) return respond(400, 'Field not allowed: ' + field);

  const client = sb();

  // Get current value
  const { data: user } = await client
    .from('ts_users')
    .select(field)
    .eq('id', userId)
    .maybeSingle();

  if (!user) return respond(404, 'User not found');

  const newValue = (user[field] || 0) + increment;
  const { error } = await client
    .from('ts_users')
    .update({ [field]: newValue })
    .eq('id', userId);

  if (error) {
    console.error('[update-user-stat] Update failed:', error.message);
    return respond(500, error.message);
  }

  return respond(200, { success: true, [field]: newValue });
};
