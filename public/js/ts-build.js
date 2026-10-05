/**
 * ts-build.js — the natural-language builder.
 *
 * The sentence goes to build-create, which parses it deterministically and
 * counts the players that would really be eligible. Nothing here invents a
 * configuration, and nothing shows "your challenge is ready" unless the server
 * said the database can support it.
 *
 * The three outcomes are all real answers:
 *   ok        — a config, with the true pool size
 *   needs     — one clarifying question, because something was missing
 *   tooSmall  — the pool is too thin, with a suggestion derived from the ask
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

  function track(name, params) {
    try { if (window.TSAnalytics) TSAnalytics.trackEvent?.(name, params || {}); } catch (_) {}
  }

  /**
   * Only what the builder, preview and publish flows all genuinely do.
   * Trivia and Who Am I? are absent because community creation does not
   * support them — advertising them here would be a dead end.
   */
  var EXAMPLES = [
    'Build a Starting XI using Liverpool and Manchester United players',
    'Make a Bullseye game using Spanish Premier League players',
    'A Higher or Lower challenge with Arsenal players',
    'An alphabet challenge with Italian players in Serie A',
  ];

  var TEMPLATES = [
    { t: 'Rival clubs', d: 'Two clubs, one eleven.',
      p: 'Build a Starting XI using Liverpool and Manchester United players' },
    { t: 'Club legends', d: 'The most-used players at one club.',
      p: 'A Higher or Lower challenge with Arsenal players' },
    { t: 'Nationalities', d: 'One country, one league.',
      p: 'Make a Bullseye game using Spanish Premier League players' },
    { t: 'Alphabet run', d: 'A player for every letter.',
      p: 'An alphabet challenge with Italian players in Serie A' },
    { t: 'Premier League', d: 'The whole competition.',
      p: 'A Bullseye game with Premier League players' },
    { t: 'European nights', d: 'Champions League only.',
      p: 'Build a Starting XI from Champions League players' },
  ];

  var text, out, go;

  function init() {
    text = document.getElementById('bText');
    out = document.getElementById('bOut');
    go = document.getElementById('bGo');
    if (!text) return;

    var egs = document.getElementById('bEgs');
    if (egs) {
      egs.innerHTML = EXAMPLES.map(function (e) {
        return '<button type="button">' + esc(e) + '</button>';
      }).join('');
      egs.addEventListener('click', function (ev) {
        var b = ev.target.closest('button');
        if (!b) return;
        text.value = b.textContent;
        text.focus();
      });
    }

    var tpl = document.getElementById('bTpl');
    if (tpl) {
      tpl.innerHTML = TEMPLATES.map(function (t) {
        return '<li><button type="button" data-p="' + esc(t.p) + '">' +
          '<b>' + esc(t.t) + '</b><span>' + esc(t.d) + '</span></button></li>';
      }).join('');
      tpl.addEventListener('click', function (ev) {
        var b = ev.target.closest('button');
        if (!b) return;
        text.value = b.getAttribute('data-p');
        text.focus();
        text.scrollIntoView({ block: 'center', behavior: 'smooth' });
        track('build_started', { source: 'template' });
      });
    }

    document.getElementById('bForm').addEventListener('submit', function (e) {
      e.preventDefault();
      submit();
    });

    tabs();
    track('build_started', { source: 'page' });
  }

  function tabs() {
    var btns = [].slice.call(document.querySelectorAll('.b-tab'));
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var want = b.getAttribute('data-pane');
        btns.forEach(function (o) { o.classList.toggle('on', o === b); });
        ['create', 'explore', 'mine'].forEach(function (p) {
          var el = document.getElementById('pane-' + p);
          if (el) el.hidden = p !== want;
        });
        if (want === 'explore') loadExplore();
        if (want === 'mine') loadMine();
      });
    });
  }

  function submit() {
    var v = (text.value || '').trim();
    if (!v) return;
    go.disabled = true;
    out.innerHTML = '<p class="b-msg">Checking the database…</p>';
    // The prompt itself is never sent to analytics — only that one happened.
    track('build_prompt_submitted', { length: v.length });

    fetch(api() + '/build-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: v }),
    })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        out.innerHTML = '<p class="b-msg">Could not reach the database just now. ' +
          'Try again in a moment.</p>';
      })
      .finally(function () { go.disabled = false; });
  }

  function render(d) {
    if (!d) return;

    if (d.error) {
      out.innerHTML = '<p class="b-msg">' + esc(d.error) + '</p>';
      return;
    }

    // Something was missing. One question, with the answers as buttons where
    // the set is closed.
    if (d.needs) {
      var n = d.needs;
      out.innerHTML = '<div class="b-card"><p class="b-msg">' + esc(n.question) + '</p>' +
        (n.options
          ? '<div class="b-choice">' + n.options.map(function (o) {
              return '<button type="button" data-add="' + esc(o.label) + '">' +
                esc(o.label) + '</button>';
            }).join('') + '</div>'
          : '') +
        unsupportedNote(d.parsed) + '</div>';
      out.addEventListener('click', function once(ev) {
        var b = ev.target.closest('[data-add]');
        if (!b) return;
        out.removeEventListener('click', once);
        // Add the answer to what they already wrote, rather than replacing it.
        text.value = (b.getAttribute('data-add') + ' — ' + text.value).trim();
        submit();
      });
      return;
    }

    if (d.tooSmall) {
      out.innerHTML = '<div class="b-card">' +
        '<p class="b-msg"><b>That one is too small to play.</b> Only ' +
        '<span class="b-pool">' + d.pool + '</span> eligible player' +
        (d.pool === 1 ? '' : 's') + ' — this game needs at least ' + d.need + '.</p>' +
        '<p class="b-warn">' + esc(d.suggestion) + '</p></div>';
      track('build_configuration_generated', { result: 'too_small' });
      return;
    }

    if (!d.ok || !d.config) return;

    var c = d.config;
    var preview = previewUrl(c);
    var rows = [
      ['Game', c.gameName],
      c.clubs.length ? ['Clubs', c.clubs.map(function (x) { return x.name; }).join(' + ')] : null,
      c.competitions.length ? ['Competitions', c.competitions.join(' + ')] : null,
      c.nationality ? ['Nationality', c.nationality] : null,
      ['Objective', c.metric === 'goals' ? 'Goals' : 'Appearances'],
    ].filter(Boolean);

    out.innerHTML = '<div class="b-card">' +
      '<p class="b-ok">Your challenge is ready</p>' +
      '<h3>' + esc(d.title) + '</h3>' +
      '<ul class="b-rows">' +
        rows.map(function (r) {
          return '<li><b>' + esc(r[0]) + '</b><span>' + esc(r[1]) + '</span></li>';
        }).join('') +
        '<li><b>Eligible players</b><span class="b-pool">' + d.pool + '</span></li>' +
      '</ul>' +
      (d.notes && d.notes.length
        ? '<p class="b-warn">' + d.notes.map(esc).join(' ') + '</p>' : '') +
      unsupportedNote(d) +
      '<div class="b-acts">' +
        (preview
          ? '<a class="b-primary" href="' + esc(preview) + '">Preview game</a>'
          : '<a class="b-primary" href="/community/?builder=' + esc(c.gameType) +
            '">Open in builder</a>') +
        '<button type="button" class="b-second" id="bEdit">Edit</button>' +
        (preview
          ? '<a class="b-second" href="/community/?builder=' + esc(c.gameType) +
            '">Publish &amp; share</a>' : '') +
      '</div>' +
      (preview ? '' :
        '<p class="b-note">A pool combining ' +
        (c.clubs.length > 1 ? 'more than one club' : 'these filters') +
        ' needs the full builder to preview \u2014 the quick preview can only ' +
        'scope one club or one competition.</p>') +
      publishNote() +
      '</div>';

    document.getElementById('bEdit')?.addEventListener('click', function () {
      text.focus();
      text.setSelectionRange(text.value.length, text.value.length);
    });

    track('build_configuration_generated', { result: 'ok', game_type: c.gameType });
  }

  /**
   * A preview URL, but ONLY when it would be the real game.
   *
   * The scope vocabulary the engines speak (`team_<slug>_<comp>`,
   * `comp_<slug>`) encodes one club or one competition. A two-club pool has no
   * scope id, so linking to /games/xi.html for "Liverpool and Manchester
   * United" would start a GENERIC Starting XI — a different game wearing the
   * label of the one just built, and the single worst thing a preview can do.
   *
   * So this returns null for anything the engines cannot scope, and the card
   * sends those to the advanced builder, which does support custom multi-club
   * pools. Fewer previews, no lying ones.
   */
  function previewUrl(c) {
    var PAGES = {
      starting_xi: '/games/xi.html', bullseye: '/games/bullseye.html',
      higher_lower: '/games/hol.html', player_alphabet: '/games/alpha.html',
    };
    var page = PAGES[c.gameType];
    if (!page) return null;
    var slugify = function (v) {
      return String(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    };
    // One club: the team scope, narrowed to one competition when exactly one
    // was asked for.
    if (c.clubs.length === 1 && !c.nationality) {
      var comp = c.competitions.length === 1 ? slugify(c.competitions[0]) : 'all';
      return page + '?scope=team_' + c.clubs[0].slug + '_' + comp + '&play=1';
    }
    // No club but one competition: the competition scope.
    if (!c.clubs.length && c.competitions.length === 1 && !c.nationality) {
      return page + '?scope=comp_' + slugify(c.competitions[0]) + '&play=1';
    }
    return null;
  }

  /**
   * Said here, before anybody invests in a game they cannot publish. The
   * limits come from ts-entitlements.js, and nobody who already holds the
   * access is shown an upgrade line.
   */
  function publishNote() {
    var E = window.TSEntitlements;
    if (!E) return '';
    if (E.isPaid()) {
      return '<p class="b-note">Publishing is included with your ' +
        (E.isDayPass() ? 'Day Pass' : 'Pro access') + '.</p>';
    }
    if (E.tier() === 'anonymous') {
      return '<p class="b-note">Previewing is free. Create a free account to save it, ' +
        'or <a href="/upgrade/">see what Pro adds</a>.</p>';
    }
    return '<p class="b-note">Previewing is free. Publishing and sharing need Pro &mdash; ' +
      '<a href="/upgrade/">one payment, no subscription</a>.</p>';
  }

  function unsupportedNote(d) {
    var u = (d && d.unsupported) || (d && d.parsed && d.parsed.unsupported) || [];
    if (!u.length) return '';
    return '<p class="b-warn">TeleStats does not hold ' + u.map(esc).join(' or ') +
      ', so that part was left out.</p>';
  }

  function loadExplore() {
    var box = document.getElementById('bExplore');
    if (!box || box.dataset.loaded) return;
    box.dataset.loaded = '1';
    box.innerHTML = '<p class="b-msg">Loading…</p>';
    fetch(api() + '/featured').then(function (r) { return r.json(); }).then(function (d) {
      var list = (d && d.community) || [];
      box.innerHTML = list.length
        ? '<ul class="tsf-list">' + list.map(function (g) {
            return '<li><a href="' + esc(g.url) + '">' +
              '<span class="tsf-ln">' + esc(g.title) + '</span>' +
              '<span class="tsf-lm">' + esc(g.game) + '</span>' +
              (g.plays ? '<span class="tsf-lp">' + g.plays + ' plays</span>' : '') +
              '</a></li>';
          }).join('') + '</ul>' +
          '<p class="b-note"><a href="/community/">Browse all community games &rarr;</a></p>'
        : '<p class="b-msg">Be the first to publish one. Describe a challenge above ' +
          'and share it with your mates.</p>';
    }).catch(function () {
      box.innerHTML = '<p class="b-msg">Could not load community games just now.</p>';
    });
  }

  function loadMine() {
    var box = document.getElementById('bMine');
    if (!box) return;
    var E = window.TSEntitlements;
    // No giant empty panel for somebody with no account — an invitation.
    if (!E || E.tier() === 'anonymous') {
      box.innerHTML = '<p class="b-msg">Create a free account to save your challenges ' +
        'and keep your scores.</p><div class="b-acts">' +
        '<button type="button" class="b-primary" id="bSignup">Create free account</button>' +
        '</div>';
      document.getElementById('bSignup')?.addEventListener('click', function () {
        track('signup_prompt_viewed', { source: 'build' });
        try { TSNav.showAuthModal('signup', 'build'); } catch (e) {}
      });
      return;
    }
    box.innerHTML = '<p class="b-msg">Your published challenges appear here. ' +
      '<a href="/community/">Manage them in the builder &rarr;</a></p>';
  }

  window.TSBuild = { init: init };
})();
