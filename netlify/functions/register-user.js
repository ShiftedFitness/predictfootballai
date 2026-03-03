/**
 * register-user.js — Create or migrate a ts_users row after Supabase auth signup
 *
 * Uses the service-role key to bypass RLS.
 *
 * POST body: { authId, email, username, anonId? }
 *   - authId:   Supabase auth user UUID
 *   - email:    User's email
 *   - username: Chosen display name
 *   - anonId:   (optional) Existing anonymous ts_users.id to migrate
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

  const { authId, email, username, anonId } = body;
  if (!authId || !email) return respond(400, 'Missing authId or email');

  const client = sb();

  // 1. Check if ts_users row already exists for this auth_id
  const { data: existing } = await client
    .from('ts_users')
    .select('*')
    .eq('auth_id', authId)
    .maybeSingle();

  if (existing) {
    return respond(200, { user: existing });
  }

  // 2. If anonId provided, try to migrate that anonymous row
  if (anonId) {
    const { data: anonRow } = await client
      .from('ts_users')
      .select('id, auth_id')
      .eq('id', anonId)
      .maybeSingle();

    if (anonRow && !anonRow.auth_id) {
      // Migrate anonymous user to authenticated
      const { data: migrated, error: migrateErr } = await client
        .from('ts_users')
        .update({
          auth_id: authId,
          email: email,
          username: username || null,
          tier: 'free'
        })
        .eq('id', anonId)
        .select('*')
        .single();

      if (!migrateErr && migrated) {
        // Generate referral code if not present
        if (!migrated.referral_code) {
          const refCode = generateReferralCode(username || email);
          await client
            .from('ts_users')
            .update({ referral_code: refCode })
            .eq('id', migrated.id);
          migrated.referral_code = refCode;
        }
        return respond(200, { user: migrated, migrated: true });
      }
      // If migration failed, fall through to create new row
      console.warn('[register-user] Migration failed:', migrateErr?.message);
    }
  }

  // 3. Create a brand new ts_users row
  const refCode = generateReferralCode(username || email);
  const { data: newUser, error: insertErr } = await client
    .from('ts_users')
    .insert({
      auth_id: authId,
      email: email,
      username: username || null,
      tier: 'free',
      referral_code: refCode,
    })
    .select('*')
    .single();

  if (insertErr) {
    console.error('[register-user] Insert failed:', insertErr.message);
    return respond(500, insertErr.message);
  }

  return respond(200, { user: newUser, created: true });
};

/**
 * Generate a short referral code from a name/email
 */
function generateReferralCode(base) {
  const prefix = (base || 'TS')
    .replace(/@.*/, '')          // strip email domain
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 6)
    .toUpperCase();
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return prefix + suffix;
}
