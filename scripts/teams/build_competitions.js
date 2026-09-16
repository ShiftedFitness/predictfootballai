#!/usr/bin/env node
/**
 * build_competitions.js — a static page for every competition, plus the hub.
 *
 * Twelve pages. Small in number and large in value: "Premier League quiz" is a
 * bigger query than any single club's, a competition is one URL to hand to
 * somebody, and — the part that may matter most while nothing is indexed — it
 * gives 355 club pages a topically-relevant parent instead of one flat hub of
 * 355 links.
 *
 *   node scripts/teams/build_competitions.js
 *
 * Output: public/competitions/<slug>/index.html, public/competitions/index.html,
 *         public/sitemap-competitions.xml
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'public', 'competitions');
const SITE = 'https://telestats.net';

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
const colours = require('./colours');
const { render } = require('./render_competition');
const { esc, num, season } = require('./render');

const LEADERS = 20;

async function page(table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data.length) break;
    for (const r of data) out.push(r);
    if (data.length < 1000) break;
  }
  return out;
}

// ─── the hub ────────────────────────────────────────────────────────────────

function renderHub(rows) {
  const title = 'Football Competitions — Quizzes by League | TeleStats';
  const description =
    `Play football quizzes by competition. ${rows.length} leagues and cups, ` +
    `from the Premier League and La Liga to League Two and the Segunda División, ` +
    `built from real appearance and goal records.`;

  const cards = rows.map(({ comp, clubs, totals, span, seasons }) => {
    const c = clubs[0] ? colours.forTeam(clubs[0]) : { primary: '#00E5FF' };
    return `<a class="comp" href="/competitions/${esc(comp.slug)}/" style="--club:${c.primary}">
      <i></i>
      <div>
        <h2>${esc(comp.name)}</h2>
        <p>${clubs.length} clubs · ${num(totals.players)} players · ${seasons} seasons</p>
        <p class="yrs">${esc(season(span.first))} – ${esc(season(span.last))}</p>
      </div>
    </a>`;
  }).join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="/js/ts-analytics.js"></script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}/competitions/">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}/competitions/">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="/telestats-theme.css">
<style>
  body { margin: 0; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 0 18px 50px; }
  .ts-header { border-bottom: 1px solid var(--rule, #24313A); background: var(--bg-card, #131A20); }
  .ts-header .inner { max-width: 900px; margin: 0 auto; padding: 11px 18px;
                      display: flex; align-items: center; gap: 18px; }
  .ts-header .brand { font-weight: 700; letter-spacing: .04em; color: var(--text-primary, #F2F5F7);
                      text-decoration: none; font-family: 'Space Mono', ui-monospace, monospace; }
  .ts-header nav { display: flex; gap: 15px; flex-wrap: wrap; }
  .ts-header nav a { font-size: .82rem; color: var(--text-secondary, #9FB0BC); text-decoration: none; }
  nav.crumbs { font-size: .78rem; color: var(--text-secondary); margin: 16px 0 12px; }
  nav.crumbs a { color: var(--accent); text-decoration: none; }
  h1 { font-size: 1.65rem; margin: 0 0 6px; }
  .lede { color: var(--text-secondary); margin: 0 0 26px; max-width: 62ch; line-height: 1.55; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
  a.comp { display: flex; gap: 12px; align-items: stretch; text-decoration: none; color: inherit;
           border: 1px solid var(--rule, #24313A); border-radius: 9px; padding: 14px 15px;
           background: var(--bg-card, #131A20); transition: border-color .15s, transform .15s; }
  a.comp:hover { border-color: var(--club); transform: translateY(-1px); }
  a.comp i { width: 5px; border-radius: 3px; background: var(--club); flex: 0 0 auto; }
  a.comp h2 { font-size: 1rem; margin: 0 0 3px; }
  a.comp p { font-size: .8rem; color: var(--text-secondary); margin: 0; }
  a.comp .yrs { color: var(--text-muted); font-size: .75rem; margin-top: 2px; }
  footer.page { margin-top: 40px; padding-top: 16px; font-size: .77rem; color: var(--text-muted);
                border-top: 1px solid var(--rule, #24313A); }
  footer.page a { color: var(--accent); }
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
<nav class="crumbs"><a href="/">TeleStats</a> › Competitions</nav>
<h1>Football Games by Competition</h1>
<p class="lede">${esc(description)}</p>

<div class="grid">
    ${cards}
</div>

<footer class="page">
  <a href="/teams/">All teams</a> ·
  <a href="/games/">All games</a> ·
  <a href="/ask/">Ask TeleStats</a> ·
  <a href="/tools/data.html">Dataset coverage</a>
</footer>
</div>
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
</body>
</html>
`;
}

// ─── main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n  Fetching aggregates…');
  const perComp = await page('agg_player_club_comp',
    'club_id, competition_id, competition_name, player_id, player_name, appearances, goals');
  const clubSeasons = await page('agg_club_season',
    'club_id, competition_id, season_start_year');
  console.log(`    ${num(perComp.length)} player-club-competition rows`);

  const byComp = new Map();
  for (const r of perComp) {
    if (!byComp.has(r.competition_name)) byComp.set(r.competition_name, []);
    byComp.get(r.competition_name).push(r);
  }
  const seasonsByComp = new Map();
  for (const r of clubSeasons) {
    if (!seasonsByComp.has(r.competition_id)) seasonsByComp.set(r.competition_id, new Set());
    seasonsByComp.get(r.competition_id).add(r.season_start_year);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const built = [];
  const all = teams.competitions();

  for (const comp of all) {
    const rows = byComp.get(comp.name) || [];
    if (!rows.length) { console.log(`    skipped ${comp.name} — no rows`); continue; }

    // One entry per player across the whole competition: somebody who played
    // for three clubs in it has one record, not three.
    const byPlayer = new Map();
    for (const r of rows) {
      const e = byPlayer.get(r.player_id) || {
        player_name: r.player_name, appearances: 0, goals: 0, club_id: r.club_id, best: 0,
      };
      e.appearances += r.appearances || 0;
      e.goals += r.goals || 0;
      // The club shown is the one they played most for in this competition.
      if ((r.appearances || 0) > e.best) { e.best = r.appearances || 0; e.club_id = r.club_id; }
      byPlayer.set(r.player_id, e);
    }

    const withClub = [...byPlayer.values()].map((p) => {
      const t = teams.byClubId(p.club_id);
      return { ...p, club_name: t ? t.name : '—', slug: t ? t.slug : '' };
    }).filter((p) => p.slug);

    const leaders = withClub.slice().sort((a, b) => b.appearances - a.appearances).slice(0, LEADERS);
    const scorers = withClub.slice().filter((p) => p.goals > 0)
      .sort((a, b) => b.goals - a.goals).slice(0, LEADERS);

    const clubs = teams.all()
      .filter((t) => t.competitions.includes(comp.name))
      .sort((a, b) => b.players - a.players);

    const compId = (rows[0] || {}).competition_id;
    const yrs = [...(seasonsByComp.get(compId) || new Set())];
    const span = { first: Math.min(...yrs), last: Math.max(...yrs) };

    const totals = {
      players: byPlayer.size,
      appearances: withClub.reduce((a, p) => a + p.appearances, 0),
    };

    const d = {
      leaders, scorers, clubs, span, totals, seasons: yrs.length,
      siblings: all.filter((x) => x.slug !== comp.slug).map((x) => ({ slug: x.slug, name: x.name })),
    };

    const html = render(comp, d, { teams });
    const dir = path.join(OUT, comp.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    built.push({ comp, clubs, totals, span, seasons: yrs.length });
    console.log(`    ${comp.name.padEnd(20)} ${String(clubs.length).padStart(4)} clubs · ` +
                `${String(num(totals.players)).padStart(7)} players · ${yrs.length} seasons`);
  }

  built.sort((a, b) => b.totals.players - a.totals.players);
  fs.writeFileSync(path.join(OUT, 'index.html'), renderHub(built));

  const today = new Date().toISOString().slice(0, 10);
  const urls = [`${SITE}/competitions/`, ...built.map((b) => `${SITE}/competitions/${b.comp.slug}/`)];
  fs.writeFileSync(path.join(ROOT, 'public', 'sitemap-competitions.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`);

  console.log(`\n  ✓ ${built.length} competition pages`);
  console.log(`  ✓ public/competitions/index.html — hub`);
  console.log(`  ✓ public/sitemap-competitions.xml — ${urls.length} URLs\n`);
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
