#!/usr/bin/env node
/**
 * refresh_counts.js — bring the manifest's numbers back in line with the data.
 *
 * data/teams/slugs.json is a URL contract: slug and club_id are fixed forever
 * and must never be recomputed. But it also carries `players`, `appearances`
 * and `competitions`, and those are a SNAPSHOT taken when it was generated.
 * After an ingest or a club merge they go stale, and a team page then says
 * "236 players" above a table listing 270.
 *
 * This refreshes only those three fields. It never touches a slug, a club_id
 * or a name, so it is safe to run after any data change.
 *
 *   node scripts/teams/refresh_counts.js            # report
 *   node scripts/teams/refresh_counts.js --apply
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

const APPLY = process.argv.includes('--apply');
const MANIFEST = path.join(ROOT, 'data', 'teams', 'slugs.json');

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

(async () => {
  const pc = await page('agg_player_club', 'club_id, player_id, appearances');
  const cc = await page('agg_player_club_comp', 'club_id, competition_name');

  const live = new Map();
  for (const r of pc) {
    const e = live.get(r.club_id) || { players: new Set(), appearances: 0, comps: new Set() };
    e.players.add(r.player_id);
    e.appearances += r.appearances || 0;
    live.set(r.club_id, e);
  }
  for (const r of cc) {
    const e = live.get(r.club_id);
    if (e) e.comps.add(r.competition_name);
  }

  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const changed = [];
  for (const t of Object.values(m.teams)) {
    const e = live.get(t.club_id);
    const players = e ? e.players.size : 0;
    const appearances = e ? e.appearances : 0;
    const comps = e ? [...e.comps].sort() : [];
    const was = { players: t.players, appearances: t.appearances, competitions: t.competitions };
    if (was.players === players && was.appearances === appearances &&
        JSON.stringify((was.competitions || []).slice().sort()) === JSON.stringify(comps)) continue;
    changed.push({ slug: t.slug, was, now: { players, appearances, competitions: comps } });
    if (APPLY) {
      t.players = players;
      t.appearances = appearances;
      // Order is preserved from the original where possible; a genuinely new
      // competition is appended rather than resorting the list.
      t.competitions = comps;
    }
  }

  console.log(`\n  ${changed.length} team${changed.length === 1 ? '' : 's'} out of date\n`);
  for (const c of changed.slice(0, 20)) {
    console.log(`    ${c.slug.padEnd(26)} ${c.was.players} → ${c.now.players} players · ` +
                `${Number(c.was.appearances).toLocaleString('en-GB')} → ${c.now.appearances.toLocaleString('en-GB')} apps`);
  }
  if (changed.length > 20) console.log(`    … and ${changed.length - 20} more`);

  if (APPLY && changed.length) {
    fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1) + '\n');
    console.log(`\n  ✓ slugs.json updated (slugs, club_ids and names untouched)\n`);
  } else if (!APPLY) {
    console.log(`\n  Nothing written. Re-run with --apply.\n`);
  } else {
    console.log();
  }
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
