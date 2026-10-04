#!/usr/bin/env node
/**
 * ga-query.mjs — ad-hoc, READ-ONLY questions to GA4 (and Search Console).
 *
 * Used by the `telestats-analytics` skill so Claude can answer one-off
 * questions ("how did people reach the Leganés page today?") between weekly
 * reports. Same credentials and read-only scopes as the weekly job.
 *
 * Usage:
 *   node scripts/analytics/ga-query.mjs '<json spec>'
 *
 * GA4 Data API spec (all optional except metrics):
 *   {
 *     "start": "2026-10-04" | "today" | "7daysAgo",   default "28daysAgo"
 *     "end":   "2026-10-04" | "today",                 default "today"
 *     "dimensions": ["sessionSource", "landingPagePlusQueryString"],
 *     "metrics": ["sessions", "activeUsers"],
 *     "filter":  { "field": "pagePath", "contains": "/teams/leganes" }
 *                | { "field": "eventName", "in": ["game_start", "game_complete"] }
 *                | { "field": "eventName", "equals": "signup_complete" },
 *     "filters": [ <filter>, <filter> ]        // AND of several
 *     "orderBy": "sessions", "limit": 50
 *   }
 * Realtime (last 30 minutes): add "realtime": true (dimensions/metrics from the Realtime API).
 * Search Console: add "gsc": true with dimensions from [query, page, date, country, device]
 *   and an optional { "field": "page"|"query", "contains": "..." } filter.
 *
 * Env (from .env.local or the shell): GA4_PROPERTY_ID, GSC_SITE_URL and
 * GOOGLE_SERVICE_ACCOUNT_FILE (or GOOGLE_SERVICE_ACCOUNT_JSON).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { googlePost } from './google-auth.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(resolve(ROOT, f));
  } catch {
    /* optional */
  }
}

const spec = JSON.parse(process.argv[2] || '{}');
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function gaFilter(f) {
  if (f.in) return { filter: { fieldName: f.field, inListFilter: { values: f.in } } };
  if (f.contains) return { filter: { fieldName: f.field, stringFilter: { matchType: 'CONTAINS', value: f.contains, caseSensitive: false } } };
  if (f.begins) return { filter: { fieldName: f.field, stringFilter: { matchType: 'BEGINS_WITH', value: f.begins } } };
  return { filter: { fieldName: f.field, stringFilter: { matchType: 'EXACT', value: String(f.equals) } } };
}

function printTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
  console.log(`(${rows.length} row${rows.length === 1 ? '' : 's'})`);
}

async function ga() {
  const property = String(process.env.GA4_PROPERTY_ID || '').replace(/^properties\//, '');
  if (!property) throw new Error('GA4_PROPERTY_ID is not set (.env.local).');
  const filters = [...list(spec.filters), ...list(spec.filter)];
  const body = {
    dimensions: list(spec.dimensions).map((name) => ({ name })),
    metrics: list(spec.metrics).map((name) => ({ name })),
    limit: spec.limit ?? 50,
  };
  if (!spec.realtime) body.dateRanges = [{ startDate: spec.start ?? '28daysAgo', endDate: spec.end ?? 'today' }];
  if (filters.length) {
    const exprs = filters.map(gaFilter);
    body.dimensionFilter = exprs.length === 1 ? exprs[0] : { andGroup: { expressions: exprs } };
  }
  if (spec.orderBy) {
    const metric = list(spec.metrics).includes(spec.orderBy);
    body.orderBys = [metric ? { metric: { metricName: spec.orderBy }, desc: true } : { dimension: { dimensionName: spec.orderBy } }];
  }
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${property}:${spec.realtime ? 'runRealtimeReport' : 'runReport'}`;
  const res = await googlePost(url, body, spec.realtime ? 'GA4 realtime' : 'GA4 runReport');
  const dh = (res.dimensionHeaders ?? []).map((h) => h.name);
  const mh = (res.metricHeaders ?? []).map((h) => h.name);
  printTable([...dh, ...mh], (res.rows ?? []).map((r) => [...(r.dimensionValues ?? []).map((v) => v.value), ...(r.metricValues ?? []).map((v) => v.value)]));
}

async function gsc() {
  const site = process.env.GSC_SITE_URL;
  if (!site) throw new Error('GSC_SITE_URL is not set (.env.local).');
  const day = (v, def) => {
    if (!v) return def;
    if (v === 'today') return new Date().toISOString().slice(0, 10);
    const m = /^(\d+)daysAgo$/.exec(v);
    return m ? new Date(Date.now() - Number(m[1]) * 86400000).toISOString().slice(0, 10) : v;
  };
  const f = list(spec.filter)[0];
  const body = {
    startDate: day(spec.start, day('28daysAgo')),
    endDate: day(spec.end, day('today')),
    dimensions: list(spec.dimensions),
    rowLimit: spec.limit ?? 50,
    dimensionFilterGroups: f ? [{ filters: [{ dimension: f.field, operator: f.contains ? 'contains' : 'equals', expression: f.contains ?? f.equals }] }] : undefined,
  };
  const res = await googlePost(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, body, 'Search Console');
  printTable(
    [...body.dimensions, 'clicks', 'impressions', 'ctr', 'position'],
    (res.rows ?? []).map((r) => [...(r.keys ?? []), r.clicks, r.impressions, (r.ctr * 100).toFixed(1) + '%', r.position.toFixed(1)]),
  );
}

(spec.gsc ? gsc() : ga()).catch((e) => {
  console.error('[ga-query]', e.message);
  process.exitCode = 1;
});
