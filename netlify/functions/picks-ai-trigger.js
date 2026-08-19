/**
 * picks-ai-trigger.js
 *
 * Manual, admin-authenticated trigger for Picks AI.
 *
 * WHY THIS IS A SEPARATE FUNCTION
 * picks-ai.js carries a `schedule` in netlify.toml, and Netlify blocks HTTP
 * invocation of scheduled functions with a 403 at the edge — the request is
 * rejected before the function runs, so no amount of auth handling inside
 * picks-ai.js can make a manual call work. The only way to have both is two
 * functions: one scheduled, one HTTP, sharing the same logic.
 *
 * This file has NO schedule, so it is reachable over HTTP. It does the admin
 * check, then calls run() from picks-ai.js.
 *
 *   POST /.netlify/functions/picks-ai-trigger
 *   header  x-admin-secret: <ADMIN_SECRET>
 *   body    {}                                → next eligible week
 *           { "week": 1 }                     → a specific week
 *           { "dryRun": true }                → research + report, no writes
 *           { "force": true }                 → ignore the timing window and
 *                                               any existing picks
 *
 * Use scripts/picks-ai-run.sh rather than curl by hand.
 */

const { respond, requireAdmin, handleOptions } = require('./_supabase.js');
const { run } = require('./picks-ai.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  if (event.httpMethod !== 'POST') {
    return respond(405, 'POST only');
  }

  const adminErr = await requireAdmin(event);
  if (adminErr) return adminErr;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return respond(400, 'Body must be valid JSON');
  }

  return run({
    requestedWeek: body.week ? Number(body.week) : null,
    dryRun: !!body.dryRun,
    force: !!body.force
  });
};
