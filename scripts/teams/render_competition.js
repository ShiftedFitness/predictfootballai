/**
 * render_competition.js — the HTML of a competition page.
 *
 * /competitions/segunda-division/
 *
 * WHY THESE EXIST, beyond the obvious.
 *
 * Three reasons are stated: "Premier League quiz" is a bigger query than any
 * one club's, a competition is a single URL to hand somebody, and the data is
 * already there. The fourth is the one that may matter most right now: 355 team
 * pages currently hang off ONE flat hub of 355 links, and Google has indexed
 * none of them. A competition page gives every club a topically-relevant parent
 * and turns a flat list into a tree — home → competitions → a competition → its
 * clubs. That is a far better shape to crawl.
 *
 * The page is static HTML for the same reason team pages are. Only the
 * community lane and the ask box need the network.
 */

const colours = require('./colours');
const { esc, num, season, listOf } = require('./render');

const SITE = 'https://telestats.net';

/**
 * Every game, and every VARIANT of it, as its own entry.
 *
 * "Higher or Lower: goals" is a different puzzle from "…: appearances", and
 * collapsing them into one link then asking which is the same friction the
 * scope picker was. The variant travels in the URL — see TSScope.variant().
 */
const GAMES = [
  { name: 'Higher or Lower', sub: 'Appearances', path: '/games/hol.html',    q: 'stat=appearances',
    blurb: 'Which player made more appearances?' },
  { name: 'Higher or Lower', sub: 'Goals',       path: '/games/hol.html',    q: 'stat=goals',
    blurb: 'Which player scored more?' },
  { name: 'Starting XI',     sub: 'Appearances', path: '/games/xi.html',     q: 'objective=appearances',
    blurb: 'Build the most-capped eleven.' },
  { name: 'Starting XI',     sub: 'Goals',       path: '/games/xi.html',     q: 'objective=goals',
    blurb: 'Build the highest-scoring eleven.' },
  { name: 'Player Alphabet', sub: null,          path: '/games/alpha.html',  q: '',
    blurb: 'Name a player for every letter.' },
  { name: 'Who Am I?',       sub: null,          path: '/games/whoami.html', q: '',
    blurb: 'Guess the player from five clues.' },
  { name: 'Trivia Quiz',     sub: null,          path: '/games/quiz.html',   q: '',
    blurb: 'Ten questions from the record books.' },
];

const TAKES_THE = new Set(['Premier League', 'Championship', 'Champions League',
                           'FA Cup', 'EFL Cup', 'Community Shield']);
const withThe = (n) => (TAKES_THE.has(n) ? 'the ' : '') + n;

