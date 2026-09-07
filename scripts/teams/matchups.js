#!/usr/bin/env node
/**
 * matchups.js — decide which club pairings deserve a page.
 *
 * 313 clubs is 48,828 possible pairs. 24,061 of them share at least one
 * player. Publishing all of those would be 24,000 pages of near-identical
 * structure pointing at each other, which is the textbook way to teach Google
 * that this site produces thin pages — and it would put the 306 team pages
 * that actually earn their place at risk.
 *
 * A pairing earns a page by HAVING MET: the two clubs were in the same
 * division in the same season, enough times to be a fixture rather than an
 * accident. Both clubs must also be individually worth indexing.
 *
 * Shared players are NOT the gate, and getting that wrong the first time is
 * worth recording. Ranking pairs by player overlap put Fiorentina/Parma at the
 * top and left out the North London, Merseyside and Manchester derbies
 * entirely — because rivals do not sell players to each other. Liverpool and
 * Manchester United share two players in thirty years; Arsenal and Tottenham
 * four. The overlap gate was excluding precisely the pages people search for.
 *
 * So shared players are content, not entry. A pairing with two of them still
 * has both clubs' records side by side, every season they spent in the same
 * division, and a game for each — which is a page worth having.
 *
 * The "they met" rule is also what keeps the site honest. Plymouth Argyle and
 * Real Betis share players and have never played each other; a matchup page
 * would be implying a fixture that does not exist, which is the same mistake
 * as asking how many goals Plymouth scored in the Premier League.
 *
 * ORDERING IS DETERMINISTIC. The slug is the two club slugs sorted
 * alphabetically and joined, so arsenal-vs-chelsea exists and
 * chelsea-vs-arsenal cannot. Two URLs for one page is the duplicate-content
 * problem the brief explicitly warns about.
 *
 *   node scripts/teams/matchups.js
 *
 * Output: data/teams/matchups.json
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
const teams = require(path.join(ROOT, 'netlify', 'functions', '_teams.js'));

// Five seasons in the same division is a fixture people remember, and it is
// low enough to keep a promoted club's rivalries while excluding the pair who
// happened to overlap for one year in League Two.
const MIN_SHARED_SEASONS = 5;

/**
 * 3,994 pairings qualify. The cap is not about content — every page has two
 * specific clubs' records, the exact seasons they met and their shared
 * players, so none of them is a template with a name swapped — it is about not
 * quadrupling the size of the site in one go.
 *
 * 2,500 is where it sits because of WHERE the real derbies rank. Scoring
 * favours Serie A and La Liga pairings, but that is a data artefact rather
 * than a demand signal: we hold 39 seasons of Serie A and 25 of League One, so
 * Italian clubs accumulate "seasons together" the English lower leagues
 * cannot. Villa/Birmingham sits at 1,805, the Devon derby at 2,007 and
 * Portsmouth/Southampton at 2,353. A cap that excluded those would be
 * optimising for the wrong country.
 */
const MAX_PAGES = 2500;

