/**
 * TeleStats Analytics Module  (window.TSAnalytics)
 * ------------------------------------------------
 * Single, central integration point for Google Analytics 4.
 *
 * Load this as the FIRST script in <head> on every tracked page:
 *     <script src="/js/ts-analytics.js"></script>
 *
 * It has no dependencies and never throws — if GA4 is unavailable the whole
 * module degrades to a set of no-ops.
 *
 * ============================================================
 *  FIVES EXCLUSION  — the single source of truth
 * ============================================================
 * Any pathname beginning with one of EXCLUDED_PREFIXES receives ZERO GA4
 * tracking: gtag.js is never injected, no page_view is sent, and every
 * trackEvent() call short-circuits. Nothing else in the codebase needs to
 * know about this rule.
 *
 *   /fives    — the Fives landing page and everything beneath it
 *   /predict  — the Fives product itself (picks, history, league, admin).
 *               `/fives/` is only the marketing shell; the actual Fives
 *               pages are served from /predict/*. Both are excluded so the
 *               product is genuinely untracked.
 *
 * Fives pages also carry no <script src="/js/ts-analytics.js"> tag at all,
 * so this runtime guard is defence in depth rather than the only barrier.
 */
(function () {
  'use strict';

  var MEASUREMENT_ID = 'G-MPSNPSY3RP';

  /* Pathname prefixes that must never be tracked. Raw prefix match: a
     pathname is excluded when it *starts with* one of these strings, so
     /fives, /fives/, /fives/game/x and /fives/results?a=1#b all match. */
  var EXCLUDED_PREFIXES = ['/fives', '/predict'];

  /* Query parameters that must never reach GA4 in page_location /
     page_referrer. Supabase puts auth tokens in the URL, Stripe puts a
     checkout session id on the return URL. */
  var SENSITIVE_PARAMS = [
    'access_token', 'refresh_token', 'token', 'token_hash', 'code',
    'email', 'session_id', 'apikey', 'key', 'password'
  ];

  var MAX_PARAM_LENGTH = 100;

  // ------------------------------------------------------------------
  // Environment
  // ------------------------------------------------------------------

  function currentPath() {
    try { return window.location.pathname || '/'; } catch (e) { return '/'; }
  }

  /** True when the given pathname must receive no tracking whatsoever. */
  function isExcludedPath(path) {
    var p = String(path == null ? '' : path).toLowerCase();
    if (p.charAt(0) !== '/') p = '/' + p;
    for (var i = 0; i < EXCLUDED_PREFIXES.length; i++) {
      if (p.indexOf(EXCLUDED_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  var excluded = isExcludedPath(currentPath());

  var host = '';
  var protocol = '';
  try { host = window.location.hostname || ''; protocol = window.location.protocol || ''; } catch (e) {}

  /* Local development: never send real GA4 traffic, log to the console
     instead so events can still be verified while building. */
  var isDev = protocol === 'file:' || host === '' || host === 'localhost' ||
              host === '127.0.0.1' || host === '[::1]' || /\.local$/.test(host);

  /* ?ts_debug=1 (or localStorage.ts_debug = '1') mirrors every event to the
     console on any host. It never suppresses real sends in production. */
  var debug = isDev;
  try {
    if (window.location.search.indexOf('ts_debug=1') !== -1) debug = true;
    else if (window.localStorage && window.localStorage.getItem('ts_debug') === '1') debug = true;
  } catch (e) {}

  function log() {
    if (!debug || !window.console || !console.log) return;
    try { console.log.apply(console, ['[TSAnalytics]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  // ------------------------------------------------------------------
  // URL sanitising — no tokens, no PII in page_location / page_referrer
  // ------------------------------------------------------------------

  /** origin + pathname + safe query. The hash is always dropped. */
  function sanitizeUrl(raw) {
    if (!raw) return '';
    var u;
    try { u = new URL(raw, window.location.origin); } catch (e) { return ''; }
    try {
      for (var i = 0; i < SENSITIVE_PARAMS.length; i++) u.searchParams.delete(SENSITIVE_PARAMS[i]);
    } catch (e) {}
    return u.origin + u.pathname + (u.search || '');
  }

  // ------------------------------------------------------------------
  // Parameter hygiene
  // ------------------------------------------------------------------

  /**
   * Keep only short scalar values. Objects and arrays are dropped outright,
   * which is what stops arrays of answers or player records ever being sent.
   */
  function cleanParams(params) {
    var out = {};
    if (!params || typeof params !== 'object') return out;
    var keys;
    try { keys = Object.keys(params); } catch (e) { return out; }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = params[k];
      if (v === undefined || v === null) continue;
      if (typeof v === 'number') { if (isFinite(v)) out[k] = v; continue; }
      if (typeof v === 'boolean') { out[k] = v; continue; }
      if (typeof v === 'string') {
        var s = v.trim();
        if (!s) continue;
        out[k] = s.length > MAX_PARAM_LENGTH ? s.slice(0, MAX_PARAM_LENGTH) : s;
      }
      /* anything else (object, array, function, symbol) is silently dropped */
    }
    return out;
  }

  function merge(a, b) {
    var out = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = b[k];
    return out;
  }

  // ------------------------------------------------------------------
  // GA4 loader
  // ------------------------------------------------------------------

  var loaded = false;

  function loadGA4() {
    if (loaded || excluded) return;
    loaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

    /* In development we still define gtag() so every call site is exercised,
       but the library is not fetched and nothing is transmitted. */
    if (!isDev) {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
      var first = document.getElementsByTagName('script')[0];
      if (first && first.parentNode) first.parentNode.insertBefore(s, first);
      else (document.head || document.documentElement).appendChild(s);
    }

    window.gtag('js', new Date());

    /* One automatic page_view per page load — this is a traditional
       multi-page site, so no manual page_view is sent anywhere and there is
       nothing to duplicate. page_location/page_referrer are overridden so
       auth tokens in the URL hash or query never reach GA4. */
    var config = {
      page_location: sanitizeUrl(window.location.href)
    };
    var ref = sanitizeUrl(document.referrer);
    if (ref) config.page_referrer = ref;

    window.gtag('config', MEASUREMENT_ID, config);
    log('GA4 initialised', MEASUREMENT_ID, config, isDev ? '(dev: no network traffic)' : '');
  }

  // ------------------------------------------------------------------
  // Round bookkeeping (drives replay detection and complete de-duping)
  // ------------------------------------------------------------------

  var roundsStarted = {};   // game_type -> number of rounds begun this page
  var round = null;         // { gameType, params, completed }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  var TSAnalytics = {

    MEASUREMENT_ID: MEASUREMENT_ID,
    EXCLUDED_PREFIXES: EXCLUDED_PREFIXES.slice(),

    /** Is analytics suppressed on this page? (true on every /fives* route) */
    isExcluded: function () { return excluded; },

    /** Exposed for tests / QA. */
    isExcludedPath: isExcludedPath,

    /**
     * Send a GA4 event. Safe to call anywhere, at any time:
     *  - does nothing on excluded routes
     *  - does nothing if GA4 never loaded
     *  - never throws
     */
    trackEvent: function (eventName, params) {
      if (excluded) return false;
      if (!eventName || typeof eventName !== 'string') return false;
      var clean = cleanParams(params);
      try {
        log('event', eventName, clean);
        if (typeof window.gtag === 'function') window.gtag('event', eventName, clean);
      } catch (e) { /* analytics must never break a page */ }
      return true;
    },

    /**
     * Turn a backend scope id into controlled GA parameters.
     *   'epl_club_arsenal' -> { league: 'epl', club: 'arsenal' }
     *   'epl_alltime'      -> { league: 'epl' }
     * Anything that is not a recognised scope id (a user-authored community
     * or custom game title, for instance) returns {} so free text is never
     * forwarded.
     */
    scopeParams: function (scopeId) {
      if (typeof scopeId !== 'string') return {};
      var m = /^([a-z0-9]+)_(alltime|club_[a-z0-9_-]+)$/.exec(scopeId.trim().toLowerCase());
      if (!m) return {};
      var out = { league: m[1] };
      if (m[2].indexOf('club_') === 0) out.club = m[2].slice(5);
      return out;
    },

    /**
     * A round of play genuinely began.
     * Fires game_replay first when this is not the first round of that game
     * on this page, then game_start for the new round.
     */
    gameStart: function (gameType, params) {
      if (excluded || !gameType) return;
      var clean = cleanParams(params);
      var n = (roundsStarted[gameType] || 0) + 1;
      roundsStarted[gameType] = n;
      round = { gameType: gameType, params: clean, completed: false };
      var payload = merge({ game_type: gameType }, clean);
      if (n > 1) this.trackEvent('game_replay', payload);
      this.trackEvent('game_start', payload);
    },

    /**
     * A round genuinely finished. Fires at most once per round, so repeated
     * calls caused by re-rendering or by two code paths reaching the same
     * end state cannot double-count. Parameters recorded at game_start are
     * carried over automatically.
     */
    gameComplete: function (gameType, params) {
      if (excluded || !gameType) return;
      if (!round || round.gameType !== gameType) {
        round = { gameType: gameType, params: {}, completed: false };
      }
      if (round.completed) return;
      round.completed = true;
      this.trackEvent('game_complete', merge(merge({ game_type: gameType }, round.params), cleanParams(params)));
    },

    /** Parameters captured for the round in progress (read-only copy). */
    currentRoundParams: function () {
      return round ? merge({}, round.params) : {};
    },

    /**
     * Wrap a global start function so a genuine start emits game_start.
     * Handles both sync and async start functions and only fires once the
     * function has actually put the player into the game (via `verify`).
     *
     * @param {Object} opts
     *   {string}   opts.fn       name of the global function to wrap
     *   {string}   opts.gameType stable game_type value
     *   {Function} [opts.params] returns the parameters for this round
     *   {Function} [opts.verify] returns true if play really began
     * @returns {boolean} whether instrumentation was applied
     */
    instrumentStart: function (opts) {
      if (excluded || !opts || !opts.fn || !opts.gameType) return false;
      var orig = window[opts.fn];
      if (typeof orig !== 'function' || orig.__tsInstrumented) return false;
      var self = this;

      var wrapped = function () {
        var ret = orig.apply(this, arguments);
        var fire = function () {
          try {
            if (typeof opts.verify === 'function' && !opts.verify()) return;
            self.gameStart(opts.gameType, typeof opts.params === 'function' ? opts.params() : opts.params);
          } catch (e) { /* never let analytics break a game */ }
        };
        if (ret && typeof ret.then === 'function') ret.then(fire, function () {});
        else fire();
        return ret;
      };

      wrapped.__tsInstrumented = true;
      window[opts.fn] = wrapped;
      return true;
    }
  };

  /* Convenience for verify callbacks: is an element currently on screen? */
  TSAnalytics.visible = function (id) {
    var el = document.getElementById(id);
    return !!el && !el.classList.contains('hidden');
  };

  window.TSAnalytics = TSAnalytics;

  if (excluded) {
    /* No gtag.js, no dataLayer, no page_view. The API above stays present
       so shared modules can call it unconditionally. */
    log('excluded route — GA4 not loaded:', currentPath());
  } else {
    loadGA4();
  }
})();
