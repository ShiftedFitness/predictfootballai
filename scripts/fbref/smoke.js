#!/usr/bin/env node
/**
 * smoke.js — run every game function against the rebuilt data, unmodified.
 *
 * This is the gate before the swap. Rather than eyeball the SQL and hope, it
 * loads each Netlify function's real handler and calls it for real — the same
 * code that will run in production — with one change: the Supabase client is
 * wrapped so `.from('players')` resolves to `players_compat`, and so on. If a
 * function works here it will work after the rename, because the rename makes
 * those names point at exactly what the wrapper is pointing them at now.
 *
 *   node scripts/fbref/smoke.js           # against the compat views (new data)
 *   node scripts/fbref/smoke.js --live    # against the live tables (old data)
 *
 * Run both and compare: --live is the control. A function that fails in both
 * was already broken; one that fails only in the first is a regression.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FUNCS = path.join(ROOT, 'netlify', 'functions');
const LIVE = process.argv.includes('--live');

// ─── env ────────────────────────────────────────────────────────────────────

for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 0) continue;
  if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

// ─── redirect the old names at the new views ────────────────────────────────

const REWRITE = LIVE ? {} : {
  players: 'players_compat',
  clubs: 'clubs_compat',
  v_all_player_season_stats: 'v_all_player_season_stats_compat',
  v_game_player_club_comp: 'v_game_player_club_comp_compat',
};

const sbModule = require('@supabase/supabase-js');
const realCreateClient = sbModule.createClient;
const seenTables = new Set();

sbModule.createClient = function (...args) {
  const client = realCreateClient(...args);
  const from = client.from.bind(client);
  client.from = (table) => {
    seenTables.add(table);
    return from(REWRITE[table] || table);
  };
  return client;
};

// ─── the calls ──────────────────────────────────────────────────────────────

const post = (body) => ({ httpMethod: 'POST', body: JSON.stringify(body), headers: {} });
const get = (qs) => ({
  httpMethod: 'GET', headers: {},
  rawUrl: `https://telestats.net/.netlify/functions/x${qs}`,
  queryStringParameters: Object.fromEntries(new URLSearchParams(qs.replace(/^\?/, ''))),
});

const CASES = [
  ['did-you-know',      'facts',           get('')],
  ['featured-player',   'random player',   get('')],
  ['player-lookup',     'search',          get('?action=search&q=salah')],
  // scopeId values come from each game's own get_scopes response — 'epl_alltime'
  // is the Premier League all-time scope every one of them exposes.
  ['quiz_start',        'generate_quiz',   post({ action: 'generate_quiz', scopeId: 'epl_alltime' })],
  ['whoami_start',      'get_scopes',      post({ action: 'get_scopes' })],
  ['whoami_start',      'start_game',      post({ action: 'start_game', scopeId: 'epl_alltime' })],
  ['alpha_start',       'get_scopes',      post({ action: 'get_scopes' })],
  ['alpha_start',       'get_alphabet',    post({ action: 'get_alphabet', scopeId: 'epl_alltime' })],
  ['hol_start',         'get_scopes',      post({ action: 'get_scopes' })],
  ['hol_start',         'get_players',     post({ action: 'get_players', scopeId: 'epl_alltime', statType: 'appearances' })],
  ['xi_start',          'get_scopes',      post({ action: 'get_scopes' })],
  // Search is scoped, so the query has to be someone who actually played for
  // the scope. 'gerr' against Arsenal returns nothing, correctly — that was a
  // bad test case, not a bug, and it sat red for several runs because of it.
  ['xi_start',          'search_players',  post({ action: 'search_players', query: 'henry', positionBucket: 'FWD', scopeId: 'club_arsenal' })],
  ['xi_start',          'get_best_xi',     post({ action: 'get_best_xi', scopeId: 'epl_alltime', formation: '4-4-2', objective: 'appearances' })],
  ['community-builder', 'preview',         post({ action: 'preview', gameType: 'higher_lower',
                                                  filters: { competitions: ['Premier League'], clubs: ['Liverpool'] } })],

  // The three scope shapes a team page can hand a game: one competition, a
  // chosen subset of them, and all of them. Every one of these has been broken
  // at some point by a variable that existed in the handler but not in the
  // helper that read it — a failure that shows up as "no players found", which
  // reads like thin data rather than a bug. Sunderland is the case worth
  // pinning: four divisions, so all three shapes are genuinely different.
  ['hol_start',         'team · one comp',  post({ action: 'get_players', scopeId: 'team_sunderland_league-one', statType: 'appearances' })],
  ['hol_start',         'team · subset',    post({ action: 'get_players', scopeId: 'team_sunderland_premier-league+championship', statType: 'appearances' })],
  ['hol_start',         'team · all comps', post({ action: 'get_players', scopeId: 'team_sunderland_all', statType: 'appearances' })],
  ['alpha_start',       'team · subset',    post({ action: 'get_alphabet', scopeId: 'team_sunderland_premier-league+championship' })],
  ['whoami_start',      'team · all comps', post({ action: 'start_game', scopeId: 'team_plymouth-argyle_all' })],
  ['xi_start',          'team · subset',    post({ action: 'get_best_xi', scopeId: 'team_sunderland_premier-league+championship',
                                                   formation: '4-4-2', objective: 'appearances' })],
  ['quiz_start',        'team · all comps', post({ action: 'generate_quiz', scopeId: 'team_plymouth-argyle_all' })],
  // A scope naming a competition the club never played in must be refused, not
  // answered with an empty game.
  ['hol_start',         'bad subset 400',   post({ action: 'get_players', scopeId: 'team_sunderland_serie-a+championship', statType: 'appearances' }), 400],

  // Team pages: the leaderboard and community list that are fetched after paint.
  ['team-extras',       'leaderboard',      get('?slug=manchester-united')],
  ['team-extras',       'quiet club',       get('?slug=plymouth-argyle')],
  ['team-extras',       'bad slug 400',     get('?slug=not-a-club'), 400],

  // The daily. Whether the CHALLENGE is playable is checked separately and far
  // more thoroughly by scripts/daily/verify.js, which plays four months of
  // them. This is only that the endpoint answers and stays deterministic.
  ['daily',             'today',            get('')],
  ['daily',             'a week ahead',     get('?days=7')],
  ['daily',             'a garbage date',   get('?date=not-a-date')],

  // Bullseye. Absent from the first version of this file, which is how it
  // reached a user with an empty board for Málaga. A non-English club is
  // deliberate: the English ones were never going to catch a lost accent.
  ['match_start',       'epl age bucket',  post({ categoryId: 'epl_age_u21' })],
  ['match_start',       'top clubs',       post({ categoryId: 'get_top_clubs' })],
  ['match_start',       'La Liga · Málaga', post({ categoryId: 'laliga_club_Málaga' })],
  ['match_start',       'Bundesliga · Köln', post({ categoryId: 'bundesliga_club_Köln' })],

  // xi_score. I edited its 41 club ids and never once ran it.
  ['xi_score',          'score an XI',     async () => {
    const xi = await require(path.join(FUNCS, 'xi_start.js')).handler(
      post({ action: 'get_best_xi', scopeId: 'club_arsenal', formation: '4-4-2', objective: 'appearances' }), {});
    const picks = (JSON.parse(xi.body).bestXI || [])
      .filter((s) => s.player)
      .map((s) => ({ slotIdx: s.slotIdx, uid: s.player.playerId }));
    return post({ scopeId: 'club_arsenal', formation: '4-4-2', objective: 'appearances',
                  picks, reveal: true });
  }],
];

/**
 * A 200 that contains an `error` key is a failure dressed as a success.
 *
 * A case may name the status it EXPECTS. Refusing a bad scope with a 400 is
 * correct behaviour and has to be asserted, not merely tolerated — a handler
 * that answers a nonsense scope with an empty 200 is the failure mode these
 * pages keep producing.
 */
