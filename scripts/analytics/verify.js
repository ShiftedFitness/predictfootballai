#!/usr/bin/env node
/**
 * verify.js — prove the analytics layer does what it claims.
 *
 * The brief's non-negotiables are worth restating, because this file exists to
 * hold them rather than to describe them:
 *
 *   1. /fives and /predict receive ZERO tracking. No gtag.js, no page_view,
 *      no events.
 *   2. No free text ever reaches GA4 — not a guess, not a player name, not an
 *      email, not an auth token, not a community game title.
 *   3. Commercial events fire ONCE. A paywall that re-renders must not read as
 *      two people hitting it.
 *
 * ts-analytics.js is loaded into a minimal fake browser with gtag replaced by
 * a recorder, so every assertion is about what would actually have been sent
 * rather than about what the source appears to say.
 *
 *   node scripts/analytics/verify.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'js', 'ts-analytics.js'), 'utf8');

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    const why = fn();
    if (why) { failures.push(`${name}: ${why}`); console.log(`  ✗  ${name}\n       ${why}`); }
    else { pass++; console.log(`  ✓  ${name}`); }
  } catch (e) {
    failures.push(`${name}: threw ${e.message}`);
    console.log(`  ✗  ${name}\n       threw: ${e.message}`);
  }
}

/**
 * Load the module at a given URL and return { TSAnalytics, sent, loadedScripts }.
 *
 * `sent` is every gtag() call. `loadedScripts` is every <script> the module
 * asked the page to insert, which is how the "gtag.js is never injected"
 * claim is actually tested rather than assumed.
 */
function bootAt(href) {
  const sent = [];
  const loadedScripts = [];
  const url = new URL(href);

  const el = () => ({
    setAttribute() {}, appendChild() {}, classList: { contains: () => false },
    parentNode: { insertBefore(node) { loadedScripts.push(node.src || ''); } },
    style: {}, set src(v) { this._src = v; }, get src() { return this._src; },
  });

  const doc = {
    referrer: '',
    createElement: () => el(),
    getElementsByTagName: () => [el()],
    getElementById: () => null,
    head: el(),
    documentElement: el(),
  };

  const store = {};
  const win = {
    location: { href, pathname: url.pathname, search: url.search,
                hostname: url.hostname, protocol: url.protocol, origin: url.origin },
    document: doc,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    console: { log() {} },        // silence the dev-mode mirror
    URL, URLSearchParams,
  };
  win.window = win;

  const ctx = vm.createContext(win);
  // gtag is defined BEFORE the module loads, so the module's own
  // `window.gtag || function(){}` keeps this recorder rather than replacing it.
  ctx.gtag = function () { sent.push([].slice.call(arguments)); };
  vm.runInContext(SRC, ctx);

  return { A: win.TSAnalytics, sent, loadedScripts, ctx };
}

const events = (sent) => sent.filter((c) => c[0] === 'event');
const named = (sent, name) => events(sent).filter((c) => c[1] === name);

// ─── 1. The Fives exclusion ─────────────────────────────────────────────────

for (const p of ['/fives/', '/fives/index.html', '/predict/', '/predict/league.html',
                 '/predict/admin.html', '/PREDICT/Index.html']) {
  check(`excluded: ${p} sends nothing`, () => {
    const { A, sent, loadedScripts } = bootAt(`https://telestats.net${p}`);
    if (!A.isExcluded()) return 'isExcluded() is false';
    A.trackEvent('game_start', { game_type: 'hol' });
    A.gameStart('hol', {});
    A.gameComplete('hol', {});
    A.paywallView({ tier: 'free' });
    A.upgradeView('free');
    A.checkoutStart('lifetime');
    A.checkoutReturn('lifetime', 'returned');
    if (sent.length) return `${sent.length} gtag calls: ${JSON.stringify(sent).slice(0, 160)}`;
    if (loadedScripts.some((s) => /googletagmanager/.test(s))) return 'gtag.js was injected';
    return null;
  });
}

check('not excluded: a normal page does configure GA4', () => {
  const { A, sent } = bootAt('https://telestats.net/teams/arsenal/');
  if (A.isExcluded()) return 'isExcluded() is true on a normal page';
  if (!sent.some((c) => c[0] === 'config')) return 'no config call';
  return null;
});

check('exclusion is a prefix match, not a substring one', () => {
  const { A } = bootAt('https://telestats.net/games/predictions.html');
  // "/games/predictions.html" contains "predict" but does not start with it.
  return A.isExcluded() ? 'a /games page was wrongly excluded' : null;
});

// ─── 2. No free text, no PII, no tokens ─────────────────────────────────────

