#!/usr/bin/env node
/**
 * restore_club_names.js — put back the club names the application knows.
 *
 * A regression I introduced. The parser takes club_name from the squad URL
 * slug, which is ASCII and always the full form:
 *
 *     /en/squads/1c896955/Malaga-Stats      -> "Malaga"
 *     /en/squads/.../Wolverhampton-Wanderers-Stats -> "Wolverhampton Wanderers"
 *
 * That fixed four English clubs the old data spelled inconsistently, and broke
 * sixty-eight others. Five functions resolve clubs by NAME against hardcoded
 * lists — match_start alone carries 144 of them — so "Málaga" stopped matching
 * "Malaga" and Bullseye returned an empty board. Accents were lost the same
 * way for Köln, Nürnberg, Alavés, Atlético Madrid, Saint-Étienne; short forms
 * were lost for Wolves, Brighton, Manchester Utd, Inter, Gladbach.
 *
 * The principle I got wrong: the rebuild was about the data being CORRECT, not
 * about renaming things the application already refers to. Where the old
 * database had a name, that name wins. FBref's slug form is kept alongside.
 *
 *   node scripts/fbref/restore_club_names.js           # report
 *   node scripts/fbref/restore_club_names.js --write   # apply + rebuild aggregates
 *
 * The aggregates carry club_name denormalised, so they MUST be rebuilt after
 * this or they keep serving the slug names.
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

/** Compare names ignoring accents, case and punctuation. */
const key = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

async function page(table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

(async () => {
  const write = process.argv.includes('--write');

  const oldClubs = await page('clubs_pre_rebuild', 'club_id, club_name');
  const newClubs = await page('clubs_v2', 'club_id, fbref_squad_id, club_name, club_name_short');

  // Index the old names. First one wins — the old table has its own duplicates
  // (the "eng Liverpool" flag-prefix rows), and those were already normalised
  // away, so an exact key collision here is the same club twice.
  const oldByKey = new Map();
  for (const o of oldClubs) {
    const k = key(o.club_name);
    if (k && !oldByKey.has(k)) oldByKey.set(k, o.club_name);
  }

  const updates = [];
  let unchanged = 0, brandNew = 0;
  for (const c of newClubs) {
    // Match on either form: the slug name or FBref's short display name.
    const was = oldByKey.get(key(c.club_name)) || oldByKey.get(key(c.club_name_short));
    if (!was) { brandNew++; continue; }
    if (was === c.club_name) { unchanged++; continue; }
    updates.push({
      fbref_squad_id: c.fbref_squad_id,
      club_name: was,
      // Keep FBref's full slug form — it is the better label for anything new,
      // and losing it would make this hard to undo.
      club_name_short: c.club_name,
    });
  }

  console.log(`\n  ${newClubs.length} clubs · ${unchanged} already correct · ` +
              `${brandNew} new (no old counterpart) · ${updates.length} to restore\n`);
  for (const u of updates.slice(0, 12)) {
    console.log(`    ${u.club_name_short.padEnd(30)} -> ${u.club_name}`);
  }
  if (updates.length > 12) console.log(`    … and ${updates.length - 12} more`);

  if (!write) {
    console.log(`\n  Report only. Re-run with --write to apply.\n`);
    return;
  }

  for (let i = 0; i < updates.length; i += 200) {
    const { error } = await db.from('clubs_v2')
      .upsert(updates.slice(i, i + 200), { onConflict: 'fbref_squad_id' });
    if (error) throw new Error(`clubs_v2: ${error.message}`);
    process.stdout.write(`\r    ${Math.min(i + 200, updates.length)} / ${updates.length}`);
  }
  console.log(`\n  ✓ ${updates.length} club names restored`);

  // Not optional. agg_player_club_comp and agg_player_club both carry
  // club_name denormalised; without this they keep serving the slug names and
  // Bullseye stays broken.
  console.log(`  rebuilding aggregates…`);
  const { error } = await db.rpc('rebuild_aggregates');
  if (error) throw new Error(`rebuild_aggregates: ${error.message}`);
  console.log(`  ✓ aggregates rebuilt\n`);
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
