/**
 * ts-streak.js — daily streaks, and the grid you share.
 *
 * LOCAL FIRST, AND ON PURPOSE.
 *
 * A streak that requires an account is a streak nobody starts. Everything here
 * lives in localStorage, works signed out, works offline, and is never sent
 * anywhere. The account prompt appears once there is genuinely something to
 * lose — see PROMPT_AT — and never before, because asking somebody to register
 * to protect a one-day streak is asking them to register for nothing.
 *
 * When they do sign in, TSStreak.pending() hands over the local history so it
 * can be merged rather than thrown away.
 *
 * THE SHARE GRID IS SPOILER-SAFE.
 *
 * Blocks, never names. A shared result says how somebody did and which club it
 * was about; it can never say who the mystery player was or which letters they
 * got. That is not a nicety — it is the whole reason a share is worth posting:
 * the person who sees it can still play.
 *
 * Exposed as window.TSStreak. No dependencies.
 */
(function () {
  'use strict';

  var KEY = 'ts_daily_v1';
  var MAX_HISTORY = 400;          // just over a year; bounded on purpose
  var PROMPT_AT = 3;              // days before an account is worth mentioning
  var DAY_MS = 86400000;

  // ── storage ───────────────────────────────────────────────────────────────
  // Every read and write is wrapped: a private window throws on access, and a
  // streak feature that breaks the page in private browsing is worse than one
  // that quietly does not remember.
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var d = raw ? JSON.parse(raw) : null;
      if (!d || typeof d !== 'object') return { days: {}, longest: 0 };
      if (!d.days || typeof d.days !== 'object') d.days = {};
      return d;
    } catch (_) {
      return { days: {}, longest: 0 };
    }
  }

  function save(d) {
    try {
      // Trim oldest first so the object cannot grow without limit.
      var keys = Object.keys(d.days).sort();
      while (keys.length > MAX_HISTORY) delete d.days[keys.shift()];
      localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch (_) {
      return false;
    }
  }

  function utcDate(offsetDays) {
    return new Date(Date.now() + (offsetDays || 0) * DAY_MS).toISOString().slice(0, 10);
  }

  function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  function shift(dateStr, days) {
    return new Date(Date.parse(dateStr + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
  }

  // ── the streak ────────────────────────────────────────────────────────────

  /**
   * Counted BACK FROM TODAY, or from yesterday if today is not played yet.
   *
   * The distinction matters and is the thing most implementations get wrong:
   * at 9am, having played every day for a week, the streak is 7 and not 0.
   * It only breaks once yesterday goes unplayed too.
   */
  function current(d) {
    d = d || load();
    var cursor = utcDate(0);
    if (!d.days[cursor]) {
      cursor = shift(cursor, -1);
      if (!d.days[cursor]) return 0;
    }
    var n = 0;
    while (d.days[cursor]) { n++; cursor = shift(cursor, -1); }
    return n;
  }

  function get() {
    var d = load();
    var cur = current(d);
    var today = utcDate(0);
    return {
      current: cur,
      longest: Math.max(d.longest || 0, cur),
      playedToday: Boolean(d.days[today]),
      today: d.days[today] || null,
      total: Object.keys(d.days).length,
      // Should the page mention making an account? Only once there is
      // something worth saving, and only while signed out.
      worthSaving: cur >= PROMPT_AT,
    };
  }

  /**
   * File a completed daily.
   *
   * `result` is the shape a game already produces — score, correct_answers,
   * total_questions and so on. It is stored so the share grid can be rebuilt
   * later, and it never leaves the browser.
   */
  function record(dateStr, gameKey, result) {
    var date = isDate(dateStr) ? dateStr : utcDate(0);
    var d = load();
    // First result of the day wins. Replaying the daily to improve a score
    // would make every shared grid meaningless.
    if (d.days[date]) return get();
    d.days[date] = {
      game: String(gameKey || '').slice(0, 24),
      score: Number(result && result.score) || 0,
      correct: Number(result && result.correct_answers) || 0,
      total: Number(result && result.total_questions) || 0,
      perfect: Boolean(result && result.is_perfect_round),
      guesses: Number(result && result.guesses_used) || 0,
      named: Number(result && result.players_named) || 0,
      team: String((result && result.team) || '').slice(0, 60),
    };
    d.longest = Math.max(d.longest || 0, current(d));
    save(d);
    return get();
  }

  /** The last N days as { date, played, game }, oldest first — for a calendar. */
  function history(days) {
    var d = load();
    var n = Math.max(1, Math.min(MAX_HISTORY, days || 14));
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var date = utcDate(-i);
      out.push({ date: date, played: Boolean(d.days[date]), game: (d.days[date] || {}).game || null });
    }
    return out;
  }

  /** Everything held locally, for merging into an account on sign-in. */
  function pending() {
    var d = load();
    return { days: d.days, longest: d.longest || 0, current: current(d) };
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (_) { /* nothing to do */ }
  }

  // ── the share grid ────────────────────────────────────────────────────────

  var FULL = '🟩';      // green
  var HALF = '🟨';      // yellow
  var MISS = '⬜';            // white
  var FIRE = '🔥';

  /**
   * A row of blocks standing for how the round went. Never the answers.
   *
   * Each game gets the shape that actually reads: 26 for the alphabet because
   * that is the puzzle, five for Who Am I because the clues are the puzzle,
   * and a capped run for Higher or Lower because the streak has no ceiling.
   */
  function grid(gameKey, r) {
    r = r || {};
    var row = function (filled, total, cap) {
      var n = Math.min(total, cap || total);
      var scale = total > n ? n / total : 1;
      var f = Math.round((filled || 0) * scale);
      return new Array(n).fill(MISS).map(function (m, i) { return i < f ? FULL : m; }).join('');
    };

    switch (gameKey) {
      case 'alpha':
        // 26 blocks is too wide for a phone; two rows of 13.
        var letters = new Array(26).fill(MISS)
          .map(function (m, i) { return i < (r.correct || 0) ? FULL : m; });
        return letters.slice(0, 13).join('') + '\n' + letters.slice(13).join('');
      case 'quiz':
        return row(r.correct, r.total || 10);
      case 'xi':
        return row(r.named, 11);
      case 'whoami':
        // Fewer clues used is better, so the blocks run the other way: a green
        // for each clue NOT needed.
        var used = Math.max(1, Math.min(5, r.guesses || 5));
        return new Array(5).fill(MISS)
          .map(function (m, i) { return i < (5 - used + 1) ? FULL : m; }).join('');
      case 'hol':
        var s = r.score || 0;
        if (!s) return MISS;
        var shown = Math.min(20, s);
        return new Array(shown).fill(FULL).join('') + (s > 20 ? ' +' + (s - 20) : '');
      default:
        return r.perfect ? FULL : (r.score ? HALF : MISS);
    }
  }

  /**
   * The text somebody pastes.
   *
   * Names the club and the game and shows the grid. Never a player, never a
   * letter, never an answer — whoever reads it can still play the same day.
   */
  function shareText(dateStr, gameName, teamLabel, gameKey, r, streak) {
    var lines = [
      'TeleStats Daily · ' + (dateStr || utcDate(0)),
      gameName + ' — ' + teamLabel,
      '',
      grid(gameKey, r || {}),
    ];
    if (streak > 1) lines.push('', FIRE + ' ' + streak + ' day streak');
    lines.push('', 'telestats.net/daily/');
    return lines.join('\n');
  }

  window.TSStreak = {
    get: get, record: record, history: history, pending: pending, clear: clear,
    grid: grid, shareText: shareText, utcDate: utcDate,
    PROMPT_AT: PROMPT_AT, STORAGE_KEY: KEY,
  };
})();
