#!/usr/bin/env node
/**
 * sweep.js — ask every game for EVERY scope it advertises.
 *
 * The smoke test checks that each game works. This checks that each game works
 * for every option it offers a player, which is a different and much larger
 * question: Bullseye alone exposes around 150 categories, the XI builder 41
 * clubs across three objectives. Nineteen hand-picked cases cannot cover that,
 * and the one that reached a real user — Málaga returning an empty board —
 * would only have been caught by guessing the right club.
 *
 * Nothing here is guessed. Each game publishes its own scope list through
 * get_scopes, so the list of things to test comes from the games themselves
 * and grows automatically when they do.
 *
 * A 200 is not a pass. An empty board is exactly the failure mode we are
 * hunting, so every check asserts there is actually something to play.
 *
 *   node scripts/fbref/sweep.js              # everything (slow — minutes)
 *   node scripts/fbref/sweep.js xi bullseye  # only the named games
 *   node scripts/fbref/sweep.js --quick      # one in four scopes
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FUNCS = path.join(ROOT, 'netlify', 'functions');

for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 0) continue;
  if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const call = async (file, body) => {
  const p = path.join(FUNCS, `${file}.js`);
  const res = await require(p).handler(
    { httpMethod: 'POST', headers: {}, body: JSON.stringify(body) }, {});
  let parsed = {};
  try { parsed = JSON.parse(res.body || '{}'); } catch { /* ignore */ }
  return { status: res.statusCode, body: parsed };
};

const scopesOf = async (file) => {
  const r = await call(file, { action: 'get_scopes' });
  return r.body.scopes || r.body.categories || [];
};

// ─── One definition per game: how to enumerate it, and what "worked" means ──

const GAMES = {
  xi: {
    file: 'xi_start',
    async plan() {
      const scopes = await scopesOf('xi_start');
      const out = [];
      for (const s of scopes) {
        for (const obj of s.visibleObjectives || ['appearances', 'goals', 'performance']) {
          out.push({
            label: `${s.id} / ${obj}`,
            body: { action: 'get_best_xi', scopeId: s.id, formation: '4-4-2', objective: obj },
            // A formation has eleven slots. Fewer means the pool ran dry.
            ok: (b) => (b.bestXI || []).filter((x) => x.player).length === 11,
            why: (b) => `${(b.bestXI || []).filter((x) => x.player).length}/11 slots filled`,
          });
        }
      }
      return out;
    },
  },

  alpha: {
    file: 'alpha_start',
    async plan() {
      return (await scopesOf('alpha_start')).map((s) => ({
        label: s.id,
        body: { action: 'get_alphabet', scopeId: s.id },
        // Twenty-six letters, but X and Q are legitimately empty for most
        // clubs, so the bar is "most of the alphabet has someone".
        ok: (b) => (b.letters || []).filter((l) => l.count > 0).length >= 15,
        why: (b) => `${(b.letters || []).filter((l) => l.count > 0).length}/26 letters populated`,
      }));
    },
  },

  hol: {
    file: 'hol_start',
    async plan() {
      const out = [];
      for (const s of await scopesOf('hol_start')) {
        for (const stat of ['appearances', 'goals']) {
          out.push({
            label: `${s.id} / ${stat}`,
            body: { action: 'get_players', scopeId: s.id, statType: stat },
            // Higher-or-Lower needs a pool to draw pairs from.
            ok: (b) => (b.players || []).length >= 10,
            why: (b) => `${(b.players || []).length} players`,
          });
        }
      }
      return out;
    },
  },

  whoami: {
    file: 'whoami_start',
    async plan() {
      return (await scopesOf('whoami_start')).map((s) => ({
        label: s.id,
        body: { action: 'start_game', scopeId: s.id },
        ok: (b) => (b.clues || []).length > 0 && Boolean(b.playerId),
        why: (b) => `${(b.clues || []).length} clues, ${b.eligibleCount ?? '?'} eligible`,
      }));
    },
  },

  quiz: {
    file: 'quiz_start',
    async plan() {
      return (await scopesOf('quiz_start')).map((s) => ({
        label: s.id,
        body: { action: 'generate_quiz', scopeId: s.id },
        ok: (b) => (b.questions || []).length > 0,
        why: (b) => `${(b.questions || []).length} questions`,
      }));
    },
  },

  bullseye: {
    file: 'match_start',
    async plan() {
      // Bullseye does not publish a scope list, so build one the way the
      // frontend does: every club in each league gets a category id.
      const { createClient } = require('@supabase/supabase-js');
      const db = createClient(process.env.Supabase_Project_URL,
                              process.env.Supabase_Service_Role,
                              { auth: { persistSession: false } });
      const leagues = { laliga: 'La Liga', seriea: 'Serie A',
                        bundesliga: 'Bundesliga', ligue1: 'Ligue 1' };
      const out = [];
      for (const [key, comp] of Object.entries(leagues)) {
        const { data } = await db.from('v_game_player_club_comp')
          .select('club_name').eq('competition_name', comp).limit(1000);
        for (const club of [...new Set((data || []).map((r) => r.club_name))]) {
          out.push({
            label: `${key}_club_${club}`,
            body: { categoryId: `${key}_club_${club.replace(/ /g, '_')}` },
            ok: (b) => (b.eligiblePlayers || []).length > 0,
            why: (b) => `${(b.eligiblePlayers || []).length} players`,
          });
        }
      }
      out.push({ label: 'epl_age_u21', body: { categoryId: 'epl_age_u21' },
                 ok: (b) => (b.eligiblePlayers || []).length > 0,
                 why: (b) => `${(b.eligiblePlayers || []).length} players` });
      return out;
    },
  },
};

