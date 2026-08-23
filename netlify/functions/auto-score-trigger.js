/**
 * auto-score-trigger.js
 *
 * Manual, admin-authenticated trigger for auto-score.
 *
 * auto-score.js carries a `schedule`, and Netlify rejects HTTP calls to
 * scheduled functions with a 403 before they run — so it cannot be kicked
 * off by hand. This function has no schedule, so it can, and it hands off
 * to auto-score-background exactly as the cron does.
 *
 *   POST /.netlify/functions/auto-score-trigger
 *   header  x-admin-secret: <ADMIN_SECRET>
 *
 * Returns 202 immediately. Watch the auto-score-background function log, or
 * just re-check the results in the database a minute later.
 */

const { respond, requireAdmin, handleOptions } = require('./_supabase.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  if (event.httpMethod !== 'POST') return respond(405, 'POST only');

  const adminErr = await requireAdmin(event);
  if (adminErr) return adminErr;

  const base = process.env.URL || process.env.DEPLOY_URL;
  const secret = process.env.ADMIN_SECRET;
  if (!base) return respond(500, 'Site URL unavailable');
  if (!secret) return respond(500, 'ADMIN_SECRET not configured');

  try {
    const res = await fetch(`${base}/.netlify/functions/auto-score-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
      body: '{}'
    });
    return respond(202, {
      ok: true,
      started: true,
      backgroundStatus: res.status,
      message:
        'Result check started. It paces one fixture every 6.5s to respect ' +
        'football-data.org rate limits, so allow ~40 seconds for a five-match ' +
        'week, then re-check the results.'
    });
  } catch (e) {
    return respond(500, `Could not start: ${e.message}`);
  }
};
