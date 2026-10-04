/**
 * build_games.js — the Games hub.
 *
 * Generated rather than hand-written so it can draw the SAME six illustrations
 * the club pages use (scripts/lib/game-art.js) instead of a second copy, and
 * so the coverage figures in the hero come from the database rather than from
 * somebody remembering to update a number in the markup.
 *
 *   npm run build:games
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 0) continue;
  process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.Supabase_Project_URL, process.env.Supabase_Service_Role,
  { auth: { persistSession: false } });

const teams = require(path.join(ROOT, 'netlify', 'functions', '_teams.js'));
const art = require('../lib/game-art');

const SITE = 'https://telestats.net';
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(n || 0).toLocaleString('en-GB');

/**
 * The brand's own colours, standing in for a club's.
 *
 * Every illustration was written for a club page and takes { primary,
 * secondary }. On a page that is not about one club, passing cyan gives the
 * same drawings in the site's own colour rather than Arsenal's — which is the
 * whole reason they take a palette instead of hardcoding one.
 */
const BRAND = { primary: '#00E5FF', secondary: '#0B3B44' };

const GAMES = [
  // No `featured` here, deliberately. Today's Challenge above IS the featured
  // thing on this page, and a second hero card competes with it for the same
  // attention. Six equal cards also divide into 3x2 and 2x3 without leaving a
  // single orphan on a row of its own, which 1 + 5 does not.
  { key: 'bullseye', name: 'Bullseye', path: '/games/bullseye.html',
    blurb: 'Pick players. Reach zero.',
    how: 'You start on 501. Name a player and their appearances come off your total. '
       + 'Land exactly on zero — going under puts the score back.',
    art: art.bullseyeArt },
  { key: 'xi', name: 'Starting XI', path: '/games/xi.html',
    blurb: 'Build your ultimate eleven.',
    how: 'Choose a formation, then fill every position with a player from the club or '
       + 'competition you picked. Your score is the total of whichever stat you are playing for.',
    art: art.pitchArt },
  { key: 'hol', name: 'Higher or Lower', path: '/games/hol.html',
    blurb: 'Who played more games?',
    how: 'Two players at a time. Say which one made more appearances, and keep going '
       + 'until you get one wrong.',
    art: art.holArt },
  { key: 'whoami', name: 'Who Am I?', path: '/games/whoami.html',
    blurb: 'Five clues. One footballer.',
    how: 'A mystery player, revealed one clue at a time. The sooner you name them, '
       + 'the more you score.',
    art: art.whoArt },
  { key: 'alpha', name: 'Player Alphabet', path: '/games/alpha.html',
    blurb: 'A player for every letter.',
    how: 'A to Z, one player per letter. Letters nobody has a player for are skipped.',
    art: art.alphaArt },
  { key: 'quiz', name: 'Trivia Quiz', path: '/games/quiz.html',
    blurb: 'Ten questions. How many?',
    how: 'Ten questions drawn from real records for the club or competition you chose.',
    art: art.quizArt },
];

/** Real figures for the hero. Never a number typed into the markup. */
async function coverage() {
  const all = teams.all();
  const { count } = await db.from('players').select('player_uid', { count: 'exact', head: true });
  const comps = new Set();
  all.forEach((t) => t.competitions.forEach((c) => comps.add(c)));
  return { clubs: all.length, players: count || 0, competitions: comps.size, games: GAMES.length };
}

module.exports = { GAMES, BRAND, esc, num, SITE, coverage };

if (require.main === module) {
  (async () => {
    const cov = await coverage();
    const { render } = require('./render_games');
    const out = path.join(ROOT, 'public', 'games', 'index.html');
    fs.writeFileSync(out, render(cov, GAMES, BRAND));
    console.log(`\n  ✓ public/games/index.html — ${cov.games} games, ` +
                `${num(cov.players)} players, ${cov.clubs} clubs\n`);
  })().catch((e) => { console.error(e); process.exit(1); });
}
