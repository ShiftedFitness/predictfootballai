/**
 * redeem-referral.js — Process a referral code redemption
 *
 * Uses the service-role key to bypass RLS (needs to update multiple users).
 *
 * POST body: { code, userId }
 *   - code:   Referral code to redeem
 *   - userId: Current user's ts_users.id
 *
 * Returns: { success: true } or { error: string }
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

  const { code, userId } = body;
  if (!code || !userId) return respond(400, 'Missing code or userId');

  const client = sb();

  // 1. Find referrer by code
  const { data: referrer } = await client
    .from('ts_users')
    .select('id, referral_count')
    .eq('referral_code', code)
    .maybeSingle();

  if (!referrer) return respond(404, 'Invalid referral code');
  if (referrer.id === userId) return respond(400, 'Cannot refer yourself');

  // 2. Check if user already has a referrer
  const { data: user } = await client
    .from('ts_users')
    .select('id, referred_by')
    .eq('id', userId)
    .maybeSingle();

  if (!user) return respond(404, 'User not found');
  if (user.referred_by) return respond(400, 'Already referred');

  // 3. Insert referral record
  const { error: refErr } = await client
    .from('ts_referrals')
    .insert({ referrer_id: referrer.id, referred_id: userId });

  if (refErr) {
    console.error('[redeem-referral] Insert referral failed:', refErr.message);
    return respond(500, refErr.message);
  }

  // 4. Update referred user
  await client.from('ts_users').update({ referred_by: referrer.id }).eq('id', userId);

  // 5. Increment referrer count
  const newCount = (referrer.referral_count || 0) + 1;
  const updates = { referral_count: newCount };
  if (newCount >= 5) updates.referral_unlocked = true;
  await client.from('ts_users').update(updates).eq('id', referrer.id);

  // 6. If referrer hit 5, also unlock the referred user
  if (newCount >= 5) {
    await client.from('ts_users').update({ referral_unlocked: true }).eq('id', userId);
  }

  console.log(`[redeem-referral] User ${userId} referred by ${referrer.id} (code: ${code}, count: ${newCount})`);
  return respond(200, { success: true, referrerCount: newCount });
};
