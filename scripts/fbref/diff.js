#!/usr/bin/env node
/**
 * diff.js — compare a freshly collected season against what the database
 * already holds, using the local backup rather than touching Supabase.
 *
 * This is the acceptance test for the collector. Run it on a season that is
 * already complete and correct in the database (2024-25, say) and the two
 * sides should agree almost row for row; anything that does not agree is a
 * parser bug, not a data update. Run it on 2025-26 and the differences are
 * the seven months of staleness.
 *
 * Matching is by player name + club name, because that is the only key the
 * two sides currently share — the database has no FBref ids yet. Which is
 * exactly the problem the rebuild fixes, so the mismatches this reports on a
 * settled season are themselves informative.
 *
 * Usage:
 *   node scripts/fbref/diff.js "Premier League" 2024
 */

const fs = require('fs');
const path = require('path');
const { byName, seasonLabel } = require('./competitions');

const ROOT = path.join(__dirname, '..', '..');
const slugDir = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function latestBackup() {
  const dir = path.join(ROOT, 'data', 'backups');
  const runs = fs.readdirSync(dir).filter((d) => /^\d{4}-/.test(d)).sort();
  if (!runs.length) throw new Error('no backup found — run scripts/backup_tables.js first');
  return path.join(dir, runs[runs.length - 1]);
}

const ndjson = (file) =>
  fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** Club names in the database sometimes carry FBref's flag prefix. */
const cleanClub = (s) => String(s || '').replace(/^[a-z]{2,3} /, '').trim();

/**
 * Repair UTF-8 that was decoded as Latin-1 on the way in: the database holds
 * 511 names like "Abdoulaye DoucourÃ©" that should read "Abdoulaye Doucouré".
 * Without this the diff reports them as missing players rather than as the
 * encoding bug they are.
 */
const demojibake = (s) => {
  if (!/[ÃÂ][\x80-\xBF\u00A0-\u00FF]/.test(s)) return s;
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    return fixed.includes('\uFFFD') ? s : fixed;
  } catch { return s; }
};

