/**
 * ensure-anon-user.js — Create or verify an anonymous ts_users row
 *
 * Uses the service-role key to bypass RLS.
 *
 * POST body: { anonId? }
 *   - anonId: (optional) Existing anonymous ts_users.id to verify
 *
 * Returns: { user: ts_users row } or { error: string }
 */

const { sb, respond, handleOptions } = require('./_supabase');

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

  const { anonId } = body;
  const client = sb();

  // 1. If anonId provided, verify it still exists
  if (anonId) {
    const { data } = await client
      .from('ts_users')
      .select('id, tier, total_xp, level, level_name, current_streak, total_games_played, referral_code')
      .eq('id', anonId)
      .maybeSingle();

    if (data) {
      return respond(200, { user: { ...data, isAnonymous: true } });
    }
    // If not found, fall through to create new
  }

  // 2. Create new anonymous user
  const { data, error } = await client
    .from('ts_users')
    .insert({ tier: 'anonymous' })
    .select('id, tier, total_xp, level, level_name, current_streak, total_games_played, referral_code')
    .single();

  if (error) {
    console.error('[ensure-anon-user] Insert failed:', error.message);
    return respond(500, error.message);
  }

  return respond(200, { user: { ...data, isAnonymous: true }, created: true });
};
