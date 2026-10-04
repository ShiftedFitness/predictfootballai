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

    var sel = null;          // assigned below, read by paint()

    function paint() {
      var picked = chosen();
      var isAll = picked.length === each.length;
      all.classList.toggle('on', isAll);
      all.setAttribute('aria-pressed', String(isAll));
      // Lets the stylesheet show "All" as the active segment while nothing has
      // actually been narrowed, instead of lighting up every competition.
      box.classList.toggle('every', isAll);
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
        ? 'Playing all ' + each.length + ' competitions.'
        : 'Playing ' + picked.map(function (c) { return c.dataset.comp; }).join(' and ') + ' only.';

      // Mirror into the select. A subset of two or more has no single option
      // to show, so it falls back to "All competitions" rather than lying
      // about which one is active — the note underneath says what is really on.
      if (sel) sel.value = (picked.length === 1 && !isAll) ? picked[0].dataset.slug : '';
    }

    all.addEventListener('click', function () {
      // "All" is a shortcut, not a fourth option: pressing it turns everything
      // on. Pressing it when everything is already on does nothing, because
      // turning them all off would leave nothing to play.
      each.forEach(function (c) { c.classList.add('on'); });
      paint();
    });

    // ── the mobile face of the same control ────────────────────────────────
    //
    // Six segments is most of a phone viewport, so narrow screens get a select
    // instead. It is NOT a second copy of the state: it writes to the same
    // buttons and then repaints, so there is only ever one answer to "which
    // competitions are on" and no way for the two to disagree.
    //
    // The select is single-choice by design. Multi-select on a phone means a
    // multiple-size listbox, which is worse than the pills it replaced; the
    // segmented control keeps the subset behaviour where there is room for it.
    sel = $('compSelect');
    if (sel) {
      sel.addEventListener('change', function () {
        var want = sel.value;
        each.forEach(function (o) { o.classList.toggle('on', !want || o.dataset.slug === want); });
        paint();
      });
    }

    each.forEach(function (c) {
      c.addEventListener('click', function () {
        // From "all", a click means "actually, just this one" — it does NOT
        // mean "all except this one". Starting every competition switched on
        // and treating the first click as a de-selection was backwards: nobody
        // arrives at Sunderland wanting three divisions minus the Championship.
        // Once a narrower choice exists, further clicks add and remove.
        var isAll = chosen().length === each.length;
        if (isAll) {
          each.forEach(function (o) { o.classList.toggle('on', o === c); });
        } else {
          c.classList.toggle('on');
          // Turning the last one off would leave nothing playable, so that
          // click returns to all instead of to an empty state.
          if (!chosen().length) each.forEach(function (o) { o.classList.add('on'); });
        }
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
      // The strip is one line tall; "Play a game about Brighton and Hove
      // Albion" wraps it to three on a phone.
      btn.textContent = 'Play';
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
            // Framed as an opportunity, not as a vacancy. "Nobody has played
            // this" tells a first-time visitor the site is empty.
            boardBox.innerHTML = '<p class="empty">No ' + esc(T.name) +
              ' scores yet — play a game and the top spot is yours.</p>' +
              '<a class="mini" href="#play">Play ' + esc(T.name) + ' &rarr;</a>';
          } else {
            // ONE board, not a panel per game type.
            //
            // Splitting by game produced three or four bordered boxes holding
            // one name each, which made a quiet club look abandoned rather
            // than new. The busiest game is shown, the rest are a line of
            // text, and the full table is a click away.
            var top = d.leaderboard[0];
            var rest = d.leaderboard.slice(1)
              .filter(function (b) { return b.entries.length; })
              .map(function (b) { return gameName(b.game_type); });
            boardBox.innerHTML =
              '<div class="board"><h3>' + esc(gameName(top.game_type)) + '</h3><ol>' +
              top.entries.slice(0, 5).map(function (e) {
                return '<li>' + esc(e.name) + '<span class="pts">' + num(e.score) + '</span></li>';
              }).join('') + '</ol></div>' +
              '<p class="empty" style="margin-top:9px">' + num(d.plays) + ' round' +
              (d.plays === 1 ? '' : 's') + ' played on ' + esc(T.name) +
              (rest.length ? ' · also ' + rest.join(', ') : '') + '</p>';
          }
        }

        // Community games. The distinction from the five official games is made
        // in the markup around this box, not here.
        if (commBox) {
          if (!d.community || !d.community.length) {
            commBox.innerHTML = '<p class="empty">Nothing for ' + esc(T.name) +
              ' yet — community games are built by players from the same database.</p>' +
              '<a class="mini" href="/community/?build=1">Build one &rarr;</a>';
          } else {
            commBox.innerHTML = '<ul class="community">' + d.community.slice(0, 4).map(function (g) {
              return '<li><a href="/community/?game=' + encodeURIComponent(g.id) + '">' +
                '<h4>' + esc(g.title) + '</h4>' +
                '<span class="meta">' + esc(gameName(g.game_type)) + ' · ' +
                num(g.plays) + ' play' + (g.plays === 1 ? '' : 's') + '</span></a></li>';
            }).join('') + '</ul>' +
            '<a class="mini" href="/community/?build=1">Build a ' + esc(T.name) + ' game &rarr;</a>';
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
