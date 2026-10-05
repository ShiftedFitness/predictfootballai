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
        // The empty state has to mirror too, or the button keeps advertising
        // the selection the Clear beside it has just thrown away.
        mirror(picked, false);
        return;
      }

      var id = scopeId(picked);
      links.forEach(function (a) {
        a.style.opacity = '';
        a.removeAttribute('aria-disabled');
        a.href = a.dataset.path + '?scope=' + encodeURIComponent(id) + '&play=1';
      });

      // Silent when nothing is filtered. "Playing all 4 competitions" is the
      // default state restating itself under a control whose first segment
      // already says All, and it is the line every visitor reads first.
      note.textContent = isAll ? ''
        : 'Playing ' + picked.map(function (c) { return c.dataset.comp; }).join(' and ') + ' only.';

      mirror(picked, isAll);
    }

    // ── the phone's face of the same state ─────────────────────────────────
    // Checkboxes and a label, written FROM the buttons above and never the
    // other way round at paint time, so the two cannot disagree about which
    // competitions are on.
    function mirror(picked, isAll) {
      if (boxes.length) {
        var on = {};
        picked.forEach(function (c) { on[c.dataset.slug] = true; });
        boxes.forEach(function (b) { b.checked = !!on[b.dataset.slug]; });
      }
      if (!label) return;
      label.textContent = 'Competitions: ' + (
        !picked.length ? 'none'
        : isAll ? 'All'
        : picked.length === 1 ? picked[0].dataset.comp
        : picked.length + ' selected');
    }

    all.addEventListener('click', function () {
      // "All" is a shortcut, not a fourth option: pressing it turns everything
      // on. Pressing it when everything is already on does nothing, because
      // turning them all off would leave nothing to play.
      each.forEach(function (c) { c.classList.add('on'); });
      paint();
    });

    // ── the phone control ─────────────────────────────────────────────────
    //
    // It was a <select>, which can only say "one competition, or all of them".
    // A Sunderland supporter on a phone therefore could not play the Premier
    // League and Championship records together — the exact thing the
    // segmented control exists for. Now: a disclosure button that says what is
    // on, and checkboxes.
    //
    // Each checkbox writes to its BUTTON above and repaints, so the subset
    // logic, the scope id and the link rewriting are the same code path the
    // desktop control uses. There is no second filtering implementation that
    // only runs on a phone.
    var toggle = $('compToggle');
    var panel = $('compPanel');
    var label = $('compToggleLabel');
    var boxes = panel ? [].slice.call(panel.querySelectorAll('input[type=checkbox]')) : [];

    function bySlug(slug) {
      for (var i = 0; i < each.length; i++) if (each[i].dataset.slug === slug) return each[i];
      return null;
    }

    if (toggle && panel) {
      toggle.addEventListener('click', function () {
        var open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        panel.hidden = open;
      });
      document.addEventListener('click', function (e) {
        if (panel.hidden) return;
        if (e.target.closest && e.target.closest('.msel')) return;
        toggle.setAttribute('aria-expanded', 'false');
        panel.hidden = true;
      });
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || panel.hidden) return;
        toggle.setAttribute('aria-expanded', 'false');
        panel.hidden = true;
        toggle.focus();
      });
    }

    boxes.forEach(function (b) {
      b.addEventListener('change', function () {
        var chip = bySlug(b.dataset.slug);
        if (chip) chip.classList.toggle('on', b.checked);
        paint();
      });
    });

    // "Clear" is allowed to empty the selection. paint() already refuses to
    // build links to nothing and says so, which is a better answer than a
    // control that silently ignores the button it just offered.
    var selAll = $('compAll');
    var selNone = $('compNone');
    if (selAll) selAll.addEventListener('click', function () {
      each.forEach(function (o) { o.classList.add('on'); });
      paint();
    });
    if (selNone) selNone.addEventListener('click', function () {
      each.forEach(function (o) { o.classList.remove('on'); });
      paint();
    });

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

  // ── Mystery player ────────────────────────────────────────────────────────
  //
  // A daily guessing game, built on the Who Am I? endpoint rather than a
  // second guessing engine: same masking, same clue generator (which already
  // obeys "never name a competition the scope does not cover"), same
  // server-side answer check, same encrypted id. `daily: true` makes the pick
  // deterministic per club per UTC day.
  //
  // The answer is never in this page, so there is nothing to read in
  // view-source and nothing to scrape for tomorrow.
  (function mystery() {
    var box = $('potd');
    if (!box) return;
    var scope = box.getAttribute('data-scope');
    if (!scope) { box.style.display = 'none'; return; }

    var blanksEl = $('potdBlanks');
    var lineEl = $('potdLine');
    var form = $('potdForm');
    var input = $('potdInput');
    var acts = $('potdActs');
    var clueBtn = $('potdClue');
    var giveUpBtn = $('potdGiveUp');
    var scoreEl = $('potdScore');

    // 100 / 60 / 30 for one, two or three clues; nothing for a reveal. Simple
    // enough to state on the widget, which is the point of showing it.
    var SCORES = [100, 60, 30, 10];
    var state = { id: null, clues: [], shown: 1, done: false, wrong: 0 };

    function score() { return state.shown <= SCORES.length ? SCORES[state.shown - 1] : 0; }
    function paintScore() {
      scoreEl.textContent = state.done ? '' : score() + ' pts';
    }

    function showClue() {
      var c = state.clues[state.shown - 1];
      lineEl.innerHTML = c ? '<b>Clue ' + state.shown + ':</b> ' + esc(c) : '';
      clueBtn.hidden = state.shown >= state.clues.length;
      paintScore();
    }

    fetch(API + '/whoami_start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start_game', scopeId: scope, daily: true }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.error || !d.blanks) throw new Error(d && d.error);
        state.id = d.playerId;
        state.clues = d.clues || [];
        blanksEl.textContent = d.blanks;
        form.hidden = false;
        acts.hidden = false;
        showClue();
      })
      .catch(function () {
        // A failure here must not leave a half-built game on the page.
        box.style.display = 'none';
      });

    clueBtn.addEventListener('click', function () {
      if (state.done || state.shown >= state.clues.length) return;
      state.shown++;
      showClue();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var guess = input.value.trim();
      if (!guess || state.done) return;
      check({ guess: guess });
    });

    giveUpBtn.addEventListener('click', function () {
      if (state.done) return;
      check({ giveUp: true });
    });

    function check(extra) {
      var body = { action: 'check_answer', playerId: state.id, scopeId: scope };
      for (var k in extra) body[k] = extra[k];
      fetch(API + '/whoami_start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || d.error) return;
          if (d.correct || extra.giveUp) return finish(d, !!d.correct);
          // A wrong guess says so and nothing else. Saying "not quite, but
          // close" would be a clue the game did not mean to give.
          state.wrong++;
          lineEl.innerHTML = '<b>Not ' + esc(guess()) + '.</b> ' +
            esc(state.clues[state.shown - 1] || '');
          input.value = '';
          input.focus();
        })
        .catch(function () { /* leave the game as it was */ });

      function guess() { return extra.guess || ''; }
    }

    function finish(d, won) {
      state.done = true;
      var name = (d.player && d.player.name) || '';
      blanksEl.textContent = name;
      blanksEl.classList.toggle('got', won);
      form.hidden = true;
      acts.hidden = true;
      var pts = won ? score() : 0;
      lineEl.innerHTML = won
        ? '<b>Correct \u2014 ' + esc(name) + '.</b> ' + pts + ' points. Back tomorrow.'
        : '<b>It was ' + esc(name) + '.</b> Back tomorrow for another.';
      if (window.TSAnalytics) TSAnalytics.teamPotdReveal?.(T.slug);
    }
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

  // Where a community game is actually PLAYED.
  //
  // These cards linked to /community/?game=<id>, and the community page has
  // never read a `game` parameter — so clicking a specific challenge landed
  // the visitor on the hub to go and find it again. The community grid itself
  // has always used this URL; the team page was simply using a different one
  // that nothing implements.
  //
  // quiz and whoami are absent on purpose: neither game page reads
  // ?community=, so a link into them would start a generic round instead of
  // the authored one. Those fall back to the hub, which is the honest answer.
  var COMMUNITY_PAGES = {
    bullseye: 'bullseye', starting_xi: 'xi', higher_lower: 'hol',
    player_alphabet: 'alpha', alphabet: 'alpha',
  };
  var communityHref = function (g) {
    var page = COMMUNITY_PAGES[g.game_type];
    return page
      ? '/games/' + page + '.html?community=' + encodeURIComponent(g.id)
      : '/community/';
  };

  (function extras() {
    var boardBox = $('boardBox');
    var commBox = $('communityBox');
    var sect = $('extras');
    var boardCol = $('boardCol');
    var commCol = $('commCol');

    fetch(API + '/team-extras?slug=' + encodeURIComponent(T.slug))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) throw new Error(d.error);

        // Leaderboard and community games, both of which are usually empty on
        // a new club. An empty one is hidden rather than filled with a sentence
        // about being empty; the invitation it was carrying moves to a single
        // quiet line, and if both are empty the whole block never appears.
        var hasBoard = !!(d.leaderboard && d.leaderboard.length);
        var hasComm = !!(d.community && d.community.length);

        if (hasBoard && boardBox) {
          // ONE board, not a panel per game type. Splitting by game produced
          // three or four bordered boxes holding one name each, which made a
          // quiet club look abandoned rather than new. The busiest game is
          // shown, the rest are a line of text, the full table is a click away.
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
            (rest.length ? ' \u00b7 also ' + rest.join(', ') : '') +
            (hasComm ? '' : ' \u00b7 <a href="/community/?builder=1">build a game</a>') + '</p>';
        }

        if (hasComm && commBox) {
          // The distinction from the five official games is made in the markup
          // around this box, not here.
          commBox.innerHTML = '<ul class="community">' + d.community.slice(0, 4).map(function (g) {
            return '<li><a href="' + communityHref(g) + '">' +
              '<h4>' + esc(g.title) + '</h4>' +
              '<span class="meta">' + esc(gameName(g.game_type)) + ' \u00b7 ' +
              num(g.plays) + ' play' + (g.plays === 1 ? '' : 's') + '</span></a></li>';
          }).join('') + '</ul>' +
          '<a class="mini" href="/community/?builder=1">Build one for ' + esc(T.name) + ' &rarr;</a>';
        }

        if (boardCol) boardCol.hidden = !hasBoard;
        if (commCol) commCol.hidden = !hasComm;
        if (sect) sect.hidden = !(hasBoard || hasComm);
      })
      .catch(function () {
        // A failure here must not look like "this club has nothing", so the
        // block simply does not appear. Both its links are reachable from the
        // site nav and the page footer either way.
      });
  })();

  // ── How to play ───────────────────────────────────────────────────────────
  // One open at a time, closes on Escape or an outside click. The button is a
  // sibling of the card's anchor, so nothing here has to cancel a navigation
  // that was never going to start.
  (function howTo() {
    var btns = document.querySelectorAll('.howto');
    if (!btns.length) return;

    function closeAll(except) {
      for (var i = 0; i < btns.length; i++) {
        if (btns[i] === except) continue;
        btns[i].setAttribute('aria-expanded', 'false');
        var pop = document.getElementById(btns[i].getAttribute('aria-controls'));
        if (pop) pop.hidden = true;
      }
    }

    Array.prototype.forEach.call(btns, function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var pop = document.getElementById(btn.getAttribute('aria-controls'));
        if (!pop) return;
        var open = btn.getAttribute('aria-expanded') === 'true';
        closeAll(btn);
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        pop.hidden = open;
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.howto, .howpop')) closeAll(null);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll(null);
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