check('objects and arrays are dropped', () => {
  const { A, sent } = bootAt('https://telestats.net/games/hol.html');
  A.trackEvent('game_complete', {
    answers: ['Henry', 'Bergkamp'],
    player: { name: 'Thierry Henry', uid: 'x1' },
    fn: function () {},
    score: 12,
  });
  const p = named(sent, 'game_complete')[0][2];
  if ('answers' in p || 'player' in p || 'fn' in p) return `leaked: ${JSON.stringify(p)}`;
  if (p.score !== 12) return 'dropped the scalar it should have kept';
  return null;
});

check('long strings are truncated', () => {
  const { A, sent } = bootAt('https://telestats.net/games/hol.html');
  A.trackEvent('t', { note: 'x'.repeat(500) });
  const v = named(sent, 't')[0][2].note;
  return v.length > 100 ? `kept ${v.length} characters` : null;
});

check('auth tokens and Stripe ids never reach page_location', () => {
  const { sent } = bootAt(
    'https://telestats.net/upgrade/?session_id=cs_live_abc123&email=a%40b.com&code=xyz#access_token=eyJhbGciOi');
  const cfg = sent.find((c) => c[0] === 'config');
  const loc = cfg && cfg[2] && cfg[2].page_location || '';
  for (const bad of ['session_id', 'access_token', 'email=', 'code=', 'eyJhbGciOi']) {
    if (loc.indexOf(bad) !== -1) return `page_location contains ${bad}: ${loc}`;
  }
  return null;
});

check('a community game title is not turned into a scope dimension', () => {
  const { A } = bootAt('https://telestats.net/games/hol.html');
  for (const title of ['My Mates XI', 'All EPL Goals', "O'Brien's quiz", 'club_arsenal; DROP TABLE']) {
    const out = A.scopeParams(title);
    if (Object.keys(out).length) return `${title} -> ${JSON.stringify(out)}`;
  }
  return null;
});

check('scopeParams reads the ids the games actually write', () => {
  const { A } = bootAt('https://telestats.net/games/hol.html');
  const cases = [
    ['epl_club_arsenal', { league: 'epl', club: 'arsenal' }],
    ['epl_alltime', { league: 'epl' }],
    ['team_plymouth-argyle_league-one', { team: 'plymouth-argyle', competition: 'league-one', competition_count: 1 }],
    ['team_sunderland_all', { team: 'sunderland', competition: 'all', competition_count: 0 }],
    ['team_sunderland_premier-league+championship',
     { team: 'sunderland', competition: 'premier-league+championship', competition_count: 2 }],
  ];
  for (const [id, want] of cases) {
    const got = A.scopeParams(id);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      return `${id} -> ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`;
    }
  }
  return null;
});

check('an unknown call site becomes "other", never a new value', () => {
  const { A, sent } = bootAt('https://telestats.net/games/hol.html');
  A.signupView('some_new_button_somebody_added');
  A.checkoutStart('annual_subscription');
  A.paywallAction('bribe');            // not in the list: must not fire at all
  A.upgradeView('platinum');
  if (named(sent, 'signup_view')[0][2].source !== 'other') return 'signup_view source leaked';
  if (named(sent, 'checkout_start')[0][2].plan !== 'other') return 'checkout_start plan leaked';
  if (named(sent, 'paywall_action').length) return 'paywall_action fired on an unknown action';
  if (named(sent, 'upgrade_view')[0][2].tier !== 'unknown') return 'upgrade_view tier leaked';
  return null;
});

// ─── 3. Once, and only once ─────────────────────────────────────────────────

for (const [label, call, event] of [
  ['paywall_view', (A) => A.paywallView({ tier: 'free' }), 'paywall_view'],
  ['upgrade_view', (A) => A.upgradeView('free'), 'upgrade_view'],
  ['signup_submit', (A) => A.signupSubmit(), 'signup_submit'],
  ['signup_complete', (A) => A.signupComplete(), 'signup_complete'],
  ['checkout_return', (A) => A.checkoutReturn('lifetime', 'returned'), 'checkout_return'],
]) {
  check(`${label} fires once however many times it is called`, () => {
    const { A, sent } = bootAt('https://telestats.net/upgrade/');
    for (let i = 0; i < 5; i++) call(A);
    const n = named(sent, event).length;
    return n === 1 ? null : `fired ${n} times`;
  });
}

check('game_complete fires once per round, not once per call', () => {
  const { A, sent } = bootAt('https://telestats.net/games/hol.html');
  A.gameStart('higher_lower', { league: 'epl' });
  A.gameComplete('higher_lower', { score: 9 });
  A.gameComplete('higher_lower', { score: 9 });
  A.gameComplete('higher_lower', { score: 9 });
  const n = named(sent, 'game_complete').length;
  return n === 1 ? null : `fired ${n} times`;
});

