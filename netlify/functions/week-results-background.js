/**
 * week-results-background.js
 *
 * Sends the weekly results emails. Background function because ~24
 * sequential sends is well past the 30-second ceiling on scheduled
 * functions. Admin-secret gated — it is a public endpoint.
 */
const { respond, requireAdmin, handleOptions } = require('./_supabase.js');
const { run } = require('./week-results.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  const adminErr = await requireAdmin(event);
  if (adminErr) {
    console.warn('week-results-background: rejected an unauthenticated call');
    return adminErr;
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* treat as {} */ }

  console.log(`week-results-background: starting ${JSON.stringify(body)}`);
  const result = await run({
    force: !!body.force,
    testEmail: body.test_email || null,
    week: body.week || null
  });
  console.log(`week-results-background: finished (${result.statusCode})`);
  return result;
};
