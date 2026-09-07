#!/usr/bin/env node
/**
 * merge_clubs.js — present two FBref squads as one club.
 *
 * FBref splits a club that was dissolved and refounded into two squads with
 * two ids. That is correct for a statistics archive and wrong for this site:
 * two pages under one name, competing with each other in search, with the
 * club's own history divided between them.
 *
 * WHAT THIS DOES NOT DO: guess. The merges are listed by hand in
 * data/teams/club_merges.json with a reason, because the rule that catches
 * Málaga also catches Wimbledon and AFC Wimbledon — which must never be
 * merged. There is no heuristic here on purpose.
 *
 * REVERSIBLE. The losing club's row is kept in `clubs` (nothing is deleted),
 * and its fbref_squad_id is recorded in the manifest, so a future collect run
 * can always separate them again.
 *
 *   node scripts/teams/merge_clubs.js            # report only
 *   node scripts/teams/merge_clubs.js --apply    # write
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
const { merges } = require(path.join(ROOT, 'data', 'teams', 'club_merges.json'));

/**
 * Every table carrying a club_id that a game or a page reads.
 *
 * player_season_stats_v2, NOT player_season_stats. Since the rebuild the
 * unsuffixed name is a compatibility VIEW over the _v2 table, and PostgREST
 * refuses to update through it — "cannot update view". The aggregates are real
 * tables and take their own name.
 */
const TABLES = ['player_season_stats_v2', 'agg_player_club', 'agg_player_club_comp', 'agg_club_season'];

const n = (x) => Number(x || 0).toLocaleString('en-GB');

async function countFor(table, clubId) {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq('club_id', clubId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count;
}

(async () => {
  console.log(`\n  ${APPLY ? 'APPLYING' : 'DRY RUN'} — ${merges.length} merge${merges.length === 1 ? '' : 's'}\n`);

  for (const m of merges) {
    console.log(`  ${m.name}: club ${m.from} → club ${m.into}`);
    console.log(`    ${m.why}\n`);

    for (const table of TABLES) {
      const before = await countFor(table, m.from);
      if (!before) { console.log(`    ${table.padEnd(22)} nothing to move`); continue; }

      if (!APPLY) { console.log(`    ${table.padEnd(22)} would move ${n(before)} rows`); continue; }

      const { error } = await db.from(table).update({ club_id: m.into }).eq('club_id', m.from);
      if (error) throw new Error(`${table}: ${error.message}`);
      const after = await countFor(table, m.from);
      console.log(`    ${table.padEnd(22)} moved ${n(before)} rows · ${after} left behind`);
    }

    if (APPLY) {
      // agg_player_club and agg_player_club_comp are keyed on (player, club[,
      // comp]). A player who turned out for BOTH squads now has two rows for
      // one club, so they have to be folded rather than left as duplicates.
      for (const [table, keys] of [['agg_player_club', ['player_id']],
                                   ['agg_player_club_comp', ['player_id', 'competition_name']]]) {
        const { data } = await db.from(table).select('*').eq('club_id', m.into);
        const seen = new Map();
        const dupes = [];
        for (const r of data || []) {
          const k = keys.map((x) => r[x]).join('|');
          if (!seen.has(k)) { seen.set(k, r); continue; }
          const first = seen.get(k);
          first.appearances = (first.appearances || 0) + (r.appearances || 0);
          first.goals = (first.goals || 0) + (r.goals || 0);
          first.first_season = Math.min(first.first_season, r.first_season);
          first.last_season = Math.max(first.last_season, r.last_season);
          dupes.push({ keep: first, drop: r });
        }
        for (const d of dupes) {
          await db.from(table).update({
            appearances: d.keep.appearances, goals: d.keep.goals,
            first_season: d.keep.first_season, last_season: d.keep.last_season,
          }).eq('id', d.keep.id);
          await db.from(table).delete().eq('id', d.drop.id);
        }
        console.log(`    ${table.padEnd(22)} folded ${dupes.length} player${dupes.length === 1 ? '' : 's'} who played for both`);
      }
      console.log(`    clubs                  row ${m.from} KEPT (nothing deleted — the merge is reversible)`);

      // Stamp the manifest so _teams.js stops offering the losing slug as a
      // team of its own. The ENTRY stays: data/teams/slugs.json is a URL
      // contract keyed on club_id, and deleting a key would make an old scope
      // id resolve to nothing instead of to the surviving club.
      const manifestPath = path.join(ROOT, 'data', 'teams', 'slugs.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const losing = Object.values(manifest.teams).find((t) => t.club_id === m.from);
      const winning = Object.values(manifest.teams).find((t) => t.club_id === m.into);
      if (losing && winning) {
        losing.merged_into = winning.slug;
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
        console.log(`    slugs.json             ${losing.slug} marked merged_into ${winning.slug}`);
      }
    }
    console.log();
  }

  if (!APPLY) console.log('  Nothing written. Re-run with --apply.\n');
  else console.log('  Now regenerate: npm run build:slugs is NOT needed (slugs are a URL contract);\n' +
                   '  run scripts/teams/slugs.js only if a new club must be appended.\n');
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
