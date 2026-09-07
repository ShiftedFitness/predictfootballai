/**
 * render.js — the HTML of a team page.
 *
 * Split out of build.js, which is now only about fetching and folding the
 * data. The page had grown to the point where the query code was hard to find
 * inside it.
 *
 * STATIC WHERE IT MATTERS.
 *
 * Everything a search engine needs — the players, the records, the game links,
 * the club's competitions — is real HTML in the file. Two sections are not:
 * the leaderboard and the community games, both of which change whenever
 * somebody plays or builds something and neither of which anybody arrives from
 * a search for. Those load from /team-extras after paint.
 */

const colours = require('./colours');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (n) => (n == null ? '0' : Number(n).toLocaleString('en-GB'));
const season = (y) => (y == null ? null : `${y}/${String(y + 1).slice(2)}`);

/** "in the Premier League" but "in League One". */
const TAKES_THE = new Set(['Premier League', 'Championship', 'Champions League',
                           'FA Cup', 'EFL Cup', 'Community Shield']);
const withArticle = (name) => (TAKES_THE.has(name) ? 'the ' : '') + name;

/** "A, B and C" — an Oxford-comma-free list, because this is British copy. */
const listOf = (xs) => xs.length <= 1 ? (xs[0] || '')
  : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * Up to three letters for the badge. "Plymouth Argyle" -> PA, "Everton" -> EVE.
 * Initials of a multi-word name, otherwise the opening letters of a single one.
 */
