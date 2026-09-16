#!/usr/bin/env node
/**
 * snapshot_club_names.js — write down what each club is CALLED.
 *
 * WHY THIS FILE HAS TO EXIST.
 *
 * The database holds decisions FBref does not know about. A club's display
 * name is one of them: the rebuild took club_name from the squad URL slug,
 * which is ASCII and always the long form, and that broke sixty-eight clubs —
 * "Málaga" became "Malaga", Köln became "Koln", Wolves became "Wolverhampton
 * Wanderers" — which emptied the Bullseye board, because five handlers resolve
 * clubs by name against hardcoded lists. restore_club_names.js put them back
 * BY HAND, into the database only.
 *
 * Nothing recorded that decision anywhere load.js could see. clubs_v2 upserts
 * on fbref_squad_id with the name the parser produced, so the next ingest
 * would have reverted all sixty-eight and re-broken the same board — silently,
 * because a wrong name does not error, it just returns nothing.
 *
 * So the names live here, in version control, keyed on the one identifier that
 * never changes, and load.js applies them on every write. A decision that only
 * exists in the database is a decision that gets overwritten.
 *
 *   node scripts/fbref/snapshot_club_names.js            # report
 *   node scripts/fbref/snapshot_club_names.js --write
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

const OUT = path.join(ROOT, 'data', 'teams', 'club_names.json');
const APPLY = process.argv.includes('--write');

(async () => {
  const clubs = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('clubs_v2')
      .select('club_id, club_name, club_name_short, fbref_squad_id').range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    for (const c of data) clubs.push(c);
    if (data.length < 1000) break;
  }

  const names = {};
  for (const c of clubs.sort((a, b) => a.club_id - b.club_id)) {
    if (!c.fbref_squad_id) continue;
    names[c.fbref_squad_id] = { name: c.club_name, short: c.club_name_short };
  }

  console.log(`\n  ${Object.keys(names).length} clubs\n`);
  const accented = Object.values(names).filter((n) => /[^\x00-\x7F]/.test(n.name));
  console.log(`    ${accented.length} carry a non-ASCII character that the FBref slug would lose`);
  console.log(`    e.g. ${accented.slice(0, 6).map((n) => n.name).join(', ')}`);

  if (!APPLY) { console.log(`\n  Nothing written. Re-run with --write.\n`); return; }
  fs.writeFileSync(OUT, JSON.stringify({
    note: 'What each club is CALLED, keyed on fbref_squad_id. Applied by scripts/fbref/load.js on every ingest so a re-load cannot revert a name the application resolves clubs by. Regenerate with scripts/fbref/snapshot_club_names.js --write AFTER a deliberate rename, never before.',
    generated: new Date().toISOString(),
    count: Object.keys(names).length,
    names,
  }, null, 1) + '\n');
  console.log(`\n  ✓ ${OUT.replace(ROOT + '/', '')}\n`);
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
