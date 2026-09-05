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

// Which official games can be configured for a club, and where they live.
const GAMES = [
  { key: 'hol',      name: 'Higher or Lower', path: '/games/hol.html',      blurb: 'Which player has more appearances?' },
  { key: 'alpha',    name: 'Player Alphabet', path: '/games/alpha.html',    blurb: 'Name a player for every letter.' },
  { key: 'xi',       name: 'Starting XI',     path: '/games/xi.html',       blurb: 'Build the strongest possible eleven.' },
  { key: 'whoami',   name: 'Who Am I?',       path: '/games/whoami.html',   blurb: 'Guess the player from five clues.' },
  { key: 'bullseye', name: 'Bullseye',        path: '/games/bullseye.html', blurb: 'Reach 501 appearances in as few picks as possible.' },
];

// ─── helpers ────────────────────────────────────────────────────────────────

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (n) => (n == null ? '0' : Number(n).toLocaleString('en-GB'));
const season = (y) => (y == null ? null : `${y}/${String(y + 1).slice(2)}`);

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

// ─── the page ───────────────────────────────────────────────────────────────

function render(team, d, related) {
  const { leaders, scorers, comps, span, totals } = d;

  const playable = comps.filter((c) =>
    c.players >= MIN_PLAYERS_TO_PLAY && c.topApps >= MIN_TOP_APPEARANCES);

  // A page with nothing to play is not a destination worth offering to a search
  // engine, however much history sits behind it. Elversberg was promoted to the
  // Bundesliga this season and has sixteen players on one appearance each: the
  // stats are real and worth showing to anyone who lands there, but there is no
  // game yet, so it stays out of the index until there is.
  const indexable = team.players >= teams.INDEXABLE_MIN_PLAYERS && playable.length > 0;
  const url = `${SITE}/teams/${team.slug}/`;
  const compList = comps.map((c) => c.competition_name);

  // Written from the data, not generated prose. A sentence that says what a
  // visitor can actually do beats one that says the club is historic and
  // passionately supported.
  const description =
    `Play ${esc(team.name)} football quizzes and trivia games built from ` +
    `${num(team.players)} players and ${num(totals.appearances)} appearances across ` +
    `${compList.join(', ')}. Higher or Lower, Starting XI, Player Alphabet and more.`;

  const title = `${team.name} Football Quiz & Trivia Games | TeleStats`;

  const gameLinks = GAMES.map((g) => {
    // Link into each competition the club actually played in.
    const scopes = playable
      .map((c) => ({ comp: c.competition_name, id: teams.scopeIdFor(team.slug, c.competition_name) }))
      .filter((s) => s.id);
    if (!scopes.length) return '';
    const links = scopes.map((s) =>
      `<a class="scope" href="${esc(g.path)}?scope=${encodeURIComponent(s.id)}">${esc(s.comp)}</a>`
    ).join('');
    return `<li class="game">
        <h3>${esc(team.name)} ${esc(g.name)}</h3>
        <p>${esc(g.blurb)}</p>
        <div class="scopes">${links}</div>
      </li>`;
  }).filter(Boolean).join('\n      ');

  const leaderRows = leaders.map((p, i) => `<tr>
          <td class="rank">${i + 1}</td>
          <td>${esc(p.player_name)}</td>
          <td class="num">${num(p.appearances)}</td>
          <td class="num">${num(p.goals)}</td>
          <td class="yr">${season(p.first_season)}–${season(p.last_season)}</td>
        </tr>`).join('\n        ');

  const scorerRows = scorers.map((p, i) => `<tr>
          <td class="rank">${i + 1}</td>
          <td>${esc(p.player_name)}</td>
          <td class="num">${num(p.goals)}</td>
          <td class="num">${num(p.appearances)}</td>
        </tr>`).join('\n        ');

  const compRows = comps.map((c) => `<tr>
          <td>${esc(c.competition_name)}</td>
          <td class="num">${num(c.players)}</td>
          <td class="yr">${season(c.first_season)}–${season(c.last_season)}</td>
          <td class="num">${c.seasons}</td>
        </tr>`).join('\n        ');

  // Questions phrased around THIS club, so the feature explains itself. The
  // partner is a club that actually shares a competition, otherwise the
  // suggested question has an obvious answer of "none".
  const askPartner = (related[0] && related[0].name) || 'Manchester United';
  // "in the Premier League" but "in League One" — some competition names take
  // the article and some do not, and getting it wrong reads as machine-written
  // on all 313 pages.
  const TAKES_THE = new Set(['Premier League', 'Championship', 'Champions League',
                             'FA Cup', 'EFL Cup', 'Community Shield']);
  const rawComp = (comps[0] && comps[0].competition_name) || 'Premier League';
  const topComp = (TAKES_THE.has(rawComp) ? 'the ' : '') + rawComp;
  const askExamples = [
    `Who has played for both ${team.name} and ${askPartner}?`,
    `Top scorers for ${team.name} in ${topComp}`,
    `Which English players have the most appearances for ${team.name}?`,
  ].map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('\n        ');

  const relatedLinks = related.map((r) =>
    `<a href="/teams/${esc(r.slug)}/">${esc(r.name)}</a>`).join('\n        ');

  // Structured data. Only what is honestly true: this is a page about a team,
  // and it sits in a breadcrumb trail. No invented ratings, no fake reviews.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'TeleStats', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Teams', item: `${SITE}/teams/` },
          { '@type': 'ListItem', position: 3, name: team.name, item: url },
        ],
      },
      {
        '@type': 'SportsTeam',
        name: team.name,
        sport: 'Association football',
        url,
      },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="/js/ts-analytics.js"></script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
