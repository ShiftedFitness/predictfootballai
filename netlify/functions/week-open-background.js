/**
 * week-open-background.js
 *
 * Sends the "week is open" emails. Background function because ~23
 * sequential sends is well past the 30s ceiling elsewhere.
 * Admin-secret gated — it is a public endpoint.
 */
const { respond, requireAdmin, handleOptions } = require('./_supabase.js');
const { run } = require('./week-open.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  const adminErr = await requireAdmin(event);
  if (adminErr) {
    console.warn('week-open-background: rejected an unauthenticated call');
    return adminErr;
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* treat as {} */ }

  console.log(`week-open-background: starting ${JSON.stringify(body)}`);
  const result = await run({
    force: !!body.force,
    testEmail: body.test_email || null,
    week: body.week || null
  });
  console.log(`week-open-background: finished (${result.statusCode}) ${result.body}`);
  return result;
};
