#!/usr/bin/env node
/**
 * slugs.js — assign every club a permanent URL slug.
 *
 * These become public URLs (/teams/plymouth-argyle/), so the only property
 * that really matters is that they NEVER CHANGE. A slug derived from the club
 * name at request time would move the moment a name is corrected — and club
 * names in this database moved 68 times last week alone, which is exactly how
 * Bullseye ended up serving an empty board for Málaga.
 *
 * So slugs are generated once, written to a committed manifest keyed on
 * club_id, and after that they are read, never recomputed. Re-running this
 * only ever ADDS clubs. An existing slug is left alone even if the club has
 * since been renamed; the manifest records what it was called at the time so
 * a human can see why a slug looks odd.
 *
 *   node scripts/teams/slugs.js          # report what would be added
 *   node scripts/teams/slugs.js --write  # add new clubs to the manifest
 *
 * Output: data/teams/slugs.json  (committed — it is a URL contract)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'data', 'teams', 'slugs.json');

for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 0) continue;
  if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.Supabase_Project_URL, process.env.Supabase_Service_Role,
                        { auth: { persistSession: false } });

// Competitions whose clubs get a page: the four English tiers and the rest of
// the big five. Cups are excluded — a club's cup record belongs on its page,
// but "FA Cup" is not a club's home.
const PAGE_COMPETITIONS = [7, 8, 11, 12, 1, 3, 9, 6];

// ─── Slug rules ─────────────────────────────────────────────────────────────

/**
 * Accents are folded rather than dropped, so Köln becomes "koln" and not
 * "kln". Ampersands become "and" because "&" in a path is a query separator
 * waiting to happen.
 */
function slugify(name) {
  return String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function page(table, cols, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(cols).range(from, from + 999);
    for (const [k, v] of Object.entries(filter || {})) q = q.in(k, v);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const write = process.argv.includes('--write');

  const existing = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
    : { generated: null, teams: {} };

  const rows = await page('agg_player_club_comp',
    'club_id, club_name, competition_id, competition_name, tier, country, appearances',
    { competition_id: PAGE_COMPETITIONS });

  // TWO NAMES PER CLUB, and the distinction matters.
  //
  //   club_name        what the games match on. Restored to the old spellings
  //                    last week because five functions compare it as an exact
  //                    string: 'Sheffield Weds', 'Manchester Utd', 'BTSV'.
  //   club_name_short  FBref's full form: 'Sheffield Wednesday',
  //                    'Manchester United', 'Eintracht Braunschweig'.
  //
  // The slug and every visible heading come from the FULLER name, because
  // nobody searches for "Sheffield Weds" or "BTSV" — those are internal
  // shorthand, and building 313 pages for organic discovery on top of them
  // would waste the exercise. The game name is kept alongside so lookups
  // still work.
  const nameRows = [];
  const allIds = [...new Set(rows.map((r) => r.club_id))];
  for (let i = 0; i < allIds.length; i += 200) {
    const { data } = await db.from('clubs')
      .select('club_id, club_name, club_name_short').in('club_id', allIds.slice(i, i + 200));
    nameRows.push(...(data || []));
  }
  const names = new Map(nameRows.map((r) => [r.club_id, r]));
  const displayName = (id, fallback) => {
    const n = names.get(id);
    if (!n) return fallback;
    // Longer wins: the abbreviation is never the searchable form.
    return (n.club_name_short && n.club_name_short.length > n.club_name.length)
      ? n.club_name_short : n.club_name;
  };

  // Fold to one record per club, keeping what it plays in and how much data
  // sits behind it — both feed the indexability decision later.
  const clubs = new Map();
  for (const r of rows) {
    const c = clubs.get(r.club_id) || {
      club_id: r.club_id, name: r.club_name, players: 0, appearances: 0,
      competitions: new Set(), tiers: new Set(), country: r.country,
    };
    c.players += 1;
    c.appearances += r.appearances || 0;
    c.competitions.add(r.competition_name);
    if (r.tier) c.tiers.add(r.tier);
    clubs.set(r.club_id, c);
  }

  const taken = new Map();                       // slug -> club_id
  for (const [id, t] of Object.entries(existing.teams)) taken.set(t.slug, Number(id));

  const added = [], renamed = [];
  for (const c of [...clubs.values()].sort((a, b) => b.appearances - a.appearances)) {
    const prior = existing.teams[c.club_id];
    if (prior) {
      // The slug is fixed. Only note it if the club has since been renamed, so
      // an odd-looking URL has a visible explanation.
      if (prior.name !== c.name) renamed.push({ ...prior, now: c.name });
      continue;
    }

    const seoName = displayName(c.club_id, c.name);
    let slug = slugify(seoName);
    if (!slug) slug = `club-${c.club_id}`;
    // Two clubs can share a name — there are two Málagas in this data. The
    // first keeps the clean slug; the rest are disambiguated by id, which is
    // ugly but permanent and unambiguous.
    if (taken.has(slug)) slug = `${slug}-${c.club_id}`;
    taken.set(slug, c.club_id);

    added.push({
      club_id: c.club_id,
      slug,
      name: seoName,                 // headings, titles, structured data
      game_name: c.name,             // the exact string the games match on
      country: c.country || null,
      tiers: [...c.tiers].sort(),
      competitions: [...c.competitions].sort(),
      players: c.players, appearances: c.appearances,
    });
  }

  console.log(`\n  ${clubs.size} clubs in the page competitions`);
  console.log(`  ${Object.keys(existing.teams).length} already in the manifest`);
  console.log(`  ${added.length} to add · ${renamed.length} renamed since their slug was fixed\n`);

  for (const a of added.slice(0, 10)) {
    console.log(`    ${a.slug.padEnd(30)} ${String(a.players).padStart(4)} players  ` +
                `${a.name !== a.game_name ? `[games: ${a.game_name}] ` : ''}${a.competitions.join(', ')}`);
  }
  if (added.length > 10) console.log(`    … and ${added.length - 10} more`);
  for (const r of renamed) {
    console.log(`    ⚠ ${r.slug} was '${r.name}', now '${r.now}' — slug kept`);
  }

  if (!write) {
    console.log(`\n  Report only. Re-run with --write to update the manifest.\n`);
    return;
  }

  for (const a of added) {
    existing.teams[a.club_id] = a;
  }
  existing.generated = new Date().toISOString();
  existing.slug_count = Object.keys(existing.teams).length;

  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(existing, null, 1) + '\n');
  console.log(`\n  ✓ data/teams/slugs.json — ${existing.slug_count} teams\n`);
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
