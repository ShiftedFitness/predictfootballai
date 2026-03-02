/**
 * create-checkout.js — Create a Stripe Checkout session for Pro upgrade
 *
 * POST body: { userId: number }
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY  — Stripe secret key (sk_live_... or sk_test_...)
 *
 * Returns: { url: string } — Stripe Checkout redirect URL
 */

const { sb, respond, handleOptions } = require('./_supabase');

exports.handler = async (event) => {
  const cors = handleOptions(event);
  if (cors) return cors;

  if (event.httpMethod !== 'POST') return respond(405, 'POST only');

  // Validate Stripe key exists
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('Missing STRIPE_SECRET_KEY env var');
    return respond(500, 'Payment system not configured');
  }

  const stripe = require('stripe')(stripeKey);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, 'Invalid JSON');
  }

  const { userId } = body;
  if (!userId) return respond(400, 'Missing userId');

  const client = sb();

  // 1. Look up the user
  const { data: user, error: userErr } = await client
    .from('ts_users')
    .select('id, tier, email, username')
    .eq('id', userId)
    .maybeSingle();

  if (userErr || !user) return respond(404, 'User not found');
  if (user.tier === 'paid') return respond(409, 'Already a Pro member');
  if (!user.email) return respond(400, 'Email required for payment. Please sign up first.');

  // 2. Determine origin for redirect URLs
  const origin = event.headers.origin
    || event.headers.referer?.replace(/\/[^\/]*$/, '')
    || 'https://telestats.net';

  try {
    // 3. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: 'TeleStats Pro',
              description: 'Unlimited plays, all categories, community game creation — forever.',
              images: ['https://res.cloudinary.com/dbfvogb95/image/upload/v1770835428/Screenshot_2026-02-11_at_19.43.16_m7urul.png']
            },
            unit_amount: 499, // £4.99 in pence
          },
          quantity: 1,
        }
      ],
      metadata: {
        ts_user_id: String(userId),
        ts_email: user.email
      },
      success_url: `${origin}/upgrade/?payment=success`,
      cancel_url: `${origin}/upgrade/?payment=cancelled`,
    });

    return respond(200, { url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    return respond(500, 'Failed to create checkout session');
  }
};
