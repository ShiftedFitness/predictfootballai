/**
 * render_matchup.js — the HTML of a matchup page.
 *
 * /matchups/arsenal-vs-tottenham-hotspur/
 *
 * WHAT THIS PAGE HONESTLY KNOWS.
 *
 * The database holds player-season records, not match results. There is no
 * head-to-head, no scoreline and no league-position comparison anywhere in it,
 * so none of that appears here. What it does hold, and what this page is built
 * from, is:
 *
 *   the fixture      every season the two clubs were in the same division,
 *                    which is a real fact about whether they met
 *   shared players   everyone who turned out for both, with what they did at
 *                    each — the thing people actually search for
 *   the records      both clubs' leaders side by side
 *
 * A page saying "Arsenal have won 84 meetings" would be inventing a statistic,
 * which is the same rule that stopped the quiz asking how many goals Plymouth
 * Argyle scored in the Premier League. If head-to-head results are ever
 * ingested, this is where they belong — until then their absence is stated
 * rather than papered over.
 */

const colours = require('./colours');
const { esc, num, season, listOf, shield } = require('./render');

const SITE = 'https://telestats.net';

const GAMES = [
  { name: 'Higher or Lower', path: '/games/hol.html' },
  { name: 'Player Alphabet', path: '/games/alpha.html' },
  { name: 'Starting XI',     path: '/games/xi.html' },
  { name: 'Who Am I?',       path: '/games/whoami.html' },
  { name: 'Trivia Quiz',     path: '/games/quiz.html' },
];

/** "1998/99 to 2004/05, and 2019/20" — runs of years, not a wall of them. */
function seasonRuns(years) {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const runs = [];
  let start = null, prev = null;
  for (const y of sorted) {
    if (start === null) { start = prev = y; continue; }
    if (y === prev + 1) { prev = y; continue; }
    runs.push([start, prev]);
    start = prev = y;
  }
  if (start !== null) runs.push([start, prev]);
  return runs.map(([a, b]) => (a === b ? season(a) : `${season(a)}–${season(b)}`));
}