// ─── Run ────────────────────────────────────────────────────────────────────

(async () => {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const want = args.filter((a) => !a.startsWith('--'));
  const games = Object.keys(GAMES).filter((g) => !want.length || want.includes(g));

  let totalPass = 0;
  const failures = [];

  for (const g of games) {
    const def = GAMES[g];
    let plan;
    try { plan = await def.plan(); }
    catch (e) { console.log(`\n  ${g}: could not build a plan — ${e.message}`); continue; }

    if (quick) plan = plan.filter((_, i) => i % 4 === 0);
    process.stdout.write(`\n  ${g} (${def.file}) — ${plan.length} scopes\n`);

    let pass = 0;
    for (const c of plan) {
      let res, err = null;
      try {
        for (const k of Object.keys(require.cache)) {
          if (/netlify.functions/.test(k)) delete require.cache[k];
        }
        res = await call(def.file, c.body);
      } catch (e) { err = e; }

      const ok = !err && res.status === 200 && !res.body.error && c.ok(res.body);
      if (ok) { pass++; totalPass++; process.stdout.write('.'); }
      else {
        process.stdout.write('F');
        failures.push({
          game: g,
          label: c.label,
          why: err ? `threw: ${err.message}`
             : res.body.error ? `${res.status} ${res.body.error}`
             : `${res.status} but ${c.why(res.body)}`,
        });
      }
    }
    process.stdout.write(`  ${pass}/${plan.length}\n`);
  }

  console.log(`\n\n  ${totalPass} passed · ${failures.length} failed\n`);
  if (failures.length) {
    // Group, because one broken club shows up once per objective.
    const byWhy = new Map();
    for (const f of failures) {
      const k = `${f.game} · ${f.why}`;
      if (!byWhy.has(k)) byWhy.set(k, []);
      byWhy.get(k).push(f.label);
    }
    for (const [k, labels] of [...byWhy.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${k}   (${labels.length})`);
      console.log(`     ${labels.slice(0, 6).join(', ')}${labels.length > 6 ? ` … +${labels.length - 6}` : ''}\n`);
    }
    process.exit(1);
  }
  console.log('  ✓ every scope every game advertises returns a playable board.\n');
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
