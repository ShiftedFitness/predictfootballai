#!/usr/bin/env node
/**
 * pool.js — the scopes a daily challenge is allowed to use.
 *
 * The daily has to be good every single day, for everyone, without anybody
 * looking at it first. That rules out picking at random from all 566 scopes:
 * Lincoln City in the Championship has twenty players who have all played four
 * games, so Higher or Lower has nothing to ask and every comparison is a tie.
 * One day of that and the habit is broken.
 *
 * So the pool is earned, from the data, on three counts:
 *
 *   depth    enough players to build a round from
 *   spread   the top player is far enough clear that comparisons decide
 *   history  enough seasons that the answers are not all this year's squad
 *
 * A scope that clears all three is in. Nothing is curated by hand and nothing
 * is excluded by name, so as a club's season is played it enters the pool on
 * its own and a club whose data is thin stays out until it is not.
 *
 *   node scripts/daily/pool.js
 *
 * Output: data/daily/pool.json
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

// Deliberately stricter than the team page's own "is there a game here" bar.
// A team page offering a thin game is a choice the visitor made; a daily
// challenge serving one is the site's choice, on the day it most needs to be
// worth coming back to.
const MIN_PLAYERS = 40;
const MIN_TOP_APPS = 100;
const MIN_SEASONS = 8;

/**
 * A scope is MARQUEE when most of this site's visitors could name several of
 * its players. The daily draws only from these for its opening weeks — see
 * OPENING_DAYS in netlify/functions/_daily.js.
 *
 * "Carlisle United in League One" is a perfectly good puzzle and a terrible
 * first impression: somebody arriving on day one cannot tell whether they are
 * bad at the game or simply do not follow League One, and there is only one
 * first impression. The lower leagues remain most of the pool and most of what
 * makes this site distinctive — they just should not be the welcome mat.
 *
 * TWO RULES, AND THE SECOND IS EDITORIAL ON PURPOSE.
 *
 * English clubs qualify on Premier League TENURE, which is derivable: ten or
 * more seasons in the top flight and a fan has seen you. That is 28 clubs and
 * it self-maintains — a promoted club earns its way in over a decade, a fallen
 * one keeps its place on history.
 *
 * European clubs qualify by being on a list. There is no honest metric for
 * "famous to a British audience": St Pauli and Cádiz clear every threshold
 * that Bayern and Barcelona clear, and the first pass duly opened with St
 * Pauli. Rather than invent a proxy and pretend it is objective, the judgement
 * is written down where it can be argued with.
 */
const MARQUEE_MIN_PL_SEASONS = 10;

const MARQUEE_EUROPEAN = new Set([
  'Barcelona', 'Real Madrid', 'Atlético Madrid', 'Valencia', 'Sevilla',
  'Bayern Munich', 'Dortmund', 'Milan', 'Internazionale', 'Juventus',
  'Roma', 'Napoli', 'Lazio', 'Paris Saint-Germain', 'Marseille', 'Lyon',
  'Porto', 'Benfica', 'Ajax', 'PSV Eindhoven', 'Celtic', 'Rangers',
]);

// The competitions a marquee scope may be about. A giant's League Two record
// does not exist, but a marquee club's cup runs are still recognisable.
const MARQUEE_COMPETITIONS = new Set([
  'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
  'Champions League', 'Championship',
]);

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
  const rows = await page('agg_player_club_comp',
    'club_id, competition_name, appearances, seasons, first_season, last_season');
  console.log(`    ${rows.length.toLocaleString('en-GB')} player-club-competition rows`);

  // Fold to one record per club per competition, and one per club overall.
  const perComp = new Map();
  const perClub = new Map();
  for (const r of rows) {
    for (const [map, key] of [[perComp, `${r.club_id}|${r.competition_name}`], [perClub, String(r.club_id)]]) {
      const c = map.get(key) || {
        club_id: r.club_id, competition_name: r.competition_name,
        players: 0, topApps: 0, first: r.first_season, last: r.last_season,
      };
      c.players += 1;
      c.topApps = Math.max(c.topApps, r.appearances || 0);
      c.first = Math.min(c.first, r.first_season);
      c.last = Math.max(c.last, r.last_season);
      map.set(key, c);
    }
  }

  const good = (c) => c.players >= MIN_PLAYERS && c.topApps >= MIN_TOP_APPS
                   && (c.last - c.first + 1) >= MIN_SEASONS;

  // Seasons in the Premier League, per club — the derivable half of marquee.
  const plSeasons = new Map();
  for (const r of rows) {
    if (r.competition_name !== 'Premier League') continue;
    if (!plSeasons.has(r.club_id)) plSeasons.set(r.club_id, new Set());
    plSeasons.get(r.club_id).add(r.first_season);
  }
  const isMarqueeClub = (t) =>
    (plSeasons.get(t.club_id) || new Set()).size >= MARQUEE_MIN_PL_SEASONS ||
    MARQUEE_EUROPEAN.has(t.name) || MARQUEE_EUROPEAN.has(t.game_name);

  const entries = [];
  let rejected = 0;

  for (const t of teams.all()) {
    // Per-competition scopes.
    for (const comp of t.competitions) {
      const c = perComp.get(`${t.club_id}|${comp}`);
      if (!c) continue;
      if (!good(c)) { rejected++; continue; }
      entries.push({
        id: teams.scopeIdFor(t.slug, comp),
        slug: t.slug, team: t.name, competition: comp,
        players: c.players, topApps: c.topApps, seasons: c.last - c.first + 1,
        marquee: isMarqueeClub(t) && MARQUEE_COMPETITIONS.has(comp),
      });
    }
    // The "all competitions" scope, for clubs that have more than one. It is
    // always at least as rich as its best single competition, so it is judged
    // on the merged numbers rather than assumed.
    if (t.competitions.length > 1) {
      const c = perClub.get(String(t.club_id));
      if (c && good(c)) {
        entries.push({
          id: `team_${t.slug}_all`,
          slug: t.slug, team: t.name, competition: null,
          players: c.players, topApps: c.topApps, seasons: c.last - c.first + 1,
          marquee: isMarqueeClub(t),
        });
      } else rejected++;
    }
  }

  entries.sort((a, b) => (b.players - a.players) || a.id.localeCompare(b.id));

  const byComp = {};
  for (const e of entries) {
    const k = e.competition || 'all competitions';
    byComp[k] = (byComp[k] || 0) + 1;
  }

  fs.writeFileSync(path.join(ROOT, 'data', 'daily', 'pool.json'),
    JSON.stringify({
      generated: new Date().toISOString(),
      thresholds: { MIN_PLAYERS, MIN_TOP_APPS, MIN_SEASONS, MARQUEE_MIN_PL_SEASONS },
      count: entries.length,
      marquee: entries.filter((e) => e.marquee).length,
      scopes: entries,
    }, null, 1) + '\n');

  console.log(`\n  ✓ ${entries.length} scopes qualify · ${rejected} rejected`);
  console.log(`    ${new Set(entries.map((e) => e.slug)).size} distinct clubs`);
  console.log(`    ${entries.filter((e) => e.marquee).length} marquee (the daily's opening weeks)`);
  for (const [k, v] of Object.entries(byComp).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(v).padStart(4)}  ${k}`);
  }
  console.log();
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