function render(m, d, opts) {
  const { A, B, sharedPlayers, metByComp, leadersA, leadersB, scorersA, scorersB,
          totalsA, totalsB, alsoA, alsoB } = d;
  const teams = opts.teams;

  const cA = colours.forTeam(A);
  const cB = colours.forTeam(B);
  const url = `${SITE}/matchups/${m.slug}/`;

  const comps = [...metByComp.entries()]
    .map(([name, years]) => ({ name, years, runs: seasonRuns(years) }))
    .sort((x, y) => y.years.length - x.years.length);
  const totalSeasons = new Set(comps.flatMap((c) => c.years)).size;
  const compNames = comps.map((c) => c.name);

  const title = `${A.name} vs ${B.name} — Players, Records & Quizzes | TeleStats`;
  const description = sharedPlayers.length
    ? `${sharedPlayers.length} players have turned out for both ${A.name} and ${B.name}. ` +
      `Every shared player, both clubs' appearance and goal records, and the ` +
      `${totalSeasons} seasons they have spent in the same division.`
    : `${A.name} and ${B.name} have spent ${totalSeasons} seasons in the same division. ` +
      `Both clubs' appearance and goal records, side by side, from real data.`;

  // ── shared players ───────────────────────────────────────────────────────
  // Behind a reveal, because "name everyone who played for both" is the
  // question people come with. The names are in the HTML either way, so a
  // search engine reads them and a visitor gets to try first.
  const sharedRows = sharedPlayers.map((p, i) => `<tr>
            <td class="rank">${i + 1}</td>
            <td>${esc(p.name)}</td>
            <td class="num">${num(p.a.appearances)}</td>
            <td class="yr">${season(p.a.first)}–${season(p.a.last)}</td>
            <td class="num">${num(p.b.appearances)}</td>
            <td class="yr">${season(p.b.first)}–${season(p.b.last)}</td>
          </tr>`).join('\n        ');

  const sideBySide = (rows, club, measure) => rows.map((p, i) => `<tr>
            <td class="rank">${i + 1}</td>
            <td>${esc(p.player_name)}</td>
            <td class="num">${num(measure === 'goals' ? p.goals : p.appearances)}</td>
          </tr>`).join('\n          ');

  const clubCard = (T, c, totals, leaders, scorers) => `<div class="club" style="--club:${c.primary};--club-2:${c.secondary}">
        <div class="club-head">
          ${shield(T, c)}
          <div>
            <h3><a href="/teams/${esc(T.slug)}/">${esc(T.name)}</a></h3>
            <p class="club-meta">${num(T.players)} players · ${num(totals.appearances)} appearances</p>
          </div>
        </div>
        <h4>Most appearances</h4>
        <table><tbody>
          ${sideBySide(leaders, T, 'appearances')}
        </tbody></table>
        <h4>Top scorers</h4>
        <table><tbody>
          ${sideBySide(scorers, T, 'goals')}
        </tbody></table>
      </div>`;

  const gameLinks = (T) => {
    const scope = teams.scopeIdFor(T.slug, null) ||
                  teams.scopeIdFor(T.slug, T.competitions[0]);
    if (!scope) return '';
    return GAMES.map((g) =>
      `<a class="pill" href="${esc(g.path)}?scope=${encodeURIComponent(scope)}&amp;play=1">${esc(g.name)}</a>`
    ).join('\n          ');
  };

  const relatedLinks = (list) => list.map((r) =>
    `<a href="/matchups/${esc(r.slug)}/">${esc(r.label)}</a>`).join('\n          ');

  const askExamples = [
    `Who has played for both ${A.name} and ${B.name}?`,
    `Top scorers for ${A.name}`,
    `Which English players have the most appearances for ${B.name}?`,
  ].map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('\n          ');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'TeleStats', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Matchups', item: `${SITE}/matchups/` },
          { '@type': 'ListItem', position: 3, name: `${A.name} vs ${B.name}`, item: url },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: [{
          '@type': 'Question',
          name: `How many players have played for both ${A.name} and ${B.name}?`,
          acceptedAnswer: {
            '@type': 'Answer',
            text: sharedPlayers.length
              ? `${sharedPlayers.length} players in the TeleStats database have appeared for both ` +
                `${A.name} and ${B.name}` +
                (sharedPlayers.length ? `, including ${sharedPlayers.slice(0, 3).map((p) => p.name).join(', ')}.` : '.')
              : `No player in the TeleStats database has appeared for both ${A.name} and ${B.name}.`,
          },
        }],
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
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="TeleStats">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/telestats-theme.css">
<style>
  body { margin: 0; }
  .wrap { max-width: 940px; margin: 0 auto; padding: 0 18px 60px; }
  .ts-header { border-bottom: 1px solid var(--rule, #24313A); background: var(--bg-card, #131A20); }
  .ts-header .inner { max-width: 940px; margin: 0 auto; padding: 11px 18px;
                      display: flex; align-items: center; gap: 18px; }
  .ts-header .brand { font-weight: 700; letter-spacing: .04em; color: var(--text-primary, #F2F5F7);
                      text-decoration: none; font-family: 'Space Mono', ui-monospace, monospace; }
  .ts-header nav { display: flex; gap: 15px; flex-wrap: wrap; }
  .ts-header nav a { font-size: .82rem; color: var(--text-secondary, #9FB0BC); text-decoration: none; }
  nav.crumbs { font-size: .78rem; color: var(--text-secondary); margin: 16px 0 12px; }
  nav.crumbs a { color: var(--accent); text-decoration: none; }

  .hero { position: relative; overflow: hidden; border-radius: 12px; padding: 20px 22px;
          border: 1px solid var(--rule, #24313A); margin-bottom: 10px;
          background: linear-gradient(100deg, ${cA.primary}33 0%, transparent 42%,
                      transparent 58%, ${cB.primary}33 100%), var(--bg-card, #131A20); }
  .hero h1 { font-size: 1.55rem; line-height: 1.25; margin: 0 0 5px; }
  .hero .sub { color: var(--text-secondary); font-size: .9rem; margin: 0; }
  .hero .note { color: var(--text-muted); font-size: .76rem; margin: 7px 0 0; }
  .hero .note a { color: var(--accent); }
  .crest { width: 42px; height: 48px; flex: 0 0 auto; }
  .versus { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
  .versus .vs { font-family: 'Space Mono', ui-monospace, monospace; font-weight: 700;
                color: var(--text-muted); font-size: .9rem; }

  h2 { font-size: 1.12rem; margin: 30px 0 4px; }
  h2 + .sub { color: var(--text-secondary); font-size: .88rem; margin: 0 0 12px; max-width: 66ch; line-height: 1.5; }

  .met { list-style: none; padding: 0; margin: 0; }
  .met li { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0;
            border-bottom: 1px solid var(--rule, #24313A); font-size: .88rem; }
  .met .comp { font-weight: 600; }
  .met .years { color: var(--text-secondary); text-align: right; }

  details.reveal { border: 1px solid var(--rule, #24313A); border-radius: 10px;
                   background: var(--bg-card, #131A20); }
  details.reveal > summary { cursor: pointer; padding: 13px 16px; font-weight: 600;
                             font-size: .95rem; list-style: none; }
  details.reveal > summary::-webkit-details-marker { display: none; }
  details.reveal > summary::after { content: ' — tap to reveal'; color: var(--text-muted);
                                    font-weight: 400; font-size: .82rem; }
  details.reveal[open] > summary::after { content: ''; }
  details.reveal .body { padding: 0 16px 14px; overflow-x: auto; }

  .clubs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .club { border: 1px solid var(--rule, #24313A); border-radius: 10px; padding: 14px 16px;
          background: linear-gradient(150deg, color-mix(in srgb, var(--club) 14%, transparent), transparent 55%),
                      var(--bg-card, #131A20); }
  .club-head { display: flex; align-items: center; gap: 11px; margin-bottom: 10px; }
  .club h3 { font-size: 1rem; margin: 0 0 2px; }
  .club h3 a { color: inherit; text-decoration: none; }
  .club h3 a:hover { color: var(--accent); }
  .club-meta { font-size: .76rem; color: var(--text-muted); margin: 0; }
  .club h4 { font-size: .68rem; text-transform: uppercase; letter-spacing: .09em;
             color: var(--text-muted); margin: 14px 0 5px; }

  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--rule, #24313A); }
  th { font-size: .68rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.rank { color: var(--text-muted); width: 2em; }
  td.yr { color: var(--text-secondary); white-space: nowrap; font-size: .8rem; }

  .play { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .play .side { border: 1px solid var(--rule, #24313A); border-radius: 10px; padding: 13px 15px;
                background: var(--bg-card, #131A20); }
  .play h4 { font-size: .9rem; margin: 0 0 9px; }
  .pill { display: inline-block; font-size: .78rem; padding: 5px 11px; border-radius: 999px;
          margin: 0 5px 5px 0; text-decoration: none;
          background: var(--bg-elevated, #1E272E); color: var(--accent); }

  .related { display: flex; flex-wrap: wrap; gap: 7px; }
  .related a { font-size: .81rem; color: var(--accent); text-decoration: none;
               padding: 4px 10px; border: 1px solid var(--rule, #24313A); border-radius: 6px; }
  form.ask { display: flex; gap: 8px; margin: 10px 0; }
  form.ask input { flex: 1; padding: 10px 13px; font-size: .93rem; border-radius: 7px;
                   border: 1px solid var(--rule, #24313A); background: var(--bg-card, #131A20);
                   color: var(--text-primary, #F2F5F7); }
  form.ask button { padding: 10px 17px; font-weight: 600; border: 0; border-radius: 7px;
                    background: var(--accent, #00E5FF); color: #0B0F12; cursor: pointer; }
  .ask-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .ask-examples button { font-size: .77rem; padding: 5px 10px; border-radius: 5px; border: 0;
                         background: var(--bg-elevated, #1E272E); color: var(--accent);
                         cursor: pointer; font-family: inherit; }
  #askAnswer .msg { font-size: .95rem; line-height: 1.5; margin: 10px 0; }
  #askAnswer .prov { font-size: .73rem; color: var(--text-muted); }
  footer.page { margin-top: 44px; padding-top: 16px; font-size: .77rem; color: var(--text-muted);
                border-top: 1px solid var(--rule, #24313A); }
  footer.page a { color: var(--accent); }
  @media (max-width: 620px) {
    .clubs, .play { grid-template-columns: 1fr; }
    .hero h1 { font-size: 1.25rem; }
    .wrap { padding: 0 13px 46px; }
  }
</style>
</head>
<body>

<header class="ts-header">
  <div class="inner">
    <a class="brand" href="/">TELESTATS</a>
    <nav>
      <a href="/daily/">Daily</a>
      <a href="/games/">Games</a>
      <a href="/teams/">Teams</a>
      <a href="/ask/">Ask</a>
      <a href="/leaderboard/">Leaderboard</a>
      <a href="/community/">Community</a>
    </nav>
  </div>
</header>

<div class="wrap">

<nav class="crumbs"><a href="/">TeleStats</a> › <a href="/matchups/">Matchups</a> › ${esc(A.name)} vs ${esc(B.name)}</nav>

<div class="hero">
  <div class="versus">
    ${shield(A, cA)}
    <span class="vs">vs</span>
    ${shield(B, cB)}
  </div>
  <h1>${esc(A.name)} vs ${esc(B.name)}</h1>
  <p class="sub">${sharedPlayers.length
    ? `${num(sharedPlayers.length)} player${sharedPlayers.length === 1 ? '' : 's'} have turned out for both`
    : 'No player in the database has turned out for both'} ·
    ${num(totalSeasons)} season${totalSeasons === 1 ? '' : 's'} in the same division</p>
  <p class="note">Built from player appearance records, not match results —
    <a href="/tools/data.html">what the dataset covers</a>.</p>
</div>

<h2>When ${esc(A.name)} and ${esc(B.name)} have met</h2>
<p class="sub">Seasons both clubs spent in the same division. This is drawn from squad records,
  so it says when a fixture existed — the results of those matches are not in the dataset.</p>
<ul class="met">
      ${comps.map((c) => `<li><span class="comp">${esc(c.name)}</span>
        <span class="years">${esc(c.runs.join(', '))} · ${c.years.length} season${c.years.length === 1 ? '' : 's'}</span></li>`).join('\n      ')}
</ul>

<h2>Players who have played for both</h2>
${sharedPlayers.length ? `<p class="sub">${num(sharedPlayers.length)} of them. Can you name any before you look?</p>
<details class="reveal">
  <summary>Show all ${num(sharedPlayers.length)}</summary>
  <div class="body">
    <table>
      <thead><tr><th></th><th>Player</th>
        <th class="num">${esc(A.name)}</th><th>Seasons</th>
        <th class="num">${esc(B.name)}</th><th>Seasons</th></tr></thead>
      <tbody>
        ${sharedRows}
      </tbody>
    </table>
  </div>
</details>` : `<p class="sub">Nobody in the TeleStats database has appeared for both ${esc(A.name)}
  and ${esc(B.name)} — which for two clubs who have met ${num(totalSeasons)} times is itself
  worth knowing. The dataset covers ${esc(listOf(compNames))}; a player who moved between them
  outside those competitions would not appear here.</p>`}

<h2>The two records, side by side</h2>
<div class="clubs">
      ${clubCard(A, cA, totalsA, leadersA, scorersA)}
      ${clubCard(B, cB, totalsB, leadersB, scorersB)}
</div>

<h2>Play them</h2>
<div class="play">
  <div class="side">
    <h4>${esc(A.name)}</h4>
      ${gameLinks(A)}
  </div>
  <div class="side">
    <h4>${esc(B.name)}</h4>
      ${gameLinks(B)}
  </div>
</div>

<h2>Ask about this matchup</h2>
<p class="sub">Answers come from the TeleStats database and are never invented — if the data
  does not support an answer, it says so.</p>
<form class="ask" id="askForm">
  <input id="askQ" autocomplete="off" maxlength="300"
         placeholder="Who has played for both ${esc(A.name)} and ${esc(B.name)}?"
         aria-label="Ask a question about ${esc(A.name)} and ${esc(B.name)}">
  <button type="submit">Ask</button>
</form>
<div class="ask-examples">
          ${askExamples}
</div>
<div id="askAnswer"></div>

${(alsoA.length || alsoB.length) ? `<h2>More matchups</h2>
<div class="related">
          ${relatedLinks(alsoA.concat(alsoB))}
</div>` : ''}

<footer class="page">
  Player statistics from the TeleStats football database.
  <a href="/tools/data.html">Coverage and last update</a> ·
  <a href="/teams/${esc(A.slug)}/">${esc(A.name)}</a> ·
  <a href="/teams/${esc(B.slug)}/">${esc(B.name)}</a> ·
  <a href="/matchups/">All matchups</a>
</footer>

</div>

<script>
window.TS_MATCHUP = ${JSON.stringify({ slug: m.slug, a: A.slug, b: B.slug })};
</script>
<script src="/js/matchup-page.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/js/ts-auth.js"></script>
<script src="/js/ts-data.js"></script>
<script src="/js/ts-nav.js"></script>
<script>
  (async function () {
    try { await TSAuth.init(); } catch (e) { console.error('[TeleStats] Auth init failed:', e); }
    try { TSNav.render(); } catch (e) { console.error('[TeleStats] Nav render failed:', e); }
  })();
</script>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</body>
</html>
`;
}

module.exports = { render, seasonRuns };
