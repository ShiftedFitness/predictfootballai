/**
 * shell.js — the no-JS header and the footer, for generated pages.
 *
 * TSNav removes .ts-header and prepends the real bar once the script runs, so
 * this is what a visitor sees first and all a crawler ever sees. Every
 * generated template had its own hand-written copy of it, which is why Teams,
 * Competitions and Ask had drifted into three different headers with three
 * different link sets.
 *
 * The link list is READ FROM ts-nav.js rather than retyped, so the fallback
 * and the real nav cannot disagree about what the site's sections are. Parsing
 * the source is ugly; two hand-maintained copies of a navigation is worse, and
 * that is exactly the drift this exists to stop.
 */
const fs = require('fs');
const path = require('path');

const NAV_SRC = path.join(__dirname, '..', '..', 'public', 'js', 'ts-nav.js');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The canonical nav, read from the one place that defines it. */
function navLinks() {
  const src = fs.readFileSync(NAV_SRC, 'utf8');
  const block = src.slice(src.indexOf('const NAV_LINKS = ['),
                          src.indexOf('];', src.indexOf('const NAV_LINKS = [')));
  const out = [];
  const re = /label:\s*'([^']+)',\s*href:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block))) out.push({ label: m[1], href: m[2] });
  if (out.length < 4) {
    throw new Error('shell.js could not read NAV_LINKS from ts-nav.js — refusing to ' +
                    'emit a header with a guessed navigation.');
  }
  return out;
}

/**
 * The fallback header. `current` is a path prefix, used for the active link,
 * and Home only matches exactly so every page is not "Home".
 */
function fallbackHeader(current) {
  const links = navLinks().map((l) => {
    const active = l.href === '/' ? current === '/' : current.startsWith(l.href);
    return `<a href="${esc(l.href)}"${active ? ' aria-current="page"' : ''}>${esc(l.label)}</a>`;
  }).join('\n      ');
  return `<header class="ts-header">
  <div class="inner">
    <a class="brand" href="/">TELESTATS</a>
    <nav aria-label="Site">
      ${links}
    </nav>
  </div>
</header>`;
}

/**
 * The footer placeholder.
 *
 * Deliberately EMPTY of a date. ts-footer.js fills it from the dataset, and a
 * date baked in at build time would be the build date wearing a data date's
 * clothes — the exact mistake that had the site claiming February for seven
 * months. A page that never runs JS shows the coverage link, which is true.
 */
function footer(extra) {
  return `<footer class="page-footer">${extra || ''}
  <noscript><a href="/tools/data.html">View data coverage</a></noscript>
</footer>`;
}

module.exports = { fallbackHeader, footer, navLinks, esc };
