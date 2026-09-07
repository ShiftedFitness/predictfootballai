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
const { render } = require('./render');

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
  body { margin: 0; }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 0 18px 50px; }
  .ts-header { border-bottom: 1px solid var(--rule, #24313A); background: var(--bg-card, #131A20); }
  .ts-header .inner { max-width: 1000px; margin: 0 auto; padding: 11px 18px;
                      display: flex; align-items: center; gap: 18px; }
  .ts-header .brand { font-weight: 700; letter-spacing: .04em; color: var(--text-primary, #F2F5F7);
                      text-decoration: none; font-family: 'Space Mono', ui-monospace, monospace; }
  .ts-header nav { display: flex; gap: 15px; flex-wrap: wrap; }
  .ts-header nav a { font-size: .82rem; color: var(--text-secondary, #9FB0BC); text-decoration: none; }
  nav.crumbs { margin-top: 16px; }
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
  footer { margin-top: 40px; font-size: .78rem; color: var(--text-muted); }
  footer a { color: var(--accent); }
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
<nav class="crumbs"><a href="/">TeleStats</a> › Teams</nav>
<h1>Football Games by Team</h1>
<p class="lede">${esc(description)} The number beside each club is how many of its
  players are in the database.</p>

${sections}

<footer>
  <a href="/daily/">Today's challenge</a> ·
  <a href="/games/">All games</a> ·
  <a href="/ask/">Ask TeleStats a question</a> ·
  <a href="/tools/data.html">Dataset coverage</a>
</footer>
</div><!-- /wrap -->
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

    const html = render(team, { leaders, scorers, comps, span, totals, playable: playableComps },
                        related, { teams, site: SITE });
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
