#!/usr/bin/env node
/**
 * bridge.js — map every OLD player_uid onto a NEW player_id.
 *
 * The rebuild replaced a derived string key with FBref's own id, which is the
 * whole point. But 6,548 performance scores and eleven Netlify functions still
 * speak the old language, so the two have to be introduced to each other
 * before anything is renamed.
 *
 * The mapping is many-to-one on purpose: Salah's three uids and Bowen's three
 * all land on one player_id. That collapsing IS the fix.
 *
 *   node scripts/fbref/bridge.js            # report only
 *   node scripts/fbref/bridge.js --write    # stamp canonical uids onto players_v2
 *                                           # and write the alias map to disk
 *
 * Writes only to players_v2.player_uid, a column nothing reads yet.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'data', 'bridge');

// ─── Name normalisation ─────────────────────────────────────────────────────

/** 511 names in the old table are UTF-8 that was decoded as Latin-1. */
const demojibake = (s) => {
  if (!/[ÃÂ][\x80-\xBF -ÿ]/.test(s || '')) return s;
  try {
    const f = Buffer.from(s, 'latin1').toString('utf8');
    return f.includes('�') ? s : f;
  } catch { return s; }
};

const norm = (s) =>
  demojibake(String(s || ''))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// ─── Load both sides ────────────────────────────────────────────────────────

function latestBackup() {
  const dir = path.join(ROOT, 'data', 'backups');
  const runs = fs.readdirSync(dir).filter((d) => /^\d{4}-/.test(d)).sort();
  return path.join(dir, runs[runs.length - 1]);
}

const ndjson = (f) =>
  fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function loadNew() {
  for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i < 0) continue;
    if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(process.env.Supabase_Project_URL, process.env.Supabase_Service_Role,
                          { auth: { persistSession: false } });
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('players_v2')
      .select('player_id, fbref_player_id, player_name, nationality, birth_year')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return { db, rows };
}

// ─── Match ──────────────────────────────────────────────────────────────────

/**
 * Match old uids to new player ids.
 *
 * ONE RULE ABOVE ALL: never match across conflicting birth years. An earlier
 * version fell back to name-plus-nationality without that guard and mapped
 * `ederson|bra|1993` — Manchester City's goalkeeper — onto a different
 * Brazilian Ederson who played for Nice and Lyon and was born in 1986. Same
 * name, same country, different human. A merge like that is worse than no
 * merge, because it is invisible afterwards.
 *
 * The passes run narrowest first, and every one of them enforces the rule:
 *   1. identical name + same birth year
 *   2. one name's words are a subset of the other's + same birth year —
 *      "Ederson" against "Ederson Moraes", "Idrissa Gueye" against
 *      "Idrissa Gana Gueye". FBref uses fuller names than the old import did.
 *   3. identical name + nationality, only where no birth year contradicts
 *   4. identical name, unique on both sides, only where nothing contradicts
 *
 * Anything left over stays unmatched and is reported. Unmatched is a cost we
 * can see and quantify; a wrong merge is one we cannot.
 */
