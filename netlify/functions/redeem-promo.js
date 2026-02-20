/**
 * redeem-promo.js — Validate and redeem a promo code
 *
 * POST body: { code: string, userId: number }
 *
 * On success: upgrades ts_users.tier to 'paid', records redemption.
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

  const normCode = code.toUpperCase().trim();
  const client = sb();

  // 1. Validate code exists
  const { data: promo, error: promoErr } = await client
    .from('ts_promo_codes')
    .select('*')
    .eq('code', normCode)
    .maybeSingle();

  if (promoErr) {
    console.error('Promo lookup error:', promoErr.message);
    return respond(500, 'Database error');
  }
  if (!promo) return respond(404, 'Invalid promo code');

  // 2. Check usage limits
  if (promo.current_uses >= promo.max_uses) {
    return respond(410, 'This code has been fully redeemed');
  }

  // 3. Check expiry
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return respond(410, 'This code has expired');
  }

  // 4. Check not already redeemed by this user
  const { data: existing } = await client
    .from('ts_promo_redemptions')
    .select('id')
    .eq('user_id', userId)
    .eq('code', normCode)
    .maybeSingle();

  if (existing) return respond(409, 'You have already redeemed this code');

  // 5. Check user exists and isn't already paid
  const { data: user } = await client
    .from('ts_users')
    .select('id, tier')
    .eq('id', userId)
    .maybeSingle();

  if (!user) return respond(404, 'User not found');
  if (user.tier === 'paid') return respond(409, 'You already have Pro access');

  // 6. Redeem: upgrade user, record redemption, increment counter
  const { error: updateErr } = await client
    .from('ts_users')
    .update({ tier: 'paid' })
    .eq('id', userId);

  if (updateErr) {
    console.error('User update error:', updateErr.message);
    return respond(500, 'Failed to upgrade account');
  }

  await client
    .from('ts_promo_redemptions')
    .insert({ user_id: userId, code: normCode });

  await client
    .from('ts_promo_codes')
    .update({ current_uses: promo.current_uses + 1 })
    .eq('id', promo.id);

  return respond(200, { success: true, tier: 'paid', message: 'Welcome to TeleStats Pro!' });
};