/** Loose name match: repair encoding, casefold, strip accents and punctuation. */
const normName = (s) =>
  demojibake(String(s || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

const FIELDS = ['appearances', 'goals', 'assists', 'minutes'];

(function main() {
  const [compName, yearArg] = process.argv.slice(2);
  const comp = byName(compName);
  const year = Number(yearArg);
  if (!comp || !Number.isFinite(year)) {
    console.error('\n  Usage: node scripts/fbref/diff.js "<competition>" <season start year>\n');
    process.exit(1);
  }

  const parsedFile = path.join(ROOT, 'data', 'fbref', slugDir(comp.name), seasonLabel(year), 'parsed.json');
  if (!fs.existsSync(parsedFile)) {
    console.error(`\n  ✗ nothing collected yet for ${comp.name} ${seasonLabel(year)}\n`);
    process.exit(1);
  }
  const fresh = JSON.parse(fs.readFileSync(parsedFile, 'utf8'));

  const backup = latestBackup();
  const clubs = new Map(ndjson(path.join(backup, 'clubs.ndjson')).map((c) => [c.club_id, c.club_name]));
  const players = new Map(ndjson(path.join(backup, 'players.ndjson')).map((p) => [p.player_uid, p.player_name]));

  const dbRows = [];
  for (const f of ['player_season_stats.ndjson', 'current_season_player_stats.ndjson']) {
    for (const r of ndjson(path.join(backup, f))) {
      if (r.competition_id === comp.id && r.season_start_year === year) dbRows.push(r);
    }
  }

  const key = (name, club) => `${normName(name)}|${normName(cleanClub(club))}`;
  const dbByKey = new Map();
  for (const r of dbRows) dbByKey.set(key(players.get(r.player_uid), clubs.get(r.club_id)), r);

  const matched = [], onlyFbref = [], changed = [];
  const seen = new Set();

  for (const f of fresh) {
    const k = key(f.player_name, f.club_name);
    const d = dbByKey.get(k);
    if (!d) { onlyFbref.push(f); continue; }
    seen.add(k);
    matched.push([f, d]);
    const deltas = FIELDS
      .filter((fl) => (f[fl] ?? 0) !== (d[fl] ?? 0))
      .map((fl) => `${fl} ${d[fl] ?? 0}→${f[fl] ?? 0}`);
    if (deltas.length) changed.push({ f, d, deltas });
  }
  const onlyDb = [...dbByKey.entries()].filter(([k]) => !seen.has(k)).map(([, r]) => r);

  const pct = (n, d) => d ? `${((100 * n) / d).toFixed(1)}%` : '—';

  console.log(`\n  ${comp.name} ${seasonLabel(year)}   FBref ${fresh.length} rows  ·  database ${dbRows.length} rows\n`);
  console.log(`    matched on name+club   ${String(matched.length).padStart(5)}   ${pct(matched.length, fresh.length)} of FBref`);
  console.log(`    identical              ${String(matched.length - changed.length).padStart(5)}   ${pct(matched.length - changed.length, matched.length)} of matched`);
  console.log(`    differing values       ${String(changed.length).padStart(5)}`);
  console.log(`    only on FBref          ${String(onlyFbref.length).padStart(5)}`);
  console.log(`    only in database       ${String(onlyDb.length).padStart(5)}`);

  if (changed.length) {
    console.log(`\n  Biggest changes:`);
    changed
      .sort((a, b) => Math.abs((b.f.appearances ?? 0) - (b.d.appearances ?? 0))
                    - Math.abs((a.f.appearances ?? 0) - (a.d.appearances ?? 0)))
      .slice(0, 12)
      .forEach(({ f, deltas }) =>
        console.log(`    ${(f.player_name + ' · ' + f.club_name).padEnd(42)} ${deltas.join('  ')}`));
  }
  if (onlyFbref.length) {
    console.log(`\n  On FBref but not in the database (first 10):`);
    onlyFbref.slice(0, 10).forEach((f) =>
      console.log(`    ${(f.player_name + ' · ' + f.club_name).padEnd(42)} ${f.appearances} apps`));
  }
  if (onlyDb.length) {
    console.log(`\n  In the database but not on FBref (first 10):`);
    onlyDb.slice(0, 10).forEach((r) =>
      console.log(`    ${((players.get(r.player_uid) || '?') + ' · ' + (clubs.get(r.club_id) || '?')).padEnd(42)} ${r.appearances} apps`));
  }

  // ── Club-name-free comparison ────────────────────────────────────────────
  //
  // The club names disagree in both directions — the database has the long
  // form for Newcastle United and Nottingham Forest, the short form for
  // Brighton and Wolves — because it was built from more than one page style.
  // That is the club-identity bug, not a data difference, and it makes a
  // name+club join understate agreement. Rolling each side up to season
  // totals per player takes club naming out of the question entirely and
  // measures the only thing that matters here: are the numbers right?
  const roll = (rows, name, get) => {
    const m = new Map();
    for (const r of rows) {
      const k = normName(name(r));
      if (!k) continue;
      const cur = m.get(k) || { appearances: 0, goals: 0, minutes: 0 };
      for (const f of ['appearances', 'goals', 'minutes']) cur[f] += get(r, f) || 0;
      m.set(k, cur);
    }
    return m;
  };
  const fRoll = roll(fresh, (r) => r.player_name, (r, f) => r[f]);
  const dRoll = roll(dbRows, (r) => players.get(r.player_uid), (r, f) => r[f]);

  let both = 0, same = 0, diffApps = 0;
  for (const [k, fv] of fRoll) {
    const dv = dRoll.get(k);
    if (!dv) continue;
    both++;
    if (fv.appearances === dv.appearances && fv.goals === dv.goals) same++;
    else if (fv.appearances !== dv.appearances) diffApps++;
  }
  console.log(`\n  Season totals per player, club naming ignored:`);
  console.log(`    players on both sides  ${String(both).padStart(5)}   ` +
              `${pct(both, fRoll.size)} of FBref's ${fRoll.size}`);
  console.log(`    apps AND goals agree   ${String(same).padStart(5)}   ${pct(same, both)}`);
  console.log(`    appearances differ     ${String(diffApps).padStart(5)}`);
  console.log(`    only on FBref          ${String(fRoll.size - both).padStart(5)}`);
  console.log(`    only in database       ${String(dRoll.size - both).padStart(5)}`);
  console.log('');
})();
