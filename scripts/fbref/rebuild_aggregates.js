#!/usr/bin/env node
/**
 * rebuild_aggregates.js — build the read model in JavaScript.
 *
 * WHY NOT THE RPC.
 *
 * rebuild_aggregates() in the database does this correctly and exceeds the
 * statement timeout every time it is called through PostgREST. It has been a
 * known gotcha since the rebuild, worked around by hand each time — which is
 * fine once and untenable for an automated weekly refresh, because the whole
 * site reads the aggregates rather than the stat rows. A load that cannot
 * rebuild them is a load that changes nothing anybody can see.
 *
 * So the same three tables are folded here, in pages, and upserted in chunks.
 * No statement runs long enough to be cancelled.
 *
 *   node scripts/fbref/rebuild_aggregates.js            # report
 *   node scripts/fbref/rebuild_aggregates.js --write
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

const APPLY = process.argv.includes('--write');
const n = (x) => Number(x || 0).toLocaleString('en-GB');

async function page(table, cols, label) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data.length) break;
    for (const r of data) out.push(r);
    process.stdout.write(`\r    ${label} … ${n(out.length)}`);
    if (data.length < 1000) break;
  }
  process.stdout.write(`\r    ${label.padEnd(30)} ${n(out.length).padStart(9)} ✓\n`);
  return out;
}

async function chunk(table, list, conflict) {
  const SIZE = 500;
  for (let i = 0; i < list.length; i += SIZE) {
    const { error } = await db.from(table).upsert(list.slice(i, i + SIZE), { onConflict: conflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    process.stdout.write(`\r    ${table} … ${n(Math.min(i + SIZE, list.length))} / ${n(list.length)}`);
  }
  process.stdout.write(`\r    ${table.padEnd(30)} ${n(list.length).padStart(9)} ✓\n`);
}

(async () => {
  console.log('\n  Reading…');
  const players = await page('players_v2', 'player_id, player_name, nationality, position_bucket', 'players');
  const clubs = await page('clubs_v2', 'club_id, club_name', 'clubs');
  const comps = await page('competitions', 'competition_id, competition_name, country, tier', 'competitions');
  const stats = await page('player_season_stats_v2',
    'player_id, club_id, competition_id, season_start_year, appearances, goals, assists, minutes', 'stat rows');

  const P = new Map(players.map((p) => [p.player_id, p]));
  const C = new Map(clubs.map((c) => [c.club_id, c]));
  const K = new Map(comps.map((c) => [c.competition_id, c]));

  console.log('\n  Folding…');
  const perComp = new Map();     // player|club|comp
  const perClub = new Map();     // player|club
  const perSeason = new Map();   // club|comp|season

  for (const s of stats) {
    const p = P.get(s.player_id), c = C.get(s.club_id), k = K.get(s.competition_id);
    if (!p || !c || !k) continue;

    const add = (map, key, seed) => {
      let e = map.get(key);
      if (!e) { e = seed(); map.set(key, e); }
      return e;
    };

    const ec = add(perComp, `${s.player_id}|${s.club_id}|${s.competition_id}`, () => ({
      player_id: s.player_id, club_id: s.club_id, competition_id: s.competition_id,
      player_name: p.player_name, nationality: p.nationality,
      position_bucket: p.position_bucket, club_name: c.club_name,
      competition_name: k.competition_name, country: k.country, tier: k.tier,
      appearances: 0, goals: 0, assists: 0, minutes: 0,
      _seasons: new Set(), first_season: s.season_start_year, last_season: s.season_start_year,
    }));
    ec.appearances += s.appearances || 0; ec.goals += s.goals || 0;
    ec.assists += s.assists || 0; ec.minutes += s.minutes || 0;
    ec._seasons.add(s.season_start_year);
    ec.first_season = Math.min(ec.first_season, s.season_start_year);
    ec.last_season = Math.max(ec.last_season, s.season_start_year);

    const ep = add(perClub, `${s.player_id}|${s.club_id}`, () => ({
      player_id: s.player_id, club_id: s.club_id,
      player_name: p.player_name, nationality: p.nationality, club_name: c.club_name,
      appearances: 0, goals: 0, assists: 0, minutes: 0,
      _comps: new Set(), _seasons: new Set(),
      first_season: s.season_start_year, last_season: s.season_start_year,
    }));
    ep.appearances += s.appearances || 0; ep.goals += s.goals || 0;
    ep.assists += s.assists || 0; ep.minutes += s.minutes || 0;
    ep._comps.add(s.competition_id); ep._seasons.add(s.season_start_year);
    ep.first_season = Math.min(ep.first_season, s.season_start_year);
    ep.last_season = Math.max(ep.last_season, s.season_start_year);

    const es = add(perSeason, `${s.club_id}|${s.competition_id}|${s.season_start_year}`, () => ({
      club_id: s.club_id, competition_id: s.competition_id, season_start_year: s.season_start_year,
      club_name: c.club_name, competition_name: k.competition_name, tier: k.tier,
      squad_size: 0, goals: 0,
    }));
    es.squad_size += 1; es.goals += s.goals || 0;
  }

  const strip = (e, extra = {}) => {
    const { _seasons, _comps, ...rest } = e;
    return { ...rest, seasons: _seasons.size, ...extra };
  };
  const aComp = [...perComp.values()].map((e) => strip(e));
  const aClub = [...perClub.values()].map((e) => strip(e, { competitions: e._comps.size }));
  const aSeason = [...perSeason.values()];

  console.log(`\n    agg_player_club_comp   ${n(aComp.length).padStart(9)}`);
  console.log(`    agg_player_club        ${n(aClub.length).padStart(9)}`);
  console.log(`    agg_club_season        ${n(aSeason.length).padStart(9)}`);

  if (!APPLY) { console.log('\n  Nothing written. Re-run with --write.\n'); return; }

  console.log('\n  Writing…');
  await chunk('agg_player_club_comp', aComp, 'player_id,club_id,competition_id');
  await chunk('agg_player_club', aClub, 'player_id,club_id');
  await chunk('agg_club_season', aSeason, 'club_id,competition_id,season_start_year');

  // Rows that no longer have a source — a club merged away, a season corrected.
  // Left in place rather than deleted: this script only ever adds and updates,
  // and a stale row is a smaller problem than a delete that was wrong. Audit
  // with scripts/fbref/preflight.js.
  console.log('\n  ✓ aggregates rebuilt\n');
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
