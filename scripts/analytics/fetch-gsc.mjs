/**
 * fetch-gsc.mjs
 *
 * Pulls Search Console's Search Analytics API into plain JSON.
 * Same principle as the GA4 fetcher: fetch and shape, never interpret.
 *
 * Search Console data lags 2-3 days, which is why callers pass it a later
 * cutoff than GA4. Comparing a fresh GA4 window against a stale GSC one
 * invents declines that aren't there.
 *
 * Env: GSC_SITE_URL — exactly as registered in Search Console, including
 * the trailing slash for a URL-prefix property (https://example.com/) or
 * the sc-domain: form for a domain property (sc-domain:example.com).
 */

import { googlePost } from './google-auth.mjs';

const API = 'https://searchconsole.googleapis.com/webmasters/v3/sites';

function siteUrl() {
  const url = process.env.GSC_SITE_URL;
  if (!url) {
    throw new Error('GSC_SITE_URL is not set. Use the exact property string from Search Console, e.g. "sc-domain:example.com".');
  }
  return url;
}

async function query(body) {
  return googlePost(`${API}/${encodeURIComponent(siteUrl())}/searchAnalytics/query`, body, 'Search Console query');
}

/** GSC returns positional `keys`; name them so downstream code reads clearly. */
function shape(res, dimensions) {
  return (res.rows ?? []).map((r) => {
    const out = {};
    dimensions.forEach((d, i) => (out[d] = r.keys?.[i] ?? null));
    out.clicks = r.clicks ?? 0;
    out.impressions = r.impressions ?? 0;
    out.ctr = r.ctr ?? 0;
    out.position = r.position ?? 0;
    return out;
  });
}

/**
 * @param exclude  page substrings to leave out (private/admin areas), from site config `gscExclude`
 */
async function byDimensions(range, dimensions, rowLimit = 1000, exclude = []) {
  const filters = dimensions.includes('page')
    ? exclude.map((expression) => ({ dimension: 'page', operator: 'notContains', expression }))
    : [];
  const res = await query({
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions,
    rowLimit,
    dimensionFilterGroups: filters.length ? [{ groupType: 'and', filters }] : undefined,
  });
  return shape(res, dimensions);
}

export async function fetchWindow(range, config = {}) {
  const ex = config.gscExclude ?? [];
  const [totals, queries, pages, queryPage, countries, devices] = await Promise.all([
    query({ startDate: range.startDate, endDate: range.endDate }).then((r) => {
      const row = r.rows?.[0];
      return { clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0, ctr: row?.ctr ?? 0, position: row?.position ?? 0 };
    }),
    byDimensions(range, ['query']),
    byDimensions(range, ['page'], 1000, ex),
    // The pairing that makes CTR opportunities actionable: without it you
    // know a query underperforms but not which page to edit.
    byDimensions(range, ['query', 'page'], 2000, ex),
    byDimensions(range, ['country'], 50),
    byDimensions(range, ['device'], 10),
  ]);
  return { range, totals, queries, pages, queryPage, countries, devices };
}
