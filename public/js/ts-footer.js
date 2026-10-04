/**
 * ts-footer.js — one footer, one date, every page.
 *
 * Before this there were three answers to "when was the data updated":
 *
 *   - ts-nav appended "Database last updated 15 Feb 2026" from the `meta`
 *     table's `current_season_last_updated` — a hand-written NOTE that
 *     somebody last edited in February.
 *   - /games/ additionally printed "Current season stats updated: 15 Feb 2026
 *     21:34" from the same note, to the minute.
 *   - /tools/data showed 16 Sep 2026, derived from the data itself.
 *
 * The data was refreshed on 16 September. The footer had been telling every
 * visitor February for seven months, because a note is a thing somebody has to
 * remember to change and a derived date is not. So the note is no longer
 * consulted: the single source is data-summary's `last_updated`, which is the
 * max of the real per-competition refresh timestamps — the same number the
 * coverage page prints, so the two agree by construction rather than by
 * somebody keeping them in step.
 *
 * A build or deploy date is never used. Deploying this file does not refresh
 * anything, and saying otherwise would be the same lie with a fresher number.
 *
 * Exposed as window.TSFooter. Rendered by TSNav.render(), so any page carrying
 * the shared header gets the shared footer with no per-page work.
 */
(function () {
  'use strict';

  var CACHE_KEY = 'ts_data_updated';
  var CACHE_MS = 6 * 3600 * 1000;
  var COVERAGE = '/tools/data.html';

  function api() {
    return window.location.hostname === 'localhost'
      ? 'http://localhost:8888/.netlify/functions'
      : '/.netlify/functions';
  }

  function fmt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function cached() {
    try {
      var raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (raw && raw.iso && Date.now() - raw.at < CACHE_MS) return raw.iso;
    } catch (_) { /* private mode: just fetch every time */ }
    return null;
  }

  function remember(iso) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ iso: iso, at: Date.now() })); }
    catch (_) { /* ignore */ }
  }

  /**
   * The standard block. Rendered immediately with neutral wording, then
   * upgraded in place if a real date arrives.
   *
   * Neutral first is the point: an unknown date must never be filled with a
   * guess, and "View data coverage" is true whether or not the request lands.
   */
  function markup(dateText) {
    return '<span class="ts-foot-line">TeleStats.net &middot; Built by ' +
      '<a href="https://shiftedlabs.ai" target="_blank" rel="noopener">Shifted.Labs</a>' +
      '</span><span class="ts-foot-line ts-foot-data">' +
      (dateText
        ? 'Data last updated: ' + dateText + ' &middot; <a href="' + COVERAGE + '">View coverage</a>'
        : '<a href="' + COVERAGE + '">View data coverage</a>') +
      '</span>';
  }

  function style() {
    if (document.getElementById('ts-footer-style')) return;
    var el = document.createElement('style');
    el.id = 'ts-footer-style';
    el.textContent =
      '.ts-footer{display:flex;flex-direction:column;gap:3px;align-items:center;' +
      'text-align:center;padding:20px 16px;margin-top:28px;' +
      'border-top:1px solid rgba(255,255,255,.07);' +
      'font-family:Inter,system-ui,-apple-system,sans-serif;font-size:12px;line-height:1.6;' +
      'color:var(--text-secondary,#8A99A6)}' +
      '.ts-footer a{color:inherit;text-decoration:underline;text-underline-offset:2px}' +
      '.ts-footer a:hover{color:var(--accent-cyan,#00E5FF)}' +
      '.ts-foot-data{opacity:.8}' +
      /* Games put fixed controls at the bottom of a phone screen; the footer
         must not sit under them. */
      '@media(max-width:620px){.ts-footer{padding-bottom:72px}}';
    document.head.appendChild(el);
  }

  function render() {
    if (document.querySelector('.ts-footer')) return;
    style();

    var box = document.createElement('div');
    box.className = 'ts-footer';

    // Any page-specific footer keeps its own content — team pages carry a
    // coverage sentence and internal links that are worth having — and the
    // standard block goes underneath it. Pages without a footer get one.
    var host = document.querySelector('footer');
    if (host) {
      // The hand-written "Built by Shifted.Labs" line these pages shipped with
      // would otherwise appear twice.
      stripLegacy(host);
      host.appendChild(box);
    } else {
      (document.body || document.documentElement).appendChild(box);
    }

    var iso = cached();
    box.innerHTML = markup(iso ? fmt(iso) : null);
    if (iso) return;

    fetch(api() + '/data-summary')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.last_updated) return;
        var text = fmt(d.last_updated);
        if (!text) return;
        remember(d.last_updated);
        box.innerHTML = markup(text);
      })
      .catch(function () { /* the neutral line is already correct */ });
  }

  /** Remove a page's own copy of the standard line, wherever it was written. */
  function stripLegacy(host) {
    var kids = [].slice.call(host.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 1 && n.classList && n.classList.contains('ts-footer')) continue;
      var t = (n.textContent || '');
      if (/Built by\s*Shifted\.?Labs/i.test(t) ||
          /Current season stats updated/i.test(t) ||
          /Database last updated/i.test(t)) {
        if (n.parentNode) n.parentNode.removeChild(n);
      }
    }
    var old = document.getElementById('tsLastUpdated');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  window.TSFooter = { render: render, COVERAGE: COVERAGE };
})();
