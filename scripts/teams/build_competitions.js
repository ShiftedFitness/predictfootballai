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
const shell = require('../pages/shell');
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

/**
 * The Competitions hub.
 *
 * It was twelve near-identical rectangles ordered by club count, which put the
 * FA Cup first and the Premier League ninth — an order that means something to
 * the database and nothing to a supporter.
 *
 * Now the order is the football one: a country's league pyramid top to bottom,
 * then its cups, then Europe. That is editorial and hardcoded on purpose,
 * because no column in the data knows that the Championship sits below the
 * Premier League.
 */
const GROUPS = [
  { code: 'ENG', name: 'England',
    order: ['Premier League', 'Championship', 'League One', 'League Two', 'FA Cup', 'EFL Cup'] },
  { code: 'ESP', name: 'Spain', order: ['La Liga', 'Segunda División'] },
  { code: 'ITA', name: 'Italy', order: ['Serie A'] },
  { code: 'GER', name: 'Germany', order: ['Bundesliga'] },
  { code: 'FRA', name: 'France', order: ['Ligue 1'] },
  { code: 'EUR', name: 'Europe', order: ['Champions League'] },
];

/** Which of those are cups rather than league divisions. */
const CUPS = new Set(['FA Cup', 'EFL Cup', 'Champions League']);

/**
 * Editorially featured. Not "most popular" — nothing here measures that, and
 * an invented ranking on a statistics site is the one thing to avoid.
 */
const FEATURED = ['Premier League', 'Champions League', 'La Liga', 'Bundesliga', 'Serie A'];

/** A stable colour per competition, so a card is recognisable without a logo. */
const TINTS = {
  'Premier League': '#38E8C0', 'Championship': '#4F8BFF', 'League One': '#C792EA',
  'League Two': '#F0A35E', 'FA Cup': '#FF6B8A', 'EFL Cup': '#8FA2B4',
  'La Liga': '#FFC94D', 'Segunda División': '#FF8A5B', 'Serie A': '#5BC8FF',
  'Bundesliga': '#FF5C5C', 'Ligue 1': '#7CE37C', 'Champions League': '#00E5FF',
};

