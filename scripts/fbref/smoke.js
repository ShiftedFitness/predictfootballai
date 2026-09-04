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
  ['xi_start',          'search_players',  post({ action: 'search_players', query: 'gerr', positionBucket: 'MID', scopeId: 'epl_alltime' })],
  ['xi_start',          'get_best_xi',     post({ action: 'get_best_xi', scopeId: 'epl_alltime', formation: '4-4-2', objective: 'appearances' })],
  ['community-builder', 'preview',         post({ action: 'preview', gameType: 'higher_lower',
                                                  filters: { competitions: ['Premier League'], clubs: ['Liverpool'] } })],
];

/** A 200 that contains an `error` key is a failure dressed as a success. */
function verdict(res) {
  if (!res || typeof res.statusCode !== 'number') return { ok: false, why: 'no response' };
  let body = {};
  try { body = JSON.parse(res.body || '{}'); } catch { /* non-JSON is fine */ }
  if (res.statusCode >= 400) return { ok: false, why: `${res.statusCode} ${body.error || ''}`.trim() };
  if (body && body.error) return { ok: false, why: `200 but error: ${body.error}` };
  const size = (res.body || '').length;
  if (size < 40) return { ok: false, why: `200 but empty (${size} bytes)` };
  return { ok: true, why: `${res.statusCode} · ${(size / 1024).toFixed(1)} KB` };
}

(async () => {
  console.log(`\n  Smoke test — ${LIVE ? 'LIVE tables (control)' : 'COMPAT views (rebuilt data)'}\n`);

  let pass = 0, fail = 0;
  for (const [file, label, event] of CASES) {
    const p = path.join(FUNCS, `${file}.js`);
    if (!fs.existsSync(p)) { console.log(`  ?  ${file} — not found`); continue; }

    let res, err = null;
    const t0 = Date.now();
    try {
      delete require.cache[require.resolve(p)];
      delete require.cache[require.resolve(path.join(FUNCS, '_supabase.js'))];
      res = await require(p).handler(event, {});
    } catch (e) { err = e; }
    const ms = Date.now() - t0;

    const v = err ? { ok: false, why: `threw: ${err.message}` } : verdict(res);
    v.ok ? pass++ : fail++;
    console.log(`  ${v.ok ? '✓' : '✗'}  ${(file + ' · ' + label).padEnd(36)} ${String(ms).padStart(5)}ms  ${v.why}`);
  }

  console.log(`\n  ${pass} passed · ${fail} failed`);
  console.log(`  tables touched: ${[...seenTables].sort().join(', ')}\n`);
  process.exit(fail ? 1 : 0);
})();
