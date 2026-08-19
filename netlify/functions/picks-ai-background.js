/**
 * picks-ai-background.js
 *
 * Where Picks AI actually does its work.
 *
 * WHY A BACKGROUND FUNCTION
 * A real run makes five server-side web searches and a model call, which
 * does not reliably fit inside Netlify's limits for the other function
 * types:
 *   scheduled functions   30 seconds
 *   background functions  15 minutes   ← this one
 * So the cron (picks-ai.js) and the manual trigger (picks-ai-trigger.js)
 * both just hand off to here.
 *
 * Background functions reply 202 immediately with an empty body, so nothing
 * useful can be returned to the caller. Every run — including a dry run —
 * therefore records itself in predict_ai_runs, which is how you see what
 * happened. GET picks-ai-trigger reads those back.
 *
 * Marked background via netlify.toml ([functions."picks-ai-background"]
 * background = true) rather than the legacy -background filename suffix.
 *
 * Requires x-admin-secret. It is a publicly reachable endpoint, so without
 * that check anyone could make it spend API budget.
 */

const { respond, requireAdmin, handleOptions } = require('./_supabase.js');
const { run } = require('./picks-ai.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  const adminErr = await requireAdmin(event);
  if (adminErr) {
    console.warn('picks-ai-background: rejected an unauthenticated call');
    return adminErr;
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    console.warn('picks-ai-background: bad JSON body, treating as {}');
  }

  const opts = {
    requestedWeek: body.week ? Number(body.week) : null,
    dryRun: !!body.dryRun,
    force: !!body.force
  };

  console.log(`picks-ai-background: starting ${JSON.stringify(opts)}`);
  const result = await run(opts);
  console.log(`picks-ai-background: finished (${result.statusCode}) ${result.body}`);

  // The caller already has its 202; this is for the function log only.
  return result;
};