/** The one true slug for a pairing, whichever order it is asked for in. */
function matchupSlug(slugA, slugB) {
  return [slugA, slugB].sort()[0] + '-vs-' + [slugA, slugB].sort()[1];
}

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
  console.log('\n  Reading aggregates…');
  const pc = await page('agg_player_club', 'player_id, club_id, appearances');
  const cs = await page('agg_club_season', 'club_id, competition_id, season_start_year');
  console.log(`    ${pc.length.toLocaleString('en-GB')} player-club rows · ` +
              `${cs.length.toLocaleString('en-GB')} club-season rows`);

  // ── who met whom ─────────────────────────────────────────────────────────
  // Two clubs met if they were in the same competition in the same season.
  // Cup competitions are excluded: everyone is in the FA Cup every year, so
  // counting it would make every English pair look like a fixture.
  const CUPS = new Set(['FA Cup', 'EFL Cup', 'Community Shield', 'Champions League']);
  const compById = new Map();
  {
    const { data } = await db.from('competitions').select('competition_id, competition_name');
    for (const c of data || []) compById.set(c.competition_id, c.competition_name);
  }

  const bySeasonComp = new Map();
  for (const r of cs) {
    if (CUPS.has(compById.get(r.competition_id))) continue;
    const k = `${r.competition_id}|${r.season_start_year}`;
    if (!bySeasonComp.has(k)) bySeasonComp.set(k, []);
    bySeasonComp.get(k).push(r.club_id);
  }

  const met = new Map();                    // "a|b" -> seasons in the same division
  for (const clubs of bySeasonComp.values()) {
    const u = [...new Set(clubs)].sort((a, b) => a - b);
    for (let i = 0; i < u.length; i++) {
      for (let j = i + 1; j < u.length; j++) {
        const k = `${u[i]}|${u[j]}`;
        met.set(k, (met.get(k) || 0) + 1);
      }
    }
  }

  // ── who shares players ───────────────────────────────────────────────────
  const byPlayer = new Map();
  for (const r of pc) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push(r);
  }

  const shared = new Map();                 // "a|b" -> { players, apps }
  for (const rows of byPlayer.values()) {
    const byClub = new Map();
    for (const r of rows) {
      const prev = byClub.get(r.club_id) || 0;
      byClub.set(r.club_id, prev + (r.appearances || 0));
    }
    const u = [...byClub.keys()].sort((a, b) => a - b);
    if (u.length < 2) continue;
    for (let i = 0; i < u.length; i++) {
      for (let j = i + 1; j < u.length; j++) {
        const k = `${u[i]}|${u[j]}`;
        const e = shared.get(k) || { players: 0, apps: 0 };
        e.players += 1;
        // Appearances at the LESSER of the two clubs: a player with 400 games
        // at one and 2 at the other is barely a shared player, and this says so.
        e.apps += Math.min(byClub.get(u[i]), byClub.get(u[j]));
        shared.set(k, e);
      }
    }
  }

  // ── the gate ─────────────────────────────────────────────────────────────
  const candidates = [];
  let neverMet = 0, tooThin = 0;

  // Every pair that MET is a candidate, whether or not they share a player.
  for (const [k, seasons] of met) {
    if (seasons < MIN_SHARED_SEASONS) { neverMet++; continue; }

    const [a, b] = k.split('|').map(Number);
    const A = teams.byClubId(a), B = teams.byClubId(b);
    if (!A || !B) continue;
    if (A.players < teams.INDEXABLE_MIN_PLAYERS || B.players < teams.INDEXABLE_MIN_PLAYERS) {
      tooThin++; continue;
    }

    const e = shared.get(k) || { players: 0, apps: 0 };

    // Rank on how much of a fixture it is and how big the pairing is, not on
    // player overlap — which is what buried the derbies.
    //
    // Prominence uses the SMALLER of the two clubs' records on purpose: a giant
    // paired with a minnow is not a big matchup, and taking the larger would
    // put every Manchester United pairing near the top of the list.
    const prominence = Math.min(A.players, B.players);
    const score = seasons * 6 + prominence / 8 + Math.min(30, e.players);

    candidates.push({
      slug: matchupSlug(A.slug, B.slug),
      // Stored in slug order, so the page and the data agree about which club
      // is "first" without the renderer having to re-sort.
      a: A.slug < B.slug ? A.slug : B.slug,
      b: A.slug < B.slug ? B.slug : A.slug,
      shared_players: e.players,
      shared_seasons: seasons,
      score: Math.round(score),
    });
  }

  candidates.sort((x, y) => y.score - x.score || x.slug.localeCompare(y.slug));
  const chosen = candidates.slice(0, MAX_PAGES);
  if (process.argv.includes('--rank')) {
    for (const want of process.argv.filter((a) => a.includes('-vs-'))) {
      const i = candidates.findIndex((c) => c.slug === want);
      console.log(`    ${want}: ${i < 0 ? 'does not qualify at all' : `rank ${i + 1} of ${candidates.length}`}`);
    }
  }

  fs.writeFileSync(path.join(ROOT, 'data', 'teams', 'matchups.json'),
    JSON.stringify({
      generated: new Date().toISOString(),
      thresholds: { MIN_SHARED_SEASONS, MAX_PAGES },
      count: chosen.length,
      matchups: chosen,
    }, null, 1) + '\n');

  console.log(`\n  ${met.size.toLocaleString('en-GB')} pairs have shared a division at least once`);
  console.log(`    ${neverMet.toLocaleString('en-GB')} rejected: under ${MIN_SHARED_SEASONS} seasons together`);
  console.log(`    ${tooThin} rejected: a club too thin to index on its own`);
  console.log(`    (${shared.size.toLocaleString('en-GB')} pairs share a player — used for content, not for entry)`);
  console.log(`\n  ✓ ${candidates.length.toLocaleString('en-GB')} qualify · ${chosen.length} written (cap ${MAX_PAGES})`);
  console.log(`    ${new Set(chosen.flatMap((c) => [c.a, c.b])).size} distinct clubs\n`);
  for (const c of chosen.slice(0, 10)) {
    console.log(`      ${String(c.score).padStart(4)}  ${c.slug}` +
                `  (${c.shared_players} players, ${c.shared_seasons} seasons together)`);
  }
  console.log();
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
