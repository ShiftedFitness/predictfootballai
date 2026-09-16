/**
 * create-checkout.js — Create a Stripe Checkout session for Pro upgrade
 *
 * POST body: { userId: number, plan?: 'lifetime' | 'day_pass' }
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY  — Stripe secret key (sk_live_... or sk_test_...)
 *
 * Returns: { url: string } — Stripe Checkout redirect URL
 */

const { sb, respond, handleOptions } = require('./_supabase');

const PLANS = {
  lifetime: {
    name: 'TeleStats Pro',
    description: 'Unlimited plays, all categories, community game creation — forever.',
    amount: 499, // £4.99
  },
  day_pass: {
    name: 'TeleStats Day Pass',
    description: 'Unlimited plays and all categories for 24 hours.',
    amount: 99, // £0.99
  }
};

/**
 * A Day Pass comes off the price of Pro if you upgrade while it is still
 * running.
 *
 * The point is to remove the "which one do I buy?" hesitation, which makes
 * people buy neither. With the credit there is no wrong answer: the Day Pass
 * is a risk-free way in, and upgrading during it costs exactly what going
 * straight to Pro would have.
 *
 * WITHIN THE PASS'S OWN WINDOW, and no longer. The deadline is what makes it
 * a decision rather than an open-ended discount, so the credit is tied to
 * pro_expires_at — the same 24 hours the pass itself runs for.
 *
 * The credit is taken from a REAL RECORDED PAYMENT, never from the tier flag.
 * A day pass granted by hand, by a refund that has not settled, or by anything
 * other than money arriving must not discount anything.
 */
const CREDIT_PLAN = 'day_pass';
// Stripe will not process a GBP charge under 30p; the floor is here so an
// unexpected credit can never produce a session that fails at the till.
const MIN_CHARGE = 30;

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

  const { userId, plan: planKey = 'lifetime' } = body;
  if (!userId) return respond(400, 'Missing userId');

  const plan = PLANS[planKey];
  if (!plan) return respond(400, 'Invalid plan. Use "lifetime" or "day_pass".');

  const client = sb();

  // 1. Look up the user
  const { data: user, error: userErr } = await client
    .from('ts_users')
    .select('id, tier, email, username, pro_expires_at')
    .eq('id', userId)
    .maybeSingle();

  if (userErr || !user) return respond(404, 'User not found');
  if (!user.email) return respond(400, 'Email required for payment. Please sign up first.');

  // 2. Check existing tier
  const isLifetime = user.tier === 'paid' && !user.pro_expires_at;
  const hasActiveDayPass = user.tier === 'paid' && user.pro_expires_at && new Date(user.pro_expires_at) > new Date();

  if (isLifetime) return respond(409, 'Already a lifetime Pro member');
  if (hasActiveDayPass && planKey === 'day_pass') return respond(409, 'You already have an active Day Pass');
  // Allow day_pass → lifetime upgrade

  // 2b. Day Pass credit, if one is running and was actually paid for.
  let credit = 0;
  if (planKey === 'lifetime' && hasActiveDayPass) {
    const { data: paid } = await client
      .from('ts_payments')
      .select('amount_total, created_at')
      .eq('user_id', userId)
      .eq('plan_type', CREDIT_PLAN)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Only the pass that is actually running: a payment older than the current
    // window belongs to a pass that has already expired and been used.
    if (paid && paid.amount_total > 0) {
      const passStarted = new Date(user.pro_expires_at).getTime() - 24 * 60 * 60 * 1000;
      if (new Date(paid.created_at).getTime() >= passStarted - 60_000) {
        credit = Math.min(paid.amount_total, plan.amount - MIN_CHARGE);
      }
    }
  }

  const amount = plan.amount - credit;
  const describe = credit
    ? `${plan.description} Your £${(credit / 100).toFixed(2)} Day Pass has been credited.`
    : plan.description;

  // 3. Determine origin for redirect URLs
  const origin = event.headers.origin
    || event.headers.referer?.replace(/\/[^\/]*$/, '')
    || 'https://telestats.net';

  try {
    // 4. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // NOT payment_method_types: ['card'].
      //
      // Naming card explicitly turns OFF Apple Pay, Google Pay and Link, so
      // every buyer had to type a full card number, expiry and CVC on a phone
      // to spend 99p. Letting Stripe decide shows a wallet button where the
      // device supports one, which for an impulse purchase at this price is
      // worth more than any discount.
      automatic_payment_methods: { enabled: true },
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: plan.name,
              description: describe,
              images: ['https://res.cloudinary.com/dbfvogb95/image/upload/v1770835428/Screenshot_2026-02-11_at_19.43.16_m7urul.png']
            },
            unit_amount: amount,
          },
          quantity: 1,
        }
      ],
      metadata: {
        ts_user_id: String(userId),
        ts_email: user.email,
        ts_plan: planKey,
        // Recorded so a payment row can be reconciled against the list price.
        ts_credit_pence: String(credit),
      },
      success_url: `${origin}/upgrade/?payment=success&plan=${planKey}`,
      cancel_url: `${origin}/upgrade/?payment=cancelled`,
    });

    return respond(200, { url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    return respond(500, 'Failed to create checkout session');
  }
};
