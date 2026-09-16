/**
 * competition-page.js — the two live parts of a competition page.
 *
 * The page is complete static HTML: the records, the clubs and the game links
 * are all in the file before this runs. Only community games (created by
 * anyone at any moment) and the ask box need the network.
 */
(function () {
  'use strict';

  var C = window.TS_COMPETITION;
  if (!C) return;

  var API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8888/.netlify/functions' : '/.netlify/functions';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  var num = function (n) { return Number(n || 0).toLocaleString('en-GB'); };

  var GAME_NAMES = {
    higher_lower: 'Higher or Lower', player_alphabet: 'Player Alphabet', alphabet: 'Player Alphabet',
    starting_xi: 'Starting XI', who_am_i: 'Who Am I?', pop_quiz: 'Trivia Quiz',
    quiz: 'Trivia Quiz', bullseye: 'Bullseye',
  };
  var gameName = function (k) { return GAME_NAMES[k] || String(k || '').replace(/_/g, ' '); };

  // ── Community games for this competition ─────────────────────────────────
  (function community() {
    var box = $('communityBox');
    if (!box) return;
    fetch(API + '/competition-extras?slug=' + encodeURIComponent(C.slug))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) throw new Error(d.error);
        if (!d.community || !d.community.length) {
          box.innerHTML = '<p class="empty">No community games about ' + esc(C.name) +
            ' yet — there are ' + num(d.community_total) + ' across the site. ' +
            'Yours would be the first for this competition.</p>';
          return;
        }
        box.innerHTML = '<ul class="community">' + d.community.map(function (g) {
          return '<li><a href="/community/?game=' + encodeURIComponent(g.id) + '">' +
            '<h4>' + esc(g.title) + '</h4>' +
            (g.description ? '<p>' + esc(String(g.description).slice(0, 130)) + '</p>' : '') +
            '<span class="meta">' + esc(gameName(g.game_type)) + ' · ' +
            num(g.plays) + ' play' + (g.plays === 1 ? '' : 's') + '</span></a></li>';
        }).join('') + '</ul>';
      })
      .catch(function () {
        box.innerHTML = '<p class="empty">Could not load community games.</p>';
      });
  })();

  // ── Ask ──────────────────────────────────────────────────────────────────
  (function ask() {
    var f = $('askForm');
    if (!f) return;
    var out = $('askAnswer');
    var input = $('askQ');

    [].slice.call(document.querySelectorAll('.ask-examples button')).forEach(function (b) {
      b.addEventListener('click', function () {
        input.value = b.dataset.q;
        f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit'));
      });
    });

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      out.innerHTML = '<p class="msg">Looking…</p>';
      fetch(API + '/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, source: 'competition_page' }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        var html = '<p class="msg">' + esc(d.message || d.error) + '</p>';
        if (d.rows && d.rows.length) {
          html += '<table><tbody>' + d.rows.slice(0, 10).map(function (r) {
            var right = r.clubs && r.clubs[0] && r.clubs[0].team
              ? r.clubs.map(function (cl) { return esc(cl.team) + ' ' + cl.appearances; }).join(' · ')
              : (r.appearances != null ? r.appearances + ' apps, ' + r.goals + 'g' : '');
            return '<tr><td>' + esc(r.player || r.name) + '</td><td>' + right + '</td></tr>';
          }).join('') + '</tbody></table>';
        }
        if (d.provenance) {
          html += '<p class="prov">From the TeleStats database in ' +
                  esc(d.provenance.query_ms) + 'ms · <a href="/tools/data.html">coverage</a></p>';
        }
        out.innerHTML = html;
        // Structured only — the question text never goes to analytics.
        if (d.analytics && window.TSAnalytics) TSAnalytics.trackEvent?.('ask_query', d.analytics);
      }).catch(function () {
        out.innerHTML = '<p class="msg">Could not reach the database. Try again.</p>';
      });
    });
  })();
})();
