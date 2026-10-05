/**
 * ts-ask.js — the Ask conversation.
 *
 * ── On "conversational" ───────────────────────────────────────────────────
 * Follow-ups are STRUCTURED, not a transcript posted to a model. Each one
 * synthesises a NEW plain question from the last turn's resolved subjects and
 * sends it through the same parser everything else uses. "What about goals?"
 * after "Top Arsenal players" becomes the question "Top Arsenal goalscorers".
 *
 * That matters for more than cost: _ask_intents.js is the documented security
 * boundary, and the parser in front of it is the gate. Letting the client post
 * a plan — or letting a model assemble one from prior text — would move that
 * boundary into the browser. Follow-ups are offered only for operations the
 * three real intents support, so none of them can promise an answer the
 * database cannot give.
 *
 * Sorting a result the page already holds needs no request at all.
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
   * The categories. Each is a real capability of one of the three intents —
   * nothing here advertises a fourth.
   */
  var CATS = [
    { t: 'Player connections', d: 'Who turned out for two clubs.',
      q: 'Who has played for both Arsenal and Chelsea?' },
    { t: 'Club records', d: 'The most-used players at a club.',
      q: 'Top Liverpool players by appearances' },
    { t: 'Top scorers', d: 'Who scored the most for a club.',
      q: 'Top Manchester United goalscorers' },
    { t: 'Career histories', d: 'Every club a player turned out for.',
      q: 'Which clubs did Peter Crouch play for?' },
    { t: 'Rivalries', d: 'Players who crossed a divide.',
      q: 'Who has played for both Liverpool and Everton?' },
    { t: 'Spanish football', d: 'The same questions, other leagues.',
      q: 'Top Barcelona goalscorers' },
  ];

  var input, thread, go;
  /** The last answered turn, so a follow-up knows what "those" meant. */
  var last = null;

  function init() {
    input = document.getElementById('aQ');
    thread = document.getElementById('aThread');
    go = document.getElementById('aGo');
    if (!input) return;

    var cats = document.getElementById('aCats');
    if (cats) {
      cats.innerHTML = CATS.map(function (c) {
        return '<li><button type="button" data-q="' + esc(c.q) + '">' +
          '<b>' + esc(c.t) + '</b><span>' + esc(c.d) + '</span></button></li>';
      }).join('');
      cats.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        ask(b.getAttribute('data-q'), 'category');
      });
    }

    document.getElementById('aForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = (input.value || '').trim();
      if (v) ask(v, 'typed');
    });

    // A shared question lands straight on its answer.
    try {
      var q = new URLSearchParams(location.search).get('q');
      if (q) ask(q, 'shared');
    } catch (_) {}
  }

  function ask(question, source, isFollowUp) {
    input.value = question;
    go.disabled = true;

    var turn = document.createElement('div');
    turn.className = 'a-turn';
    turn.innerHTML = '<p class="a-q"><i>You</i>' + esc(question) + '</p>' +
      '<div class="a-a"><p class="a-msg">Checking the database…</p></div>';
    thread.prepend(turn);

    // The question itself never goes to analytics — only that one was asked.
    track(isFollowUp ? 'ask_followup' : 'ask_submitted', { source: source || 'typed' });

    fetch(api() + '/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question, source: source || 'ask_page' }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { paint(turn, question, d); })
      .catch(function () {
        turn.querySelector('.a-a').innerHTML =
          '<p class="a-msg">Could not reach the database just now.</p>';
      })
      .finally(function () { go.disabled = false; });
  }

  function paint(turn, question, d) {
    var box = turn.querySelector('.a-a');
    if (!d) return;

    if (!d.answered) {
      // Different failures deserve different words. Telling somebody who asked
      // about three competitions to "try naming two clubs" was the single
      // least helpful thing this page did.
      var HINTS = {
        unknown_scope: 'Try one of the competitions TeleStats holds: the Premier League, ' +
          'Championship, League One, League Two, FA Cup, EFL Cup, Champions League, ' +
          'La Liga, Segunda Divisi\u00f3n, Serie A, Bundesliga or Ligue 1.',
        no_scope: 'Name a club or a competition, and Ask will take it from there.',
        unsupported: 'That comparison is not supported yet. Try "more than", ' +
          '"at least", "fewer than" or "between".',
        technical: 'This one is on us \u2014 try again in a moment.',
      };
      var hint = HINTS[d.kind] || 'Ask can find player connections, club records, top ' +
        'scorers, career histories, and statistical questions like "who scored more than ' +
        '10 goals in La Liga, the Premier League and Serie A".';
      box.innerHTML = '<p class="a-msg">' + esc(d.message || 'I could not answer that one.') +
        '</p><p class="a-cover">' + hint + '</p>';
      track('ask_answered', { answered: false, kind: d.kind || 'unparsed' });
      return;
    }

    var rows = d.rows || [];
    last = { question: question, rows: rows, message: d.message };

    box.innerHTML =
      // Natural language is ambiguous, so the reading is shown before the
      // table. If "both" over three leagues was taken as "each of three",
      // that should be visible rather than inferred from the numbers.
      (d.interpreted ? '<p class="a-read">' + esc(d.interpreted) + '</p>' : '') +
      '<p class="a-msg">' + esc(d.message) + '</p>' +
      (d.columns && d.columns.length ? scopeTable(rows, d.columns) : table(rows)) +
      follows(question, rows) +
      '<div class="a-tools">' +
        '<button type="button" data-share>Share this</button>' +
      '</div>' +
      '<p class="a-cover">From recorded appearances and goals in the TeleStats ' +
      'database. <a href="/tools/data.html">What it covers</a>.</p>';

    box.querySelector('[data-share]')?.addEventListener('click', function () {
      share(question);
    });

    box.querySelectorAll('[data-follow]').forEach(function (b) {
      b.addEventListener('click', function () {
        ask(b.getAttribute('data-follow'), 'followup', true);
      });
    });

    wireSort(box);
    track('ask_answered', { answered: true, rows: rows.length });
  }

  /**
   * One column per competition (or club), which is what a question like
   * "more than 10 goals in each of three leagues" is actually asking to see.
   * A single "total" column would hide the very thing being tested.
   */
  function scopeTable(rows, columns) {
    if (!rows.length) return '';
    return '<div class="a-scroll"><table class="a-tbl" data-sortable><thead><tr>' +
      '<th>Player</th>' +
      columns.map(function (c) {
        return '<th class="num" data-k="' + esc(c) + '">' + esc(c) + '</th>';
      }).join('') +
      '<th class="num" data-k="total" aria-sort="descending">Total</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.player) +
          (r.nationality ? '<span class="a-nat">' + esc(r.nationality) + '</span>' : '') +
          '</td>' +
          columns.map(function (c) {
            return '<td class="num">' + (r.per && r.per[c] != null ? r.per[c] : 0) + '</td>';
          }).join('') +
          '<td class="num">' + (r.total != null ? r.total : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /** The right shape for the rows that came back, not one shape for all. */
  function table(rows) {
    if (!rows.length) return '';

    // "Which clubs did X play for?" — one player, a list of clubs.
    if (rows[0].clubs && rows[0].name) {
      var clubs = rows[0].clubs || [];
      return '<table class="a-tbl"><thead><tr><th>Club</th>' +
        '<th class="num">Apps</th><th class="num">Goals</th><th class="opt">Seasons</th>' +
        '</tr></thead><tbody>' + clubs.map(function (c) {
          return '<tr><td>' + esc(c.team || c.club || '') + '</td>' +
            '<td class="num">' + (c.appearances != null ? c.appearances : '') + '</td>' +
            '<td class="num">' + (c.goals != null ? c.goals : '') + '</td>' +
            '<td class="opt">' + esc((c.from || '') + (c.to ? '–' + c.to : '')) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    // Players who appeared for every named club — each carries their spells.
    if (rows[0].clubs && rows[0].player) {
      return '<table class="a-tbl" data-sortable><thead><tr>' +
        '<th>Player</th><th class="num" data-k="total" aria-sort="descending">Total apps</th>' +
        '<th class="opt">Clubs</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td>' + esc(r.player) +
            (r.nationality ? '<span class="a-nat">' + esc(r.nationality) + '</span>' : '') +
            '</td><td class="num">' + (r.total != null ? r.total : '') + '</td>' +
            '<td class="opt">' + (r.clubs || []).map(function (c) {
              return esc(c.team) + ' (' + (c.appearances || 0) + ')';
            }).join(', ') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    // Top players at a club.
    if (rows[0].player) {
      return '<table class="a-tbl" data-sortable><thead><tr><th>Player</th>' +
        '<th class="num" data-k="appearances">Apps</th>' +
        '<th class="num" data-k="goals">Goals</th>' +
        '<th class="opt">Seasons</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td>' + esc(r.player) +
            (r.nationality ? '<span class="a-nat">' + esc(r.nationality) + '</span>' : '') +
            '</td><td class="num">' + (r.appearances != null ? r.appearances : '') + '</td>' +
            '<td class="num">' + (r.goals != null ? r.goals : '') + '</td>' +
            '<td class="opt">' + esc((r.from || '') + (r.to ? '–' + r.to : '')) +
            '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    return '';
  }

  /** Sorting a result the page already holds needs no request. */
  function wireSort(box) {
    var tbl = box.querySelector('table[data-sortable]');
    if (!tbl) return;
    tbl.querySelectorAll('th[data-k]').forEach(function (th, idx) {
      th.addEventListener('click', function () {
        var cells = [].slice.call(tbl.querySelectorAll('thead th'));
        var col = cells.indexOf(th);
        var body = tbl.querySelector('tbody');
        var trs = [].slice.call(body.querySelectorAll('tr'));
        var desc = th.getAttribute('aria-sort') !== 'descending';
        trs.sort(function (a, b) {
          var av = parseFloat(a.children[col].textContent) || 0;
          var bv = parseFloat(b.children[col].textContent) || 0;
          return desc ? bv - av : av - bv;
        });
        cells.forEach(function (c) { c.removeAttribute('aria-sort'); });
        th.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
        trs.forEach(function (tr) { body.appendChild(tr); });
      });
    });
  }

  /**
   * Follow-ups, built from the question that was just answered.
   *
   * Each becomes a real question through the same parser, so every one of
   * them is an operation the three intents genuinely support. There is no
   * suggestion here that the engine would have to refuse.
   */
  function follows(question, rows) {
    var out = [];
    var q = question.toLowerCase();

    // A club question that was about appearances can be about goals, and back.
    var club = question.match(/(?:top|most|best)\s+([A-Z][\w\s'&-]+?)\s+(?:players|goalscorers|scorers)/i);
    if (club) {
      var name = club[1].trim();
      if (/goal|scorer/.test(q)) out.push(['What about appearances?', 'Top ' + name + ' players by appearances']);
      else out.push(['What about goals?', 'Top ' + name + ' goalscorers']);
    }

    // A connection question suggests the mirror of itself.
    var both = question.match(/both\s+([\w\s'&.-]+?)\s+and\s+([\w\s'&.-]+?)\s*\??$/i);
    if (both) {
      out.push(['Top ' + both[1].trim() + ' players', 'Top ' + both[1].trim() + ' players']);
      out.push(['Top ' + both[2].trim() + ' players', 'Top ' + both[2].trim() + ' players']);
    }

    // The top row of a result is a player worth asking about.
    if (rows.length && rows[0].player) {
      out.push(['Which clubs did ' + rows[0].player + ' play for?',
                'Which clubs did ' + rows[0].player + ' play for?']);
    }

    if (!out.length) return '';
    return '<div class="a-follow">' + out.slice(0, 3).map(function (f) {
      return '<button type="button" data-follow="' + esc(f[1]) + '">' + esc(f[0]) + '</button>';
    }).join('') + '</div>';
  }

  /** A shareable URL that reproduces the question, not the stale answer. */
  function share(question) {
    var url = location.origin + '/ask/?q=' + encodeURIComponent(question);
    track('ask_shared', {});
    if (navigator.share) {
      navigator.share({ title: 'Ask TeleStats', text: question, url: url }).catch(function () {});
      return;
    }
    navigator.clipboard?.writeText(url).then(function () {
      var b = document.querySelector('[data-share]');
      if (b) { b.textContent = 'Link copied'; setTimeout(function () { b.textContent = 'Share this'; }, 1800); }
    }).catch(function () {});
  }

  window.TSAsk = { init: init };
})();
