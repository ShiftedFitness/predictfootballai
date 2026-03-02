/**
 * stripe-webhook.js — Handle Stripe webhook events
 *
 * Listens for checkout.session.completed to upgrade users to Pro.
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY      — Stripe secret key
 *   STRIPE_WEBHOOK_SECRET  — Stripe webhook signing secret (whsec_...)
 *
 * Stripe Dashboard → Developers → Webhooks → Add endpoint:
 *   URL: https://telestats.net/.netlify/functions/stripe-webhook
 *   Events: checkout.session.completed
 */

const { sb, respond } = require('./_supabase');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return respond(405, 'POST only');

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    console.error('Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return respond(500, 'Webhook not configured');
  }

  const stripe = require('stripe')(stripeKey);

  // 1. Verify webhook signature
  const sig = event.headers['stripe-signature'];
  if (!sig) return respond(400, 'Missing stripe-signature header');

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return respond(400, 'Invalid signature');
  }

  // 2. Handle checkout.session.completed
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const userId = session.metadata?.ts_user_id;
    const email = session.metadata?.ts_email;

    if (!userId) {
      console.error('Webhook: No ts_user_id in session metadata', session.id);
      return respond(200, { received: true, warning: 'No user ID in metadata' });
    }

    const client = sb();

    try {
      // 3. Upgrade user to paid
      const { error: updateErr } = await client
        .from('ts_users')
        .update({ tier: 'paid' })
        .eq('id', userId);

      if (updateErr) {
        console.error('Failed to upgrade user:', updateErr.message);
        return respond(500, 'Failed to upgrade user');
      }

      // 4. Record payment in ts_payments
      const { error: paymentErr } = await client
        .from('ts_payments')
        .insert({
          user_id: userId,
          stripe_session_id: session.id,
          stripe_payment_intent: session.payment_intent,
          stripe_customer_email: session.customer_email || email,
          amount_total: session.amount_total,     // in pence (499 = £4.99)
          currency: session.currency || 'gbp',
          status: session.payment_status || 'paid'
        });

      if (paymentErr) {
        // Non-fatal — user is already upgraded, just log the error
        console.error('Failed to record payment:', paymentErr.message);
      }

      console.log(`[Stripe] User ${userId} upgraded to Pro (session: ${session.id})`);
      return respond(200, { received: true, upgraded: true });

    } catch (err) {
      console.error('Webhook processing error:', err.message);
      return respond(500, 'Processing error');
    }
  }

  // 3. Other event types — acknowledge but ignore
  console.log(`[Stripe] Ignoring event type: ${stripeEvent.type}`);
  return respond(200, { received: true });
};
