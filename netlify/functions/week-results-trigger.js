/**
 * week-results-trigger.js
 *
 * Manual/test sends for the weekly results email.
 *
 * week-results.js carries a `schedule` and Netlify rejects HTTP calls to
 * scheduled functions with a 403, so the manual path lives here.
 *
 *   POST /.netlify/functions/week-results-trigger
 *   header  x-admin-secret: <ADMIN_SECRET>
 *   body    { "force": true, "test_email": "you@example.com", "week": 1 }
 *             → send just to you, for one week. Does NOT stamp the week,
 *               so the real send still happens.
 *           { "force": true, "week": 1 }
 *             → send to EVERYONE for that week, now.
 *
 * Always test with test_email first: without it, force emails all 23 players.
 */
const { sb, respond, requireAdmin, handleOptions } = require('./_supabase.js');
const { checkReady } = require('./week-results.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  // ── GET: preflight ───────────────────────────────────────────────────
  // Checks everything that can silently stop an email, in one call:
  // migration applied, mail credentials present, week ready, recipients.
  // Added because a send reported success and delivered nothing, and the
  // real cause was invisible from the browser.
  if (event.httpMethod === 'GET') {
    const adminErrG = await requireAdmin(event);
    if (adminErrG) return adminErrG;

    const client = sb();
    const out = { ok: true, checks: {} };

    // 1. Did migration 012 run? Without it every query in run() errors.
    const { error: colErr } = await client
      .from('predict_match_weeks')
      .select('scored_at, results_email_sent_at')
      .limit(1);
    out.checks.migration012 = colErr
      ? { pass: false, detail: `Columns missing — run sql/012. (${colErr.message})` }
      : { pass: true };

    // 2. Mail credentials. The reminder emails also never arrived, so this
    //    is worth checking independently of any one feature.
    out.checks.gmail = {
      pass: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
      detail: process.env.GMAIL_USER
        ? (process.env.GMAIL_APP_PASSWORD ? `configured as ${process.env.GMAIL_USER}` : 'GMAIL_APP_PASSWORD is not set')
        : 'GMAIL_USER is not set'
    };

    // 3. Can the background function be reached?
    out.checks.siteUrl = {
      pass: !!(process.env.URL || process.env.DEPLOY_URL),
      detail: process.env.URL || process.env.DEPLOY_URL || 'no URL in env'
    };
    out.checks.adminSecret = { pass: !!process.env.ADMIN_SECRET };

    // 4. Who would actually receive it?
    const { data: users, error: uErr } = await client
      .from('predict_users')
      .select('id, username, email, is_bot, is_active')
      .eq('is_active', true);
    const recipients = (users || []).filter((u) => !u.is_bot && u.email);
    out.checks.recipients = uErr
      ? { pass: false, detail: uErr.message }
      : { pass: recipients.length > 0,
          detail: `${recipients.length} active players with an email address`,
          missingEmail: (users || []).filter((u) => !u.is_bot && !u.email).map((u) => u.username) };

    // 5. Is the requested week actually sendable?
    const url = new URL(event.rawUrl);
    const wk = url.searchParams.get('week');
    if (wk) out.checks.week = await checkReady(client, wk);

    out.ok = Object.values(out.checks).every((c) => c.pass !== false && c.ready !== false);
    return respond(200, out);
  }

  if (event.httpMethod !== 'POST') return respond(405, 'GET to preflight, POST to send');

  const adminErr = await requireAdmin(event);
  if (adminErr) return adminErr;

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return respond(400, 'Body must be valid JSON'); }

  // Answer synchronously whether this can work at all. Handing off blindly
  // meant the admin saw "Started" for a send the background function then
  // silently skipped.
  if (body.week) {
    const ready = await checkReady(sb(), body.week);
    if (!ready.ready) return respond(400, ready.reason);
    if (ready.alreadySent && !body.test_email && !body.force) {
      return respond(400,
        `Week ${body.week} results were already emailed at ${ready.alreadySent}.`);
    }
  }

  const base = process.env.URL || process.env.DEPLOY_URL;
  const secret = process.env.ADMIN_SECRET;
  if (!base || !secret) return respond(500, 'URL or ADMIN_SECRET not configured');

  try {
    const res = await fetch(`${base}/.netlify/functions/week-results-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
      body: JSON.stringify(body)
    });
    return respond(202, {
      ok: true, started: true, backgroundStatus: res.status, options: body,
      message: 'Send started in the background. Check the ' +
               'week-results-background function log for the outcome.'
    });
  } catch (e) {
    return respond(500, `Could not start: ${e.message}`);
  }
};
