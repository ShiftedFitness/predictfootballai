#!/usr/bin/env node
/**
 * rebuild.js — collect EVERY season of EVERY competition, once.
 *
 * Drives collect.js competition by competition. Resumable: a page already on
 * disk is not re-fetched, so an interrupted run costs nothing to restart, and
 * a 300-page scrape will be interrupted.
 *
 * Writes only to data/fbref/ — it does not touch Supabase.
 *
 * Usage:
 *   node scripts/fbref/rebuild.js            # everything
 *   node scripts/fbref/rebuild.js --plan     # show the work, fetch nothing
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { regular, allSeasons, seasonLabel } = require('./competitions');

const HERE = __dirname;
const RAW = path.join(HERE, '..', '..', 'data', 'fbref');
const slugDir = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const done = (comp, y) =>
  fs.existsSync(path.join(RAW, slugDir(comp.name), seasonLabel(y), 'parsed.json'));

const work = regular().map((c) => ({
  comp: c,
  seasons: allSeasons(c),
  todo: allSeasons(c).filter((y) => !done(c, y)),
}));

const totalTodo = work.reduce((a, w) => a + w.todo.length, 0);
const totalAll = work.reduce((a, w) => a + w.seasons.length, 0);

console.log(`\n  Full rebuild — ${totalAll} season-pages, ${totalTodo} still to collect\n`);
for (const w of work) {
  const have = w.seasons.length - w.todo.length;
  console.log(`    ${w.comp.name.padEnd(18)} ${String(w.seasons.length).padStart(3)} seasons ` +
              `${w.comp.first}–2026   ${have ? `${have} already on disk` : ''}`);
}
// Three page types per season at five seconds apart, plus load time.
console.log(`\n  Estimated ${Math.round((totalTodo * 3 * 6.5) / 60)} minutes at 5s pacing\n`);

if (process.argv.includes('--plan')) process.exit(0);

let failures = [];
for (const w of work) {
  if (!w.todo.length) { console.log(`  ── ${w.comp.name}: complete\n`); continue; }
  console.log(`  ══ ${w.comp.name} — ${w.todo.length} seasons ══`);
  try {
    execFileSync('node', [path.join(HERE, 'collect.js'), w.comp.name, ...w.todo.map(String)],
                 { stdio: 'inherit' });
  } catch (e) {
    // One competition failing must not abandon the other eleven — but a dead
    // browser or a dead connection will fail all of them in a second flat,
    // which just burns through the list for nothing. Check before continuing.
    console.error(`  ✗ ${w.comp.name} stopped early`);
    failures.push(w.comp.name);
    try {
      execFileSync('curl', ['-s', '-m', '5', '-o', '/dev/null',
                            'http://localhost:9222/json/version']);
    } catch {
      console.error(`\n  ✗ Chrome is no longer on port 9222. Stopping here.`);
      console.error(`    Relaunch Chrome, then re-run this script — everything`);
      console.error(`    already collected is on disk and will be skipped.\n`);
      process.exit(1);
    }
  }
}

console.log(failures.length
  ? `\n  Finished with ${failures.length} incomplete: ${failures.join(', ')}\n  Re-run to resume.\n`
  : `\n  ✓ All ${totalAll} season-pages collected.\n`);