${indexable ? '' : '<meta name="robots" content="noindex,follow">\n'}<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="TeleStats">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<link rel="stylesheet" href="/telestats-theme.css">
<style>
  body { max-width: 900px; margin: 0 auto; padding: 20px; }
  nav.crumbs { font-size: .8rem; color: var(--text-secondary); margin-bottom: 14px; }
  nav.crumbs a { color: var(--accent); text-decoration: none; }
  h1 { font-size: 1.7rem; margin: 0 0 6px; }
  .sub { color: var(--text-secondary); margin: 0 0 6px; }
  .scope-note { color: var(--text-muted); font-size: .78rem; margin: 0 0 26px; }
  h2 { font-size: 1.15rem; margin: 30px 0 10px; }
  ul.games { list-style: none; padding: 0; display: grid;
             grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
  li.game { background: var(--bg-card); border: 1px solid var(--rule, #24313A); border-radius: 8px; padding: 14px; }
  li.game h3 { font-size: .95rem; margin: 0 0 4px; }
  li.game p { font-size: .82rem; color: var(--text-secondary); margin: 0 0 10px; }
  .scopes { display: flex; flex-wrap: wrap; gap: 6px; }
  a.scope { font-size: .78rem; padding: 4px 9px; border-radius: 5px;
            background: var(--bg-elevated, #1E272E); color: var(--accent); text-decoration: none; }
  table { border-collapse: collapse; width: 100%; font-size: .875rem; margin-bottom: 8px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--rule, #24313A); }
  th { font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.rank { color: var(--text-muted); width: 2em; }
  td.yr { color: var(--text-secondary); white-space: nowrap; }
  .related { display: flex; flex-wrap: wrap; gap: 8px; }
  .related a { font-size: .82rem; color: var(--accent); text-decoration: none;
               padding: 4px 9px; border: 1px solid var(--rule, #24313A); border-radius: 5px; }
  form.ask { display: flex; gap: 8px; margin: 10px 0 10px; }
  form.ask input { flex: 1; padding: 10px 13px; font-size: .95rem; border-radius: 7px;
                   border: 1px solid var(--rule, #24313A); background: var(--bg-card, #171F25);
                   color: var(--text-primary, #F2F5F7); }
  form.ask button { padding: 10px 16px; font-weight: 600; border: 0; border-radius: 7px;
                    background: var(--accent, #00E5FF); color: #0B0F12; cursor: pointer; }
  .ask-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .ask-examples button { font-size: .78rem; padding: 5px 10px; border-radius: 5px; border: 0;
                         background: var(--bg-elevated, #1E272E); color: var(--accent); cursor: pointer; }
  #askAnswer .msg { font-size: .98rem; line-height: 1.5; margin: 10px 0; }
  #askAnswer .prov { font-size: .74rem; color: var(--text-muted); }
  footer { margin-top: 40px; font-size: .78rem; color: var(--text-muted); }
  footer a { color: var(--accent); }
</style>
</head>
<body>

<nav class="crumbs"><a href="/">TeleStats</a> › <a href="/teams/">Teams</a> › ${esc(team.name)}</nav>

<h1>${esc(team.name)} Football Games &amp; Trivia</h1>
<p class="sub">${num(team.players)} players · ${num(totals.appearances)} appearances · ${esc(compList.join(', '))}</p>
<p class="scope-note">Data covers ${esc(season(span.first))} to ${esc(season(span.last))}.
  <a href="/tools/data.html">Full dataset scope</a>.</p>

${gameLinks ? `<h2>Play ${esc(team.name)}</h2>
<ul class="games">
      ${gameLinks}
</ul>` : `<h2>Games</h2>
<p class="sub">${esc(team.name)} does not have enough data in a single competition
  to build a game yet — this season is only a few matches old. The record below
  is complete, and games will appear here as the season is played.</p>`}

<h2>${esc(team.name)} appearance leaders</h2>
<table>
  <thead><tr><th></th><th>Player</th><th class="num">Apps</th><th class="num">Goals</th><th>Seasons</th></tr></thead>
  <tbody>
        ${leaderRows}
  </tbody>
</table>

<h2>${esc(team.name)} top scorers</h2>
<table>
  <thead><tr><th></th><th>Player</th><th class="num">Goals</th><th class="num">Apps</th></tr></thead>
  <tbody>
        ${scorerRows}
  </tbody>
</table>

<h2>Competitions</h2>
<table>
  <thead><tr><th>Competition</th><th class="num">Players</th><th>Seasons</th><th class="num">Count</th></tr></thead>
  <tbody>
        ${compRows}
  </tbody>
</table>

<h2>Ask about ${esc(team.name)}</h2>
<p class="sub">Ask the database a question. Answers come from ${num(team.players)} ${esc(team.name)}
  players and are never invented — if the data does not support an answer, it says so.</p>
<form class="ask" id="askForm">
  <input id="askQ" autocomplete="off" maxlength="300"
         placeholder="Who has played for both ${esc(team.name)} and ${esc(askPartner)}?"
         aria-label="Ask a question about ${esc(team.name)}">
  <button type="submit">Ask</button>
</form>
<div class="ask-examples">
      ${askExamples}
</div>
<div id="askAnswer"></div>

${related.length ? `<h2>More teams</h2>\n<div class="related">\n        ${relatedLinks}\n</div>` : ''}

<footer>
  Player statistics from the TeleStats football database.
  <a href="/tools/data.html">Coverage and last update</a> ·
  <a href="/games/">All games</a> ·
  <a href="/teams/">All teams</a>
</footer>

<script>
(function () {
  var f = document.getElementById('askForm');
  if (!f) return;
  var out = document.getElementById('askAnswer');
  var input = document.getElementById('askQ');
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  document.querySelectorAll('.ask-examples button').forEach(function (b) {
    b.onclick = function () { input.value = b.dataset.q; f.requestSubmit(); };
  });
  f.onsubmit = function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    out.innerHTML = '<p class="msg">Looking\u2026</p>';
    fetch('/.netlify/functions/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, source: 'team_page' })
    }).then(function (r) { return r.json(); }).then(function (d) {
      var html = '<p class="msg">' + esc(d.message || d.error) + '</p>';
      if (d.rows && d.rows.length) {
        html += '<table><tbody>' + d.rows.slice(0, 10).map(function (r) {
          var right = r.clubs && r.clubs[0] && r.clubs[0].team
            ? r.clubs.map(function (c) { return esc(c.team) + ' ' + c.appearances; }).join(' \u00b7 ')
            : (r.appearances != null ? r.appearances + ' apps, ' + r.goals + 'g' : '');
          return '<tr><td>' + esc(r.player || r.name) + '</td><td>' + right + '</td></tr>';
        }).join('') + '</tbody></table>';
      }
      if (d.provenance) {
        html += '<p class="prov">From the TeleStats database in ' +
                esc(d.provenance.query_ms) + 'ms \u00b7 <a href="/tools/data.html">coverage</a></p>';
      }
      out.innerHTML = html;
      // Structured only \u2014 the question text never goes to analytics.
      if (d.analytics && window.TSAnalytics) TSAnalytics.trackEvent('ask_query', d.analytics);
    }).catch(function () {
      out.innerHTML = '<p class="msg">Could not reach the database. Try again.</p>';
    });
  };
})();
</script>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</body>
</html>
`;
}


// ─── the hub ────────────────────────────────────────────────────────────────

/**
 * /teams/ — the index every team page links back to, and the page that stops
 * 313 URLs being orphans. Grouped by competition because that is how a person
 * looks for a club, and it puts the four English tiers in ladder order.
 */
function renderHub(rows) {
  const GROUPS = [
    ['Premier League', 'ENG'], ['Championship', 'ENG'], ['League One', 'ENG'], ['League Two', 'ENG'],
    ['La Liga', 'ESP'], ['Serie A', 'ITA'], ['Bundesliga', 'GER'], ['Ligue 1', 'FRA'],
  ];
  const seen = new Set();
  const sections = GROUPS.map(([comp]) => {
    const members = rows
      .filter((r) => r.team.competitions.includes(comp))
      .sort((a, b) => a.team.name.localeCompare(b.team.name));
    if (!members.length) return '';
    const links = members.map((m) => {
      seen.add(m.team.slug);
      return `<a href="/teams/${esc(m.team.slug)}/">${esc(m.team.name)}<span>${num(m.team.players)}</span></a>`;
    }).join('\n        ');
    return `<section>
  <h2>${esc(comp)}</h2>
  <p class="count">${members.length} clubs</p>
  <div class="grid">
        ${links}
  </div>
</section>`;
  }).filter(Boolean).join('\n\n');

  const title = 'Football Team Quizzes & Trivia Games by Club | TeleStats';
  const description =
    `Pick your club and play football quizzes built from real data. ` +
    `${rows.length} teams across the Premier League, Championship, League One, League Two, ` +
    `La Liga, Serie A, Bundesliga and Ligue 1.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'TeleStats', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Teams', item: `${SITE}/teams/` },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="/js/ts-analytics.js"></script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}/teams/">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}/teams/">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/telestats-theme.css">
<style>
  body { max-width: 1000px; margin: 0 auto; padding: 20px; }
  nav.crumbs { font-size: .8rem; color: var(--text-secondary); margin-bottom: 14px; }
  nav.crumbs a { color: var(--accent); text-decoration: none; }
  h1 { font-size: 1.7rem; margin: 0 0 6px; }
  .lede { color: var(--text-secondary); margin: 0 0 26px; max-width: 60ch; }
  h2 { font-size: 1.1rem; margin: 26px 0 2px; }
  .count { font-size: .78rem; color: var(--text-muted); margin: 0 0 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; }
  .grid a { display: flex; justify-content: space-between; gap: 8px; font-size: .85rem;
            padding: 7px 10px; border: 1px solid var(--rule, #24313A); border-radius: 6px;
            color: var(--accent); text-decoration: none; }
  .grid a span { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  form.ask { display: flex; gap: 8px; margin: 10px 0 10px; }
  form.ask input { flex: 1; padding: 10px 13px; font-size: .95rem; border-radius: 7px;
                   border: 1px solid var(--rule, #24313A); background: var(--bg-card, #171F25);
                   color: var(--text-primary, #F2F5F7); }
  form.ask button { padding: 10px 16px; font-weight: 600; border: 0; border-radius: 7px;
                    background: var(--accent, #00E5FF); color: #0B0F12; cursor: pointer; }
  .ask-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .ask-examples button { font-size: .78rem; padding: 5px 10px; border-radius: 5px; border: 0;
                         background: var(--bg-elevated, #1E272E); color: var(--accent); cursor: pointer; }
  #askAnswer .msg { font-size: .98rem; line-height: 1.5; margin: 10px 0; }
  #askAnswer .prov { font-size: .74rem; color: var(--text-muted); }
  footer { margin-top: 40px; font-size: .78rem; color: var(--text-muted); }
  footer a { color: var(--accent); }
</style>
</head>
<body>
<nav class="crumbs"><a href="/">TeleStats</a> › Teams</nav>
<h1>Football Games by Team</h1>
<p class="lede">${esc(description)} The number beside each club is how many of its
  players are in the database.</p>

${sections}

<footer>
  <a href="/games/">All games</a> ·
  <a href="/tools/data.html">Dataset coverage</a>
</footer>
<script>
(function () {
  var f = document.getElementById('askForm');
  if (!f) return;
  var out = document.getElementById('askAnswer');
  var input = document.getElementById('askQ');
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  document.querySelectorAll('.ask-examples button').forEach(function (b) {
    b.onclick = function () { input.value = b.dataset.q; f.requestSubmit(); };
  });
  f.onsubmit = function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    out.innerHTML = '<p class="msg">Looking\u2026</p>';
    fetch('/.netlify/functions/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, source: 'team_page' })
    }).then(function (r) { return r.json(); }).then(function (d) {
      var html = '<p class="msg">' + esc(d.message || d.error) + '</p>';
      if (d.rows && d.rows.length) {
        html += '<table><tbody>' + d.rows.slice(0, 10).map(function (r) {
          var right = r.clubs && r.clubs[0] && r.clubs[0].team
            ? r.clubs.map(function (c) { return esc(c.team) + ' ' + c.appearances; }).join(' \u00b7 ')
            : (r.appearances != null ? r.appearances + ' apps, ' + r.goals + 'g' : '');
          return '<tr><td>' + esc(r.player || r.name) + '</td><td>' + right + '</td></tr>';
        }).join('') + '</tbody></table>';
      }
      if (d.provenance) {
        html += '<p class="prov">From the TeleStats database in ' +
                esc(d.provenance.query_ms) + 'ms \u00b7 <a href="/tools/data.html">coverage</a></p>';
      }
      out.innerHTML = html;
      // Structured only \u2014 the question text never goes to analytics.
      if (d.analytics && window.TSAnalytics) TSAnalytics.trackEvent('ask_query', d.analytics);
    }).catch(function () {
      out.innerHTML = '<p class="msg">Could not reach the database. Try again.</p>';
    });
  };
})();
</script>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</body>
</html>
`;
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

    // Related teams: others sharing a competition, biggest first. This is the
    // internal linking spine — no team page should be an orphan.
    const related = teams.all()
      .filter((t) => t.slug !== team.slug && t.competitions.some((c) => comps.some((x) => x.competition_name === c)))
      .sort((a, b) => b.players - a.players)
      .slice(0, 12);

    const playableComps = comps.filter((c) =>
      c.players >= MIN_PLAYERS_TO_PLAY && c.topApps >= MIN_TOP_APPEARANCES);
    // ONE decision, used by the page and the sitemap alike. Two copies of this
    // rule would eventually disagree, and a sitemap that lists a noindex page
    // is a contradiction Google is entitled to distrust.
    const isIndexable = team.players >= teams.INDEXABLE_MIN_PLAYERS && playableComps.length > 0;
    indexDecision.set(team.slug, isIndexable);

    const html = render(team, { leaders, scorers, comps, span, totals }, related);
    const dir = path.join(OUT, team.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    written++;
    if (!isIndexable) noindexed++;
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

  console.log(`\n  ✓ ${written} team pages written to public/teams/`);
  console.log(`  ✓ public/teams/index.html — hub linking all ${built.length}`);
  console.log(`  ✓ public/sitemap-teams.xml — ${urls.length} indexable URLs`);
  console.log(`    ${written - noindexed} indexable · ${noindexed} noindex,follow (too thin)\n`);
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
