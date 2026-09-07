/**
 * team-page.js — the interactive parts of a team page.
 *
 * Every team page is static HTML: the players, the records and the game links
 * are already in the file when it arrives, and the page is complete and
 * playable with this script blocked. What is here is the four things that
 * genuinely cannot be baked in at build time.
 *
 *   competition chips   which of a club's divisions to play. The choice
 *                       rewrites the game links; the static ones already point
 *                       at every playable competition, which is what the chips
 *                       start on, so nothing changes until somebody chooses.
 *
 *   player of the day   picked in the browser from a list baked into the page,
 *                       seeded on the date. A build-time choice would be frozen
 *                       until the next deploy.
 *
 *   leaderboard         changes whenever somebody plays.
 *   community games     created by anyone at any moment.
 *
 * The last two come from /team-extras. Neither is something a person arrives
 * from a search for, so fetching them after paint costs nothing that matters.
 *
 * Reads window.TS_TEAM, written into the page by scripts/teams/render.js.
 */
(function () {
  'use strict';

  var T = window.TS_TEAM;
  if (!T) return;

  var API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8888/.netlify/functions'
    : '/.netlify/functions';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString('en-GB'); }

  // ── The explainer ─────────────────────────────────────────────────────────
  // Open the first time somebody lands on a team page, shut every time after.
  // It answers "what is this?", and that question is only asked once — leaving
  // it open forever would push the games below the fold for the people who
  // already know.
  (function explainer() {
    var el = $('explainer');
    if (!el) return;
    var KEY = 'ts_team_explained';
    var seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch (_) { seen = false; }
    if (!seen) {
      el.open = true;
      try { localStorage.setItem(KEY, '1'); } catch (_) { /* private window */ }
    }
  })();

  // ── Competition chips ─────────────────────────────────────────────────────
  (function chips() {
    var box = $('compChips');
    if (!box) return;                         // one competition, nothing to pick
    var note = $('chipNote');
    var all = box.querySelector('.chip[data-all]');
    var each = [].slice.call(box.querySelectorAll('.chip[data-comp]'));
    var links = [].slice.call(document.querySelectorAll('a.game-go'));

    function chosen() {
      return each.filter(function (c) { return c.classList.contains('on'); });
    }

    function scopeId(picked) {
      // Mirrors _teams.js scopeIdForMany. The server resolves and validates the
      // id it is given, so a wrong one here is a clean error rather than a game
      // about the wrong club — but the shapes must agree or every link 400s.
      if (picked.length === each.length) return 'team_' + T.slug + '_all';
      if (picked.length === 1) return 'team_' + T.slug + '_' + picked[0].dataset.slug;
      return 'team_' + T.slug + '_' + picked.map(function (c) { return c.dataset.slug; }).join('+');
    }

    function paint() {
      var picked = chosen();
      var isAll = picked.length === each.length;
      all.classList.toggle('on', isAll);
      all.setAttribute('aria-pressed', String(isAll));
      each.forEach(function (c) {
        c.setAttribute('aria-pressed', String(c.classList.contains('on')));
      });

      if (!picked.length) {
        // Refusing to build a link is better than building one to nothing.
        links.forEach(function (a) {
          a.setAttribute('aria-disabled', 'true');
          a.style.opacity = '.45';
          a.removeAttribute('href');
        });
        note.textContent = 'Pick at least one competition.';
        return;
      }

      var id = scopeId(picked);
      links.forEach(function (a) {
        a.style.opacity = '';
        a.removeAttribute('aria-disabled');
        a.href = a.dataset.path + '?scope=' + encodeURIComponent(id) + '&play=1';
      });

      note.textContent = isAll
        ? 'Playing ' + T.name + ' across all ' + each.length + ' competitions.'
        : 'Playing ' + T.name + ' in ' +
          picked.map(function (c) { return c.dataset.comp; }).join(' and ') + ' only.';
    }

    all.addEventListener('click', function () {
      // "All" is a shortcut, not a fourth option: pressing it turns everything
      // on. Pressing it when everything is already on does nothing, because
      // turning them all off would leave nothing to play.
      each.forEach(function (c) { c.classList.add('on'); });
      paint();
    });

    each.forEach(function (c) {
      c.addEventListener('click', function () {
        c.classList.toggle('on');
        paint();
      });
    });

    paint();
  })();

  // ── Player of the day ─────────────────────────────────────────────────────
  (function potd() {
    var btn = $('potdBtn');
    if (!btn || !T.potd || !T.potd.length) {
      var box = $('potd');
      if (box) box.style.display = 'none';
      return;
    }

    // Seeded on the club and the date, so everyone looking at Plymouth Argyle
    // today sees the same player, and tomorrow it is a different one — with no
    // rebuild and no request.
    var day = new Date();
    var seedStr = T.slug + '|' + day.getUTCFullYear() + '-' +
                  (day.getUTCMonth() + 1) + '-' + day.getUTCDate();
    var h = 2166136261;
    for (var i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    var p = T.potd[(h >>> 0) % T.potd.length];

    function reveal() {
      $('potdName').textContent = p.n;
      var bits = [num(p.a) + ' appearance' + (p.a === 1 ? '' : 's')];
      if (p.g) bits.push(num(p.g) + ' goal' + (p.g === 1 ? '' : 's'));
      if (p.f) bits.push(p.f === p.t ? p.f : p.f + ' to ' + p.t);
      $('potdLine').textContent = bits.join(' · ') + ' for ' + T.name + '.';
      btn.textContent = 'Play a game about ' + T.name;
      btn.onclick = function () {
        var first = document.querySelector('a.game-go[href]');
        if (first) first.click(); else location.hash = '#play';
      };
      if (window.TSAnalytics) {
        TSAnalytics.trackEvent?.('team_potd_reveal', { team: T.slug });
      }
    }
    btn.addEventListener('click', reveal);
  })();

  // ── Leaderboard and community games ───────────────────────────────────────
  // The game_type strings the games actually write. Anything not listed falls
  // back to the raw key with its underscores removed, which reads badly but
  // never shows a blank heading.
  var GAME_NAMES = {
    higher_lower: 'Higher or Lower', alphabet: 'Player Alphabet', player_alphabet: 'Player Alphabet',
    starting_xi: 'Starting XI', who_am_i: 'Who Am I?', pop_quiz: 'Trivia Quiz',
    quiz: 'Trivia Quiz', bullseye: 'Bullseye', goal_recreator: 'Goal Recreator',
  };
  var gameName = function (k) { return GAME_NAMES[k] || String(k || '').replace(/_/g, ' '); };

  (function extras() {
    var boardBox = $('boardBox');
    var commBox = $('communityBox');

    fetch(API + '/team-extras?slug=' + encodeURIComponent(T.slug))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) throw new Error(d.error);

        // Leaderboard
        if (boardBox) {
          if (!d.leaderboard || !d.leaderboard.length) {
            boardBox.innerHTML = '<p class="empty">Nobody has posted a score on ' +
              esc(T.name) + ' yet. Play a game above and you are top of the board.</p>';
          } else {
            boardBox.innerHTML = '<div class="boards">' + d.leaderboard.map(function (b) {
              return '<div class="board"><h4>' + esc(gameName(b.game_type)) + '</h4><ol>' +
                b.entries.map(function (e) {
                  return '<li>' + esc(e.name) +
                    ' <span class="pts">' + num(e.score) + '</span></li>';
                }).join('') + '</ol></div>';
            }).join('') + '</div>' +
            '<p class="empty">' + num(d.plays) + ' round' + (d.plays === 1 ? '' : 's') +
            ' played on ' + esc(T.name) + ' so far.</p>';
          }
        }

        // Community games. The distinction from the five official games is made
        // in the markup around this box, not here.
        if (commBox) {
          if (!d.community || !d.community.length) {
            commBox.innerHTML = '<p class="empty">No community games about ' + esc(T.name) +
              ' yet — there are ' + num(d.community_total) +
              ' across the site. Yours would be the first for this club.</p>';
          } else {
            commBox.innerHTML = '<ul class="community">' + d.community.map(function (g) {
              return '<li><a href="/community/?game=' + encodeURIComponent(g.id) + '">' +
                '<h4>' + esc(g.title) + '</h4>' +
                (g.description ? '<p>' + esc(String(g.description).slice(0, 130)) + '</p>' : '') +
                '<span class="meta">' + esc(gameName(g.game_type)) + ' · ' +
                num(g.plays) + ' play' + (g.plays === 1 ? '' : 's') + '</span></a></li>';
            }).join('') + '</ul>';
          }
        }
      })
      .catch(function () {
        // A failure here must not look like "this club has nothing".
        if (boardBox) boardBox.innerHTML = '<p class="empty">Could not load the leaderboard.</p>';
        if (commBox) commBox.innerHTML = '<p class="empty">Could not load community games.</p>';
      });
  })();

  // ── Ask TeleStats ─────────────────────────────────────────────────────────
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
        body: JSON.stringify({ question: q, source: 'team_page' }),
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
