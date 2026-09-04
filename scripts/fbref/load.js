#!/usr/bin/env node
/**
 * load.js — assemble everything in data/fbref/ and load it into the _v2 tables.
 *
 * DRY RUN BY DEFAULT. Writing requires --load, explicitly. The dry run reads
 * every parsed season, resolves players and clubs into the entities they will
 * become, diffs the result against the pre-rebuild backup and prints the lot —
 * without opening a connection to Supabase.
 *
 *   node scripts/fbref/load.js              # report only, writes nothing
 *   node scripts/fbref/load.js --load       # actually write to the _v2 tables
 *
 * The _v2 tables must exist first: run sql/014_rebuild_schema.sql.
 * Nothing here touches the live tables. The swap is a separate, manual step.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { COMPETITIONS, seasonLabel } = require('./competitions');

const ROOT = path.join(__dirname, '..', '..');
const RAW = path.join(ROOT, 'data', 'fbref');
const slugDir = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const n = (x) => (x ?? 0).toLocaleString();
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');

// ─── Read every parsed season ───────────────────────────────────────────────

/**
 * A handful of players — 220 rows out of 200,000, almost all in League Two
 * between 2002 and 2006 — appear in FBref's tables with no player page and
 * therefore no id. They still played the games, so they are kept rather than
 * dropped, under a synthetic id derived from name and birth year. It is
 * deterministic, so the same person merges across seasons and clubs on a
 * re-run, and it can never collide with a real FBref id because of the prefix.
 */
function syntheticId(row) {
  const seed = [row.player_name, row.nationality || '', row.birth_year || ''].join('|').toLowerCase();
  return 'x' + crypto.createHash('sha1').update(seed).digest('hex').slice(0, 7);
}

/**
 * FBref occasionally lists the same player twice for one club in one season —
 * two rows, one appearance each. Summing is the honest resolution: the totals
 * are right either way, and the alternative is discarding real appearances.
 */
function mergeDuplicates(rows) {
  const SUM = ['appearances', 'starts', 'sub_appearances', 'minutes', 'goals', 'assists',
               'pens_scored', 'pens_attempted', 'cards_yellow', 'cards_red',
               'goals_against', 'clean_sheets', 'shots_on_target_against', 'saves',
               'wins', 'draws', 'losses', 'tackles_won', 'interceptions', 'tackles_interceptions'];
  const out = new Map();
  let merged = 0;
  for (const r of rows) {
    const k = `${r.fbref_player_id}|${r.fbref_squad_id}|${r.competition_id}|${r.season_start_year}`;
    const cur = out.get(k);
    if (!cur) { out.set(k, r); continue; }
    merged++;
    for (const f of SUM) {
      if (r[f] == null) continue;
      cur[f] = (cur[f] ?? 0) + r[f];
    }
  }
  return { rows: [...out.values()], merged };
}

function readAll() {
  const rows = [];
  const perComp = new Map();

  for (const comp of COMPETITIONS) {
    const dir = path.join(RAW, slugDir(comp.name));
    if (!fs.existsSync(dir)) continue;
    let seasons = 0, count = 0;
    for (const season of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, season, 'parsed.json');
      if (!fs.existsSync(file)) continue;
      const batch = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const r of batch) if (!r.fbref_player_id) r.fbref_player_id = syntheticId(r);
      for (const r of batch) rows.push(r);
      seasons++; count += batch.length;
    }
    if (seasons) perComp.set(comp.id, { comp, seasons, count });
  }
  return { rows, perComp };
}

// ─── Resolve entities ───────────────────────────────────────────────────────

/**
 * One row per human, keyed on FBref's id. A player's name, nationality and
 * birth year are taken from the season where he played most — FBref's own
 * spelling drifts a little across eras, and the season he actually featured
 * in is the most trustworthy.
 */
function buildPlayers(rows) {
  const best = new Map();
  for (const r of rows) {
    if (!r.fbref_player_id) continue;
    const cur = best.get(r.fbref_player_id);
    const weight = r.minutes ?? r.appearances ?? 0;
    if (!cur || weight > cur.weight) {
      best.set(r.fbref_player_id, {
        weight,
        fbref_player_id: r.fbref_player_id,
        player_name: r.player_name,
        nationality: r.nationality,
        birth_year: r.birth_year,
        position_bucket: r.position_bucket,
      });
    }
  }
  for (const p of best.values()) delete p.weight;
  return best;
}