function renderHub(rows) {
  const byName = new Map(rows.map((r) => [r.comp.name, r]));
  const total = rows.length;

  const card = (r, group, big) => {
    const { comp, clubs, totals, span, seasons } = r;
    const tint = TINTS[comp.name] || '#00E5FF';
    return `<li><a class="comp${big ? ' big' : ''}" href="/competitions/${esc(comp.slug)}/"
        style="--tint:${tint}">
      <span class="ctop">
        <span class="cbadge" aria-hidden="true">${esc(initialsOf(comp.name))}</span>
        <span class="cwho">
          <span class="cname">${esc(comp.name)}</span>
          <span class="cscope">${esc(group.name)}${CUPS.has(comp.name) ? ' · Cup' : ''}</span>
        </span>
      </span>
      <span class="cfig">
        <b>${clubs.length}</b><span>clubs</span>
        <b>${num(totals.players)}</b><span>players</span>
        <b>${seasons}</b><span>seasons</span>
      </span>
      <span class="cyrs">${esc(season(span.first))}&ndash;${esc(season(span.last))}</span>
    </a></li>`;
  };

  const featured = FEATURED.map((n) => {
    const r = byName.get(n);
    if (!r) return '';
    const g = GROUPS.find((x) => x.order.includes(n)) || { name: '' };
    return card(r, g, true);
  }).filter(Boolean).join('\n        ');

  const sections = GROUPS.map((g) => {
    const mine = g.order.map((n) => byName.get(n)).filter(Boolean);
    if (!mine.length) return '';
    const leagues = mine.filter((r) => !CUPS.has(r.comp.name));
    const cups = mine.filter((r) => CUPS.has(r.comp.name));
    const block = (list, label) => list.length ? `
    ${label ? `<p class="csub">${esc(label)}</p>` : ''}
    <ul class="comps">
          ${list.map((r) => card(r, g, false)).join('\n          ')}
    </ul>` : '';
    return `<section class="gblock" data-group="${esc(g.code)}">
  <div class="ghead"><h3>${esc(g.name)}</h3><span class="gcount">${mine.length}</span></div>
  ${block(leagues, cups.length ? 'Leagues' : '')}
  ${block(cups, 'Cups')}
</section>`;
  }).filter(Boolean).join('\n\n');
  const title = 'Football Competitions: Player Stats, Records & Games | TeleStats';
  const description =
    `Explore player records and play football challenges across ${total} of Europe's ` +
    `leagues and cups, from the Premier League and La Liga to League Two and the ` +
    `Segunda División.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'TeleStats', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Competitions', item: `${SITE}/competitions/` }] },
      { '@type': 'CollectionPage', name: title, description, url: `${SITE}/competitions/` },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/telestats-theme.css">
<link rel="stylesheet" href="/css/ts-page.css">
<style>
  /* A competition's identity is a tint and its initials. No crests, no league
     logos: those are trademarks, and this page is not worth a licence. */
  ul.comps { list-style: none; padding: 0; margin: 0; display: grid; gap: 9px;
             grid-template-columns: repeat(3, minmax(0, 1fr)); }
  ul.feat { list-style: none; padding: 0; margin: 0; display: grid; gap: 9px;
            grid-template-columns: repeat(5, minmax(0, 1fr)); }
  a.comp { display: flex; flex-direction: column; gap: 9px; height: 100%; min-width: 0;
           box-sizing: border-box; padding: 14px 15px 13px; border-radius: 12px;
           text-decoration: none; color: var(--fg); background: var(--s1);
           border: 1px solid var(--line); border-top: 2px solid var(--tint);
           transition: background .14s, border-color .14s, transform .14s; }
  a.comp:hover { background: var(--s2); transform: translateY(-2px);
                 border-color: color-mix(in srgb, var(--tint) 55%, var(--line-2));
                 border-top-color: var(--tint); }
  a.comp:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
  .ctop { display: flex; align-items: center; gap: 10px; }
  .cbadge { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 8px;
            display: flex; align-items: center; justify-content: center;
            font-family: var(--mono); font-size: .72rem; font-weight: 700;
            color: #06181C; background: var(--tint); letter-spacing: -.02em; }
  .cwho { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .cname { font-family: var(--mono); font-size: .88rem; font-weight: 700; line-height: 1.2; }
  .cscope { font-size: .68rem; color: var(--fg-3); }
  .cfig { display: grid; grid-template-columns: repeat(3, minmax(0, auto)); gap: 1px 5px;
          align-items: baseline; margin-top: auto; min-width: 0; }
  .cfig b { font-family: var(--mono); font-size: .9rem; font-weight: 700;
            font-variant-numeric: tabular-nums; grid-row: 1; }
  .cfig span { font-size: .6rem; text-transform: uppercase; letter-spacing: .08em;
               color: var(--fg-3); grid-row: 2; }
  .cyrs { font-size: .68rem; color: var(--fg-3); font-variant-numeric: tabular-nums; }
  a.comp.big .cbadge { width: 38px; height: 38px; font-size: .8rem; }
  a.comp.big .cname { font-size: .95rem; }

  .gtabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 18px; }
  .gtab { font: inherit; font-size: .82rem; font-weight: 600; padding: 8px 14px;
          min-height: 38px; border-radius: 999px; cursor: pointer;
          background: var(--s1); color: var(--fg-2); border: 1px solid var(--line); }
  .gtab:hover { color: var(--fg); border-color: var(--line-2); }
  .gtab.on { background: var(--cyan); color: #06181C; border-color: var(--cyan); }
  .gtab:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
  .gblock { margin-bottom: 26px; }
  .gblock[hidden] { display: none; }
  .ghead { display: flex; align-items: baseline; gap: 9px; margin-bottom: 10px; }
  .ghead h3 { font-family: var(--mono); font-size: .92rem; margin: 0; }
  .gcount { font-size: .72rem; color: var(--fg-3); }
  .csub { font-size: .66rem; text-transform: uppercase; letter-spacing: .1em;
          color: var(--fg-3); margin: 0 0 7px; }
  .histnote { font-size: .72rem; color: var(--fg-3); margin: 0 0 16px; }

  @media (max-width: 900px) { ul.feat { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 720px) { ul.comps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 620px) {
    /* minmax(0, 1fr), not 1fr. A grid track defaults to min-content, and the
       three-figure row inside a card refuses to go below its own width — so at
       360px the tracks pushed the page 2px wider than the viewport rather than
       letting the cards shrink. */
    ul.feat, ul.comps { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    a.comp { padding: 12px 12px 11px; }
    .cbadge, a.comp.big .cbadge { width: 28px; height: 28px; font-size: .64rem; }
    .cname, a.comp.big .cname { font-size: .8rem; }
    .cfig b { font-size: .8rem; }
    .gblock { margin-bottom: 22px; }
  }
</style>
</head>
<body>
<div class="ts-shell">
${shell.fallbackHeader('/competitions/')}
<main class="wrap">
<nav class="crumbs"><a href="/">TeleStats</a> &rsaquo; Competitions</nav>

<div class="hero">
  <p class="kicker">Pick your <em>competition</em>.</p>
  <h1>Football competitions: player records, stats and games</h1>
  <p class="lede">Explore player records and take on football challenges across
    <b>${total} of Europe's leagues and cups</b>.</p>
</div>

<section class="band">
  <h2>Start here</h2>
  <p class="sublede">A few of the best known. Every competition below has the same
    records and the same games.</p>
  <ul class="feat">
        ${featured}
  </ul>
</section>

<section class="band">
  <h2>All ${total} competitions</h2>
  <p class="sublede">By country, leagues top to bottom, then cups.</p>
  <div class="gtabs" role="group" aria-label="Filter competitions by country">
    <button type="button" class="gtab on" data-group="">All</button>
    ${GROUPS.map((g) => `<button type="button" class="gtab" data-group="${esc(g.code)}"
      >${esc(g.name)}</button>`).join('\n    ')}
  </div>
  <p class="histnote">Club and player counts cover everyone we hold records for in that
    competition at any point in its history &mdash; not the current season's entrants.</p>

${sections}
</section>
</main>
${shell.footer()}
</div>
<script>
(function () {
  'use strict';
  var tabs = [].slice.call(document.querySelectorAll('.gtab'));
  var blocks = [].slice.call(document.querySelectorAll('.gblock'));
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      var want = t.getAttribute('data-group');
      tabs.forEach(function (o) { o.classList.toggle('on', o === t); });
      blocks.forEach(function (b) {
        b.hidden = !!want && b.getAttribute('data-group') !== want;
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

/** "Premier League" -> "PL", "Serie A" -> "SA", "Bundesliga" -> "BUN". */
function initialsOf(name) {
  const words = String(name).split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
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
