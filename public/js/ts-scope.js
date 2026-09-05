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
    if (!wanted || !Array.isArray(scopes)) return null;
    for (var i = 0; i < scopes.length; i++) {
      if (scopes[i] && scopes[i].id === wanted) return scopes[i];
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

  /** Should the game start on its own? Team pages can pass &play=1. */
  function autostart() {
    return param('play') === '1';
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

  window.TSScope = { requested: requested, requestedId: requestedId,
                     autostart: autostart, sourceTeam: sourceTeam, param: param };
})();
