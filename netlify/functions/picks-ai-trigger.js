/**
 * picks-ai-trigger.js
 *
 * Manual, admin-authenticated control surface for Picks AI.
 *
 * WHY THIS IS A SEPARATE FUNCTION FROM picks-ai.js
 * picks-ai.js carries a `schedule`, and Netlify rejects HTTP calls to
 * scheduled functions with a 403 at the edge — the request never reaches the
 * code, so no auth handling there could make a manual call work.
 *
 * WHY IT DOES NOT DO THE WORK ITSELF
 * A real run (five web searches + a model turn) can take minutes. Only a
 * background function gets that long, so this hands off to
 * picks-ai-background and returns straight away.
 *
 *   POST  → start a run, returns 202 immediately
 *           {}                  next eligible week
 *           { "week": 1 }       a specific week
 *           { "dryRun": true }  research + report, writes no picks
 *           { "force": true }   ignore the timing window and existing picks
 *
 *   GET   → read back recent runs, which is how you see the result of a
 *           POST (background functions cannot report back to the caller).
 *           ?week=1  filters to one week
 *
 * Use scripts/picks-ai-run.sh, which does the POST and then polls the GET.
 */

const { sb, respond, requireAdmin, handleOptions } = require('./_supabase.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  const adminErr = await requireAdmin(event);
  if (adminErr) return adminErr;

  // ── GET: read recent runs ────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      const url = new URL(event.rawUrl);
      const week = url.searchParams.get('week');

      let q = sb()
        .from('predict_ai_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      if (week) q = q.eq('week_number', Number(week));

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return respond(200, { ok: true, runs: data || [] });
    } catch (e) {
      return respond(500, e.message || 'Failed to read runs');
    }
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, 'POST to start a run, GET to read recent runs');
  }

  // ── POST: hand off to the background function ────────────────────────
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return respond(400, 'Body must be valid JSON');
  }

  const base = process.env.URL || process.env.DEPLOY_URL;
  const secret = process.env.ADMIN_SECRET;
  if (!base) return respond(500, 'Site URL unavailable');
  if (!secret) return respond(500, 'ADMIN_SECRET not configured');

  try {
    const res = await fetch(`${base}/.netlify/functions/picks-ai-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
      body: JSON.stringify(body)
    });

    return respond(202, {
      ok: true,
      started: true,
      backgroundStatus: res.status,
      options: body,
      message:
        'Run started in the background. It can take a couple of minutes ' +
        '(five web searches plus the model turn). Poll GET on this endpoint ' +
        'to see the result — every run, dry or live, is recorded.'
    });
  } catch (e) {
    return respond(500, `Could not start background run: ${e.message}`);
  }
};