/**
 * One row per club, keyed on FBref's squad id — which is already stable. The
 * NAME is the thing that wobbles: the season-specific URL gives
 * "West-Ham-United-Stats" while the current-season URL, having no season
 * segment, gives "West-Ham-Stats". Same club, same id, two spellings. Taking
 * the most frequent form across every season it appears in (longest wins a
 * tie) settles on the full name rather than whichever page happened to be
 * read first.
 */
function buildClubs(rows) {
  const names = new Map();   // squad id -> { name -> count }
  const shorts = new Map();
  for (const r of rows) {
    if (!r.fbref_squad_id) continue;
    if (!names.has(r.fbref_squad_id)) names.set(r.fbref_squad_id, new Map());
    const tally = names.get(r.fbref_squad_id);
    tally.set(r.club_name, (tally.get(r.club_name) || 0) + 1);
    if (r.club_name_short) shorts.set(r.fbref_squad_id, r.club_name_short);
  }

  const clubs = new Map();
  for (const [id, tally] of names) {
    const best = [...tally.entries()]
      .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    clubs.set(id, {
      fbref_squad_id: id,
      club_name: best,
      club_name_short: shorts.get(id) || best,
      name_variants: tally.size,
    });
  }
  return clubs;
}

// ─── Compare with the pre-rebuild backup ────────────────────────────────────

const demojibake = (s) => {
  if (!/[ÃÂ][\x80-\xBF -ÿ]/.test(s || '')) return s;
  try {
    const f = Buffer.from(s, 'latin1').toString('utf8');
    return f.includes('�') ? s : f;
  } catch { return s; }
};
const normName = (s) =>
  demojibake(String(s || '')).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

