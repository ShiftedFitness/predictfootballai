#!/usr/bin/env node
/**
 * run-weekly.mjs
 *
 * The whole weekly job: fetch → shape → report → write → email.
 * Shared by every site; everything site-specific is in analytics/site.config.mjs.
 *
 * Deliberately contains no judgement. It gathers evidence and formats it.
 * Deciding what to change happens afterwards, by a human or by Claude in a
 * session (/seo-review) reading the committed report — so nothing here can
 * alter the site, and the Google credentials live only in this step.
 *
 * Usage:
 *   node scripts/analytics/run-weekly.mjs
 *   node scripts/analytics/run-weekly.mjs --no-email
 *   node scripts/analytics/run-weekly.mjs --date 2026-10-18   # backfill
 *
 * Env: see google-auth.mjs, fetch-ga4.mjs, fetch-gsc.mjs, fetch-first-party.mjs, email-report.mjs
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { windows } from './periods.mjs';
import { fetchWindow as fetchGa4 } from './fetch-ga4.mjs';
import { fetchWindow as fetchGsc } from './fetch-gsc.mjs';
import { fetchFirstParty } from './fetch-first-party.mjs';
import { buildReport } from './report.mjs';
import { emailReport, emailEnabled } from './email-report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// Local runs: pick up settings from .env.local / .env (both git-ignored). In CI the env comes from secrets.
for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(resolve(ROOT, f));
  } catch {
    /* optional */
  }
}
const INPUT_DIR = resolve(ROOT, 'analytics/input');
const REPORT_DIR = resolve(ROOT, 'analytics/reports');
const LEDGER = resolve(ROOT, 'analytics/experiments.json');

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};
const log = (...a) => console.log('[analytics]', ...a);

async function readLedger() {
  try {
    const raw = JSON.parse(await readFile(LEDGER, 'utf-8'));
    if (Array.isArray(raw)) return { experiments: raw, standingDecisions: [] };
    return { experiments: raw.experiments ?? [], standingDecisions: raw.standingDecisions ?? [] };
  } catch {
    return { experiments: [], standingDecisions: [] };
  }
}

async function main() {
  const config = (await import(pathToFileURL(resolve(ROOT, 'analytics/site.config.mjs')).href)).default;
  const now = opt('--date') ? new Date(`${opt('--date')}T08:00:00Z`) : new Date();

  // GA4 settles within a day; Search Console needs three.
  const wGa4 = windows(now, 1);
  const wGsc = windows(now, 3);
  const useGsc = Boolean(process.env.GSC_SITE_URL);

  log(`${config.name}: GA4 decision window ${wGa4.decision.current.startDate} → ${wGa4.decision.current.endDate}`);
  if (useGsc) log(`${config.name}: GSC decision window ${wGsc.decision.current.startDate} → ${wGsc.decision.current.endDate}`);
  else log('GSC_SITE_URL not set — skipping Search Console');

  const ga4 = { momentum: {}, decision: {} };
  const gsc = useGsc ? { momentum: {}, decision: {} } : null;
  for (const scope of ['momentum', 'decision']) {
    for (const which of ['current', 'previous']) {
      ga4[scope][which] = await fetchGa4(wGa4[scope][which], config);
      if (gsc) gsc[scope][which] = await fetchGsc(wGsc[scope][which], config);
    }
    log(`fetched ${scope}`);
  }
  const extra = config.firstParty ? await fetchFirstParty(wGa4) : null;
  if (config.firstParty) log(extra ? 'fetched first-party stats' : 'first-party stats unavailable');

  await mkdir(INPUT_DIR, { recursive: true });
  await mkdir(REPORT_DIR, { recursive: true });

  const stamp = wGa4.decision.current.endDate;
  const generatedAt = new Date().toISOString();

  // Raw pulls are kept so the review can go deeper without another round trip to Google.
  await writeFile(resolve(INPUT_DIR, 'ga4.json'), JSON.stringify(ga4, null, 2));
  if (gsc) await writeFile(resolve(INPUT_DIR, 'gsc.json'), JSON.stringify(gsc, null, 2));
  if (extra) await writeFile(resolve(INPUT_DIR, 'first-party.json'), JSON.stringify(extra, null, 2));
  log('wrote analytics/input/*.json');

  const markdown = buildReport({ config, generatedAt, ga4, gsc, extra, ...(await readLedger()) });
  await writeFile(resolve(REPORT_DIR, `${stamp}.md`), markdown, 'utf-8');
  await writeFile(resolve(REPORT_DIR, 'latest.md'), markdown, 'utf-8');
  log(`wrote analytics/reports/${stamp}.md`);

  if (flag('--no-email')) log('skipping email (--no-email)');
  else if (!emailEnabled()) log('email not configured — set SMTP_* and REPORT_EMAIL_TO to enable');
  else {
    const res = await emailReport({ subject: config.subject({ stamp, ga4, extra }), markdown });
    log(res.ok ? `emailed ${res.recipients} recipient(s)` : `email failed: ${res.reason}`);
  }
}

main().catch((err) => {
  console.error('[analytics] failed:', err.message);
  process.exitCode = 1;
});