function initials(name) {
  const words = String(name).replace(/[^A-Za-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  return String(words[0] || '?').slice(0, 3).toUpperCase();
}

/**
 * A shield in the club's colours with its initials on it.
 *
 * Explicitly NOT a crest. A real badge is somebody's trademark, and 126 of
 * these clubs have a colour derived from a hash of the slug rather than a
 * researched one. So it is a placeholder that looks like it belongs to the
 * club, and nothing on the page calls it a badge of the club.
 */
function shield(team, c) {
  const label = initials(team.name);
  const size = label.length >= 3 ? 15 : 19;
  return `<svg class="crest" viewBox="0 0 56 64" role="img" aria-label="${esc(team.name)}">
      <path d="M4 4h48v30c0 14-12 23-24 26C16 57 4 48 4 34Z" fill="${c.primary}" stroke="${c.secondary}" stroke-width="3"/>
      <path d="M4 20h48v8H4Z" fill="${c.secondary}" opacity=".55"/>
      <text x="28" y="40" text-anchor="middle" font-size="${size}" font-weight="700"
            font-family="Space Mono, ui-monospace, monospace" fill="#fff">${esc(label)}</text>
    </svg>`;
}

/** A "?" on a shirt, for the player of the day before it is revealed. */
function mysteryShirt(c) {
  return `<svg class="shirt" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M22 8 32 14 42 8l14 8-6 12-6-3v31H20V25l-6 3-6-12Z"
            fill="${c.primary}" stroke="${c.secondary}" stroke-width="2.5" stroke-linejoin="round"/>
      <text x="32" y="46" text-anchor="middle" font-size="24" font-weight="700"
            font-family="Space Mono, ui-monospace, monospace" fill="#fff">?</text>
    </svg>`;
}

// ─── the games ──────────────────────────────────────────────────────────────

const GAMES = [
  { key: 'hol',      name: 'Higher or Lower', path: '/games/hol.html',      blurb: 'Which player has more appearances?' },
  { key: 'alpha',    name: 'Player Alphabet', path: '/games/alpha.html',    blurb: 'Name a player for every letter of the alphabet.' },
  { key: 'xi',       name: 'Starting XI',     path: '/games/xi.html',       blurb: 'Build the strongest eleven you can.' },
  { key: 'whoami',   name: 'Who Am I?',       path: '/games/whoami.html',   blurb: 'Guess the player from five clues.' },
  { key: 'quiz',     name: 'Trivia Quiz',     path: '/games/quiz.html',     blurb: 'Ten questions from this club’s record.' },
];

// ─── the page ───────────────────────────────────────────────────────────────

function render(team, d, related, opts) {
  const { leaders, scorers, comps, span, totals, playable } = d;
  const teams = opts.teams;
  const SITE = opts.site;

  const c = colours.forTeam(team);
  const url = `${SITE}/teams/${team.slug}/`;
  const compList = comps.map((x) => x.competition_name);
  const playableNames = playable.map((x) => x.competition_name);

  const indexable = team.players >= teams.INDEXABLE_MIN_PLAYERS && playable.length > 0;

  // The link a game card points at before any JavaScript runs: every
  // competition the club has a playable game in. That is also what the
  // competition chips start on, so the static href and the scripted one agree.
  const defaultScope = teams.scopeIdForMany(team.slug, playableNames);

  const description =
    `Play ${team.name} football quizzes and trivia games built from ` +
    `${num(team.players)} players and ${num(totals.appearances)} appearances in ` +
    `${listOf(compList)}. Higher or Lower, Starting XI, Player Alphabet, Who Am I and a trivia quiz.`;

  const title = `${team.name} Football Quiz & Trivia Games | TeleStats`;

  // ── games ────────────────────────────────────────────────────────────────
  // &play=1 so the link goes to the game, not to a picker offering every other
  // club — which is what it did before, and read as if the link went nowhere.
  const gameCards = !defaultScope ? '' : GAMES.map((g) => `<li class="game">
          <a class="game-go" data-path="${esc(g.path)}"
             href="${esc(g.path)}?scope=${encodeURIComponent(defaultScope)}&amp;play=1">
            <h3>${esc(team.name)} ${esc(g.name)}</h3>
            <p>${esc(g.blurb)}</p>
            <span class="go">Play now &rarr;</span>
          </a>
        </li>`).join('\n        ');

  // ── competition chips ────────────────────────────────────────────────────
  // Only competitions with a playable game get a chip. Offering "Plymouth
  // Argyle in the Championship" when four players have one appearance each
  // produces a game with nothing to ask, which is worse than not offering it.
  const chips = playable.length < 2 ? '' : `<div class="chips" id="compChips" role="group"
       aria-label="Choose which competitions to play">
        <button type="button" class="chip all on" data-all="1" aria-pressed="true">All competitions</button>
        ${playable.map((x) => `<button type="button" class="chip on"
                data-comp="${esc(x.competition_name)}"
                data-slug="${esc(teams.competitionSlug(x.competition_name))}"
                aria-pressed="true">${esc(x.competition_name)}</button>`).join('\n        ')}
      </div>
      <p class="chip-note" id="chipNote"></p>`;

  // ── player of the day ────────────────────────────────────────────────────
  // Chosen in the browser from a list baked into the page, seeded on today's
  // date. A build-time choice would be frozen until the next deploy, and a
  // server call would be a request for something nobody searches for. This
  // changes daily, is the same for everyone, and works with no network.
  const potdPool = leaders.slice(0, 25).map((p) => ({
    n: p.player_name, a: p.appearances, g: p.goals,
    f: season(p.first_season), t: season(p.last_season),
  }));

  // ── stats tables ─────────────────────────────────────────────────────────
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

  const compRows = comps.map((x) => `<tr>
            <td>${esc(x.competition_name)}</td>
            <td class="num">${num(x.players)}</td>
            <td class="yr">${season(x.first_season)}–${season(x.last_season)}</td>
            <td class="num">${x.seasons}</td>
            <td class="${playableNames.includes(x.competition_name) ? 'yes' : 'no'}">${
              playableNames.includes(x.competition_name) ? 'Playable' : 'Too few games yet'}</td>
          </tr>`).join('\n        ');

  // ── ask ──────────────────────────────────────────────────────────────────
  const askPartner = (related[0] && related[0].name) || 'Manchester United';
  const topComp = withArticle((comps[0] && comps[0].competition_name) || 'Premier League');
  const askExamples = [
    `Who has played for both ${team.name} and ${askPartner}?`,
    `Top scorers for ${team.name} in ${topComp}`,
    `Which English players have the most appearances for ${team.name}?`,
  ].map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('\n          ');

  const relatedLinks = related.map((r) =>
    `<a href="/teams/${esc(r.slug)}/">${esc(r.name)}</a>`).join('\n          ');

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
      { '@type': 'SportsTeam', name: team.name, sport: 'Association football', url },
      // The explainer is a real question a first-time visitor asks, answered on
      // the page in the same words. Nothing here is invented for the markup.
      {
        '@type': 'FAQPage',
        mainEntity: [{
          '@type': 'Question',
          name: `What is the ${team.name} page on TeleStats?`,
          acceptedAnswer: {
            '@type': 'Answer',
            text: `Free ${team.name} football quizzes and trivia games generated from real ` +
                  `appearance and goal records for ${num(team.players)} players across ` +
                  `${listOf(compList)}. No sign-up is needed to play.`,
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
${indexable ? '' : '<meta name="robots" content="noindex,follow">\n'}<meta name="theme-color" content="${c.primary}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="TeleStats">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<link rel="stylesheet" href="/telestats-theme.css">
<style>
  :root { --club: ${c.primary}; --club-2: ${c.secondary}; }
  body { margin: 0; }
  .wrap { max-width: 940px; margin: 0 auto; padding: 0 18px 60px; }

  /* Fallback header. TSNav removes .ts-header and prepends the real one, so
     this is what a visitor sees before the script runs, and all a search
     engine ever sees. Without it the page opened with no way back to the
     site and read as if it belonged somewhere else. */
  .ts-header { border-bottom: 1px solid var(--rule, #24313A); background: var(--bg-card, #131A20); }
  .ts-header .inner { max-width: 940px; margin: 0 auto; padding: 11px 18px;
                      display: flex; align-items: center; gap: 18px; }
  .ts-header .brand { font-weight: 700; letter-spacing: .04em; color: var(--text-primary, #F2F5F7);
                      text-decoration: none; font-family: 'Space Mono', ui-monospace, monospace; }
  .ts-header nav { display: flex; gap: 15px; flex-wrap: wrap; }
  .ts-header nav a { font-size: .82rem; color: var(--text-secondary, #9FB0BC); text-decoration: none; }
  .ts-header nav a:hover { color: var(--accent, #00E5FF); }

  nav.crumbs { font-size: .78rem; color: var(--text-secondary); margin: 16px 0 12px; }
  nav.crumbs a { color: var(--accent); text-decoration: none; }

  /* Hero: scarf stripes, shield, name. The point is that landing here feels
     like arriving somewhere about this club. */
  .hero { position: relative; overflow: hidden; border-radius: 12px; padding: 22px 22px 20px;
          border: 1px solid var(--rule, #24313A); margin-bottom: 8px;
          background:
            linear-gradient(160deg, color-mix(in srgb, var(--club) 30%, transparent), transparent 62%),
            var(--bg-card, #131A20); }
  .scarf { position: absolute; inset: 0 0 auto 0; height: 6px;
           background: repeating-linear-gradient(90deg,
             var(--club) 0 26px, var(--club-2) 26px 52px); }
  .hero-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .crest { width: 52px; height: 60px; flex: 0 0 auto; filter: drop-shadow(0 2px 6px rgba(0,0,0,.45)); }
  .hero h1 { font-size: 1.65rem; line-height: 1.2; margin: 0 0 5px; }
  .sub { color: var(--text-secondary); margin: 0; font-size: .9rem; }
  .scope-note { color: var(--text-muted); font-size: .76rem; margin: 6px 0 0; }
  .scope-note a { color: var(--accent); }

  /* Explainer: shut by default on a return visit, open the first time. */
  details.explainer { border: 1px solid var(--rule, #24313A); border-radius: 9px;
                      background: var(--bg-card, #131A20); margin: 12px 0 26px; }
  details.explainer > summary { cursor: pointer; padding: 11px 15px; font-size: .87rem;
                                font-weight: 600; list-style: none; }
  details.explainer > summary::-webkit-details-marker { display: none; }
  details.explainer > summary::after { content: ' \\25BE'; color: var(--text-muted); }
  details.explainer[open] > summary::after { content: ' \\25B4'; }
  details.explainer .body { padding: 0 15px 14px; font-size: .87rem; line-height: 1.55;
                            color: var(--text-secondary); max-width: 68ch; }
  details.explainer .body p { margin: 0 0 9px; }

  h2 { font-size: 1.12rem; margin: 30px 0 4px; }
  h2 + .sub { margin-bottom: 12px; }
  h3.sub-head { font-size: .95rem; margin: 26px 0 3px; }

  /* Player of the day */
  .potd { display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
          border: 1px solid var(--rule, #24313A); border-radius: 11px; padding: 16px 18px;
          background: linear-gradient(120deg, color-mix(in srgb, var(--club) 15%, transparent), transparent 55%),
                      var(--bg-card, #131A20); }
  .shirt { width: 66px; height: 66px; flex: 0 0 auto; }
  .potd-body { flex: 1; min-width: 220px; }
  .potd .eyebrow { font-size: .68rem; text-transform: uppercase; letter-spacing: .1em;
                   color: var(--text-muted); margin: 0 0 4px; }
  .potd .name { font-size: 1.22rem; font-weight: 700; margin: 0 0 4px; }
  .potd .line { font-size: .85rem; color: var(--text-secondary); margin: 0; }
  .potd button.reveal { margin-top: 9px; padding: 8px 15px; border: 0; border-radius: 7px;
                        font-weight: 600; font-size: .84rem; cursor: pointer;
                        background: var(--accent, #00E5FF); color: #0B0F12; }

  /* Competition chips */
  .chips { display: flex; flex-wrap: wrap; gap: 7px; margin: 4px 0 6px; }
  .chip { font-size: .79rem; padding: 6px 12px; border-radius: 999px; cursor: pointer;
          border: 1px solid var(--rule, #24313A); background: transparent;
          color: var(--text-secondary); font: inherit; font-size: .79rem; }
  .chip.on { background: var(--club); border-color: var(--club); color: #fff; font-weight: 600; }
  .chip-note { font-size: .76rem; color: var(--text-muted); margin: 0 0 14px; min-height: 1.1em; }

  ul.games { list-style: none; padding: 0; margin: 0; display: grid;
             grid-template-columns: repeat(auto-fit, minmax(232px, 1fr)); gap: 11px; }
  li.game { background: var(--bg-card, #131A20); border: 1px solid var(--rule, #24313A);
            border-radius: 9px; transition: border-color .15s, transform .15s; }
  li.game:hover { border-color: var(--club); transform: translateY(-1px); }
  a.game-go { display: block; padding: 14px 15px; text-decoration: none; color: inherit; height: 100%; }
  li.game h3 { font-size: .95rem; margin: 0 0 4px; }
  li.game p { font-size: .81rem; color: var(--text-secondary); margin: 0 0 10px; line-height: 1.4; }
  li.game .go { font-size: .8rem; font-weight: 600; color: var(--accent, #00E5FF); }

  .lane-note { font-size: .82rem; color: var(--text-secondary); margin: 3px 0 12px; max-width: 66ch; }
  .cta { display: inline-block; margin-top: 10px; font-size: .84rem; font-weight: 600;
         padding: 9px 15px; border-radius: 7px; text-decoration: none;
         border: 1px solid var(--club); color: var(--text-primary, #F2F5F7); }
  .cta:hover { background: var(--club); color: #fff; }

  /* Community + leaderboard, both filled in after paint */
  .community { list-style: none; padding: 0; margin: 0; display: grid;
               grid-template-columns: repeat(auto-fit, minmax(232px, 1fr)); gap: 11px; }
  .community li { background: var(--bg-card, #131A20); border: 1px dashed var(--rule, #3A4A55);
                  border-radius: 9px; padding: 13px 15px; }
  .community a { color: inherit; text-decoration: none; }
  .community h4 { font-size: .9rem; margin: 0 0 4px; }
  .community p { font-size: .79rem; color: var(--text-secondary); margin: 0 0 7px; line-height: 1.4; }
  .community .meta { font-size: .72rem; color: var(--text-muted); }
  .boards { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; }
  .board { border: 1px solid var(--rule, #24313A); border-radius: 9px; padding: 12px 14px;
           background: var(--bg-card, #131A20); }
  .board h4 { font-size: .82rem; text-transform: uppercase; letter-spacing: .06em;
              color: var(--text-muted); margin: 0 0 8px; }
  .board ol { margin: 0; padding-left: 1.3em; font-size: .86rem; }
  .board li { padding: 2px 0; }
  .board .pts { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .empty { font-size: .84rem; color: var(--text-muted); margin: 6px 0 0; }

  /* Stats: shut on load, per feedback. The content is still in the HTML, so
     it is still indexed and still readable with JavaScript off. */
  details.stats { border: 1px solid var(--rule, #24313A); border-radius: 9px;
                  background: var(--bg-card, #131A20); margin-bottom: 11px; }
  details.stats > summary { cursor: pointer; padding: 12px 15px; font-weight: 600;
                            font-size: .95rem; list-style: none; }
  details.stats > summary::-webkit-details-marker { display: none; }
  details.stats > summary::after { content: ' \\25BE'; color: var(--text-muted); }
  details.stats[open] > summary::after { content: ' \\25B4'; }
  details.stats .body { padding: 0 15px 12px; overflow-x: auto; }

  table { border-collapse: collapse; width: 100%; font-size: .86rem; }
  th, td { text-align: left; padding: 6px 9px; border-bottom: 1px solid var(--rule, #24313A); }
  th { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.rank { color: var(--text-muted); width: 2em; }
  td.yr { color: var(--text-secondary); white-space: nowrap; }
  td.yes { color: var(--accent, #00E5FF); font-size: .78rem; }
  td.no { color: var(--text-muted); font-size: .78rem; }

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

  @media (max-width: 560px) {
    .hero h1 { font-size: 1.32rem; }
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

<nav class="crumbs"><a href="/">TeleStats</a> › <a href="/teams/">Teams</a> › ${esc(team.name)}</nav>

<div class="hero">
  <div class="scarf"></div>
  <div class="hero-row">
    ${shield(team, c)}
    <div>
      <h1>${esc(team.name)} Football Quizzes &amp; Trivia</h1>
      <p class="sub">${num(team.players)} players · ${num(totals.appearances)} appearances · ${esc(listOf(compList))}</p>
      <p class="scope-note">Records cover ${esc(season(span.first))} to ${esc(season(span.last))}.
        <a href="/tools/data.html">Full dataset scope</a>.</p>
    </div>
  </div>
</div>

<details class="explainer" id="explainer">
  <summary>New here? What this page is</summary>
  <div class="body">
    <p>This is a set of free football games about <strong>${esc(team.name)}</strong>, generated
      from real appearance and goal records — ${num(team.players)} players who have turned out
      for the club in ${esc(listOf(compList))}, going back to ${esc(season(span.first))}.</p>
    <p>Pick a game below and it starts straight away on ${esc(team.name)}. No sign-up, no app.
      Make an account only if you want your scores kept and your name on the club's board.</p>
    <p>Everything you see here comes from the TeleStats database. Nothing is written by an AI
      and nothing is guessed — if a fact is not in the data, the site says so rather than
      inventing one.</p>
  </div>
</details>

<section class="potd" id="potd" data-team="${esc(team.name)}">
  ${mysteryShirt(c)}
  <div class="potd-body">
    <p class="eyebrow">${esc(team.name)} · Player of the day</p>
    <p class="name" id="potdName">Who is it?</p>
    <p class="line" id="potdLine">One of this club's most-used players. Reveal to find out.</p>
    <button type="button" class="reveal" id="potdBtn">Reveal</button>
  </div>
</section>

<h2 id="play">Play ${esc(team.name)}</h2>
${gameCards ? `<p class="sub">The five TeleStats games, set up for ${esc(team.name)}. Click one and it starts.</p>
      ${chips}
      <ul class="games">
        ${gameCards}
      </ul>` : `<p class="sub">${esc(team.name)} does not have enough played matches in a single
  competition to build a fair game yet — the season is only a few rounds old and every player
  has the same number of appearances. The records below are complete, and games will appear
  here as the season is played.</p>`}

<h3 class="sub-head">Community games about ${esc(team.name)}</h3>
<p class="lane-note">The five above are the official TeleStats games. These are made by players,
  using the same database — different rules, different lists, same real records.</p>
<div id="communityBox"><p class="empty">Loading…</p></div>
<a class="cta" href="/community/?build=1">Make your own ${esc(team.name)} game &rarr;</a>

<h2>${esc(team.name)} leaderboard</h2>
<p class="sub">Best scores on ${esc(team.name)} games, by game type. Sign in before you play to
  get your name on it — or see the <a href="/leaderboard/">site-wide leaderboard</a>.</p>
<div id="boardBox"><p class="empty">Loading…</p></div>

<h2>${esc(team.name)} records</h2>
<p class="sub">The data these games are built from.</p>

<details class="stats">
  <summary>${esc(team.name)} appearance leaders</summary>
  <div class="body">
    <table>
      <thead><tr><th></th><th>Player</th><th class="num">Apps</th><th class="num">Goals</th><th>Seasons</th></tr></thead>
      <tbody>
        ${leaderRows}
      </tbody>
    </table>
  </div>
</details>

<details class="stats">
  <summary>${esc(team.name)} top scorers</summary>
  <div class="body">
    <table>
      <thead><tr><th></th><th>Player</th><th class="num">Goals</th><th class="num">Apps</th></tr></thead>
      <tbody>
        ${scorerRows}
      </tbody>
    </table>
  </div>
</details>

<details class="stats">
  <summary>${esc(team.name)} competitions in the database</summary>
  <div class="body">
    <table>
      <thead><tr><th>Competition</th><th class="num">Players</th><th>Seasons</th><th class="num">Count</th><th>Games</th></tr></thead>
      <tbody>
        ${compRows}
      </tbody>
    </table>
  </div>
</details>

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

${related.length ? `<h2>More teams</h2>\n<div class="related">\n          ${relatedLinks}\n</div>` : ''}

<footer class="page">
  Player statistics from the TeleStats football database.
  <a href="/tools/data.html">Coverage and last update</a> ·
  <a href="/games/">All games</a> ·
  <a href="/teams/">All teams</a> ·
  <a href="/ask/">Ask TeleStats</a>
</footer>

</div><!-- /wrap -->

<script>
window.TS_TEAM = ${JSON.stringify({
  slug: team.slug, name: team.name, comps: playableNames,
  defaultScope, potd: potdPool,
})};
</script>
<script src="/js/ts-scope.js"></script>
<script src="/js/team-page.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/js/ts-auth.js"></script>
<script src="/js/ts-data.js"></script>
<script src="/js/ts-nav.js"></script>
<script>
  // The real site header, which replaces the static fallback above. Wrapped
  // because a team page must stay readable if auth is down — the games, the
  // records and the ask box do not need a signed-in user.
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

module.exports = { render, GAMES, esc, num, season, listOf, withArticle, initials };
