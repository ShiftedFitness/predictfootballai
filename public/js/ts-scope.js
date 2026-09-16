/**
 * ts-scope.js — let a link choose the game's scope.
 *
 * Team pages link straight into a preconfigured game:
 *
 *   /games/hol.html?scope=team_plymouth-argyle_league-one
 *
 * Without this, that parameter is ignored and the player lands on the scope
 * picker having already told us what they wanted. Every team page on the site
 * points at these URLs, so the link has to arrive somewhere.
 *
 * Deliberately one shared file rather than the same six lines in five game
 * pages. Five copies of one club list is what put "Málaga" in four places and
 * left one of them behind; there is no reason to repeat the shape of that
 * mistake with scope handling.
 *
 * Exposed as window.TSScope. No dependencies, safe to load anywhere.
 */
(function () {
  'use strict';

  function param(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (_) {
      return null;               // very old browsers, or a malformed query
    }
  }

  /**
   * The scope this URL asked for, but only if the game actually offers it.
   *
   * Validating against the game's own list matters: scope ids are public and
   * editable in the address bar, and a stale bookmark should quietly fall back
   * to the picker rather than firing a request that returns nothing. Returns
   * null when there is no valid request, which callers can treat as "behave
   * exactly as before".
   */
  function requested(scopes) {
    var wanted = param('scope');
    if (!wanted) return null;
    if (Array.isArray(scopes)) {
      for (var i = 0; i < scopes.length; i++) {
        if (scopes[i] && scopes[i].id === wanted) return scopes[i];
      }
    }
    // Not in the list, but shaped like one of ours. Team pages let a supporter
    // pick two of a club's four divisions, and the resulting subset id is not
    // pre-enumerated in any picker — a club in four competitions has eleven
    // such subsets, and putting all of them in front of every player to serve a
    // choice made on one page would be absurd. The server resolves it properly
    // and rejects anything it does not recognise, so an id it has never seen
    // comes back as a clean error rather than a game about the wrong club.
    if (/^team_[a-z0-9-]+_[a-z0-9+-]+$/.test(wanted)) {
      return { id: wanted, label: null, synthetic: true };
    }
    return null;
  }

  /**
   * The requested scope id WITHOUT checking it against a local list.
   *
   * For pages that carry their own hardcoded scope array rather than fetching
   * one — whoami.html is a sixth copy of the club list, and it does not know
   * about any club below the top flight. Validating against that list would
   * reject every valid League One link. The server validates the id properly,
   * so an unknown one comes back as a clean error rather than a wrong game.
   */
  function requestedId() {
    return param('scope');
  }

  /**
   * A game's own setting, chosen by the link rather than by the player.
   *
   *   /games/hol.html?scope=comp_segunda-division&stat=goals&play=1
   *
   * Competition and team pages list each game VARIANT separately — "Higher or
   * Lower: goals" is a different puzzle from "Higher or Lower: appearances",
   * and offering them as one link then making somebody choose again is the
   * same friction as the scope picker was.
   *
   * Validated against the caller's own allowlist, so a value invented in the
   * address bar falls back to the default instead of reaching a handler.
   */
  function variant(name, allowed) {
    var v = param(name);
    if (!v || !Array.isArray(allowed)) return null;
    return allowed.indexOf(v) === -1 ? null : v;
  }

  /** Should the game start on its own? Team pages can pass &play=1. */
  function autostart() {
    return param('play') === '1';
  }

  /**
   * Start the game without making the player choose again.
   *
   * Arriving from a team page having already picked the club, the division and
   * the game, and then landing on a picker offering every other club, reads as
   * if the link went nowhere. So: click through for them.
   *
   * Deliberately a click on the game's own start control rather than a call to
   * its start function. Each game does different work in that handler —
   * disabling the button, swapping in a spinner, reading the formation — and
   * calling past it would skip whichever parts happen to live there.
   *
   *   TSScope.play(function () { return document.getElementById('startBtn'); })
   *
   * Does nothing unless the URL asked for it with &play=1 and a scope resolved.
   */
  function play(getButton, opts) {
    if (!autostart() || !param('scope')) return false;
    // Cover the setup screen straight away.
    //
    // Clicking "Luton Town — Higher or Lower" and landing on a picker showing
    // every other club, which then flickers away on its own, reads as a
    // misfire even though the right game starts. The player already chose;
    // this hides the choosing and says what is loading.
    curtain();
    var tries = 0;
    (function attempt() {
      var btn = null;
      try { btn = getButton(); } catch (_) { btn = null; }
      // A game whose scope list is still loading has a disabled button; wait
      // for it rather than clicking a control that will refuse.
      if (btn && !btn.disabled) {
        if (!opts || opts.announce !== false) announce();
        btn.click();
        // The game replaces the setup step itself; the curtain comes down a
        // beat later so there is no flash of the picker in between.
        setTimeout(uncurtain, 350);
        return;
      }
      if (++tries < 40) { setTimeout(attempt, 100); return; }
      // Four seconds and no start button. Something is wrong or slow — show
      // the picker rather than leaving somebody on a curtain forever.
      uncurtain();
    })();
    return true;
  }

  /** Hide the page behind a "loading" panel that names what is coming. */
  function curtain() {
    if (document.getElementById('ts-curtain')) return;
    var from = sourceTeam() || sourceCompetition();
    var pretty = from
      ? from.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      : '';
    var el = document.createElement('div');
    el.id = 'ts-curtain';
    el.setAttribute('style',
      'position:fixed;inset:0;z-index:9998;display:flex;align-items:center;' +
      'justify-content:center;flex-direction:column;gap:14px;' +
      'background:var(--bg,#0B0F12);font-family:inherit;text-align:center;padding:24px');
    el.innerHTML =
      '<div style="width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.14);' +
      'border-top-color:var(--accent-cyan,#00E5FF);animation:tsSpin .8s linear infinite"></div>' +
      '<div style="font-size:1rem;font-weight:700;color:var(--text-primary,#F2F5F7)">' +
      (pretty ? pretty : 'Setting up your game') + '</div>' +
      '<div style="font-size:.83rem;color:var(--text-secondary,#9FB0BC)">Loading\u2026</div>' +
      '<style>@keyframes tsSpin{to{transform:rotate(360deg)}}</style>';
    (document.body || document.documentElement).appendChild(el);
  }

  function uncurtain() {
    var el = document.getElementById('ts-curtain');
    if (!el) return;
    el.style.transition = 'opacity .18s';
    el.style.opacity = '0';
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
  }

  /**
   * A line saying where the player came from and how to change it. Autostarting
   * without this would leave someone who followed the wrong link with no way
   * back to the picker except the browser button.
   */
  function announce() {
    if (document.getElementById('ts-scope-note')) return;
    var team = sourceTeam();
    var note = document.createElement('div');
    note.id = 'ts-scope-note';
    note.setAttribute('style',
      'max-width:900px;margin:10px auto 0;padding:8px 12px;border-radius:7px;' +
      'font-size:.8rem;line-height:1.4;background:rgba(255,255,255,.04);' +
      'color:var(--text-secondary,#9FB0BC);text-align:center');
    var here = window.location.pathname;
    var link = function (href, text) {
      return '<a style="color:var(--accent,#00E5FF)" href="' + href + '">' + text + '</a>';
    };
    var title = function (slug) {
      return slug.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    };
    // Where they came from decides what the way back should say. A daily
    // player wants the daily; somebody who chose a club wants that club.
    var comp = sourceCompetition();
    // Where they came from decides what the way back should say. Sending a
    // competition player "back to your team page" is worse than saying nothing.
    if (param('daily')) {
      note.innerHTML = 'Today\u2019s TeleStats Daily. ' + link('/daily/', 'Back to the daily') +
        (team ? ' \u00b7 ' + link('/teams/' + team + '/', title(team)) : '');
    } else if (comp) {
      note.innerHTML = 'Playing all of ' + title(comp) + '. ' +
        link('/competitions/' + comp + '/', 'Back to ' + title(comp)) + ' \u00b7 ' +
        link(here, 'Pick something else');
    } else if (team) {
      note.innerHTML = 'Started from your team page. ' +
        link('/teams/' + team + '/', 'Back to ' + title(team)) + ' \u00b7 ' +
        link(here, 'Pick a different team');
    } else {
      note.innerHTML = link(here, 'Pick a different game');
    }
    if (document.body) document.body.insertBefore(note, document.body.firstChild);
  }

  /**
   * Where the player came from, for analytics. Scalar and safe: this is a slug
   * we generated, never anything a user typed, so it can go to GA4 — unlike a
   * free-text guess or a player name.
   */
  function sourceTeam() {
    var wanted = param('scope') || '';
    var m = /^team_([a-z0-9-]+)_/.exec(wanted);
    return m ? m[1] : null;
  }

  /** The competition slug, when the round is a whole-competition one. */
  function sourceCompetition() {
    var m = /^comp_([a-z0-9-]+)$/.exec(param('scope') || '');
    return m ? m[1] : null;
  }

  window.TSScope = { requested: requested, requestedId: requestedId,
                     autostart: autostart, play: play, sourceTeam: sourceTeam,
                     param: param, variant: variant,
                     sourceCompetition: sourceCompetition,
                     curtain: curtain, uncurtain: uncurtain };
})();
