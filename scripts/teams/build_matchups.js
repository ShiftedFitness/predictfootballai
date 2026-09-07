#!/usr/bin/env node
/**
 * build_matchups.js — generate a static page for every qualifying matchup.
 *
 * Reads data/teams/matchups.json (which decides WHICH pairings deserve a page,
 * and why — see scripts/teams/matchups.js) and writes one page each, plus a
 * hub and a sitemap.
 *
 * All the data is fetched ONCE in two paged queries and folded in memory.
 * 2,500 pages against per-pairing queries would be 5,000 round trips for
 * information two queries already contain.
 *
 *   node scripts/teams/build_matchups.js                    # all
 *   node scripts/teams/build_matchups.js arsenal-vs-chelsea # one
 *
 * Output: public/matchups/<slug>/index.html, public/matchups/index.html,
 *         public/sitemap-matchups.xml
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'public', 'matchups');
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
const { render } = require('./render_matchup');
const { esc, num } = require('./render');

const MANIFEST = require(path.join(ROOT, 'data', 'teams', 'matchups.json'));

// Cups are excluded from "when they met" for the same reason as in
// matchups.js: everyone is in the FA Cup every year, so counting it would make
// every English pairing look like a fixture.
const CUPS = new Set(['FA Cup', 'EFL Cup', 'Community Shield', 'Champions League']);

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
  const title = 'Football Club Matchups — Shared Players & Records | TeleStats';
  const description =
    `Who has played for both? ${rows.length} club pairings with every shared player, ` +
    `both clubs' appearance and goal records, and the seasons they spent in the same division.`;

  // Grouped by the leading club, so the hub is navigable rather than a wall of
  // 2,500 links. Only the strongest few per club are listed; the rest are
  // reachable from each matchup page's own "more matchups".
  const byClub = new Map();
  for (const r of rows) {
    for (const slug of [r.a, r.b]) {
      if (!byClub.has(slug)) byClub.set(slug, []);
      byClub.get(slug).push(r);
    }
  }

  const sections = [...byClub.entries()]
    .map(([slug, list]) => ({ team: teams.bySlug(slug), list }))
    .filter((s) => s.team)
    .sort((x, y) => y.team.players - x.team.players)
    .slice(0, 60)
    .map(({ team, list }) => {
      const links = list
        .sort((x, y) => y.score - x.score)
        .slice(0, 8)
        .map((r) => {
          const other = teams.bySlug(r.a === team.slug ? r.b : r.a);
          if (!other) return '';
          return `<a href="/matchups/${esc(r.slug)}/">${esc(other.name)}<span>${num(r.shared_players)}</span></a>`;
        }).filter(Boolean).join('\n        ');
      return `<section>
  <h2><a href="/teams/${esc(team.slug)}/">${esc(team.name)}</a></h2>
  <div class="grid">
        ${links}
  </div>
</section>`;
    }).join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="/js/ts-analytics.js"></script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}/matchups/">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}/matchups/">
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
  nav.crumbs { font-size: .78rem; color: var(--text-secondary); margin: 16px 0 12px; }
  nav.crumbs a { color: var(--accent); text-decoration: none; }
  h1 { font-size: 1.65rem; margin: 0 0 6px; }
  .lede { color: var(--text-secondary); margin: 0 0 26px; max-width: 62ch; line-height: 1.55; }
  h2 { font-size: 1rem; margin: 24px 0 8px; }
  h2 a { color: var(--text-primary, #F2F5F7); text-decoration: none; }
  h2 a:hover { color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; }
  .grid a { display: flex; justify-content: space-between; gap: 8px; font-size: .84rem;
            padding: 7px 10px; border: 1px solid var(--rule, #24313A); border-radius: 6px;
            color: var(--accent); text-decoration: none; }
  .grid a span { color: var(--text-muted); font-variant-numeric: tabular-nums; }
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
      <a href="/teams/">Teams</a>
      <a href="/ask/">Ask</a>
      <a href="/leaderboard/">Leaderboard</a>
      <a href="/community/">Community</a>
    </nav>
  </div>
</header>
<div class="wrap">
<nav class="crumbs"><a href="/">TeleStats</a> › Matchups</nav>
<h1>Club Matchups</h1>
<p class="lede">${esc(description)} The number beside each club is how many players
  have turned out for both. Only pairings that have actually met — five or more seasons
  in the same division — get a page.</p>

${sections}

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
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  console.log('\n  Fetching aggregates…');
  const perClub = await page('agg_player_club',
    'club_id, player_id, player_name, appearances, goals, first_season, last_season');
  const clubSeasons = await page('agg_club_season',
    'club_id, competition_name, season_start_year');
  console.log(`    ${num(perClub.length)} player-club rows · ${num(clubSeasons.length)} club-season rows`);

  const byClub = new Map();
  const byPlayer = new Map();
  for (const r of perClub) {
    if (!byClub.has(r.club_id)) byClub.set(r.club_id, []);
    byClub.get(r.club_id).push(r);
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, new Map());
    byPlayer.get(r.player_id).set(r.club_id, r);
  }

  const seasonsByClub = new Map();
  for (const r of clubSeasons) {
    if (CUPS.has(r.competition_name)) continue;
    if (!seasonsByClub.has(r.club_id)) seasonsByClub.set(r.club_id, new Map());
    const m = seasonsByClub.get(r.club_id);
    if (!m.has(r.competition_name)) m.set(r.competition_name, new Set());
    m.get(r.competition_name).add(r.season_start_year);
  }

  // Per-club precomputed leaders, so a club appearing in forty matchups is
  // sorted once rather than forty times.
  const cache = new Map();
  function clubData(T) {
    if (cache.has(T.club_id)) return cache.get(T.club_id);
    const rows = byClub.get(T.club_id) || [];
    const v = {
      leaders: rows.slice().sort((a, b) => b.appearances - a.appearances).slice(0, 10),
      scorers: rows.slice().filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, 10),
      totals: rows.reduce((a, r) => ({
        appearances: a.appearances + (r.appearances || 0),
        goals: a.goals + (r.goals || 0),
      }), { appearances: 0, goals: 0 }),
    };
    cache.set(T.club_id, v);
    return v;
  }

  // Every matchup a club is in, for the "more matchups" links.
  const bySlug = new Map();
  for (const m of MANIFEST.matchups) {
    for (const s of [m.a, m.b]) {
      if (!bySlug.has(s)) bySlug.set(s, []);
      bySlug.get(s).push(m);
    }
  }
  const alsoFor = (slug, exclude) => (bySlug.get(slug) || [])
    .filter((x) => x.slug !== exclude)
    .sort((x, y) => y.score - x.score)
    .slice(0, 6)
    .map((x) => {
      const other = teams.bySlug(x.a === slug ? x.b : x.a);
      const me = teams.bySlug(slug);
      return other && me ? { slug: x.slug, label: `${me.name} vs ${other.name}` } : null;
    })
    .filter(Boolean);

  const list = only.length
    ? MANIFEST.matchups.filter((m) => only.includes(m.slug))
    : MANIFEST.matchups;

  fs.mkdirSync(OUT, { recursive: true });
  let written = 0, skipped = 0;

  for (const m of list) {
    const A = teams.bySlug(m.a), B = teams.bySlug(m.b);
    if (!A || !B) { skipped++; continue; }

    // Shared players, ordered by how much they actually did at the lesser club
    // — a player with 300 games at one and two at the other belongs last.
    const sharedPlayers = [];
    for (const [pid, clubs] of byPlayer) {
      const ra = clubs.get(A.club_id), rb = clubs.get(B.club_id);
      if (!ra || !rb) continue;
      sharedPlayers.push({
        name: ra.player_name,
        a: { appearances: ra.appearances, goals: ra.goals, first: ra.first_season, last: ra.last_season },
        b: { appearances: rb.appearances, goals: rb.goals, first: rb.first_season, last: rb.last_season },
        weight: Math.min(ra.appearances || 0, rb.appearances || 0),
      });
    }
    sharedPlayers.sort((x, y) => y.weight - x.weight ||
      (y.a.appearances + y.b.appearances) - (x.a.appearances + x.b.appearances));

    // Seasons both were in the same division.
    const metByComp = new Map();
    const sa = seasonsByClub.get(A.club_id) || new Map();
    const sb = seasonsByClub.get(B.club_id) || new Map();
    for (const [comp, years] of sa) {
      const other = sb.get(comp);
      if (!other) continue;
      const both = [...years].filter((y) => other.has(y));
      if (both.length) metByComp.set(comp, both);
    }
    if (!metByComp.size) { skipped++; continue; }   // the manifest said they met; trust the data

    const da = clubData(A), dbb = clubData(B);
    const html = render(m, {
      A, B, sharedPlayers, metByComp,
      leadersA: da.leaders, scorersA: da.scorers, totalsA: da.totals,
      leadersB: dbb.leaders, scorersB: dbb.scorers, totalsB: dbb.totals,
      alsoA: alsoFor(A.slug, m.slug).slice(0, 3),
      alsoB: alsoFor(B.slug, m.slug).slice(0, 3),
    }, { teams });

    const dir = path.join(OUT, m.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    written++;
  }

  console.log(`\n  ✓ ${num(written)} matchup pages written to public/matchups/`);
  if (skipped) console.log(`    ${skipped} skipped (no shared division in the data)`);

  // The hub and the sitemap describe the WHOLE set, so they are only correct
  // after a whole build. Writing them from a three-page test run would publish
  // a hub linking 2,500 pages that do not exist and a sitemap of 2,500 URLs
  // that 404 — which is a worse signal to a search engine than having none.
  if (only.length) {
    console.log(`    hub and sitemap left alone (partial build)\n`);
    return;
  }

  fs.writeFileSync(path.join(OUT, 'index.html'), renderHub(MANIFEST.matchups));

  const today = new Date().toISOString().slice(0, 10);
  const urls = [`${SITE}/matchups/`,
    ...MANIFEST.matchups.map((m) => `${SITE}/matchups/${m.slug}/`)];
  fs.writeFileSync(path.join(ROOT, 'public', 'sitemap-matchups.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`);

  console.log(`  ✓ public/matchups/index.html — hub`);
  console.log(`  ✓ public/sitemap-matchups.xml — ${num(urls.length)} URLs\n`);
})().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