function verdict(res, expect) {
  if (!res || typeof res.statusCode !== 'number') return { ok: false, why: 'no response' };
  let body = {};
  try { body = JSON.parse(res.body || '{}'); } catch { /* non-JSON is fine */ }
  if (expect) {
    return res.statusCode === expect
      ? { ok: true, why: `${res.statusCode} as expected · ${body.error || ''}`.trim() }
      : { ok: false, why: `expected ${expect}, got ${res.statusCode}` };
  }
  if (res.statusCode >= 400) return { ok: false, why: `${res.statusCode} ${body.error || ''}`.trim() };
  if (body && body.error) return { ok: false, why: `200 but error: ${body.error}` };
  const size = (res.body || '').length;
  if (size < 40) return { ok: false, why: `200 but empty (${size} bytes)` };
  return { ok: true, why: `${res.statusCode} · ${(size / 1024).toFixed(1)} KB` };
}

(async () => {
  console.log(`\n  Smoke test — ${LIVE ? 'LIVE tables (control)' : 'COMPAT views (rebuilt data)'}\n`);

  let pass = 0, fail = 0;
  for (const [file, label, eventOrFn, expect] of CASES) {
    const p = path.join(FUNCS, `${file}.js`);
    if (!fs.existsSync(p)) { console.log(`  ?  ${file} — not found`); continue; }

    let res, err = null;
    const t0 = Date.now();
    try {
      delete require.cache[require.resolve(p)];
      delete require.cache[require.resolve(path.join(FUNCS, '_supabase.js'))];
      // Some cases need a live value first — scoring an XI needs an XI.
      const event = typeof eventOrFn === 'function' ? await eventOrFn() : eventOrFn;
      res = await require(p).handler(event, {});
    } catch (e) { err = e; }
    const ms = Date.now() - t0;

    const v = err ? { ok: false, why: `threw: ${err.message}` } : verdict(res, expect);
    v.ok ? pass++ : fail++;
    console.log(`  ${v.ok ? '✓' : '✗'}  ${(file + ' · ' + label).padEnd(36)} ${String(ms).padStart(5)}ms  ${v.why}`);
  }

  console.log(`\n  ${pass} passed · ${fail} failed`);
  console.log(`  tables touched: ${[...seenTables].sort().join(', ')}\n`);
  process.exit(fail ? 1 : 0);
})();