check('a second round fires game_replay then game_start', () => {
  const { A, sent } = bootAt('https://telestats.net/games/hol.html');
  A.gameStart('higher_lower', {});
  A.gameComplete('higher_lower', {});
  A.gameStart('higher_lower', {});
  if (named(sent, 'game_start').length !== 2) return 'game_start did not fire twice';
  if (named(sent, 'game_replay').length !== 1) return 'game_replay did not fire once';
  const order = events(sent).map((c) => c[1]);
  if (order.indexOf('game_replay') > order.lastIndexOf('game_start')) return 'game_replay fired after game_start';
  return null;
});

check('a new round after a complete can complete again', () => {
  const { A, sent } = bootAt('https://telestats.net/games/hol.html');
  A.gameStart('higher_lower', {});
  A.gameComplete('higher_lower', {});
  A.gameStart('higher_lower', {});
  A.gameComplete('higher_lower', {});
  const n = named(sent, 'game_complete').length;
  return n === 2 ? null : `fired ${n} times, expected 2`;
});

// ─── 4. The commercial funnel exists and is shaped as claimed ───────────────

check('the full commercial funnel fires, in order, with scalar params only', () => {
  const { A, sent } = bootAt('https://telestats.net/upgrade/');
  A.paywallView({ game_type: 'higher_lower', tier: 'free' });
  A.paywallAction('upgrade', { game_type: 'higher_lower' });
  A.upgradeView('free');
  A.checkoutStart('day_pass');
  A.checkoutReturn('day_pass', 'returned');
  A.signupView('paywall');
  A.signupSubmit();
  A.signupComplete();
  A.loginSuccess('password');

  const want = ['paywall_view', 'paywall_action', 'upgrade_view', 'checkout_start',
                'checkout_return', 'signup_view', 'signup_submit', 'signup_complete', 'login_success'];
  const got = events(sent).map((c) => c[1]);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    return `got ${JSON.stringify(got)}`;
  }
  for (const [, name, params] of events(sent)) {
    for (const [k, v] of Object.entries(params || {})) {
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        return `${name}.${k} is ${typeof v}`;
      }
    }
  }
  return null;
});

check('there is no `purchase` event — revenue is the webhook, not the browser', () => {
  const { A, sent } = bootAt('https://telestats.net/upgrade/');
  if (typeof A.purchase === 'function') return 'TSAnalytics.purchase exists';
  A.checkoutReturn('lifetime', 'returned');
  return named(sent, 'purchase').length ? 'a purchase event was sent' : null;
});

check('a cancelled return is recorded as cancelled', () => {
  const { A, sent } = bootAt('https://telestats.net/upgrade/');
  A.checkoutReturn('lifetime', 'cancelled');
  const p = named(sent, 'checkout_return')[0][2];
  return p.status === 'cancelled' ? null : `status was ${p.status}`;
});

// ─── 5. It never breaks a page ──────────────────────────────────────────────

check('nothing throws when gtag is missing entirely', () => {
  const { A, ctx } = bootAt('https://telestats.net/games/hol.html');
  ctx.gtag = undefined;
  ctx.window.gtag = undefined;
  A.trackEvent('x', { a: 1 });
  A.paywallView({});
  A.gameStart('hol', {});
  A.gameComplete('hol', {});
  return null;
});

check('nothing throws on rubbish input', () => {
  const { A } = bootAt('https://telestats.net/games/hol.html');
  A.trackEvent(null); A.trackEvent(''); A.trackEvent(123);
  A.trackEvent('x', null); A.trackEvent('x', 'a string'); A.trackEvent('x', []);
  A.scopeParams(null); A.scopeParams(42); A.scopeParams({});
  A.paywallAction(null); A.signupView(undefined); A.checkoutStart(undefined);
  return null;
});

// ─── The call sites in the pages themselves ─────────────────────────────────

check('no page pastes the gtag snippet directly', () => {
  const roots = ['public'];
  const bad = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.html$/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (/googletagmanager\.com\/gtag/.test(src)) bad.push(p);
    }
  };
  roots.forEach((r) => walk(path.join(__dirname, '..', '..', r)));
  return bad.length ? `gtag snippet in: ${bad.join(', ')}` : null;
});

check('no Fives page loads the analytics module', () => {
  const base = path.join(__dirname, '..', '..', 'public');
  const bad = [];
  for (const dir of ['fives', 'predict']) {
    const d = path.join(base, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!/\.html$/.test(f)) continue;
      if (/ts-analytics\.js/.test(fs.readFileSync(path.join(d, f), 'utf8'))) bad.push(`${dir}/${f}`);
    }
  }
  return bad.length ? `loads ts-analytics.js: ${bad.join(', ')}` : null;
});

console.log(`\n  ${pass} passed · ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
