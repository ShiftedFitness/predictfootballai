/**
 * fetch-ga4.mjs
 *
 * Pulls the Google Analytics Data API into plain JSON. Shared by every site:
 * which events count as wins lives in analytics/site.config.mjs, not here.
 *
 * Deliberately dumb: it fetches, shapes and writes. No interpretation, no
 * thresholds, no opinions. Analysis happens later, against the file — which
 * keeps the credentials in one small step and means the analysis input is
 * reviewable, diffable and re-runnable without touching Google again.
 *
 * Env: GA4_PROPERTY_ID (the numeric id, not the G- measurement id)
 */

import { googlePost } from './google-auth.mjs';

const API = 'https://analyticsdata.googleapis.com/v1beta';

function propertyId() {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error('GA4_PROPERTY_ID is not set (the numeric property id, not G-XXXXXXX).');
  return String(id).replace(/^properties\//, '');
}

async function runReport(body) {
  return googlePost(`${API}/properties/${propertyId()}:runReport`, body, 'GA4 runReport');
}

/** Turn GA4's row/header shape into plain objects. */
function rows(res) {
  const dims = (res.dimensionHeaders ?? []).map((h) => h.name);
  const mets = (res.metricHeaders ?? []).map((h) => h.name);
  return (res.rows ?? []).map((r) => {
    const out = {};
    dims.forEach((d, i) => (out[d] = r.dimensionValues?.[i]?.value ?? null));
    mets.forEach((m, i) => {
      const raw = r.metricValues?.[i]?.value;
      const n = Number(raw);
      out[m] = Number.isFinite(n) ? n : raw;
    });
    return out;
  });
}

/**
 * GA4 only returns a `totals` block when the request asks for
 * `metricAggregations`. A dimensionless report puts its numbers in
 * `rows[0]` instead — reading `totals` alone silently produced zeros.
 */
const totals = (res) => {
  const mets = (res.metricHeaders ?? []).map((h) => h.name);
  const source = res.totals?.[0]?.metricValues ?? res.rows?.[0]?.metricValues ?? [];
  return Object.fromEntries(mets.map((m, i) => [m, Number(source[i]?.value ?? 0)]));
};

/**
 * Everything the weekly report needs, for one date range.
 *
 * Separate reports rather than one wide one: GA4 cardinality rules mean
 * mixing high-cardinality dimensions (page path) with event names produces
 * sampled, unusable numbers.
 *
 * @param config  analytics/site.config.mjs (uses config.breakdowns for optional per-parameter splits)
 */
export async function fetchWindow(dateRange, config = {}) {
  const ranges = [dateRange];

  const [overview, channels, landing, pages, hosts, countries, events, revenue, breakdowns] = await Promise.all([
    runReport({
      dateRanges: ranges,
      metrics: [
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'userEngagementDuration' },
        { name: 'engagedSessions' },
      ],
      metricAggregations: ['TOTAL'],
    }),
    runReport({
      dateRanges: ranges,
      dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      limit: 50,
    }),
    runReport({
      dateRanges: ranges,
      dimensions: [{ name: 'hostName' }, { name: 'landingPagePlusQueryString' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'userEngagementDuration' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 40,
    }),
    runReport({
      dateRanges: ranges,
      dimensions: [{ name: 'hostName' }, { name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'userEngagementDuration' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 40,
    }),
    runReport({
      dateRanges: ranges,
      dimensions: [{ name: 'hostName' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagedSessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 100,
    }),
    runReport({
      dateRanges: ranges,
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 25,
    }),
    runReport({
      dateRanges: ranges,
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      limit: 250,
    }),
    runReport({
      dateRanges: ranges,
      metrics: [{ name: 'totalRevenue' }, { name: 'transactions' }],
      metricAggregations: ['TOTAL'],
    }).catch(() => null), // ecommerce metrics 400 if nothing has ever been sent
    // Per-site splits of chosen events by one parameter (e.g. game_type, form_name).
    // `customEvent:<param>` only resolves once the parameter is registered as a custom
    // dimension in GA4 (Admin → Custom definitions); until then the request 400s and
    // that breakdown is reported as unavailable rather than failing the run.
    Promise.all(
      (config.breakdowns ?? []).map((b) =>
        runReport({
          dateRanges: ranges,
          dimensions: [{ name: 'eventName' }, { name: b.dimension }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: b.events } } },
          limit: 100,
        }).catch(() => null),
      ),
    ),
  ]);

  const byEvent = Object.fromEntries(rows(events).map((r) => [r.eventName, { count: r.eventCount, users: r.totalUsers }]));

  return {
    range: dateRange,
    overview: totals(overview),
    events: byEvent,
    channels: rows(channels),
    landingPages: rows(landing),
    pages: rows(pages),
    hosts: rows(hosts),
    countries: rows(countries),
    revenue: revenue ? totals(revenue) : { totalRevenue: 0, transactions: 0 },
    breakdowns: (config.breakdowns ?? []).map((b, i) => shapeBreakdown(breakdowns[i], b)),
  };
}

/** eventName × dimension → one row per value with a count per event; null when unavailable or all "(not set)". */
function shapeBreakdown(res, b) {
  if (!res) return null;
  const grid = new Map();
  for (const r of rows(res)) {
    const key = r[b.dimension] || '(not set)';
    const cur = grid.get(key) ?? { value: key, counts: {} };
    cur.counts[r.eventName] = (cur.counts[r.eventName] ?? 0) + Number(r.eventCount ?? 0);
    grid.set(key, cur);
  }
  const out = [...grid.values()].sort((x, y) => (y.counts[b.events[0]] ?? 0) - (x.counts[b.events[0]] ?? 0));
  if (!out.length || out.every((r) => r.value === '(not set)')) return null;
  return out;
}
