/**
 * fetch-first-party.mjs
 *
 * Numbers that only the site itself knows (signups, items registered,
 * shares made…), from the site's own database rather than GA4. They don't
 * depend on cookie consent or ad blockers, so they are the ground truth that
 * GA4's numbers are read against.
 *
 * The site exposes a small read-only endpoint that returns COUNTS ONLY (never
 * rows or personal data) for the date ranges it is given, protected by a
 * shared token. This script never sees a database credential.
 *
 * Env:
 *   ANALYTICS_STATS_URL    e.g. https://tagsy.it/.netlify/functions/analytics-stats
 *   ANALYTICS_STATS_TOKEN  shared secret; the same value is set on the site
 *
 * Returns null (and the report says so) when not configured or on failure:
 * a missing number must never fail the job that produced the rest.
 */

export async function fetchFirstParty(windows) {
  const url = process.env.ANALYTICS_STATS_URL;
  const token = process.env.ANALYTICS_STATS_TOKEN;
  if (!url || !token) return null;

  const ranges = {
    momentum: { current: windows.momentum.current, previous: windows.momentum.previous },
    decision: { current: windows.decision.current, previous: windows.decision.previous },
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-analytics-token': token },
      body: JSON.stringify({ ranges }),
    });
    if (!res.ok) {
      console.warn(`[analytics] first-party stats failed (${res.status})`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[analytics] first-party stats unreachable:', err?.message ?? err);
    return null;
  }
}
