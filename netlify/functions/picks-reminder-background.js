/**
 * picks-reminder-background.js
 *
 * Sends the pre-deadline reminders. Background function because 23
 * sequential Gmail sends take about 35 seconds and a scheduled function is
 * killed at 30 — which is exactly what truncated week 2's reminders at 19.
 *
 * Admin-secret gated: this is a publicly reachable endpoint.
 */
const { respond, requireAdmin, handleOptions } = require('./_supabase.js');
const { run } = require('./picks-reminder.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  const adminErr = await requireAdmin(event);
  if (adminErr) {
    console.warn('picks-reminder-background: rejected an unauthenticated call');
    return adminErr;
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* treat as {} */ }

  console.log(`picks-reminder-background: starting ${JSON.stringify(body)}`);
  const result = await run({ force: !!body.force, testEmail: body.test_email || null });
  console.log(`picks-reminder-background: finished (${result.statusCode}) ${result.body}`);
  return result;
};
