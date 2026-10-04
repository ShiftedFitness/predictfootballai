#!/usr/bin/env node
/**
 * build.js — generate a static HTML page for every team.
 *
 * STATIC, DELIBERATELY.
 *
 * The whole point of these pages is organic discovery. Asking Googlebot to
 * execute JavaScript and wait on a Netlify function before it can see any
 * content — across 313 pages — is the single decision most likely to waste the
 * exercise. So every page ships as real HTML with the players, the records and
 * the links already in it. JavaScript is for the interactive parts only, and
 * the page is complete without it.
 *
 * The data is fetched ONCE for all teams in three paged queries, not per page.
 * Reading agg_player_club per team would be 313 round trips for information
 * three queries already contain.
 *
 *   node scripts/teams/build.js              # all teams
 *   node scripts/teams/build.js plymouth-argyle arsenal   # named teams only
 *
 * Output: public/teams/<slug>/index.html, plus public/teams/index.html
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'public', 'teams');

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
const { render, shield } = require('./render');
const ALIASES = require(path.join(ROOT, 'data', 'teams', 'aliases.json'));
const colours = require('./colours');
const shell = require('../pages/shell');

const SITE = 'https://telestats.net';

/**
 * Before a game is worth offering for a club in a competition, the data has to
 * be rich enough to build a round from — and "rich enough" is not a headcount.
 *
 * Lincoln City has twenty Championship players, comfortably past any sensible
 * squad minimum. Every one of them has four appearances, because the season is
 * four games old. Higher or Lower has nothing to ask about: every comparison is
 * a tie. Elversberg is the same in the Bundesliga with sixteen players on one
 * appearance each.
 *
 * So the second condition is about SPREAD. Once somebody has played ten games
 * the numbers have started to separate, and both clubs clear it on their own as
 * the season goes on — no list to maintain.
 */
const MIN_PLAYERS_TO_PLAY = 12;
const MIN_TOP_APPEARANCES = 10;

// ─── helpers ────────────────────────────────────────────────────────────────

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (n) => (n == null ? '0' : Number(n).toLocaleString('en-GB'));

