/**
 * ts-featured.js — the Daily | Featured | Community module.
 *
 * ONE implementation, mounted by both the homepage and /games/. Two copies of
 * this would mean two answers to "what is today's challenge" and two streak
 * readings, which is the bug that had the homepage saying 1 and /games/
 * saying 0 on the same device.
 *
 *   TSFeatured.mount(document.getElementById('feature'), { compact: true })
 *
 * The middle tab is labelled from the SERVER's answer, never hardcoded: it
 * says Trending only when /featured reports real play volume, and Featured
 * otherwise. See netlify/functions/featured.js.
 */
(function () {
  'use strict';

  function api() {
    return location.hostname === 'localhost'
      ? 'http://localhost:8888/.netlify/functions' : '/.netlify/functions';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var ARROW = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 8h9M9 4.5 12.5 8 9 11.5"/></svg>';

  function mount(root, opts) {
    if (!root) return;
    opts = opts || {};
    root.classList.add('tsf');
    if (opts.compact) root.classList.add('tsf-compact');

    root.innerHTML =
      '<div class="tsf-tabs" role="tablist" aria-label="What to play">' +
        tab('daily', 'Daily', true) +
        tab('hot', 'Featured', false) +
        tab('community', 'Community', false) +
      '</div>' +
      panel('daily', '<p class="tsf-wait">Loading today’s challenge…</p>', true) +
      panel('hot', '<p class="tsf-wait">Loading…</p>', false) +
      panel('community', '<p class="tsf-wait">Loading…</p>', false);

    wireTabs(root);
    loadDaily(root);
    loadFeatured(root);
  }

  function tab(id, label, selected) {
    return '<button type="button" role="tab" id="tsf-t-' + id + '" class="tsf-tab' +
      (selected ? ' on' : '') + '" aria-selected="' + selected + '" aria-controls="tsf-p-' + id +
      '" tabindex="' + (selected ? '0' : '-1') + '" data-tab="' + id + '">' + label + '</button>';
  }

  function panel(id, inner, shown) {
    return '<div role="tabpanel" id="tsf-p-' + id + '" class="tsf-panel" ' +
      'aria-labelledby="tsf-t-' + id + '" tabindex="0"' + (shown ? '' : ' hidden') + '>' +
      inner + '</div>';
  }

  /** Proper tab semantics: arrows move, Home/End jump, only one is tabbable. */
  function wireTabs(root) {
    var tabs = [].slice.call(root.querySelectorAll('.tsf-tab'));

    function select(btn) {
      tabs.forEach(function (t) {
        var on = t === btn;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', String(on));
        t.setAttribute('tabindex', on ? '0' : '-1');
        var p = root.querySelector('#tsf-p-' + t.getAttribute('data-tab'));
        if (p) p.hidden = !on;
      });
    }

    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        if (!next) return;
        e.preventDefault();
        select(next);
        next.focus();
      });
    });
  }

  /** Today's challenge, from the same function and the same streak store. */
  function loadDaily(root) {
    var box = root.querySelector('#tsf-p-daily');
    fetch(api() + '/daily').then(function (r) { return r.json(); }).then(function (d) {
      var c = d && d.challenge;
      if (!c || !c.game) { box.innerHTML = note('Today’s challenge is on its way.'); return; }

      var s = (window.TSStreak && TSStreak.combined) ? TSStreak.combined() : null;
      var done = s && s.playedToday;

      box.innerHTML =
        '<div class="tsf-daily">' +
          '<div class="tsf-dmain">' +
            '<p class="tsf-eyebrow"><i></i>Today</p>' +
            '<p class="tsf-title">' + esc(c.game.name) + '</p>' +
            '<p class="tsf-sub">' + esc(c.label || '') + '</p>' +
            '<a class="tsf-cta" href="' + esc(c.url || '/daily/') + '">' +
              (done ? 'Play again' : 'Play today’s challenge') + ARROW + '</a>' +
          '</div>' +
          (s ? '<div class="tsf-streak">' +
            fig(s.current, 'Streak') + fig(s.longest, 'Best') + fig(s.total, 'Days') +
          '</div>' : '') +
        '</div>';
    }).catch(function () {
      box.innerHTML = note('Today’s challenge is on its way.');
    });
  }

  function fig(v, label) {
    return '<div><b>' + (v || 0) + '</b><span>' + label + '</span></div>';
  }

  function note(text) { return '<p class="tsf-wait">' + esc(text) + '</p>'; }

  /** The other two tabs come from one call, so they cannot disagree. */
  function loadFeatured(root) {
    var hot = root.querySelector('#tsf-p-hot');
    var comm = root.querySelector('#tsf-p-community');

    fetch(api() + '/featured').then(function (r) { return r.json(); }).then(function (d) {
      if (!d) throw new Error('no data');

      // The LABEL follows the data. It says Trending only when the server
      // says it measured enough plays to mean it.
      var label = d.mode === 'trending' ? 'Trending' : 'Featured';
      var t = root.querySelector('#tsf-t-hot');
      if (t) t.textContent = label;

      hot.innerHTML = (d.items || []).length
        ? '<ul class="tsf-list">' + d.items.map(function (i) {
            return '<li><a href="' + esc(i.url) + '">' +
              '<span class="tsf-ln">' + esc(i.name) + '</span>' +
              '<span class="tsf-lm">' + esc(i.label || '') + '</span>' +
              (d.mode === 'trending' && i.plays
                ? '<span class="tsf-lp">' + i.plays + ' plays</span>' : '') +
              ARROW + '</a></li>';
          }).join('') + '</ul>' +
          (d.mode === 'trending'
            ? '<p class="tsf-foot">Most played in the last ' + (d.windowDays || 7) + ' days.</p>'
            : '<p class="tsf-foot">A few good places to start.</p>')
        : note('Nothing to show yet.');

      comm.innerHTML = (d.community || []).length
        ? '<ul class="tsf-list">' + d.community.map(function (g) {
            return '<li><a href="' + esc(g.url) + '">' +
              '<span class="tsf-ln">' + esc(g.title) + '</span>' +
              '<span class="tsf-lm">' + esc(g.game) + '</span>' +
              (g.plays ? '<span class="tsf-lp">' + g.plays + ' plays</span>' : '') +
              ARROW + '</a></li>';
          }).join('') + '</ul>' +
          '<p class="tsf-foot"><a href="/community/">Browse all community games</a></p>'
        // No "there are none": an invitation instead, which is true either way.
        : '<div class="tsf-invite"><p>Build a challenge from the same database and ' +
          'share it.</p><a class="tsf-cta tsf-build" href="/community/?builder=1">' +
          'Build a game' + ARROW + '</a>' +
          '<p class="tsf-foot">Building and previewing are free. Publishing needs Pro.</p></div>';
    }).catch(function () {
      hot.innerHTML = note('Could not load this just now.');
      comm.innerHTML = note('Could not load this just now.');
    });
  }

  window.TSFeatured = { mount: mount };
})();
