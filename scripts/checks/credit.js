#!/usr/bin/env node
/**
 * credit.js — prove the Day Pass credit charges the right amount.
 *
 * This is money. Stripe and Supabase are both stubbed so the assertion is
 * about the unit_amount that WOULD be charged, under conditions that are
 * awkward to reach by hand — an expired pass, a pass nobody paid for, a
 * payment from a previous pass.
 *
 *   node scripts/checks/credit.js
 */

const path = require('path');
const Module = require('module');

const FUNCS = path.join(__dirname, '..', '..', 'netlify', 'functions');
const HOUR = 3600_000;

let captured = null;

/**
 * Install stubs for stripe and _supabase, and LEAVE THEM INSTALLED.
 *
 * create-checkout calls require('stripe') inside the handler, not at module
 * load, so restoring Module._load before invoking it puts the real library
 * back and every assertion fails against a rejected API key.
 */
function installStubs({ user, payment }) {
  captured = null;
  for (const k of Object.keys(require.cache)) if (k.startsWith(FUNCS)) delete require.cache[k];

  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'stripe') {
      return () => ({
        checkout: { sessions: { create: async (opts) => { captured = opts; return { url: 'https://stripe.test/x' }; } } },
      });
    }
    if (request === './_supabase') {
      const table = (name) => {
        const q = {
          _t: name, select: () => q, eq: () => q, order: () => q, limit: () => q,
          maybeSingle: async () => ({
            data: name === 'ts_users' ? user : payment,
            error: null,
          }),
        };
        return q;
      };
      return {
        sb: () => ({ from: table }),
        respond: (status, body) => ({ statusCode: status, body: JSON.stringify(body) }),
        handleOptions: () => null,
      };
    }
    return origLoad.apply(this, arguments);
  };
  return origLoad;
}

const call = async (ctx, plan) => {
  const origLoad = installStubs(ctx);
  try {
    const h = require(path.join(FUNCS, 'create-checkout.js')).handler;
    const res = await h({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ userId: 'u1', plan }) }, {});
    return { res, amount: captured && captured.line_items[0].price_data.unit_amount,
             desc: captured && captured.line_items[0].price_data.product_data.description,
             methods: captured && captured.automatic_payment_methods,
             forced: captured && captured.payment_method_types,
             meta: captured && captured.metadata };
  } finally {
    Module._load = origLoad;                       // only after the handler ran
  }
};

process.env.STRIPE_SECRET_KEY = 'sk_test_stub';

let pass = 0; const fails = [];
const check = async (name, fn) => {
  try {
    const why = await fn();
    if (why) { fails.push(name); console.log(`  ✗  ${name}\n       ${why}`); }
    else { pass++; console.log(`  ✓  ${name}`); }
  } catch (e) { fails.push(name); console.log(`  ✗  ${name}\n       threw: ${e.message}`); }
};

const activeUser = (expiresInMs) => ({
  id: 'u1', tier: 'paid', email: 'a@b.com', username: 'x',
  pro_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
});
const freeUser = { id: 'u1', tier: 'free', email: 'a@b.com', username: 'x', pro_expires_at: null };
const paidDayPass = (agoMs) => ({ amount_total: 99, created_at: new Date(Date.now() - agoMs).toISOString() });

(async () => {
  console.log('\n  Day Pass credit\n');

  await check('no pass: Pro is the full £4.99', async () => {
    const r = await call({ user: freeUser, payment: null }, 'lifetime');
    return r.amount === 499 ? null : `charged ${r.amount}`;
  });

  await check('pass running and paid for: Pro is £4.00', async () => {
    const r = await call({ user: activeUser(10 * HOUR), payment: paidDayPass(14 * HOUR) }, 'lifetime');
    if (r.amount !== 400) return `charged ${r.amount}, expected 400`;
    if (!/credited/i.test(r.desc || '')) return 'the credit is not mentioned on the Stripe page';
    return null;
  });

  await check('pass running but NEVER PAID FOR: no credit', async () => {
    const r = await call({ user: activeUser(10 * HOUR), payment: null }, 'lifetime');
    return r.amount === 499 ? null : `charged ${r.amount} — a hand-granted pass discounted Pro`;
  });

  await check('payment from an EARLIER, expired pass: no credit', async () => {
    // Pass expires in 10h, so it began 14h ago. A payment from 40h ago belongs
    // to a pass that has already been used and expired.
    const r = await call({ user: activeUser(10 * HOUR), payment: paidDayPass(40 * HOUR) }, 'lifetime');
    return r.amount === 499 ? null : `charged ${r.amount} — an old payment was credited again`;
  });

  await check('pass already expired: no credit', async () => {
    const r = await call({ user: activeUser(-1 * HOUR), payment: paidDayPass(25 * HOUR) }, 'lifetime');
    return r.amount === 499 ? null : `charged ${r.amount} after the deadline`;
  });

  await check('buying a second Day Pass while one runs is refused', async () => {
    const r = await call({ user: activeUser(10 * HOUR), payment: paidDayPass(14 * HOUR) }, 'day_pass');
    return r.res.statusCode === 409 ? null : `got ${r.res.statusCode}`;
  });

  await check('lifetime members cannot buy again', async () => {
    const r = await call({ user: { id: 'u1', tier: 'paid', email: 'a@b.com', pro_expires_at: null }, payment: null }, 'lifetime');
    return r.res.statusCode === 409 ? null : `got ${r.res.statusCode}`;
  });

  await check('the credit can never take the charge below Stripe\'s 30p floor', async () => {
    const r = await call({ user: activeUser(10 * HOUR), payment: { amount_total: 9999, created_at: new Date().toISOString() } }, 'lifetime');
    return r.amount >= 30 ? null : `charged ${r.amount}`;
  });

  await check('wallets are enabled, card is not forced', async () => {
    const r = await call({ user: freeUser, payment: null }, 'lifetime');
    if (!r.methods || r.methods.enabled !== true) return 'automatic_payment_methods is not enabled';
    return r.forced ? 'payment_method_types is still set, which disables wallets' : null;
  });

  await check('the credit is recorded in metadata', async () => {
    const r = await call({ user: activeUser(10 * HOUR), payment: paidDayPass(14 * HOUR) }, 'lifetime');
    return r.meta && r.meta.ts_credit_pence === '99' ? null : `metadata: ${JSON.stringify(r.meta)}`;
  });

  console.log(`\n  ${pass} passed · ${fails.length} failed\n`);
  process.exit(fails.length ? 1 : 0);
})();