async function page(table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// ─── the hub ────────────────────────────────────────────────────────────────

/**
 * /teams/ — the index every team page links back to, and the page that stops
 * 313 URLs being orphans. Grouped by competition because that is how a person
 * looks for a club, and it puts the four English tiers in ladder order.
 */
/**
 * The Teams hub — "find your club", not a sitemap.
 *
 * It used to be a search box over eight competition sections, each listing
 * every club that had ever played in that competition. A club in four
 * divisions appeared four times, the page ran to several hundred links, and
 * the grouping quietly implied current league membership: Oldham sat under
 * "Premier League" because of 1990s records.
 *
 * Now: one country per club, so every club appears exactly ONCE in the
 * unfiltered directory; competitions are a filter over that, labelled as
 * records rather than tables; and the fastest route — search — is the first
 * thing on the page.
 *
 * Everything stays in the server-rendered HTML. The filtering only hides rows
 * that are already there, so a visitor without JavaScript sees all 355 clubs
 * and every link remains crawlable.
 */
const COUNTRIES = [
  { code: 'ENG', name: 'England', comps: ['Premier League', 'Championship', 'League One', 'League Two', 'FA Cup', 'EFL Cup'] },
  { code: 'ESP', name: 'Spain', comps: ['La Liga', 'Segunda División'] },
  { code: 'ITA', name: 'Italy', comps: ['Serie A'] },
  { code: 'GER', name: 'Germany', comps: ['Bundesliga'] },
  { code: 'FRA', name: 'France', comps: ['Ligue 1'] },
];

/**
 * Editorially featured, and labelled as such.
 *
 * Not "most popular": nothing here measures that, and a made-up ranking on a
 * statistics site is the one thing this page must not do. Spread across the
 * five countries so the hub does not read as an English site with extras.
 */
/**
 * How many clubs a country shows before "Show all".
 *
 * England alone is 114 rows; all five countries ran the page to 15,700px, or
 * about eighteen phone screens of links. The rest are STILL IN THE HTML and
 * still crawlable — they are hidden with the hidden attribute, which is what
 * the country and competition filters already use, not removed from the
 * document. A visitor without JavaScript sees all 355, because the capping
 * only happens once the script runs.
 */
const CAP = 24;

const FEATURED = [
  'arsenal', 'liverpool', 'manchester-united', 'chelsea',
  'barcelona', 'real-madrid', 'bayern-munich', 'juventus',
];

/** Lowercase, accents removed — the same folding the search applies to a query. */
function fold(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function renderHub(rows) {
  const bySlug = new Map(rows.map((r) => [r.team.slug, r]));
  const total = rows.length;

  // ── the directory: one country per club, alphabetical ───────────────────
  const sections = COUNTRIES.map((country) => {
    const members = rows
      .filter((r) => r.team.country === country.code)
      .sort((a, b) => a.team.name.localeCompare(b.team.name, 'en'));
    if (!members.length) return '';

    const links = members.map((m) => {
      const t = m.team;
      const c = colours.forTeam(t);
      // Everything the search can match on, folded once here rather than 355
      // times per keystroke: the club's name, and its real-world nicknames.
      const keys = [fold(t.name), ...(ALIASES[t.slug] || [])].join('|');
      // Which competitions it has records in, so the filter can hide rows
      // without a second copy of the club list.
      const comps = t.competitions.map((x) => fold(x)).join('|');
      return `<li><a href="/teams/${esc(t.slug)}/" data-k="${esc(keys)}" ` +
        `data-c="${esc(comps)}" style="--club:${c.primary}"><i></i>` +
        `<span class="cn">${esc(t.name)}</span>` +
        `<span class="cm">${esc(String(t.players))}</span></a></li>`;
    }).join('\n          ');

    const chips = country.comps
      .filter((comp) => members.some((m) => m.team.competitions.includes(comp)))
      .map((comp) => `<button type="button" class="cchip" data-comp="${esc(fold(comp))}"
              >${esc(comp)}</button>`).join('\n            ');

    return `<section class="cblock" data-country="${esc(country.code)}">
  <div class="chead">
    <h3>${esc(country.name)}</h3>
    <span class="ccount">${members.length} clubs</span>
  </div>
  ${chips ? `<div class="cfilter" role="group" aria-label="${esc(country.name)} competitions">
    <button type="button" class="cchip on" data-comp="">All</button>
            ${chips}
  </div>` : ''}
  <ul class="clist">
          ${links}
  </ul>
  ${members.length > CAP ? `<button type="button" class="showall" data-n="${members.length}"
    >Show all ${members.length} ${esc(country.name)} clubs</button>` : ''}
</section>`;
  }).filter(Boolean).join('\n\n');

  // ── featured ────────────────────────────────────────────────────────────
  const featured = FEATURED.map((slug) => {
    const r = bySlug.get(slug);
    if (!r) return '';
    const t = r.team;
    const c = colours.forTeam(t);
    return `<li><a href="/teams/${esc(t.slug)}/" style="--club:${c.primary}">
            ${shield(t, c)}
            <span class="fn">${esc(t.name)}</span>
            <span class="fm">${Number(t.players).toLocaleString('en-GB')} players</span>
          </a></li>`;
  }).filter(Boolean).join('\n        ');
  const title = 'Football Teams: Player Stats, Records & Games | TeleStats';
  const description =
    `Explore football player records, appearances, goals and games for ${total} clubs. ` +
    `Find your team and discover football history on TeleStats.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'TeleStats', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Teams', item: `${SITE}/teams/` },
        ],
      },
      {
        '@type': 'CollectionPage',
        name: title,
        description,
        url: `${SITE}/teams/`,
      },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<script src="/js/ts-analytics.js"></script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}/teams/">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}/teams/">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/telestats-theme.css">
<link rel="stylesheet" href="/css/ts-page.css">
<style>
  /* Tokens, the shell, headings, the hero and breadcrumbs now come from
     css/ts-page.css. What stays here is what only this page has. */
  /* ── search ─────────────────────────────────────────────────────────────
     The main action. One input, a live list of matches, Enter goes to the top
     one. No request: every club is already on the page. */
  .find { position: relative; margin: 0 0 8px; }
  .find input { width: 100%; box-sizing: border-box; padding: 15px 44px 15px 46px;
                font: inherit; font-size: 1rem; min-height: 54px; border-radius: 12px;
                border: 1px solid var(--line-2); background: var(--s1); color: var(--fg); }
  .find input::placeholder { color: var(--fg-3); }
  .find input:focus { outline: none; border-color: var(--cyan); }
  .find .mag { position: absolute; left: 16px; top: 50%; transform: translateY(-50%);
               width: 18px; height: 18px; color: var(--fg-3); pointer-events: none; }
  .find .clear { position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
                 width: 36px; height: 36px; display: none; align-items: center;
                 justify-content: center; border: 0; border-radius: 50%; cursor: pointer;
                 background: transparent; color: var(--fg-2); font-size: 20px; line-height: 1; }
  .find .clear:hover { color: var(--fg); background: rgba(255,255,255,.07); }
  .find.has .clear { display: flex; }
  .sugg { position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; right: 0;
          margin: 0; padding: 6px; list-style: none; border-radius: 12px;
          background: var(--s2); border: 1px solid var(--line-2);
          box-shadow: 0 16px 40px rgba(0,0,0,.62); max-height: 320px; overflow-y: auto; }
  .sugg[hidden] { display: none; }
  .sugg a { display: flex; align-items: center; gap: 10px; padding: 10px 11px;
            min-height: 44px; box-sizing: border-box; border-radius: 8px;
            text-decoration: none; color: var(--fg); font-size: .9rem; }
  .sugg li.on a, .sugg a:hover { background: rgba(255,255,255,.07); }
  .sugg i { width: 4px; align-self: stretch; min-height: 20px; border-radius: 2px;
            background: var(--club, var(--fg-3)); flex: 0 0 auto; }
  .sugg .where { margin-left: auto; font-size: .72rem; color: var(--fg-3); }
  .examples { font-size: .76rem; color: var(--fg-3); margin: 0 0 26px; }
  .examples b { color: var(--fg-2); font-weight: 500; }
  .nores { font-size: .84rem; color: var(--fg-2); padding: 12px 2px 0; }
  .nores[hidden] { display: none; }

  h2 { font-family: var(--mono); font-size: 1rem; font-weight: 700; margin: 0 0 3px; }
  .sublede { color: var(--fg-3); font-size: .78rem; margin: 0 0 14px; }
  section.band { margin-bottom: 34px; }

  /* ── featured ───────────────────────────────────────────────────────────
     Eight clubs with a shield each. The shields stop here: 355 of them would
     be 355 inline SVGs on one page to decorate a list of links. */
  ul.feat { list-style: none; padding: 0; margin: 0; display: grid; gap: 9px;
            grid-template-columns: repeat(4, 1fr); }
  ul.feat a { display: flex; flex-direction: column; align-items: center; gap: 5px;
              padding: 15px 10px 13px; border-radius: var(--r); text-decoration: none;
              color: var(--fg); background: var(--s1); border: 1px solid var(--line);
              transition: border-color .14s, background .14s, transform .14s; }
  ul.feat a:hover { background: var(--s2); transform: translateY(-2px);
                    border-color: color-mix(in srgb, var(--club) 60%, var(--line-2)); }
  ul.feat .crest { width: 34px; height: 39px; }
  ul.feat .fn { font-family: var(--mono); font-size: .8rem; font-weight: 700;
                text-align: center; line-height: 1.25; }
  ul.feat .fm { font-size: .68rem; color: var(--fg-3); }

  /* ── directory ──────────────────────────────────────────────────────────
     Rows, not cards. 355 cards is the mistake this page already made once in
     a different shape. */
  .ctabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 16px; }
  .ctab { font: inherit; font-size: .82rem; font-weight: 600; padding: 8px 14px;
          min-height: 38px; border-radius: 999px; cursor: pointer;
          background: var(--s1); color: var(--fg-2); border: 1px solid var(--line); }
  .ctab:hover { color: var(--fg); border-color: var(--line-2); }
  .ctab.on { background: var(--cyan); color: #06181C; border-color: var(--cyan); }
  .ctab:focus-visible, .cchip:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }

  .cblock { margin-bottom: 26px; }
  .cblock[hidden] { display: none; }
  .chead { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
  .chead h3 { font-family: var(--mono); font-size: .92rem; margin: 0; }
  .ccount { font-size: .72rem; color: var(--fg-3); }
  .cfilter { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 11px; }
  .cchip { font: inherit; font-size: .75rem; padding: 6px 11px; min-height: 32px;
           border-radius: 7px; cursor: pointer; background: transparent;
           color: var(--fg-3); border: 1px solid var(--line); }
  .cchip:hover { color: var(--fg); }
  .cchip.on { background: rgba(255,255,255,.09); color: var(--fg); border-color: var(--line-2); }
  .histnote { font-size: .72rem; color: var(--fg-3); margin: 0 0 10px; }

  ul.clist { list-style: none; padding: 0; margin: 0;
             columns: 3; column-gap: 18px; }
  ul.clist li { break-inside: avoid; }
  ul.clist a { display: flex; align-items: center; gap: 9px; padding: 7px 2px;
               min-height: 34px; box-sizing: border-box; font-size: .85rem;
               color: var(--fg); text-decoration: none;
               border-bottom: 1px solid var(--line); }
  ul.clist a:hover { color: var(--cyan); }
  ul.clist a[hidden] { display: none; }
  ul.clist i { width: 3px; align-self: stretch; min-height: 18px; border-radius: 2px;
               background: var(--club, var(--fg-3)); flex: 0 0 auto; }
  ul.clist .cn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  ul.clist .cm { margin-left: auto; font-size: .7rem; color: var(--fg-3);
                 font-variant-numeric: tabular-nums; }

  .showall { display: block; width: 100%; margin-top: 10px; font: inherit; font-size: .8rem;
             font-weight: 600; padding: 10px; min-height: 42px; cursor: pointer;
             border-radius: 9px; background: transparent; color: var(--fg-2);
             border: 1px solid var(--line-2); }
  .showall:hover { color: var(--fg); border-color: var(--fg-3); }
  .showall[hidden] { display: none; }
  .showall:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }

  footer.page { margin-top: 10px; padding-top: 18px; font-size: .75rem; color: var(--fg-3);
                border-top: 1px solid var(--line); line-height: 1.7; }
  footer.page a { color: var(--fg-2); }
  footer.page a:hover { color: var(--cyan); }

  @media (max-width: 860px) { ul.clist { columns: 2; } }
  @media (max-width: 620px) {
    .wrap { padding: 0 14px 48px; }
    nav.crumbs { margin: 10px 0 9px; }
    .kicker { font-size: clamp(1.35rem, 7vw, 1.8rem); }
    h1 { font-size: .86rem; }
    .lede { font-size: .79rem; margin-bottom: 13px; }
    .find input { font-size: 16px; /* iOS zooms anything smaller on focus */
                  padding: 14px 42px 14px 42px; min-height: 50px; }
    .examples { margin-bottom: 22px; }
    ul.feat { grid-template-columns: repeat(2, 1fr); }
    ul.clist { columns: 1; }
    ul.clist a { min-height: 40px; }
    section.band { margin-bottom: 28px; }
  }
  @media (prefers-reduced-motion: reduce) {
    ul.feat a { transition: none; }
    ul.feat a:hover { transform: none; }
  }
</style>
</head>
<body>

${shell.fallbackHeader('/teams/')}

<div class="wrap">
<nav class="crumbs"><a href="/">TeleStats</a> &rsaquo; Teams</nav>

<div class="hero">
  <p class="kicker">Your club. Your history. <em>Your games.</em></p>
  <h1>Football teams: player stats, records and games</h1>
  <p class="lede">Player records, appearances, goals and five free games for
    <b>${total} clubs</b> across England, Spain, Italy, Germany and France.</p>

  <div class="find" id="findBox">
    <svg class="mag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="teamFind" type="search" autocomplete="off" autocorrect="off"
           autocapitalize="off" spellcheck="false" enterkeyhint="go"
           role="combobox" aria-expanded="false" aria-autocomplete="list"
           aria-controls="findSugg" placeholder="Find your club&hellip;"
           aria-label="Search for a football club">
    <button type="button" class="clear" id="findClear" aria-label="Clear search">&times;</button>
    <ul class="sugg" id="findSugg" role="listbox" aria-label="Matching clubs" hidden></ul>
  </div>
  <p class="examples">Try <b>Arsenal</b>, <b>M&aacute;laga</b>, <b>Man Utd</b> or <b>Barcelona</b></p>
  <p class="nores" id="findNone" hidden></p>
</div>

<section class="band">
  <h2>Featured clubs</h2>
  <p class="sublede">A few to start with &mdash; every club below has the same records and games.</p>
  <ul class="feat">
        ${featured}
  </ul>
</section>

<section class="band">
  <h2>All ${total} clubs</h2>
  <p class="sublede">Grouped by country, A&ndash;Z. The number beside each club is how many
    of its players we hold records for.</p>

  <div class="ctabs" role="group" aria-label="Filter clubs by country">
    <button type="button" class="ctab on" data-country="">All countries</button>
    ${COUNTRIES.map((c) => `<button type="button" class="ctab" data-country="${esc(c.code)}"
      >${esc(c.name)}</button>`).join('\n    ')}
  </div>
  <p class="histnote">Competition filters show clubs we hold <strong>records</strong> for in that
    competition at any point in its history &mdash; not the current league table.</p>

${sections}
</section>

<footer class="page">
  Player statistics compiled from official league and competition sources.
  <a href="/daily/">Today's challenge</a> &middot;
  <a href="/games/">All games</a> &middot;
  <a href="/competitions/">Browse by competition</a> &middot;
  <a href="/ask/">Ask TeleStats</a> &middot;
  <a href="/tools/data.html">Data coverage</a>
</footer>
</main>
</div><!-- /ts-shell -->
<script>
(function () {
  'use strict';
  var input = document.getElementById('teamFind');
  if (!input) return;
  var box = document.getElementById('findBox');
  var sugg = document.getElementById('findSugg');
  var none = document.getElementById('findNone');
  var clear = document.getElementById('findClear');
  var tabs = [].slice.call(document.querySelectorAll('.ctab'));
  var blocks = [].slice.call(document.querySelectorAll('.cblock'));
  var links = [].slice.call(document.querySelectorAll('ul.clist a'));

  // Every row, read ONCE. data-k already holds the folded name and the
  // maintained aliases, so a keystroke is a substring test over an array that
  // was built at load, not 355 string normalisations.
  var ROWS = links.map(function (a) {
    return {
      el: a,
      href: a.getAttribute('href'),
      name: a.querySelector('.cn').textContent,
      keys: a.getAttribute('data-k') || '',
      comps: a.getAttribute('data-c') || '',
      country: a.closest('.cblock').getAttribute('data-country'),
      block: a.closest('.cblock'),
    };
  });
  var COUNTRY_NAMES = {};
  blocks.forEach(function (b) {
    COUNTRY_NAMES[b.getAttribute('data-country')] = b.querySelector('h3').textContent;
  });

  function fold(v) {
    return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  var country = '';          // '' = every country
  var comps = {};            // country code -> folded competition, '' = all
  var active = -1;           // highlighted suggestion

  /** Matches, best first: a name that STARTS with the query beats one that merely contains it. */
  function search(q) {
    if (!q) return [];
    var starts = [], has = [];
    for (var i = 0; i < ROWS.length; i++) {
      var parts = ROWS[i].keys.split('|');
      var best = -1;
      for (var j = 0; j < parts.length; j++) {
        var at = parts[j].indexOf(q);
        if (at === -1) continue;
        if (at === 0) { best = 0; break; }
        if (best === -1) best = at;
      }
      if (best === 0) starts.push(ROWS[i]);
      else if (best > 0) has.push(ROWS[i]);
    }
    return starts.concat(has);
  }

  function renderSuggestions(hits, q) {
    if (!q) { hide(); return; }
    if (!hits.length) {
      hide();
      none.hidden = false;
      none.textContent = 'No club matches “' + input.value.trim() +
        '”. Try a shorter word, or browse by country below.';
      return;
    }
    none.hidden = true;
    sugg.innerHTML = hits.slice(0, 8).map(function (r, i) {
      var club = r.el.style.getPropertyValue('--club');
      return '<li role="option" aria-selected="' + (i === 0) + '"' + (i === 0 ? ' class="on"' : '') +
        '><a href="' + r.href + '" style="--club:' + club + '" tabindex="-1">' +
        '<i></i><span>' + r.name + '</span>' +
        '<span class="where">' + (COUNTRY_NAMES[r.country] || '') + '</span></a></li>';
    }).join('');
    sugg.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = 0;
  }

  function hide() {
    sugg.hidden = true;
    sugg.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    none.hidden = true;
    active = -1;
  }

  function move(step) {
    var items = sugg.querySelectorAll('li');
    if (!items.length) return;
    active = (active + step + items.length) % items.length;
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('on', i === active);
      items[i].setAttribute('aria-selected', String(i === active));
    }
    items[active].scrollIntoView({ block: 'nearest' });
  }

  /**
   * The directory underneath, filtered by country and competition, and capped.
   *
   * One pass decides both things per row, so the cap counts MATCHING rows
   * rather than positions in the markup — otherwise filtering to a competition
   * with 90 clubs would still show the first 24 slots of the unfiltered list.
   */
  var CAP = 24;
  var expanded = {};

  function paintDirectory() {
    blocks.forEach(function (b) {
      var code = b.getAttribute('data-country');
      b.hidden = !!country && country !== code;
    });

    var seen = {};
    ROWS.forEach(function (r) {
      var want = comps[r.country] || '';
      var matches = !want || r.comps.split('|').indexOf(want) !== -1;
      if (!matches) { r.el.hidden = true; return; }
      seen[r.country] = (seen[r.country] || 0) + 1;
      r.el.hidden = !expanded[r.country] && seen[r.country] > CAP;
    });

    blocks.forEach(function (b) {
      var code = b.getAttribute('data-country');
      var total = seen[code] || 0;
      var count = b.querySelector('.ccount');
      if (count) count.textContent = total + (total === 1 ? ' club' : ' clubs');
      var btn = b.querySelector('.showall');
      if (!btn) return;
      btn.hidden = expanded[code] || total <= CAP;
      btn.textContent = 'Show all ' + total + ' ' +
        b.querySelector('h3').textContent + ' clubs';
    });
  }

  document.querySelectorAll('.showall').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var code = btn.closest('.cblock').getAttribute('data-country');
      expanded[code] = true;
      paintDirectory();
      // Focus the first row that was just revealed, so a keyboard user is not
      // left where a button used to be.
      var rows = btn.closest('.cblock').querySelectorAll('ul.clist a:not([hidden])');
      if (rows.length > CAP) rows[CAP].focus();
    });
  });

  input.addEventListener('input', function () {
    var q = fold(input.value);
    box.classList.toggle('has', !!input.value);
    renderSuggestions(search(q), q);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
    if (e.key === 'Escape') { hide(); return; }
    if (e.key !== 'Enter') return;
    // Enter goes to the highlighted club. Reaching one club fast is the job.
    var chosen = sugg.querySelector('li.on a');
    if (chosen) { e.preventDefault(); window.location.href = chosen.getAttribute('href'); }
  });

  clear.addEventListener('click', function () {
    input.value = '';
    box.classList.remove('has');
    hide();
    input.focus();
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.find')) hide();
  });

  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      country = t.getAttribute('data-country');
      tabs.forEach(function (o) { o.classList.toggle('on', o === t); });
      paintDirectory();
    });
  });

  paintDirectory();   // apply the cap once the script is here to undo it

  document.querySelectorAll('.cfilter').forEach(function (group) {
    var code = group.closest('.cblock').getAttribute('data-country');
    var chips = [].slice.call(group.querySelectorAll('.cchip'));
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        comps[code] = c.getAttribute('data-comp');
        chips.forEach(function (o) { o.classList.toggle('on', o === c); });
        paintDirectory();
      });
    });
  });
})();
</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/js/ts-auth.js"></script>
<script src="/js/ts-data.js"></script>
<script src="/js/ts-footer.js"></script>
<script src="/js/ts-nav.js"></script>
<script>
  (async function () {
    try { await TSAuth.init(); } catch (e) { console.error('[TeleStats] Auth init failed:', e); }
    try { TSNav.render(); } catch (e) { console.error('[TeleStats] Nav render failed:', e); }
  })();
</script>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</body>
</html>`;
}

// ─── main ───────────────────────────────────────────────────────────────────

(async () => {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  console.log(`\n  Fetching aggregates…`);
  const perClub = await page('agg_player_club',
    'club_id, player_name, appearances, goals, first_season, last_season');
  const perComp = await page('agg_player_club_comp',
    'club_id, competition_name, appearances, goals, seasons, first_season, last_season');
  console.log(`    ${num(perClub.length)} player-club rows · ${num(perComp.length)} player-club-competition rows`);

  const byClub = new Map();
  for (const r of perClub) {
    if (!byClub.has(r.club_id)) byClub.set(r.club_id, []);
    byClub.get(r.club_id).push(r);
  }
  const compByClub = new Map();
  for (const r of perComp) {
    if (!compByClub.has(r.club_id)) compByClub.set(r.club_id, []);
    compByClub.get(r.club_id).push(r);
  }

  const list = only.length
    ? only.map((s) => teams.bySlug(s)).filter(Boolean)
    : teams.all();

  fs.mkdirSync(OUT, { recursive: true });
  const indexDecision = new Map();
  let written = 0, noindexed = 0;

  for (const team of list) {
    const rows = (byClub.get(team.club_id) || []).slice();
    if (!rows.length) continue;

    const leaders = rows.slice().sort((a, b) => b.appearances - a.appearances).slice(0, 15);
    const scorers = rows.slice().sort((a, b) => b.goals - a.goals).filter((p) => p.goals > 0).slice(0, 10);
    const totals = rows.reduce((a, r) => ({
      appearances: a.appearances + (r.appearances || 0),
      goals: a.goals + (r.goals || 0),
    }), { appearances: 0, goals: 0 });

    // Fold the per-competition rows into one line per competition.
    const compMap = new Map();
    for (const r of compByClub.get(team.club_id) || []) {
      const c = compMap.get(r.competition_name) || {
        competition_name: r.competition_name, players: 0, seasons: 0, topApps: 0,
        first_season: r.first_season, last_season: r.last_season,
      };
      c.players += 1;
      c.topApps = Math.max(c.topApps, r.appearances || 0);
      c.seasons = Math.max(c.seasons, r.seasons || 0);
      c.first_season = Math.min(c.first_season, r.first_season);
      c.last_season = Math.max(c.last_season, r.last_season);
      compMap.set(r.competition_name, c);
    }
    const comps = [...compMap.values()].sort((a, b) => b.players - a.players);
    const span = {
      first: Math.min(...comps.map((c) => c.first_season)),
      last: Math.max(...comps.map((c) => c.last_season)),
    };

    // ── related clubs ────────────────────────────────────────────────────
    //
    // "Shares any competition, biggest squad first" put Oldham Athletic,
    // Swindon Town and Barnsley on the Arsenal page. Two things were wrong.
    //
    // The CUPS relate everything: 110 clubs have played in the FA Cup, so any
    // English club shares a competition with almost any other. Relatedness is
    // judged on LEAGUE competitions only.
    //
    // And "biggest squad" is not prominence — it is turnover. A League Two club
    // churns through 500 players in 25 seasons while Arsenal used 287; sorting
    // on it ranks the lower leagues above everyone. Clubs are ranked by how
    // much of their history they share with this one: same division, weighted
    // by the number of seasons they were both in it.
    const LEAGUES_ONLY = (name) => !/Cup|Shield|Champions League/.test(name);
    const myLeagues = comps.map((x) => x.competition_name).filter(LEAGUES_ONLY);
    const mySeasons = new Map();
    for (const r of compByClub.get(team.club_id) || []) {
      if (!LEAGUES_ONLY(r.competition_name)) continue;
      const cur = mySeasons.get(r.competition_name) || { lo: Infinity, hi: -Infinity };
      cur.lo = Math.min(cur.lo, r.first_season);
      cur.hi = Math.max(cur.hi, r.last_season);
      mySeasons.set(r.competition_name, cur);
    }

    const related = teams.all()
      .filter((t) => t.slug !== team.slug &&
                     t.competitions.some((cName) => myLeagues.includes(cName)))
      .map((t) => {
        // Overlapping YEARS in a shared division, not merely a shared name:
        // two clubs that were both in the Championship but twenty years apart
        // are less related than two who were there together.
        let overlap = 0;
        for (const r of compByClub.get(t.club_id) || []) {
          const mine = mySeasons.get(r.competition_name);
          if (!mine) continue;
          overlap += Math.max(0, Math.min(mine.hi, r.last_season) - Math.max(mine.lo, r.first_season) + 1);
        }
        return { t, overlap };
      })
      .filter((x) => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || b.t.players - a.t.players)
      .slice(0, 12)
      .map((x) => x.t);

    const playableComps = comps.filter((c) =>
      c.players >= MIN_PLAYERS_TO_PLAY && c.topApps >= MIN_TOP_APPEARANCES);
    // ONE decision, used by the page and the sitemap alike. Two copies of this
    // rule would eventually disagree, and a sitemap that lists a noindex page
    // is a contradiction Google is entitled to distrust.
    const isIndexable = team.players >= teams.INDEXABLE_MIN_PLAYERS && playableComps.length > 0;
    indexDecision.set(team.slug, isIndexable);

    const html = render(team, { leaders, scorers, comps, span, totals, playable: playableComps },
                        related, { teams, site: SITE });
    const dir = path.join(OUT, team.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    written++;
    if (!isIndexable) noindexed++;
  }

  console.log(`\n  ✓ ${written} team pages written to public/teams/`);

  // The hub and the sitemap describe the WHOLE set, so they are only correct
  // after a whole build. Writing them from a one-team run publishes a hub
  // linking one club and a sitemap that drops the other 354 — which is worse
  // than not regenerating them at all.
  if (only.length) {
    console.log(`    hub and sitemap left alone (partial build)\n`);
    return;
  }

  // The hub, so nothing is orphaned, and a sitemap of what deserves indexing.
  const built = list
    .filter((t) => byClub.has(t.club_id))
    .map((t) => ({ team: t }));
  fs.writeFileSync(path.join(OUT, 'index.html'), renderHub(built));

  const indexableTeams = built.filter((b) => indexDecision.get(b.team.slug));
  const today = new Date().toISOString().slice(0, 10);
  const urls = [`${SITE}/teams/`, ...indexableTeams.map((b) => `${SITE}/teams/${b.team.slug}/`)];
  fs.writeFileSync(path.join(ROOT, 'public', 'sitemap-teams.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`);

  console.log(`  ✓ public/teams/index.html — hub linking all ${built.length}`);
  console.log(`  ✓ public/sitemap-teams.xml — ${urls.length} indexable URLs`);
  console.log(`    ${written - noindexed} indexable · ${noindexed} noindex,follow (too thin)\n`);
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
