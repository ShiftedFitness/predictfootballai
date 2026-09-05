#!/usr/bin/env node
/**
 * check_club_names.js — every club name the code mentions must resolve.
 *
 * Written after Bullseye returned an empty board for Málaga. Five functions
 * resolve clubs by NAME against hardcoded lists — match_start alone carries
 * 144 — and the rebuild changed 68 club names, so a fifth of them silently
 * stopped matching. Nothing errored. The game just came back empty.
 *
 * A smoke test cannot catch that: it would have had to guess Málaga. This can,
 * because it checks every name in the codebase rather than the handful someone
 * thought to try.
 *
 *   node scripts/fbref/check_club_names.js
 *
 * Exits non-zero if any referenced club name has no rows behind it, so it can
 * gate a deploy.
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

// ─── Collect candidate names from the source ────────────────────────────────

function sourceFiles() {
  const out = [];
  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === '_deprecated') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'netlify', 'functions'));
  walk(path.join(ROOT, 'public'));
  return out;
}

/**
 * Names appear as clubName: 'X', in club arrays, and inside category ids like
 * `laliga_club_Real_Madrid`. Rather than parse each shape, take every quoted
 * string that could be a club name and let the database decide — a name that
 * is not a club simply will not be in the reference list, and is ignored.
 */
function candidates(text) {
  const found = new Set();
  // Comments are documentation, not lookups — an example club name in a
  // docstring is not a query that can come back empty.
  const code = text.split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

  for (const m of code.matchAll(/['"`]([A-ZÀ-Þ][A-Za-zÀ-ÿ0-9.&''-]*(?: [A-Za-zÀ-ÿ0-9.&''-]+){0,3})['"`]/g)) {
    found.add(m[1]);
  }
  // laliga_club_Real_Madrid → "Real Madrid". These are resolved with ilike in
  // match_start, so case does not have to match.
  for (const m of code.matchAll(/(?:laliga|seriea|bundesliga|ligue1|epl)_(?:club|goals)_([A-Za-zÀ-ÿ0-9_'-]+)/g)) {
    found.add(m[1].replace(/_/g, ' '));
  }
  return found;
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  // Every club name that has rows behind it. This is the reference list: a
  // name is "valid" only if a game asking for it would get players back.
  const withRows = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('v_game_player_club_comp').select('club_name').range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    for (const r of data) withRows.add(r.club_name);
    if (data.length < 1000) break;
  }

  // Names the database knows about at all, so a club with no rows in the game
  // view can be reported differently from a typo.
  const known = new Set();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('clubs').select('club_name').range(from, from + 999);
    if (!data || !data.length) break;
    for (const r of data) known.add(r.club_name);
    if (data.length < 1000) break;
  }

  const de = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  const byLoose = new Map();
  for (const n of withRows) if (!byLoose.has(de(n))) byLoose.set(de(n), n);

  const broken = [];
  const files = sourceFiles();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const c of candidates(text)) {
      if (withRows.has(c)) continue;             // resolves — fine
      if (!known.has(c) && !byLoose.has(de(c))) continue;  // not a club at all — ignore

      // An ALIAS is not a break. alpha_start and hol_start carry maps like
      //   'Atlético Madrid': ['Atletico Madrid', 'Atletico']
      // where the accented key is what gets queried and the rest are inputs
      // the user might type. If the file also contains the form that DOES
      // resolve, this candidate is one of those aliases, not a dead lookup.
      const resolving = byLoose.get(de(c));
      if (resolving && text.includes(resolving)) continue;

      broken.push({ file: path.relative(ROOT, f), name: c, near: resolving || null });
    }
  }

  // One entry per name+file.
  const seen = new Set();
  const unique = broken.filter((b) => {
    const k = `${b.file}|${b.name}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  console.log(`\n  ${withRows.size} club names have players behind them.`);
  console.log(`  scanned ${files.length} source files.\n`);

  if (!unique.length) {
    console.log(`  ✓ every club name referenced in the code resolves.\n`);
    return;
  }

  console.log(`  ✗ ${unique.length} references do NOT resolve — these games return an empty board:\n`);
  for (const b of unique) {
    console.log(`    ${b.file.padEnd(38)} '${b.name}'` +
                (b.near ? `   (data has '${b.near}')` : `   (no close match)`));
  }
  console.log('');
  process.exit(1);
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