function render(comp, d, opts) {
  const { leaders, scorers, clubs, span, totals, seasons, siblings } = d;
  const teams = opts.teams;

  const url = `${SITE}/competitions/${comp.slug}/`;
  const scope = `comp_${comp.slug}`;
  // A competition's own colour: taken from its biggest club, so the page has an
  // identity without inventing a palette for a league.
  const flagship = clubs[0];
  const c = flagship ? colours.forTeam(flagship) : { primary: '#00E5FF', secondary: '#0B7C8C' };

  const title = `${comp.name} Quiz & Trivia Games | TeleStats`;
  const description =
    `Play ${comp.name} football quizzes built from real data — ${num(totals.players)} players, ` +
    `${num(totals.appearances)} appearances and ${clubs.length} clubs across ` +
    `${seasons} seasons, ${season(span.first)} to ${season(span.last)}. ` +
    `Higher or Lower, Starting XI, Player Alphabet, Who Am I and a trivia quiz.`;

  const gameCards = GAMES.map((g) => {
    const href = `${g.path}?scope=${encodeURIComponent(scope)}${g.q ? '&amp;' + g.q : ''}&amp;play=1`;
    return `<li class="game">
          <a href="${href}">
            <h3>${esc(g.name)}${g.sub ? ` <span class="variant">${esc(g.sub)}</span>` : ''}</h3>
            <p>${esc(g.blurb)}</p>
            <span class="go">Play &rarr;</span>
          </a>
        </li>`;
  }).join('\n        ');

  const leaderRows = leaders.map((p, i) => `<tr>
            <td class="rank">${i + 1}</td>
            <td>${esc(p.player_name)}</td>
            <td class="club"><a href="/teams/${esc(p.slug)}/">${esc(p.club_name)}</a></td>
            <td class="num">${num(p.appearances)}</td>
            <td class="num">${num(p.goals)}</td>
          </tr>`).join('\n        ');

  const scorerRows = scorers.map((p, i) => `<tr>
            <td class="rank">${i + 1}</td>
            <td>${esc(p.player_name)}</td>
            <td class="club"><a href="/teams/${esc(p.slug)}/">${esc(p.club_name)}</a></td>
            <td class="num">${num(p.goals)}</td>
            <td class="num">${num(p.appearances)}</td>
          </tr>`).join('\n        ');

  const clubLinks = clubs.map((t) => {
    const cc = colours.forTeam(t);
    return `<a href="/teams/${esc(t.slug)}/" style="--club:${cc.primary}"><i></i>` +
           `${esc(t.name)}<span>${num(t.players)}</span></a>`;
  }).join('\n        ');

  const siblingLinks = siblings.map((s) =>
    `<a href="/competitions/${esc(s.slug)}/">${esc(s.name)}</a>`).join('\n          ');

  const askExamples = [
    `Top scorers in ${withThe(comp.name)}`,
    `Which English players have the most appearances for ${clubs[0] ? clubs[0].name : 'Arsenal'}?`,
    `Who has played for both ${clubs[0] ? clubs[0].name : 'Arsenal'} and ${clubs[1] ? clubs[1].name : 'Chelsea'}?`,
  ].map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('\n          ');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'TeleStats', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Competitions', item: `${SITE}/competitions/` },
          { '@type': 'ListItem', position: 3, name: comp.name, item: url },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: [{
          '@type': 'Question',
          name: `Who has the most ${comp.name} appearances?`,
          acceptedAnswer: {
            '@type': 'Answer',
            text: leaders.length
              ? `${leaders[0].player_name} has the most ${comp.name} appearances in the TeleStats ` +
                `database with ${num(leaders[0].appearances)} for ${leaders[0].club_name}.`
              : `The TeleStats database does not yet hold enough ${comp.name} data to answer that.`,
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
<meta name="theme-color" content="${c.primary}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="TeleStats">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/telestats-theme.css">
<style>
  :root { --club: ${c.primary}; --club-2: ${c.secondary}; }
  body { margin: 0; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 0 18px 60px; }
  .ts-header { border-bottom: 1px solid var(--rule, #24313A); background: var(--bg-card, #131A20); }
  .ts-header .inner { max-width: 980px; margin: 0 auto; padding: 11px 18px;
                      display: flex; align-items: center; gap: 18px; }
  .ts-header .brand { font-weight: 700; letter-spacing: .04em; color: var(--text-primary, #F2F5F7);
                      text-decoration: none; font-family: 'Space Mono', ui-monospace, monospace; }
  .ts-header nav { display: flex; gap: 15px; flex-wrap: wrap; }
  .ts-header nav a { font-size: .82rem; color: var(--text-secondary, #9FB0BC); text-decoration: none; }
  nav.crumbs { font-size: .78rem; color: var(--text-secondary); margin: 16px 0 12px; }
  nav.crumbs a { color: var(--accent); text-decoration: none; }

  .hero { position: relative; overflow: hidden; border-radius: 12px; padding: 22px;
          border: 1px solid var(--rule, #24313A); margin-bottom: 8px;
          background: linear-gradient(160deg, color-mix(in srgb, var(--club) 26%, transparent), transparent 62%),
                      var(--bg-card, #131A20); }
  .scarf { position: absolute; inset: 0 0 auto 0; height: 5px;
           background: repeating-linear-gradient(90deg, var(--club) 0 24px, var(--club-2) 24px 48px); }
  .hero h1 { font-size: 1.7rem; line-height: 1.2; margin: 0 0 6px; }
  .hero .sub { color: var(--text-secondary); font-size: .92rem; margin: 0; }
  .hero .note { color: var(--text-muted); font-size: .76rem; margin: 7px 0 0; }
  .hero .note a { color: var(--accent); }

  h2 { font-size: 1.14rem; margin: 32px 0 4px; }
  h2 + .sub { color: var(--text-secondary); font-size: .88rem; margin: 0 0 13px; max-width: 66ch; line-height: 1.5; }

  ul.games { list-style: none; padding: 0; margin: 0; display: grid;
             grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 11px; }
  li.game { background: var(--bg-card, #131A20); border: 1px solid var(--rule, #24313A);
            border-radius: 9px; transition: border-color .15s, transform .15s; }
  li.game:hover { border-color: var(--club); transform: translateY(-1px); }
  li.game a { display: block; padding: 14px 15px; text-decoration: none; color: inherit; height: 100%; }
  li.game h3 { font-size: .95rem; margin: 0 0 4px; }
  li.game .variant { font-size: .74rem; font-weight: 600; color: var(--club);
                     border: 1px solid var(--club); border-radius: 4px; padding: 1px 6px;
                     margin-left: 4px; vertical-align: 1px; }
  li.game p { font-size: .81rem; color: var(--text-secondary); margin: 0 0 10px; line-height: 1.4; }
  li.game .go { font-size: .8rem; font-weight: 600; color: var(--accent, #00E5FF); }

  table { border-collapse: collapse; width: 100%; font-size: .87rem; }
  th, td { text-align: left; padding: 6px 9px; border-bottom: 1px solid var(--rule, #24313A); }
  th { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.rank { color: var(--text-muted); width: 2em; }
  td.club a { color: var(--text-secondary); text-decoration: none; }
  td.club a:hover { color: var(--accent); }
  .tables { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .table-wrap { overflow-x: auto; }

  .clubs { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 6px; }
  .clubs a { display: flex; align-items: center; gap: 9px; font-size: .85rem; padding: 7px 11px;
             border: 1px solid var(--rule, #24313A); border-radius: 6px;
             color: var(--text-primary, #F2F5F7); text-decoration: none; }
  .clubs a i { width: 4px; align-self: stretch; min-height: 17px; border-radius: 2px;
               background: var(--club, #4A5A66); flex: 0 0 auto; }
  .clubs a span { margin-left: auto; color: var(--text-muted); font-variant-numeric: tabular-nums; font-size: .78rem; }
  .clubs a:hover { border-color: var(--club); }

  .community { list-style: none; padding: 0; margin: 0; display: grid;
               grid-template-columns: repeat(auto-fit, minmax(232px, 1fr)); gap: 11px; }
  .community li { background: var(--bg-card, #131A20); border: 1px dashed var(--rule, #3A4A55);
                  border-radius: 9px; padding: 13px 15px; }
  .community a { color: inherit; text-decoration: none; }
  .community h4 { font-size: .9rem; margin: 0 0 4px; }
  .community p { font-size: .79rem; color: var(--text-secondary); margin: 0 0 7px; line-height: 1.4; }
  .community .meta { font-size: .72rem; color: var(--text-muted); }
  .empty { font-size: .84rem; color: var(--text-muted); margin: 6px 0 0; }
  .cta { display: inline-block; margin-top: 11px; font-size: .84rem; font-weight: 600;
         padding: 9px 15px; border-radius: 7px; text-decoration: none;
         border: 1px solid var(--club); color: var(--text-primary, #F2F5F7); }
  .cta:hover { background: var(--club); color: #fff; }

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
  @media (max-width: 680px) { .tables { grid-template-columns: 1fr; } .hero h1 { font-size: 1.35rem; } }
</style>
</head>
<body>

<header class="ts-header">
  <div class="inner">
    <a class="brand" href="/">TELESTATS</a>
    <nav>
      <a href="/daily/">Daily</a>
      <a href="/games/">Games</a>
      <a href="/competitions/">Competitions</a>
      <a href="/teams/">Teams</a>
      <a href="/ask/">Ask</a>
      <a href="/community/">Community</a>
    </nav>
  </div>
</header>

<div class="wrap">

<nav class="crumbs"><a href="/">TeleStats</a> › <a href="/competitions/">Competitions</a> › ${esc(comp.name)}</nav>

<div class="hero">
  <div class="scarf"></div>
  <h1>${esc(comp.name)} Quizzes &amp; Trivia</h1>
  <p class="sub">${num(totals.players)} players · ${num(totals.appearances)} appearances ·
    ${clubs.length} clubs · ${seasons} seasons</p>
  <p class="note">Records cover ${esc(season(span.first))} to ${esc(season(span.last))}.
    <a href="/tools/data.html">What the dataset covers</a>.</p>
</div>

<h2>Play ${esc(comp.name)}</h2>
<p class="sub">Every club in the competition at once. Pick a game and it starts —
  or scroll down and choose a single club instead.</p>
<ul class="games">
        ${gameCards}
</ul>

<h2>${esc(comp.name)} all-time records</h2>
<p class="sub">Across every club in the competition, ${esc(season(span.first))} to ${esc(season(span.last))}.</p>
<div class="tables">
  <div class="table-wrap">
    <h3 style="font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin:0 0 6px">Most appearances</h3>
    <table>
      <thead><tr><th></th><th>Player</th><th>Club</th><th class="num">Apps</th><th class="num">Goals</th></tr></thead>
      <tbody>
        ${leaderRows}
      </tbody>
    </table>
  </div>
  <div class="table-wrap">
    <h3 style="font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin:0 0 6px">Most goals</h3>
    <table>
      <thead><tr><th></th><th>Player</th><th>Club</th><th class="num">Goals</th><th class="num">Apps</th></tr></thead>
      <tbody>
        ${scorerRows}
      </tbody>
    </table>
  </div>
</div>

<h2>Clubs in ${esc(comp.name)}</h2>
<p class="sub">${clubs.length} clubs have played in ${esc(withThe(comp.name))} in this dataset.
  Each has its own page, records and games.</p>
<div class="clubs">
        ${clubLinks}
</div>

<h2>Community games</h2>
<p class="sub">Made by players from the same database — different rules, same real records.</p>
<div id="communityBox"><p class="empty">Loading…</p></div>
<a class="cta" href="/community/?build=1">Build a ${esc(comp.name)} game &rarr;</a>

<h2>Ask about ${esc(comp.name)}</h2>
<p class="sub">Answers come from the database and are never invented — if the data does not
  support an answer, it says so.</p>
<form class="ask" id="askForm">
  <input id="askQ" autocomplete="off" maxlength="300"
         placeholder="Top scorers in ${esc(withThe(comp.name))}"
         aria-label="Ask a question about ${esc(comp.name)}">
  <button type="submit">Ask</button>
</form>
<div class="ask-examples">
          ${askExamples}
</div>
<div id="askAnswer"></div>

${siblings.length ? `<h2>Other competitions</h2>
<div class="related">
          ${siblingLinks}
</div>` : ''}

<footer class="page">
  Player statistics compiled from official league and competition sources.
  <a href="/tools/data.html">Coverage and last update</a> ·
  <a href="/competitions/">All competitions</a> ·
  <a href="/teams/">All teams</a> ·
  <a href="/ask/">Ask TeleStats</a>
</footer>

</div>

<script>
window.TS_COMPETITION = ${JSON.stringify({ slug: comp.slug, name: comp.name, scope })};
</script>
<script src="/js/ts-scope.js"></script>
<script src="/js/competition-page.js"></script>
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

module.exports = { render, GAMES };
