#!/usr/bin/env node
/**
 * sitemap.js — build the sitemap index and the core-pages sitemap.
 *
 * Split by section rather than one flat file, so Search Console reports
 * coverage per type: if team pages index and game pages do not, that shows up
 * as two different numbers instead of one average that hides both.
 *
 *   /sitemap.xml         index
 *   /sitemap-core.xml    homepage, games, tools  (written here)
 *   /sitemap-teams.xml   313 team pages          (written by scripts/teams/build.js)
 *
 * lastmod comes from the file's own modification time, not from "now".
 * Stamping every URL with today's date on every build teaches Google that the
 * dates are meaningless, which is worse than omitting them.
 *
 *   node scripts/seo/sitemap.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PUB = path.join(ROOT, 'public');
const SITE = 'https://telestats.net';

/**
 * Pages worth offering to a search engine, with the priority TeleStats
 * actually places on them. Admin screens, auth flows and the offline shell are
 * absent by design — they are disallowed in robots.txt for the same reason.
 */
const CORE = [
  { file: 'index.html',                 url: '/',                       priority: '1.0', freq: 'daily' },
  { file: 'games/index.html',           url: '/games/',                 priority: '0.9', freq: 'weekly' },
  { file: 'games/hol.html',             url: '/games/hol.html',         priority: '0.8', freq: 'weekly' },
  { file: 'games/alpha.html',           url: '/games/alpha.html',       priority: '0.8', freq: 'weekly' },
  { file: 'games/xi.html',              url: '/games/xi.html',          priority: '0.8', freq: 'weekly' },
  { file: 'games/whoami.html',          url: '/games/whoami.html',      priority: '0.8', freq: 'weekly' },
  { file: 'games/quiz.html',            url: '/games/quiz.html',        priority: '0.8', freq: 'weekly' },
  { file: 'games/bullseye.html',        url: '/games/bullseye.html',    priority: '0.8', freq: 'weekly' },
  { file: 'community/index.html',       url: '/community/',             priority: '0.7', freq: 'weekly' },
  { file: 'leaderboard/index.html',     url: '/leaderboard/',           priority: '0.6', freq: 'daily' },
  { file: 'tools/player-lookup.html',   url: '/tools/player-lookup.html', priority: '0.7', freq: 'weekly' },
  { file: 'tools/data.html',            url: '/tools/data.html',        priority: '0.6', freq: 'daily' },
  { file: 'ask/index.html',             url: '/ask/',                   priority: '0.8', freq: 'weekly' },
  { file: 'upgrade/index.html',         url: '/upgrade/',               priority: '0.5', freq: 'monthly' },
];

const lastmod = (rel) => {
  const p = path.join(PUB, rel);
  if (!fs.existsSync(p)) return null;
  return fs.statSync(p).mtime.toISOString().slice(0, 10);
};

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';

(function main() {
  // ── core pages ────────────────────────────────────────────────────────────
  const entries = CORE
    .map((c) => ({ ...c, lastmod: lastmod(c.file) }))
    .filter((c) => {
      if (c.lastmod) return true;
      console.log(`    skipped (missing): ${c.url}`);
      return false;
    });

  fs.writeFileSync(path.join(PUB, 'sitemap-core.xml'),
    xmlHeader +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map((e) =>
      `  <url>\n` +
      `    <loc>${SITE}${e.url}</loc>\n` +
      `    <lastmod>${e.lastmod}</lastmod>\n` +
      `    <changefreq>${e.freq}</changefreq>\n` +
      `    <priority>${e.priority}</priority>\n` +
      `  </url>`).join('\n') +
    '\n</urlset>\n');

  // ── the index ─────────────────────────────────────────────────────────────
  // Only sections that exist. A sitemap index pointing at a 404 is a broken
  // signal, and Search Console reports it as an error rather than ignoring it.
  const sections = ['sitemap-core.xml', 'sitemap-teams.xml']
    .filter((f) => fs.existsSync(path.join(PUB, f)))
    .map((f) => ({ f, lastmod: lastmod(f) }));

  fs.writeFileSync(path.join(PUB, 'sitemap.xml'),
    xmlHeader +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    sections.map((s) =>
      `  <sitemap>\n    <loc>${SITE}/${s.f}</loc>\n    <lastmod>${s.lastmod}</lastmod>\n  </sitemap>`
    ).join('\n') +
    '\n</sitemapindex>\n');

  const teamCount = fs.existsSync(path.join(PUB, 'sitemap-teams.xml'))
    ? (fs.readFileSync(path.join(PUB, 'sitemap-teams.xml'), 'utf8').match(/<loc>/g) || []).length
    : 0;

  console.log(`\n  ✓ sitemap-core.xml   ${entries.length} URLs`);
  console.log(`  ✓ sitemap-teams.xml  ${teamCount} URLs`);
  console.log(`  ✓ sitemap.xml        index of ${sections.length} sections`);
  console.log(`    total indexable: ${entries.length + teamCount}\n`);
})();
