#!/usr/bin/env node
/**
 * preflight.js — what would this load CHANGE that somebody decided on purpose?
 *
 * THE PROBLEM THIS EXISTS FOR.
 *
 * The database holds decisions the source does not know about: that two FBref
 * squads are one club, that Málaga is spelled with an accent, that a slug is a
 * URL that must never move. Every one of those is invisible to an ingest, and
 * an ingest that overwrites one does not error — it just quietly makes the
 * site wrong. That is how the Bullseye board emptied, and it is how the Málaga
 * page split in two.
 *
 * Both were found by a person noticing something looked odd, weeks later. This
 * looks for them before the write instead, by asking what the load WOULD
 * produce — using load.js's own builders, so the guard cannot drift out of
 * agreement with the thing it guards — and diffing that against what is there.
 *
 *   node scripts/fbref/preflight.js
 *
 * Exit 1 on anything that would silently destroy a decision. New clubs and new
 * seasons are reported, not blocked: growth is the point.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 0) continue;
  if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.Supabase_Project_URL, process.env.Supabase_Service_Role,
                       { auth: { persistSession: false } });

const { readAll, mergeDuplicates, buildPlayers, buildClubs } = require('./load');
const { COMPETITIONS } = require('./competitions');

const n = (x) => Number(x || 0).toLocaleString('en-GB');
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

async function page(table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data.length) break;
    for (const r of data) out.push(r);
    if (data.length < 1000) break;
  }
  return out;
}

const blockers = [];
const warnings = [];
const say = (h) => console.log(`\n▸ ${h}`);

(async () => {
  console.log('\n  Reading what the load would produce…');
  const { rows: raw } = readAll();
  const { rows } = mergeDuplicates(raw);
  const clubs = buildClubs(rows);
  const players = buildPlayers(rows);
  console.log(`    ${n(rows.length)} stat rows · ${n(clubs.size)} clubs · ${n(players.size)} players`);

  const dbClubs = await page('clubs_v2', 'club_id, club_name, club_name_short, fbref_squad_id');
  const bySquad = new Map(dbClubs.filter((c) => c.fbref_squad_id).map((c) => [c.fbref_squad_id, c]));

  // ── 1. names that would change ──────────────────────────────────────────
  const renames = [];
  for (const [squad, c] of clubs) {
    const existing = bySquad.get(squad);
    if (!existing) continue;
    if (existing.club_name !== c.club_name) {
      renames.push({ squad, from: existing.club_name, to: c.club_name });
    }
  }
  say(`CLUB RENAMES — ${renames.length}`);
  if (renames.length) {
    for (const r of renames.slice(0, 25)) console.log(`    ${r.from}  →  ${r.to}   (${r.squad})`);
    if (renames.length > 25) console.log(`    … and ${renames.length - 25} more`);
    blockers.push(`${renames.length} clubs would be renamed. Five handlers resolve clubs BY NAME; ` +
                  `a rename that is not deliberate empties a game board silently. ` +
                  `If these are wanted, run snapshot_club_names.js --write first.`);
  } else {
    console.log('    none — every established name survives this load');
  }

  // ── 2. merges that would be undone ──────────────────────────────────────
  let merges = [];
  try { merges = require(path.join(ROOT, 'data', 'teams', 'club_merges.json')).merges || []; }
  catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  say(`CLUB MERGES — ${merges.length} recorded`);
  for (const m of merges) {
    const losing = dbClubs.find((c) => c.club_id === m.from);
    const wouldWrite = losing && clubs.has(losing.fbref_squad_id);
    console.log(`    ${m.name}: ${m.from} → ${m.into}   ` +
                (wouldWrite ? 'the losing squad IS in this load — load.js must remap it' : 'not in this load'));
    if (wouldWrite) {
      const src = fs.readFileSync(path.join(__dirname, 'load.js'), 'utf8');
      if (!/club_merges\.json/.test(src)) {
        blockers.push(`${m.name}'s merge would be undone — load.js does not read club_merges.json`);
      }
    }
  }

  // ── 3. clubs that are new ───────────────────────────────────────────────
  const fresh = [...clubs.keys()].filter((s) => !bySquad.has(s));
  say(`NEW CLUBS — ${fresh.length}`);
  for (const s of fresh.slice(0, 15)) console.log(`    ${clubs.get(s).club_name}   (${s})`);
  if (fresh.length > 15) console.log(`    … and ${fresh.length - 15} more`);

  // ── 4. a new club that shares a name with an existing one ───────────────
  // This is the Málaga bug before it happens: two clubs, one name, two pages
  // competing with each other in search and the history split between them.
  const existingByName = new Map();
  for (const c of dbClubs) {
    const k = fold(c.club_name);
    if (!existingByName.has(k)) existingByName.set(k, []);
    existingByName.get(k).push(c);
  }
  const collisions = [];
  for (const s of fresh) {
    const k = fold(clubs.get(s).club_name);
    const clash = existingByName.get(k);
    if (clash && clash.length) collisions.push({ name: clubs.get(s).club_name, squad: s, with: clash });
  }
  say(`NAME COLLISIONS WITH EXISTING CLUBS — ${collisions.length}`);
  if (collisions.length) {
    for (const c of collisions) {
      console.log(`    "${c.name}" (new, ${c.squad})  collides with  ` +
                  c.with.map((x) => `club_id ${x.club_id}`).join(', '));
    }
    warnings.push(`${collisions.length} new club(s) share a name with an existing club. That is the ` +
                  `Málaga situation: two pages, one name, history split. Decide per club whether to ` +
                  `merge (data/teams/club_merges.json) or to distinguish the names — BEFORE loading.`);
  } else {
    console.log('    none');
  }

  // ── 5. new clubs need a slug, and slugs are a URL contract ──────────────
  let manifest = {};
  try { manifest = require(path.join(ROOT, 'data', 'teams', 'slugs.json')).teams || {}; }
  catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  const knownSquads = new Set(dbClubs.filter((c) => Object.values(manifest)
    .some((t) => t.club_id === c.club_id)).map((c) => c.fbref_squad_id));
  say(`SLUGS`);
  console.log(`    ${Object.keys(manifest).length} teams in the manifest · ${fresh.length} new clubs will need one`);
  if (fresh.length) {
    console.log(`    run scripts/teams/slugs.js after loading — it APPENDS, and must never renumber`);
  }

  // ── 6. players who look like two people, or one person twice ───────────
  // The Ederson case: same name, same nationality, different birth year is two
  // people; the matcher has been wrong in both directions before.
  const byIdentity = new Map();
  for (const p of players.values()) {
    const k = `${fold(p.player_name)}|${p.nationality_norm || ''}`;
    if (!byIdentity.has(k)) byIdentity.set(k, new Set());
    byIdentity.get(k).add(p.birth_year || '?');
  }
  const ambiguous = [...byIdentity.entries()].filter(([, yrs]) => yrs.size > 1);
  say(`SAME NAME + NATIONALITY, DIFFERENT BIRTH YEAR — ${ambiguous.length}`);
  for (const [k, yrs] of ambiguous.slice(0, 10)) {
    console.log(`    ${k.split('|')[0]}  (${[...yrs].sort().join(', ')})`);
  }
  if (ambiguous.length > 10) console.log(`    … and ${ambiguous.length - 10} more`);
  console.log(`    these stay SEPARATE players, which is usually right — flagged so a wrong split is visible`);

  // ── 7. competitions the data references ────────────────────────────────
  const dbComps = await page('competitions', 'competition_id, competition_name');
  const known = new Set(dbComps.map((c) => c.competition_id));
  const used = new Set(rows.map((r) => r.competition_id));
  const missing = [...used].filter((c) => !known.has(c));
  say(`COMPETITIONS — ${used.size} in the data, ${known.size} in the database`);
  for (const id of missing) {
    const def = COMPETITIONS.find((c) => c.id === id);
    console.log(`    competition_id ${id} (${def ? def.name : 'unknown'}) is NOT in the competitions table`);
    blockers.push(`competition_id ${id} (${def ? def.name : '?'}) must be inserted into the ` +
                  `competitions table before loading, or its rows will violate the foreign key.`);
  }
  if (!missing.length) console.log('    every competition in the data exists');

  // ── 8. a competition with data but no team pages ───────────────────────
  // Loading a competition is not the same as surfacing it. scripts/teams/
  // slugs.js keeps its own allowlist of competitions whose clubs get a page,
  // and when Segunda was first loaded that list had not heard of it — so the
  // generator reported "0 to add" and 85 clubs silently got no page at all.
  say('COMPETITIONS WITH DATA BUT NO TEAM PAGES');
  const slugSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'teams', 'slugs.js'), 'utf8');
  const listed = (slugSrc.match(/const PAGE_COMPETITIONS = \[([^\]]*)\]/) || [, ''])[1]
    .split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
  const CUPS = new Set(['FA Cup', 'EFL Cup', 'Community Shield', 'Champions League']);
  const unsurfaced = [...used].filter((id) => {
    if (listed.includes(id)) return false;
    const def = dbComps.find((c) => c.competition_id === id);
    return def && !CUPS.has(def.competition_name);   // cups are excluded on purpose
  });
  if (unsurfaced.length) {
    for (const id of unsurfaced) {
      const def = dbComps.find((c) => c.competition_id === id);
      console.log(`    ${def ? def.competition_name : id} has data but is not in PAGE_COMPETITIONS`);
    }
    warnings.push(`${unsurfaced.length} competition(s) would load but produce no team pages. ` +
                  `Add them to PAGE_COMPETITIONS in scripts/teams/slugs.js.`);
  } else {
    console.log('    none — every league in the data surfaces as team pages');
  }

  // ── verdict ────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(72)}`);
  if (warnings.length) {
    console.log('\n  WARNINGS');
    for (const w of warnings) console.log(`    ! ${w}`);
  }
  if (blockers.length) {
    console.log('\n  BLOCKERS');
    for (const b of blockers) console.log(`    ✗ ${b}`);
    console.log('\n  Not safe to load.\n');
    process.exit(1);
  }
  console.log('\n  ✓ Nothing that would silently destroy a decision. Safe to load.\n');
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
