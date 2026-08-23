/**
 * picks-reminder-trigger.js
 *
 * Manual/test sends for the picks reminder.
 *
 * picks-reminder.js carries a `schedule`, and Netlify rejects HTTP calls to
 * scheduled functions with a 403 at the edge — so its built-in force/
 * test_email mode has never been reachable in production. This function has
 * no schedule, so it is.
 *
 *   POST /.netlify/functions/picks-reminder-trigger
 *   header  x-admin-secret: <ADMIN_SECRET>
 *   body    { "force": true, "test_email": "you@example.com" }
 *              → send ONE email, to that address only. Does not stamp the
 *                week, so the real reminder still goes out later.
 *           { "force": true }
 *              → send to EVERYONE now, ignoring the timing window.
 *           {}
 *              → behave exactly like a cron tick (usually a no-op)
 *
 * Always test with test_email first. Without it, force sends to all 23
 * players immediately.
 */

const { respond, requireAdmin, handleOptions } = require('./_supabase.js');
const { run } = require('./picks-reminder.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  if (event.httpMethod !== 'POST') return respond(405, 'POST only');

  const adminErr = await requireAdmin(event);
  if (adminErr) return adminErr;

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return respond(400, 'Body must be valid JSON');
  }

  return run({ force: !!body.force, testEmail: body.test_email || null });
};
