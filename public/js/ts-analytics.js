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

  /* Events that must fire at most once per page load. A paywall re-rendering,
     or two code paths reaching the same overlay, must not read as two people
     hitting it. */
  var seen = {};

  /* Closed vocabularies. Every value below is chosen at a call site in this
     codebase, never taken from a user, and anything not in the list becomes
     'other' rather than being sent. This is what stops a new button quietly
     introducing a new dimension — or a free-text value. */
  var PAYWALL_ACTIONS = ['signup', 'upgrade', 'day_pass', 'dismiss'];
  var SIGNUP_SOURCES = ['nav', 'paywall', 'upgrade_page', 'post_game', 'homepage', 'daily'];
  var PLANS = ['lifetime', 'day_pass'];
  var TIERS = ['anonymous', 'free', 'paid'];

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
      var id = scopeId.trim().toLowerCase();

      // Team-page scopes: team_<slug>_<competition>, where <competition> may
      // be 'all' or several joined with '+'. Both halves are values this
      // codebase generated — a slug from data/teams/slugs.json and a
      // competition slug from a fixed list — so neither can be user text.
      var t = /^team_([a-z0-9-]+)_([a-z0-9+-]+)$/.exec(id);
      if (t) {
        return {
          team: t[1],
          competition: t[2],
          // How many divisions the round covers, which is the interesting
          // question about the chip picker and is a number rather than a name.
          competition_count: t[2] === 'all' ? 0 : t[2].split('+').length,
        };
      }

      var m = /^([a-z0-9]+)_(alltime|club_[a-z0-9_-]+)$/.exec(id);
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

    /* ================================================================
     * COMMERCIAL EVENTS
     * ================================================================
     * The paywall, the account and the checkout. Named methods rather than
     * bare trackEvent() calls at each site, for two reasons: the event names
     * stay in one file where they can be read as a list, and the once-only
     * rules live with the event instead of in whichever page happens to fire
     * it.
     *
     * WHAT IS DELIBERATELY NOT HERE
     *
     * There is no `purchase` event. GA4 reserves that name for revenue, and
     * the only thing a browser can observe is somebody arriving back from
     * Stripe — a URL anybody can load, and one a paying customer may never
     * load at all if they close the tab. Revenue is recorded by
     * stripe-webhook.js against ts_payments, which is the truth. What is here
     * is `checkout_return`, which is what actually happened.
     *
     * No event below carries an email address, a name, a promo code, a Stripe
     * id or an amount. cleanParams would pass a string through, so the
     * discipline is at the call sites, and scripts/analytics/verify.js asserts
     * it.
     */

    /** Fires once per page: a limit stopped somebody playing. */
    paywallView: function (params) {
      if (excluded || seen.paywall) return;
      seen.paywall = true;
      this.trackEvent('paywall_view', params);
    },

    /**
     * What they did about it. `action` must be one of a fixed set, so a new
     * button cannot quietly start sending a new value.
     */
    paywallAction: function (action, params) {
      if (PAYWALL_ACTIONS.indexOf(action) === -1) return;
      this.trackEvent('paywall_action', merge({ action: action }, params || {}));
    },

    /**
     * The account dialog opened. `source` is where from, and it is checked
     * against a list for the same reason: these are call sites, not user input.
     */
    signupView: function (source) {
      this.trackEvent('signup_view', { source: SIGNUP_SOURCES.indexOf(source) === -1 ? 'other' : source });
    },

    /** The form was submitted and the backend accepted it. No email, ever. */
    signupSubmit: function () {
      if (seen.signup) return;
      seen.signup = true;
      this.trackEvent('signup_submit', {});
    },

    /** A confirmed account reached the site for the first time. */
    signupComplete: function () {
      if (seen.signupDone) return;
      seen.signupDone = true;
      this.trackEvent('signup_complete', {});
    },

    /** A successful sign-in. `method` is password or magic_link. */
    loginSuccess: function (method) {
      this.trackEvent('login_success', { method: method === 'magic_link' ? 'magic_link' : 'password' });
    },

    /** The upgrade page was seen. Fires once per page load. */
    upgradeView: function (tier) {
      if (excluded || seen.upgrade) return;
      seen.upgrade = true;
      this.trackEvent('upgrade_view', { tier: TIERS.indexOf(tier) === -1 ? 'unknown' : tier });
    },

    /** About to hand off to Stripe. `plan` is lifetime or day_pass. */
    checkoutStart: function (plan) {
      this.trackEvent('checkout_start', { plan: PLANS.indexOf(plan) === -1 ? 'other' : plan });
    },

    /**
     * The handoff failed. The reason is NOT sent: it comes from an exception
     * message and could carry anything, including something a user typed.
     */
    checkoutError: function (plan) {
      this.trackEvent('checkout_error', { plan: PLANS.indexOf(plan) === -1 ? 'other' : plan });
    },

    /**
     * Back from Stripe. NOT a purchase — see the note above. `status` says
     * which of the two return URLs this was.
     */
    checkoutReturn: function (plan, status) {
      if (excluded || seen.checkoutReturn) return;
      seen.checkoutReturn = true;
      this.trackEvent('checkout_return', {
        plan: PLANS.indexOf(plan) === -1 ? 'other' : plan,
        status: status === 'cancelled' ? 'cancelled' : 'returned',
      });
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
