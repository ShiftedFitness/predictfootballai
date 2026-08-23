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
const { respond, requireAdmin, handleOptions } = require('./_supabase.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;
  if (event.httpMethod !== 'POST') return respond(405, 'POST only');

  const adminErr = await requireAdmin(event);
  if (adminErr) return adminErr;

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return respond(400, 'Body must be valid JSON'); }

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
