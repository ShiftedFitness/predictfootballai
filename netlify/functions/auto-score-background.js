/**
 * auto-score-background.js
 *
 * Where result-fetching and week scoring actually happen.
 *
 * football-data.org's free tier is 10 requests/minute, so auto-score paces
 * one fixture every 6.5 seconds — about 33 seconds for a five-match week.
 * Netlify kills a scheduled function at 30 seconds, which is why week 1
 * ended up with three results set and two missing, and scoring then
 * recorded nearly every pick as wrong.
 *
 * Background functions get 15 minutes, which is ample.
 *
 * Requires x-admin-secret: this is a public endpoint, and without the check
 * anyone could drive scoring.
 */

const { respond, requireAdmin, handleOptions } = require('./_supabase.js');
const { run } = require('./auto-score.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  const adminErr = await requireAdmin(event);
  if (adminErr) {
    console.warn('auto-score-background: rejected an unauthenticated call');
    return adminErr;
  }

  console.log('auto-score-background: starting');
  const result = await run();
  console.log(`auto-score-background: finished (${result.statusCode}) ${result.body}`);
  return result;
};
