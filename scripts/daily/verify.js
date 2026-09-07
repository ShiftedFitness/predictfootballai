#!/usr/bin/env node
/**
 * verify.js — play every daily challenge in a window, before anyone else does.
 *
 * The pool is filtered on data, not on outcome, and a scope can clear every
 * threshold and still produce a game with nothing in it. A daily challenge is
 * the one thing on the site that nobody looks at before it ships, so this
 * looks at it: it runs the actual handler for each day's actual game and scope
 * and asserts a real round came back.
 *
 *   node scripts/daily/verify.js [days] [startDate]
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

const FUNCS = path.join(ROOT, 'netlify', 'functions');
const daily = require(path.join(FUNCS, '_daily.js'));

const DAYS = Number(process.argv[2] || 30);
const START = process.argv[3] || new Date().toISOString().slice(0, 10);

// What each game is asked, and what counts as a real round coming back.
const CHECK = {
  hol:    { fn: 'hol_start',    body: (s) => ({ action: 'get_players', scopeId: s, statType: 'appearances' }),
            ok: (d) => (d.players || []).length >= 20, say: (d) => `${(d.players || []).length} players` },
  alpha:  { fn: 'alpha_start',  body: (s) => ({ action: 'get_alphabet', scopeId: s }),
            ok: (d) => (d.letters || []).filter((l) => l.count > 0).length >= 15,
            say: (d) => `${(d.letters || []).filter((l) => l.count > 0).length}/26 letters` },
  whoami: { fn: 'whoami_start', body: (s) => ({ action: 'start_game', scopeId: s }),
            ok: (d) => (d.clues || []).length === 5 && d.eligibleCount >= 20,
            say: (d) => `${d.eligibleCount} eligible` },
  quiz:   { fn: 'quiz_start',   body: (s) => ({ action: 'generate_quiz', scopeId: s }),
            ok: (d) => (d.questions || []).length >= 8, say: (d) => `${(d.questions || []).length} questions` },
  xi:     { fn: 'xi_start',     body: (s) => ({ action: 'get_best_xi', scopeId: s, formation: '4-4-2', objective: 'appearances' }),
            ok: (d) => (d.bestXI || []).filter((x) => x.player).length === 11,
            say: (d) => `${(d.bestXI || []).filter((x) => x.player).length}/11` },
};

(async () => {
  console.log(`\n  Playing ${DAYS} daily challenges from ${START}\n`);
  let pass = 0; const failures = [];

  for (let i = 0; i < DAYS; i++) {
    const date = new Date(Date.parse(`${START}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    const c = daily.challengeFor(date);
    const check = CHECK[c.game.key];
    if (!check) { console.log(`  ?  ${date}  no check for ${c.game.key}`); continue; }

    for (const k of Object.keys(require.cache)) if (k.startsWith(FUNCS)) delete require.cache[k];
    let d = {}, code = 0;
    try {
      const res = await require(path.join(FUNCS, `${check.fn}.js`)).handler(
        { httpMethod: 'POST', headers: {}, body: JSON.stringify(check.body(c.scope.id)) }, {});
      code = res.statusCode;
      d = JSON.parse(res.body || '{}');
    } catch (e) { d = { error: e.message }; }

    const ok = code === 200 && !d.error && check.ok(d);
    if (ok) pass++; else failures.push({ date, c, why: d.error || `thin: ${check.say(d)}` });
    console.log(`  ${ok ? '✓' : '✗'}  ${date}  ${c.game.name.padEnd(16)} ${c.label.padEnd(44)} ` +
                `${ok ? check.say(d) : (d.error || check.say(d))}`);
  }

  console.log(`\n  ${pass} playable · ${failures.length} not`);
  if (failures.length) {
    console.log('\n  Raise a threshold in scripts/daily/pool.js and regenerate:');
    for (const f of failures) console.log(`    ${f.date}  ${f.c.game.name} · ${f.c.label} — ${f.why}`);
  }
  console.log();
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