function loadBackup() {
  const dir = path.join(ROOT, 'data', 'backups');
  if (!fs.existsSync(dir)) return null;
  const runs = fs.readdirSync(dir).filter((d) => /^\d{4}-/.test(d)).sort();
  if (!runs.length) return null;
  const b = path.join(dir, runs[runs.length - 1]);
  const nd = (f) => fs.readFileSync(path.join(b, f), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { dir: runs[runs.length - 1], players: nd('players.ndjson'),
           clubs: nd('clubs.ndjson'), stats: nd('player_season_stats.ndjson'),
           current: nd('current_season_player_stats.ndjson') };
}

// ─── Report ─────────────────────────────────────────────────────────────────

function report(rows, perComp, players, clubs, backup) {
  const seasons = new Set(rows.map((r) => `${r.competition_id}:${r.season_start_year}`));
  const years = [...new Set(rows.map((r) => r.season_start_year))].sort();

  console.log(`\n  ══ COLLECTED ══\n`);
  console.log(`    ${n(rows.length)} season rows · ${n(players.size)} players · ` +
              `${n(clubs.size)} clubs · ${seasons.size} competition-seasons`);
  console.log(`    ${years[0]}–${years[years.length - 1]}\n`);

  console.log(`    ${'competition'.padEnd(18)} ${'seasons'.padStart(7)} ${'rows'.padStart(8)}`);
  for (const { comp, seasons: s, count } of
       [...perComp.values()].sort((a, b) => (a.comp.tier ?? 9) - (b.comp.tier ?? 9) || a.comp.name.localeCompare(b.comp.name))) {
    const tag = comp.country === 'ENG' && comp.tier ? `  tier ${comp.tier}` : '';
    console.log(`    ${comp.name.padEnd(18)} ${String(s).padStart(7)} ${String(count).padStart(8)}${tag}`);
  }

  // Identity health — the reason for all of this.
  const noPid = rows.filter((r) => String(r.fbref_player_id).startsWith('x')).length;
  const noSid = rows.filter((r) => !r.fbref_squad_id).length;
  const noBirth = [...players.values()].filter((p) => !p.birth_year).length;
  const noNat = [...players.values()].filter((p) => !p.nationality).length;

  console.log(`\n  ══ IDENTITY ══\n`);
  console.log(`    rows on a synthetic player id  ${String(noPid).padStart(7)}   ${pct(noPid, rows.length)}   (no FBref page exists)`);
  const variants = [...clubs.values()].filter((c) => c.name_variants > 1).length;
  console.log(`    clubs seen under >1 spelling   ${String(variants).padStart(7)}   resolved to the most common`);
  console.log(`    rows with no FBref squad id    ${String(noSid).padStart(7)}   ${pct(noSid, rows.length)}`);
  console.log(`    players with no birth year     ${String(noBirth).padStart(7)}   ${pct(noBirth, players.size)}`);
  console.log(`    players with no nationality    ${String(noNat).padStart(7)}   ${pct(noNat, players.size)}`);

  // Multi-club seasons — the case that has to work.
  const perSeason = new Map();
  for (const r of rows) {
    const k = `${r.fbref_player_id}:${r.competition_id}:${r.season_start_year}`;
    perSeason.set(k, (perSeason.get(k) || 0) + 1);
  }
  const multi = [...perSeason.values()].filter((c) => c > 1).length;
  console.log(`    player-seasons split over 2+ clubs ${String(multi).padStart(3)}   (expected; one row each)`);

  // Primary-key safety: (player, club, competition, season) must be unique.
  const pk = new Set(); let collisions = 0;
  for (const r of rows) {
    const k = `${r.fbref_player_id}|${r.fbref_squad_id}|${r.competition_id}|${r.season_start_year}`;
    if (pk.has(k)) collisions++; else pk.add(k);
  }
  console.log(`    primary-key collisions         ${String(collisions).padStart(7)}   ${collisions ? '⚠ MUST BE ZERO' : 'none'}`);

  if (!backup) return { collisions };

  // What changes against the live database.
  const oldRows = [...backup.stats, ...backup.current];
  const oldNames = new Set(backup.players.map((p) => normName(p.player_name)));
  const newNames = new Set([...players.values()].map((p) => normName(p.player_name)));
  const known = [...newNames].filter((x) => oldNames.has(x)).length;

  console.log(`\n  ══ AGAINST THE LIVE DATABASE ══   (backup ${backup.dir})\n`);
  console.log(`    season rows        ${String(n(oldRows.length)).padStart(9)}  →  ${n(rows.length)}`);
  console.log(`    player records     ${String(n(backup.players.length)).padStart(9)}  →  ${n(players.size)}` +
              `   (${n(backup.players.length - players.size)} fewer — the duplicate identities)`);
  console.log(`    club records       ${String(n(backup.clubs.length)).padStart(9)}  →  ${n(clubs.size)}`);
  console.log(`    names recognised   ${String(n(known)).padStart(9)}      ${pct(known, newNames.size)} of the new set`);

  return { collisions };
}

/** The two players this whole exercise was diagnosed on. */
function spotCheck(rows, clubs, label, match) {
  const mine = rows.filter((r) => match(r.player_name));
  if (!mine.length) return;
  const ids = [...new Set(mine.map((r) => r.fbref_player_id))];
  console.log(`\n  ── ${label} ──`);
  console.log(`     FBref ids: ${ids.join(', ')}   ${ids.length === 1 ? '✓ one identity' : '⚠ still split'}`);
  const byComp = new Map();
  for (const r of mine) {
    const c = COMPETITIONS.find((x) => x.id === r.competition_id);
    const k = c ? c.name : r.competition_id;
    const e = byComp.get(k) || { apps: 0, goals: 0, seasons: new Set(), clubs: new Set() };
    e.apps += r.appearances || 0; e.goals += r.goals || 0;
    e.seasons.add(r.season_start_year);
    // the resolved club entity, not the per-page spelling
    e.clubs.add((clubs.get(r.fbref_squad_id) || {}).club_name || r.club_name);
    byComp.set(k, e);
  }
  for (const [comp, e] of [...byComp.entries()].sort((a, b) => b[1].apps - a[1].apps)) {
    console.log(`     ${comp.padEnd(18)} ${String(e.apps).padStart(4)} apps ${String(e.goals).padStart(3)}g ` +
                `${String(e.seasons.size).padStart(2)} seasons  ${[...e.clubs].join(', ')}`);
  }
  const tot = mine.reduce((a, r) => a + (r.appearances || 0), 0);
  console.log(`     ${'TOTAL'.padEnd(18)} ${String(tot).padStart(4)} apps`);
}

// ─── Write ──────────────────────────────────────────────────────────────────

async function write(rows, players, clubs) {
  const { createClient } = require('@supabase/supabase-js');
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i < 0) continue;
    if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  const url = process.env.Supabase_Project_URL, key = process.env.Supabase_Service_Role;
  if (!url || !key) throw new Error('.env is missing the Supabase values');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const chunk = async (table, list, conflict) => {
    const SIZE = 500;
    for (let i = 0; i < list.length; i += SIZE) {
      const { error } = await db.from(table).upsert(list.slice(i, i + SIZE), { onConflict: conflict });
      if (error) throw new Error(`${table}: ${error.message}`);
      process.stdout.write(`\r    ${table} … ${n(Math.min(i + SIZE, list.length))} / ${n(list.length)}`);
    }
    process.stdout.write(`\r    ${table.padEnd(26)} ${String(list.length).padStart(8)} ✓\n`);
  };

  console.log(`\n  Writing to the _v2 tables…\n`);
  await chunk('players_v2', [...players.values()], 'fbref_player_id');
  await chunk('clubs_v2',
              [...clubs.values()].map(({ name_variants, ...c }) => c), 'fbref_squad_id');

  // Map FBref ids to the surrogate keys the database just assigned.
  const pMap = new Map(), cMap = new Map();
  for (const [table, col, map] of [['players_v2', 'fbref_player_id', pMap],
                                   ['clubs_v2', 'fbref_squad_id', cMap]]) {
    const idCol = table === 'players_v2' ? 'player_id' : 'club_id';
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select(`${idCol}, ${col}`).range(from, from + 999);
      if (error) throw new Error(`${table} read-back: ${error.message}`);
      if (!data.length) break;
      for (const r of data) map.set(r[col], r[idCol]);
      if (data.length < 1000) break;
    }
  }

  const stats = rows
    .filter((r) => pMap.has(r.fbref_player_id) && cMap.has(r.fbref_squad_id))
    .map((r) => ({
      player_id: pMap.get(r.fbref_player_id),
      club_id: cMap.get(r.fbref_squad_id),
      competition_id: r.competition_id,
      season_start_year: r.season_start_year,
      season_label: r.season_label,
      position_raw: r.position_raw, position_bucket: r.position_bucket, age: r.age,
      appearances: r.appearances, starts: r.starts, sub_appearances: r.sub_appearances,
      minutes: r.minutes, goals: r.goals, assists: r.assists,
      pens_scored: r.pens_scored, pens_attempted: r.pens_attempted,
      cards_yellow: r.cards_yellow, cards_red: r.cards_red,
      goals_against: r.goals_against, clean_sheets: r.clean_sheets,
      shots_on_target_against: r.shots_on_target_against, saves: r.saves,
      wins: r.wins, draws: r.draws, losses: r.losses,
      tackles_won: r.tackles_won, interceptions: r.interceptions,
      tackles_interceptions: r.tackles_interceptions,
    }));

  await chunk('player_season_stats_v2', stats,
              'player_id,club_id,competition_id,season_start_year');

  console.log(`\n    rebuilding aggregates…`);
  const { error } = await db.rpc('rebuild_aggregates');
  if (error) throw new Error(`rebuild_aggregates: ${error.message}`);
  console.log(`    aggregates rebuilt ✓\n`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const doLoad = process.argv.includes('--load');

  const { rows: raw, perComp } = readAll();
  if (!raw.length) {
    console.error('\n  ✗ nothing in data/fbref/ — run collect.js first\n');
    process.exit(1);
  }
  const { rows, merged } = mergeDuplicates(raw);
  if (merged) {
    console.log(`\n  merged ${merged} duplicate FBref rows ` +
                `(same player, club, competition and season)`);
  }

  const players = buildPlayers(rows);
  const clubs = buildClubs(rows);
  const backup = loadBackup();

  const { collisions } = report(rows, perComp, players, clubs, backup);

  console.log(`\n  ══ SPOT CHECKS ══`);
  spotCheck(rows, clubs, 'Mohamed Salah — was three identities, split by competition',
            (nm) => nm === 'Mohamed Salah');
  spotCheck(rows, clubs, 'Jarrod Bowen — was three identities, 2024-25 missing entirely',
            (nm) => nm === 'Jarrod Bowen');

  if (!doLoad) {
    console.log(`\n  Dry run. Nothing written.`);
    console.log(`  To load: apply sql/014_rebuild_schema.sql, then re-run with --load\n`);
    return;
  }
  if (collisions) {
    console.error(`\n  ✗ ${collisions} primary-key collisions — refusing to load.\n`);
    process.exit(1);
  }
  await write(rows, players, clubs);
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
