/**
 * week-open-trigger.js
 *
 * Announce a new matchweek to the players.
 *
 *   GET  ?week=N            preflight — is this week announceable, and to
 *                           how many people? Changes nothing.
 *   POST { week, force?, test_email? }
 *                           send. test_email goes to that address only and
 *                           does NOT stamp the week.
 *
 * Readiness is checked SYNCHRONOUSLY before handing off to the background
 * function. The results email originally did not do this, and an admin got
 * a success message for an email that was silently skipped — a 202 handoff
 * must never be reported to a person as success.
 */

const { sb, respond, requireAdmin, handleOptions } = require('./_supabase.js');
const { checkReady } = require('./week-open.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  const adminErr = await requireAdmin(event);
  if (adminErr) return adminErr;

  // ── GET: preflight ───────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const url = new URL(event.rawUrl);
    const wk = url.searchParams.get('week');
    if (!wk) return respond(400, 'week parameter required');

    const client = sb();
    const ready = await checkReady(client, wk);

    const { data: users } = await client
      .from('predict_users')
      .select('id, username, email, is_bot')
      .eq('is_active', true);
    const recipients = (users || []).filter((u) => !u.is_bot && u.email);

    return respond(200, {
      ok: !!ready.ready,
      week: Number(wk),
      ...ready,
      recipients: recipients.length
    });
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, 'GET to preflight, POST to send');
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return respond(400, 'Body must be valid JSON'); }

  if (!body.week) return respond(400, 'A week number is required.');

  const ready = await checkReady(sb(), body.week);
  if (!ready.ready) return respond(400, ready.reason);
  if (ready.alreadySent && !body.test_email && !body.force) {
    return respond(400,
      `Week ${body.week} was already announced at ${ready.alreadySent}. ` +
      'Use force if you really want to send it again.');
  }

  const base = process.env.URL || process.env.DEPLOY_URL;
  const secret = process.env.ADMIN_SECRET;
  if (!base || !secret) return respond(500, 'URL or ADMIN_SECRET not configured');

  try {
    const res = await fetch(`${base}/.netlify/functions/week-open-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
      body: JSON.stringify(body)
    });
    return respond(202, {
      ok: true, started: true, backgroundStatus: res.status,
      week: body.week, deadline: ready.deadline,
      message: body.test_email
        ? 'Test send started — it goes only to that address and does not mark the week as announced.'
        : 'Announcement started in the background; the week is now marked as announced.'
    });
  } catch (e) {
    return respond(500, `Could not start: ${e.message}`);
  }
};