function buildMapping(oldPlayers, newPlayers) {
  const prepped = newPlayers.map((p) => ({
    ...p,
    _n: norm(p.player_name),
    _tokens: new Set(norm(p.player_name).split(' ').filter(Boolean)),
  }));

  const byName = new Map();
  const byToken = new Map();
  for (const p of prepped) {
    if (!byName.has(p._n)) byName.set(p._n, []);
    byName.get(p._n).push(p);
    for (const t of p._tokens) {
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push(p);
    }
  }

  /**
   * The guard — with one year of slack, deliberately.
   *
   * The old uids carry a systematic off-by-one: their birth year was derived
   * from age, so anyone born in the second half of the calendar year is a year
   * out. Ryan Giggs is `|1974|` in the old data and 1973 in FBref's; Jarrod
   * Bowen is `|1997|` and 1996; Rio Ferdinand `|1979|` and 1978. Rejecting
   * those loses real, correct matches.
   *
   * One year of tolerance recovers them and still refuses the case this guard
   * exists for: Ederson 1993 against Ederson 1986 is seven years apart and
   * stays vetoed. Anything matched on a non-zero gap is counted separately so
   * the slack is visible rather than assumed.
   */
  const YEAR_SLACK = 1;
  const yearGap = (oldYear, cand) => {
    if (!oldYear || !cand.birth_year) return null;         // nothing to compare
    return Math.abs(Number(oldYear) - Number(cand.birth_year));
  };
  const yearOk = (oldYear, cand) => {
    const g = yearGap(oldYear, cand);
    return g === null || g <= YEAR_SLACK;
  };

  const mapping = new Map();
  const how = { exact: 0, slack: 0, subset: 0, nat: 0, unique: 0, vetoed: 0, ambiguous: 0, none: 0 };
  const unmatched = [];

  for (const o of oldPlayers) {
    const n = norm(o.player_name);
    const tokens = new Set(n.split(' ').filter(Boolean));
    // The uid's own segments beat the columns: the nationality column was
    // normalised at some point, the uid never was.
    const year = o.player_uid.split('|')[2] || o.birth_year || '';
    const nat = (o.player_uid.split('|')[1] || '').split(' ').pop();

    // 1. identical name, birth year equal or one out
    let cands = (byName.get(n) || []).filter((c) => year && yearOk(year, c) && c.birth_year);
    if (cands.length > 1) {
      // Prefer an exact year over a one-out one before giving up as ambiguous.
      const exact = cands.filter((c) => yearGap(year, c) === 0);
      if (exact.length === 1) cands = exact;
    }
    if (cands.length === 1) {
      mapping.set(o.player_uid, cands[0].player_id);
      if (yearGap(year, cands[0]) > 0) how.slack++; else how.exact++;
      continue;
    }

    // 2. one name's words contain the other's, same birth year
    if (year && tokens.size) {
      const pool = new Map();
      for (const t of tokens) for (const c of byToken.get(t) || []) pool.set(c.player_id, c);
      cands = [...pool.values()].filter((c) => {
        if (!yearOk(year, c)) return false;
        const [small, big] = tokens.size <= c._tokens.size ? [tokens, c._tokens] : [c._tokens, tokens];
        return [...small].every((t) => big.has(t));
      });
      if (cands.length === 1) { mapping.set(o.player_uid, cands[0].player_id); how.subset++; continue; }
    }

    // 3. identical name + nationality, nothing contradicting
    const sameName = byName.get(n) || [];
    if (sameName.length && year && !sameName.some((c) => yearOk(year, c))) {
      // Every same-named candidate disagrees on birth year: a different human.
      how.vetoed++; unmatched.push(o); continue;
    }
    cands = sameName.filter((c) => nat && c.nationality &&
                                   c.nationality.toLowerCase() === nat && yearOk(year, c));
    if (cands.length === 1) { mapping.set(o.player_uid, cands[0].player_id); how.nat++; continue; }

    // 4. identical name, unique on both sides, nothing contradicting
    cands = sameName.filter((c) => yearOk(year, c));
    if (cands.length === 1) { mapping.set(o.player_uid, cands[0].player_id); how.unique++; continue; }

    if (cands.length > 1) how.ambiguous++; else how.none++;
    unmatched.push(o);
  }
  return { mapping, how, unmatched };
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const write = process.argv.includes('--write');
  const b = latestBackup();

  const oldPlayers = ndjson(path.join(b, 'players.ndjson'));
  const oldStats = [...ndjson(path.join(b, 'player_season_stats.ndjson')),
                    ...ndjson(path.join(b, 'current_season_player_stats.ndjson'))];

  console.log(`\n  old players ${oldPlayers.length.toLocaleString()} · old stat rows ${oldStats.length.toLocaleString()}`);
  const { db, rows: newPlayers } = await loadNew();
  console.log(`  new players ${newPlayers.length.toLocaleString()}\n`);

  const { mapping, how, unmatched } = buildMapping(oldPlayers, newPlayers);
  const pct = (x) => `${((100 * x) / oldPlayers.length).toFixed(1)}%`;

  console.log(`  ══ MATCHING ══\n`);
  console.log(`    exact name + birth year  ${String(how.exact).padStart(6)}   ${pct(how.exact)}`);
  console.log(`    same name, year 1 out    ${String(how.slack).padStart(6)}   ${pct(how.slack)}   (old age-derived year)`);
  console.log(`    name subset + birth year ${String(how.subset).padStart(6)}   ${pct(how.subset)}`);
  console.log(`    name + nationality       ${String(how.nat).padStart(6)}   ${pct(how.nat)}`);
  console.log(`    unique name              ${String(how.unique).padStart(6)}   ${pct(how.unique)}`);
  console.log(`    VETOED — birth year clash${String(how.vetoed).padStart(6)}   ${pct(how.vetoed)}   (different human)`);
  console.log(`    ambiguous namesakes      ${String(how.ambiguous).padStart(6)}   ${pct(how.ambiguous)}`);
  console.log(`    no candidate             ${String(how.none).padStart(6)}   ${pct(how.none)}`);
  console.log(`    ─────────────────────────────────────`);
  console.log(`    MAPPED                 ${String(mapping.size).padStart(6)}   ${pct(mapping.size)}`);

  // How much data is behind the unmatched uids? A uid with no stats behind it
  // costs nothing; one with 300 appearances would be a real loss.
  const rowsPerUid = new Map();
  for (const r of oldStats) rowsPerUid.set(r.player_uid, (rowsPerUid.get(r.player_uid) || 0) + 1);
  const orphanRows = unmatched.reduce((a, o) => a + (rowsPerUid.get(o.player_uid) || 0), 0);
  const orphanWithData = unmatched.filter((o) => rowsPerUid.get(o.player_uid)).length;
  console.log(`\n    unmatched uids holding no stats at all  ${unmatched.length - orphanWithData}`);
  console.log(`    unmatched uids holding stats            ${orphanWithData}   (${orphanRows} rows, ${((100 * orphanRows) / oldStats.length).toFixed(2)}% of the old table)`);

  if (orphanWithData) {
    console.log(`\n    biggest unmatched:`);
    unmatched
      .filter((o) => rowsPerUid.get(o.player_uid))
      .sort((a, b) => rowsPerUid.get(b.player_uid) - rowsPerUid.get(a.player_uid))
      .slice(0, 10)
      .forEach((o) => console.log(`      ${o.player_uid.padEnd(38)} ${rowsPerUid.get(o.player_uid)} rows`));
  }

  // The collapse: how many old uids now share one player_id.
  const perPlayer = new Map();
  for (const [uid, pid] of mapping) {
    if (!perPlayer.has(pid)) perPlayer.set(pid, []);
    perPlayer.get(pid).push(uid);
  }
  const collapsed = [...perPlayer.values()].filter((v) => v.length > 1);
  console.log(`\n  ══ IDENTITIES MERGED ══\n`);
  console.log(`    ${mapping.size.toLocaleString()} old uids  →  ${perPlayer.size.toLocaleString()} players`);
  console.log(`    ${collapsed.length.toLocaleString()} players were split across 2 or more uids`);
  for (const uids of collapsed.sort((a, b) => b.length - a.length).slice(0, 5)) {
    console.log(`      ${uids.join('   ')}`);
  }

  // Canonical uid per player: whichever old uid carried the most data. That is
  // the one existing rows are most likely to reference.
  const canonical = new Map();
  for (const [pid, uids] of perPlayer) {
    canonical.set(pid, uids.slice().sort((a, b) => (rowsPerUid.get(b) || 0) - (rowsPerUid.get(a) || 0))[0]);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'uid_to_player_id.json'),
                   JSON.stringify(Object.fromEntries(mapping)));
  fs.writeFileSync(path.join(OUT, 'unmatched.json'),
                   JSON.stringify(unmatched.map((o) => ({ ...o, rows: rowsPerUid.get(o.player_uid) || 0 })), null, 1));
  console.log(`\n  ✓ data/bridge/uid_to_player_id.json  (${mapping.size.toLocaleString()} entries)`);
  console.log(`  ✓ data/bridge/unmatched.json         (${unmatched.length.toLocaleString()} entries)`);

  if (!write) {
    console.log(`\n  Report only. Re-run with --write to stamp canonical uids onto players_v2.\n`);
    return;
  }

  console.log(`\n  Stamping canonical player_uid onto players_v2…`);

  // player_id is GENERATED ALWAYS AS IDENTITY, so it cannot be supplied — an
  // upsert carrying it is rejected outright. Key on fbref_player_id, the
  // natural unique key, and include player_name because it is NOT NULL:
  // Postgres validates the INSERT tuple before deciding to take the ON
  // CONFLICT branch, so a partial payload fails even though every row here
  // is certain to conflict.
  const nameById = new Map(newPlayers.map((p) => [p.player_id, p]));
  const updates = [...canonical.entries()].map(([player_id, player_uid]) => {
    const p = nameById.get(player_id);
    return { fbref_player_id: p.fbref_player_id, player_name: p.player_name, player_uid };
  });
  const SIZE = 500;
  for (let i = 0; i < updates.length; i += SIZE) {
    const { error } = await db.from('players_v2')
      .upsert(updates.slice(i, i + SIZE), { onConflict: 'fbref_player_id' });
    if (error) throw new Error(`players_v2: ${error.message}`);
    process.stdout.write(`\r    ${Math.min(i + SIZE, updates.length).toLocaleString()} / ${updates.length.toLocaleString()}`);
  }
  console.log(`\n  ✓ ${updates.length.toLocaleString()} canonical uids stamped`);

  // The alias table is what lets anything still holding an OLD uid find its
  // player — performance scores, a saved community game, a bookmarked link.
  // Every old uid goes in, including the duplicates: that many-to-one shape
  // is the fix, not a defect.
  const { error: probe } = await db.from('player_uid_aliases').select('player_uid').limit(1);
  if (probe) {
    console.log(`\n  ⚠ player_uid_aliases not found — run sql/015_compat_views.sql first`);
    return;
  }
  console.log(`\n  Populating player_uid_aliases…`);
  const aliases = [...mapping.entries()].map(([player_uid, player_id]) => ({ player_uid, player_id }));
  for (let i = 0; i < aliases.length; i += SIZE) {
    const { error } = await db.from('player_uid_aliases')
      .upsert(aliases.slice(i, i + SIZE), { onConflict: 'player_uid' });
    if (error) throw new Error(`player_uid_aliases: ${error.message}`);
    process.stdout.write(`\r    ${Math.min(i + SIZE, aliases.length).toLocaleString()} / ${aliases.length.toLocaleString()}`);
  }
  console.log(`\n  ✓ ${aliases.length.toLocaleString()} aliases written\n`);
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
