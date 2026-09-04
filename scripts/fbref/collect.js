#!/usr/bin/env node
/**
 * collect.js — fetch FBref season pages to disk, then parse them.
 *
 * Fetching and parsing are kept apart on purpose. Fetching depends on a real
 * Chrome getting past Cloudflare and is the fragile half; parsing is pure and
 * re-runnable. Raw HTML lands in data/fbref/ and stays there, so a parser
 * change costs nothing to re-apply and a failed run never leaves the database
 * half-written.
 *
 * This script does NOT touch Supabase. It only reads FBref and writes files.
 *
 * Usage:
 *   node scripts/fbref/collect.js "Premier League" 2024
 *   node scripts/fbref/collect.js "Premier League" 2024 2025 2026
 *   node scripts/fbref/collect.js "League One" --missing     # every season we lack
 *   node scripts/fbref/collect.js "Premier League" 2024 --reparse   # skip the network
 *
 * Requires Chrome on --remote-debugging-port=9222. See cdp.js.
 */

const fs = require('fs');
const path = require('path');
const { Tab, navigate, browserInfo, sleep } = require('./cdp');
const { byName, buildUrl, missingSeasons, seasonLabel, PAGE_TYPES, COMPETITIONS } = require('./competitions');
const { parseStandard, parseKeepers, parseDefense } = require('./parse');

const ROOT = path.join(__dirname, '..', '..');
const RAW = path.join(ROOT, 'data', 'fbref');

// FBref asks for no more than one request every three seconds. Five is
// well inside that and still collects a full season in a couple of minutes.
const DELAY_MS = 5_000;

const slugDir = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function usage(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  console.error('  Usage: node scripts/fbref/collect.js "<competition>" <season…|--missing> [--reparse]\n');
  console.error('  Competitions:');
  for (const c of COMPETITIONS) {
    console.error(`    ${c.name.padEnd(18)} tier ${String(c.tier ?? '-').padEnd(2)} ${c.country}  from ${c.first}`);
  }
  console.error('');
  process.exit(1);
}

// ─── One season ─────────────────────────────────────────────────────────────

async function collectSeason(tab, comp, year, { reparse, refetch }) {
  const dir = path.join(RAW, slugDir(comp.name), seasonLabel(year));
  fs.mkdirSync(dir, { recursive: true });

  const pages = {};
  for (const type of Object.keys(PAGE_TYPES)) {
    const file = path.join(dir, `${type}.html`);

    // Resumable by default: a page already on disk is never re-fetched.
    // A 300-page rebuild will be interrupted at some point, and re-running
    // it should cost nothing for the seasons already collected. --refetch
    // forces the network for the rare case where a saved page is bad.
    if (fs.existsSync(file) && fs.statSync(file).size > 20_000 && !refetch) {
      pages[type] = fs.readFileSync(file, 'utf8');
      continue;
    }
    if (reparse) continue;   // reparse mode never hits the network

    const url = buildUrl(comp, year, type);

    // A dropped connection is not a reason to abandon a three-hour scrape.
    // Retry with a widening pause so a laptop being carried between rooms,
    // or a wifi handover, costs a minute rather than the run.
    let saved = false;
    for (let attempt = 1; attempt <= 4 && !saved; attempt++) {
      try {
        const res = await navigate(tab, url);
        fs.writeFileSync(file, res.html);
        pages[type] = res.html;
        process.stdout.write(`    ${type.padEnd(8)} ${(res.html.length / 1048576).toFixed(1)} MB\n`);
        saved = true;
      } catch (e) {
        if (attempt === 4) {
          // keepers and defense genuinely do not exist for older seasons,
          // so only a missing stats page is fatal.
          if (PAGE_TYPES[type].required) throw e;
          process.stdout.write(`    ${type.padEnd(8)} — not available\n`);
        } else {
          const wait = attempt * 20;
          process.stdout.write(`    ${type.padEnd(8)} — ${e.message.split('\n')[0]}; retrying in ${wait}s (${attempt}/3)\n`);
          await sleep(wait * 1000);
        }
      }
    }
    await sleep(DELAY_MS);
  }

  if (!pages.stats) throw new Error(`no stats page for ${comp.name} ${seasonLabel(year)}`);

  const { rows, warnings, commented } = parseStandard(pages.stats);
  const keepers = pages.keepers ? parseKeepers(pages.keepers) : {};
  const defense = pages.defense ? parseDefense(pages.defense) : {};

  for (const r of rows) {
    Object.assign(r, keepers[r.fbref_player_id] || {}, defense[r.fbref_player_id] || {});
    r.competition_id = comp.id;
    r.season_start_year = year;
    r.season_label = `${year}/${String(year + 1).slice(2)}`;
  }

  const out = path.join(dir, 'parsed.json');
  fs.writeFileSync(out, JSON.stringify(rows, null, 1));

  const noPlayerId = rows.filter((r) => !r.fbref_player_id).length;
  const noSquadId = rows.filter((r) => !r.fbref_squad_id).length;
  const clubs = new Set(rows.map((r) => r.fbref_squad_id)).size;

  console.log(
    `    parsed   ${String(rows.length).padStart(4)} rows · ${clubs} clubs` +
    `${commented ? ' · table was commented out' : ''}` +
    `${noPlayerId ? ` · ⚠ ${noPlayerId} without a player id` : ''}` +
    `${noSquadId ? ` · ⚠ ${noSquadId} without a squad id` : ''}` +
    `${keepers && Object.keys(keepers).length ? ` · ${Object.keys(keepers).length} keepers` : ''}`
  );
  if (warnings.length && process.env.VERBOSE) {
    for (const w of warnings.slice(0, 10)) console.log(`      ${w}`);
  }
  return rows;
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const argv = process.argv.slice(2);
  const reparse = argv.includes('--reparse');
  const refetch = argv.includes('--refetch');
  const wantMissing = argv.includes('--missing');
  const positional = argv.filter((a) => !a.startsWith('--'));

  if (!positional.length) usage('name a competition');

  const comp = byName(positional[0]);
  if (!comp) usage(`unknown competition "${positional[0]}"`);
  if (comp.irregular) usage(`${comp.name} has irregular season URLs and needs handling of its own`);

  const years = wantMissing
    ? missingSeasons(comp)
    : positional.slice(1).map(Number).filter((n) => Number.isFinite(n));

  if (!years.length) usage('name at least one season start year, or pass --missing');

  if (!reparse) {
    const info = await browserInfo();
    console.log(`\n  ${info.Browser} on the debugging port\n`);
  }

  console.log(`  ${comp.name} · ${years.length} season${years.length > 1 ? 's' : ''} ` +
              `· ${years[0]} → ${years[years.length - 1]}${reparse ? ' · reparse only' : ''}\n`);

  const tab = reparse ? null : await Tab.open();
  const totals = { rows: 0, seasons: 0 };
  try {
    for (const y of years) {
      console.log(`  ${seasonLabel(y)}`);
      const rows = await collectSeason(tab, comp, y, { reparse, refetch });
      totals.rows += rows.length;
      totals.seasons++;
    }
  } finally {
    if (tab) await tab.close();
  }

  console.log(`\n  ✓ ${totals.rows.toLocaleString()} rows across ${totals.seasons} seasons`);
  console.log(`  ✓ data/fbref/${slugDir(comp.name)}/\n`);
})().catch((e) => {
  console.error(`\n  ✗ ${e.message}\n`);
  process.exit(1);
});
