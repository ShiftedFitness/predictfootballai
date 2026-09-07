#!/usr/bin/env node
/**
 * legacy_scopes.js — map every legacy scope id to a team slug.
 *
 * A round played before the rebuild was filed in ts_game_sessions.game_category
 * under whatever id the game's own hardcoded list used at the time. Those lists
 * disagree with each other and with the database: Higher or Lower wrote
 * 'epl_club_manchesterunited', Starting XI wrote 'club_manutd', and neither
 * matches 'team_manchester-united_premier-league'.
 *
 * A team leaderboard built from a regex over club names would quietly miss the
 * clubs with the most history, so this reads the ids out of the game handlers
 * themselves. Each legacy entry carries a `clubName` — the exact string it
 * matched in the database — which is the same string _teams.js knows as
 * game_name. That is the join, and it is exact rather than guessed.
 *
 *   node scripts/teams/legacy_scopes.js
 *
 * Output: data/teams/legacy_scopes.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FUNCS = path.join(ROOT, 'netlify', 'functions');

// Higher or Lower and Player Alphabet are asked for their scopes by calling
// their handlers, and those need Supabase credentials. Without this the calls
// fail, the script still exits 0, and it quietly writes a third of the map —
// which is how the team leaderboards would have lost their history.
for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 0) continue;
  if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const teams = require(path.join(FUNCS, '_teams.js'));

const SOURCES = ['xi_start.js', 'xi_score.js', 'whoami_start.js', 'quiz_start.js', 'match_start.js'];

/**
 * Higher or Lower and Player Alphabet do not write their ids out as literals —
 * they build them from arrays of club names at module load. So rather than
 * re-implement that construction here (a second copy, free to drift), ask the
 * handlers themselves: get_scopes is the same code path the game uses, and it
 * returns the ids as the game will actually write them.
 */
const ASK = [
  ['hol_start.js', { action: 'get_scopes' }],
  ['alpha_start.js', { action: 'get_scopes' }],
];

// Only lines that pair an id with the club name it resolved to. Anything that
// does not carry both is not a club scope and is none of this script's business.
const ENTRY = /id:\s*'([a-z0-9_]+)'[^\n]*?clubName:\s*'([^']+)'/g;

// Resolve on the string the games actually matched, which is game_name.
const byGameName = new Map();
for (const t of teams.all()) {
  byGameName.set(t.game_name, t.slug);
  if (!byGameName.has(t.name)) byGameName.set(t.name, t.slug);
}

(async function main() {
  const out = {};
  const unresolved = new Map();
  let scanned = 0;

  for (const file of SOURCES) {
    const p = path.join(FUNCS, file);
    if (!fs.existsSync(p)) { console.log(`    skipped (missing): ${file}`); continue; }
    const src = fs.readFileSync(p, 'utf8');
    let m, found = 0;
    ENTRY.lastIndex = 0;
    while ((m = ENTRY.exec(src))) {
      const [, id, clubName] = m;
      if (id.startsWith('team_')) continue;            // already canonical
      found++;
      const slug = byGameName.get(clubName);
      if (!slug) { unresolved.set(clubName, (unresolved.get(clubName) || 0) + 1); continue; }
      // Two files can define the same id; they must agree.
      if (out[id] && out[id] !== slug) {
        console.log(`    ✗ ${id}: ${out[id]} vs ${slug} (${file})`);
      }
      out[id] = slug;
    }
    scanned++;
    console.log(`    ${file.padEnd(20)} ${found} club scopes`);
  }

  for (const [file, body] of ASK) {
    const p = path.join(FUNCS, file);
    if (!fs.existsSync(p)) { console.log(`    skipped (missing): ${file}`); continue; }
    let scopes = [];
    try {
      const res = await require(p).handler(
        { httpMethod: 'POST', headers: {}, body: JSON.stringify(body) }, {});
      scopes = (JSON.parse(res.body || '{}').scopes) || [];
    } catch (e) {
      // Not a warning. A partial map means played rounds stop attributing to
      // their club, silently, on every team page.
      throw new Error(`${file} could not be asked for its scopes: ${e.message}`);
    }
    let found = 0;
    for (const s of scopes) {
      if (!s || s.type !== 'club' || !s.id || String(s.id).startsWith('team_')) continue;
      found++;
      // These carry `club` or `clubName` depending on the handler's shape; the
      // label is a shortened display name and is deliberately not used.
      const clubName = s.clubName || s.club || null;
      const slug = clubName ? byGameName.get(clubName) : null;
      if (!slug) { unresolved.set(clubName || s.id, (unresolved.get(clubName || s.id) || 0) + 1); continue; }
      out[s.id] = slug;
    }
    scanned++;
    console.log(`    ${file.padEnd(20)} ${found} club scopes (live)`);
  }

  // The same club under a league prefix: 'epl_club_arsenal' and 'club_arsenal'
  // are both in the sources, but a game that only ever wrote one of the two
  // still played the same club. Fill in the prefixed forms from the bare ones.
  const KEYS = Object.values(teams.LEAGUE_KEYS);
  for (const [id, slug] of Object.entries({ ...out })) {
    const bare = id.replace(/^[a-z0-9]+_club_/, 'club_');
    if (!out[bare]) out[bare] = slug;
    for (const k of KEYS) {
      const prefixed = `${k}_${bare}`;
      if (!out[prefixed]) out[prefixed] = slug;
    }
  }

  const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  fs.writeFileSync(path.join(ROOT, 'data', 'teams', 'legacy_scopes.json'),
    JSON.stringify({ generated: new Date().toISOString(), scopes: sorted }, null, 2) + '\n');

  if (scanned < SOURCES.length + ASK.length - 1) {
    throw new Error(`only ${scanned} of ${SOURCES.length + ASK.length} sources were read — refusing to write a partial map`);
  }
  console.log(`\n  ✓ ${Object.keys(sorted).length} legacy scope ids from ${scanned} files`);
  console.log(`    ${new Set(Object.values(sorted)).size} distinct clubs`);
  if (unresolved.size) {
    console.log(`\n  ! ${unresolved.size} club names in the game lists resolve to no team:`);
    for (const [n, c] of unresolved) console.log(`      ${n} (${c})`);
  }
  console.log();
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
