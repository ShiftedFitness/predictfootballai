/**
 * TeleStats Fives – Supabase Data Layer
 *
 * Replaces all Netlify function calls with direct Supabase queries.
 * Exposes window.PredictData with the same data shapes the existing
 * frontend pages and picks-widget expect.
 *
 * Usage:
 *   <script src="/predict/auth.js"></script>
 *   <script src="/predict/predict-data.js"></script>
 *   <script>
 *     const week = await PredictData.getWeek(5, userId);
 *   </script>
 */

(function () {
  'use strict';

  if (!window.PFAuth) {
    throw new Error('predict-data.js requires PFAuth (auth.js) to be loaded first');
  }

  /** Shorthand for the Supabase client */
  function sb() {
    return PFAuth.supabase;
  }

  /* ================================================================
     Helpers
     ================================================================ */

  /**
   * Normalise a Supabase match row into the field names the
   * picks-widget and other pages expect.
   */
  function normaliseMatch(m) {
    return {
      id:                String(m.id),
      'Week':            m.match_week_id,
      'Home Team':       m.home_team,
      'Away Team':       m.away_team,
      'Lockout Time':    m.lockout_time,
      'Locked':          m.locked,
      'Correct Result':  m.correct_result || '',
      // Enrichment
      'Prediction Home':   m.prediction_home,
      'Prediction Draw':   m.prediction_draw,
      'Prediction Away':   m.prediction_away,
      'Home Form':         m.home_form,
      'Away Form':         m.away_form,
      'H2H Summary':       m.h2h_summary,
      'Prediction Advice': m.prediction_advice,
      'Match Stats':       m.match_stats,
      'API Fixture ID':    m.api_fixture_id,
      _raw: m
    };
  }

  /**
   * Normalise a Supabase prediction row into the field names
   * the picks-widget expects.
   */
  function normalisePrediction(p, week) {
    return {
      id:               String(p.id),
      'User':           String(p.user_id),
      'Match':          String(p.match_id),
      'Pick':           p.pick,
      'Week':           week,
      'Points Awarded': p.points_awarded
    };
  }

  /**
   * Determine if a week's matches are locked (deadline passed).
   */
  function isWeekLocked(matches) {
    const now = Date.now();
    return matches.some(function (m) {
      if (m.locked) return true;
      if (m.lockout_time && new Date(m.lockout_time).getTime() <= now) return true;
      return false;
    });
  }

  /* ================================================================
     Public API
     ================================================================ */

  var PredictData = {

    /* ────────────────────────────────────────────────────────────
       getWeekMatches(week)
       Returns normalised match array for a week.
       ──────────────────────────────────────────────────────────── */
    async getWeekMatches(week) {
      var _ref = await sb()
        .from('predict_matches')
        .select('*')
        .eq('match_week_id', week)
        .order('id', { ascending: true });

      if (_ref.error) throw new Error('getWeekMatches: ' + _ref.error.message);
      return (_ref.data || []).map(normaliseMatch);
    },

    /* ────────────────────────────────────────────────────────────
       getWeek(week, userId)
       Full week payload: matches + user predictions + lock status.
       Drop-in replacement for GET /get-week.
       ──────────────────────────────────────────────────────────── */
    async getWeek(week, userId) {
      if (!week) throw new Error('week is required');
      if (!userId) throw new Error('userId is required');

      var matches = await this.getWeekMatches(week);
      if (!matches.length) {
        return { week: week, locked: false, matches: [], predictions: [], isAdmin: false };
      }

      var locked = isWeekLocked(matches.map(function (m) { return m._raw; }));

      // Fetch user's predictions
      var matchIds = matches.map(function (m) { return parseInt(m.id); });
      var _ref2 = await sb()
        .from('predict_predictions')
        .select('*')
        .eq('user_id', parseInt(userId))
        .in('match_id', matchIds);

      if (_ref2.error) throw new Error('getWeek predictions: ' + _ref2.error.message);
      var predictions = (_ref2.data || []).map(function (p) { return normalisePrediction(p, week); });

      return {
        week: week,
        locked: locked,
        matches: matches,
        predictions: predictions,
        isAdmin: PFAuth.isAdmin()
      };
    },

    /* ────────────────────────────────────────────────────────────
       getWeeks()
       Returns available weeks + recommended pick/view weeks.
       Drop-in replacement for GET /weeks.
       ──────────────────────────────────────────────────────────── */
    async getWeeks() {
      // Get all matches (need lockout info per week)
      var _ref = await sb()
        .from('predict_matches')
        .select('match_week_id, lockout_time, locked')
        .order('match_week_id', { ascending: true });

      if (_ref.error) throw new Error('getWeeks: ' + _ref.error.message);

      var matches = _ref.data || [];
      if (!matches.length) {
        return { weeks: [], latest: null, recommendedPickWeek: null, recommendedViewWeek: null, detail: [] };
      }

      // Deduplicate week numbers
      var weekSet = {};
      matches.forEach(function (m) { weekSet[m.match_week_id] = true; });
      var weekNumbers = Object.keys(weekSet).map(Number).sort(function (a, b) { return a - b; });

      var latest = weekNumbers[weekNumbers.length - 1];
      var now = Date.now();

      // Per-week lock status & earliest lockout
      var detail = weekNumbers.map(function (w) {
        var wMatches = matches.filter(function (m) { return m.match_week_id === w; });
        var lockouts = wMatches
          .map(function (m) { return m.lockout_time ? new Date(m.lockout_time).getTime() : null; })
          .filter(Boolean)
          .sort(function (a, b) { return a - b; });

        var locked = wMatches.some(function (m) { return m.locked; }) ||
                     (lockouts.length > 0 && lockouts[0] <= now);

        return {
          week: w,
          earliest: lockouts.length ? new Date(lockouts[0]).toISOString() : null,
          locked: locked
        };
      });

      var lockedWeeks = detail.filter(function (d) { return d.locked; }).map(function (d) { return d.week; });
      var recommendedPickWeek = latest;
      var recommendedViewWeek = lockedWeeks.length ? lockedWeeks[lockedWeeks.length - 1] : latest;

      return {
        weeks: weekNumbers,
        latest: latest,
        recommendedPickWeek: recommendedPickWeek,
        recommendedViewWeek: recommendedViewWeek,
        detail: detail
      };
    },

    /* ────────────────────────────────────────────────────────────
       submitPicks(userId, week, picks)
       Upsert predictions. Checks deadline first.
       Drop-in replacement for POST /submit-picks.
       picks: [ { match_id, pick } ]
       ──────────────────────────────────────────────────────────── */
    async submitPicks(userId, week, picks) {
      if (!userId || !week || !Array.isArray(picks)) {
        throw new Error('userId, week, and picks array are required');
      }

      // Verify deadline not passed
      var matches = await this.getWeekMatches(week);
      if (isWeekLocked(matches.map(function (m) { return m._raw; }))) {
        throw new Error('Deadline has passed – picks are locked.');
      }

      // Build upsert rows
      var rows = picks.map(function (p) {
        var pick = String(p.pick).toUpperCase();
        if (['HOME', 'DRAW', 'AWAY'].indexOf(pick) === -1) {
          throw new Error('Invalid pick: ' + pick);
        }
        return {
          user_id: parseInt(userId),
          match_id: parseInt(p.match_id),
          pick: pick
        };
      });

      var _ref = await sb()
        .from('predict_predictions')
        .upsert(rows, { onConflict: 'user_id,match_id' })
        .select();

      if (_ref.error) throw new Error('submitPicks: ' + _ref.error.message);
      return { ok: true, saved: (_ref.data || []).length };
    },

    /* ────────────────────────────────────────────────────────────
       getSummary(week, userId)
       Per-match pick distribution + same-combo users.
       Drop-in replacement for GET /summary.
       ──────────────────────────────────────────────────────────── */
    async getSummary(week, userId) {
      if (!week || !userId) throw new Error('week and userId required');

      var matches = await this.getWeekMatches(week);
      var matchIds = matches.map(function (m) { return parseInt(m.id); });

      // All predictions for this week
      var _ref = await sb()
        .from('predict_predictions')
        .select('*')
        .in('match_id', matchIds);

      if (_ref.error) throw new Error('getSummary: ' + _ref.error.message);
      var allPreds = _ref.data || [];

      // Per-match distribution
      var perMatch = matches.map(function (m) {
        var mid = parseInt(m.id);
        var ps = allPreds.filter(function (p) { return p.match_id === mid; });

        var count = {
          HOME: ps.filter(function (p) { return p.pick === 'HOME'; }).length,
          DRAW: ps.filter(function (p) { return p.pick === 'DRAW'; }).length,
          AWAY: ps.filter(function (p) { return p.pick === 'AWAY'; }).length
        };
        var total = count.HOME + count.DRAW + count.AWAY;

        return {
          match_id: mid,
          home_team: m['Home Team'],
          away_team: m['Away Team'],
          pct: {
            HOME: total ? Math.round(100 * count.HOME / total) : 0,
            DRAW: total ? Math.round(100 * count.DRAW / total) : 0,
            AWAY: total ? Math.round(100 * count.AWAY / total) : 0
          },
          count: count,
          total: total
        };
      });

      // Find users with same 5-pick combo (SHA-like fingerprint comparison)
      var uid = parseInt(userId);
      var sortedMatchIds = matchIds.slice().sort(function (a, b) { return a - b; });

      function fingerprint(userPreds) {
        return sortedMatchIds.map(function (mid) {
          var p = userPreds.find(function (pr) { return pr.match_id === mid; });
          return p ? p.pick.charAt(0) : '-';
        }).join('');
      }

      // Group predictions by user
      var byUser = {};
      allPreds.forEach(function (p) {
        if (!byUser[p.user_id]) byUser[p.user_id] = [];
        byUser[p.user_id].push(p);
      });

      var myFp = fingerprint(byUser[uid] || []);
      var samePickUsers = [];
      Object.keys(byUser).forEach(function (key) {
        var id = parseInt(key);
        if (id !== uid && fingerprint(byUser[id]) === myFp) {
          samePickUsers.push(String(id));
        }
      });

      return { perMatch: perMatch, samePickUsers: samePickUsers };
    },

    /* ────────────────────────────────────────────────────────────
       getLeaderboard()
       Overall season standings.
       Drop-in replacement for GET /leaderboard.
       ──────────────────────────────────────────────────────────── */
    async getLeaderboard() {
      var _ref = await sb()
        .from('predict_users')
        .select('id, username, full_name, points, correct_results, incorrect_results, full_houses, blanks')
        .order('points', { ascending: false })
        .order('full_houses', { ascending: false })
        .order('correct_results', { ascending: false });

      if (_ref.error) throw new Error('getLeaderboard: ' + _ref.error.message);

      return (_ref.data || []).map(function (u, i) {
        var total = (u.correct_results || 0) + (u.incorrect_results || 0);
        var accuracy = total > 0 ? u.correct_results / total : 0;
        return {
          id: u.id,
          name: u.username || u.full_name || ('User ' + u.id),
          points: u.points || 0,
          correct: u.correct_results || 0,
          incorrect: u.incorrect_results || 0,
          total: total,
          accuracy: accuracy,
          fh: u.full_houses || 0,
          blanks: u.blanks || 0,
          position: i + 1
        };
      });
    },

    /* ────────────────────────────────────────────────────────────
       getWeeklyTable(week)
       Per-week picks grid with results.
       Drop-in replacement for GET /weekly-table.
       ──────────────────────────────────────────────────────────── */
    async getWeeklyTable(week) {
      if (!week) throw new Error('week required');
      week = Number(week);

      var matches = await this.getWeekMatches(week);
      var rawMatches = matches.map(function (m) { return m._raw; });
      var locked = isWeekLocked(rawMatches);

      var matchIds = matches.map(function (m) { return parseInt(m.id); });

      // Get all predictions for this week
      var _ref = await sb()
        .from('predict_predictions')
        .select('*')
        .in('match_id', matchIds);

      if (_ref.error) throw new Error('getWeeklyTable: ' + _ref.error.message);
      var preds = _ref.data || [];

      // Get all users
      var _ref2 = await sb()
        .from('predict_users')
        .select('id, username, full_name');

      if (_ref2.error) throw new Error('getWeeklyTable users: ' + _ref2.error.message);
      var usersMap = {};
      (_ref2.data || []).forEach(function (u) { usersMap[u.id] = u; });

      // Group predictions by user
      var byUser = {};
      preds.forEach(function (p) {
        if (!byUser[p.user_id]) byUser[p.user_id] = [];
        byUser[p.user_id].push(p);
      });

      // Build rows
      var rows = Object.keys(byUser).map(function (uid) {
        uid = parseInt(uid);
        var userPreds = byUser[uid];
        var user = usersMap[uid];

        // Map predictions to match order
        var picksRaw = matches.map(function (m) {
          var p = userPreds.find(function (pr) { return pr.match_id === parseInt(m.id); });
          return p ? p.pick : null;
        });

        var correct = matches.map(function (m, i) {
          var cr = m['Correct Result'];
          return picksRaw[i] && cr ? picksRaw[i] === cr : false;
        });

        var points = userPreds.reduce(function (s, p) {
          return s + (p.points_awarded != null ? p.points_awarded : 0);
        }, 0);

        return {
          userId: uid,
          name: user ? (user.username || user.full_name || ('User ' + uid)) : ('User ' + uid),
          points: points,
          picksRaw: picksRaw,
          correct: correct
        };
      });

      // Sort by points desc, then name
      rows.sort(function (a, b) {
        if (b.points !== a.points) return b.points - a.points;
        return a.name.localeCompare(b.name);
      });
      rows.forEach(function (r, i) { r.pos = i + 1; });

      // Available weeks (all locked weeks)
      var weeksData = await this.getWeeks();
      var availableWeeks = (weeksData.detail || [])
        .filter(function (d) { return d.locked; })
        .map(function (d) { return d.week; })
        .sort(function (a, b) { return b - a; });

      return {
        week: week,
        locked: locked,
        rows: rows,
        matches: matches.map(function (m) {
          return {
            id: m.id,
            home: m['Home Team'],
            away: m['Away Team'],
            correct: m['Correct Result']
          };
        }),
        availableWeeks: availableWeeks
      };
    },

    /* ────────────────────────────────────────────────────────────
       getHistory(userId, viewWeek, compareId)
       Head-to-head pick comparison.
       Drop-in replacement for GET /history.
       ──────────────────────────────────────────────────────────── */
    async getHistory(userId, viewWeek, compareId) {
      if (!userId) throw new Error('userId required');

      userId = parseInt(userId);
      compareId = parseInt(compareId || '1');

      // Get all weeks info
      var weeksData = await this.getWeeks();
      var availableWeeks = (weeksData.detail || [])
        .filter(function (d) { return d.locked; })
        .map(function (d) { return d.week; })
        .sort(function (a, b) { return b - a; });

      // Default to latest locked week
      if (!viewWeek && availableWeeks.length) viewWeek = availableWeeks[0];
      viewWeek = parseInt(viewWeek) || 1;

      // Get matches for view week
      var matches = await this.getWeekMatches(viewWeek);
      var rawMatches = matches.map(function (m) { return m._raw; });
      var weekLocked = isWeekLocked(rawMatches);
      var matchIds = matches.map(function (m) { return parseInt(m.id); });

      // Get all users for compare dropdown
      var _refUsers = await sb()
        .from('predict_users')
        .select('id, username, full_name, points, correct_results, incorrect_results');

      if (_refUsers.error) throw new Error('getHistory users: ' + _refUsers.error.message);
      var allUsers = _refUsers.data || [];
      var usersMap = {};
      allUsers.forEach(function (u) { usersMap[u.id] = u; });

      // Get predictions for both users in this week
      var userIds = [userId, compareId];
      var _refPreds = await sb()
        .from('predict_predictions')
        .select('*')
        .in('match_id', matchIds)
        .in('user_id', userIds);

      if (_refPreds.error) throw new Error('getHistory predictions: ' + _refPreds.error.message);
      var preds = _refPreds.data || [];

      // Group by user
      var predsByUser = {};
      preds.forEach(function (p) {
        if (!predsByUser[p.user_id]) predsByUser[p.user_id] = {};
        predsByUser[p.user_id][p.match_id] = p;
      });

      // Build stats
      function userStats(uid) {
        var u = usersMap[uid] || {};
        var total = (u.correct_results || 0) + (u.incorrect_results || 0);
        return {
          id: uid,
          name: u.username || u.full_name || ('User ' + uid),
          points: u.points || 0,
          correct: u.correct_results || 0,
          total: total,
          accuracy: total > 0 ? u.correct_results / total : 0
        };
      }

      // Build comparison rows
      var rows = matches.map(function (m) {
        var mid = parseInt(m.id);
        var myPred = (predsByUser[userId] || {})[mid];
        var hisPred = (predsByUser[compareId] || {})[mid];
        var correct = m['Correct Result'] || null;
        var myPick = myPred ? myPred.pick : null;
        var hisPick = hisPred ? hisPred.pick : null;

        return {
          match_id: mid,
          fixture: m['Home Team'] + ' v ' + m['Away Team'],
          myPick: myPick,
          hisPick: hisPick,
          correct: correct,
          myPoint: (myPick && correct && myPick === correct) ? 1 : 0,
          hisPoint: (hisPick && correct && hisPick === correct) ? 1 : 0,
          myCorrect: !!(myPick && correct && myPick === correct)
        };
      });

      return {
        currentWeek: weeksData.latest,
        viewWeek: viewWeek,
        weekLocked: weekLocked,
        availableWeeks: availableWeeks,
        users: allUsers.map(function (u) {
          return { id: u.id, name: u.username || u.full_name || ('User ' + u.id) };
        }),
        me: userStats(userId),
        compare: userStats(compareId),
        rows: rows
      };
    },

    /* ================================================================
       ADMIN METHODS
       ================================================================ */

    /* ────────────────────────────────────────────────────────────
       seedWeek(week, lockoutTime, fixtures)
       Create match_week + matches for a new week.
       fixtures: [ { home, away, apiFixtureId?, homeForm?, awayForm?,
                     predictionHome?, predictionDraw?, predictionAway?,
                     predictionAdvice?, h2hSummary?, matchStats? } ]
       ──────────────────────────────────────────────────────────── */
    async seedWeek(week, lockoutTime, fixtures) {
      if (!week || !lockoutTime || !Array.isArray(fixtures) || fixtures.length === 0) {
        throw new Error('week, lockoutTime, and fixtures array required');
      }

      // Upsert the match_week row
      var _mw = await sb()
        .from('predict_match_weeks')
        .upsert({ id: parseInt(week), week_number: parseInt(week), status: 'open' }, { onConflict: 'id' })
        .select();
      if (_mw.error) throw new Error('seedWeek match_week: ' + _mw.error.message);

      // Build match rows
      var lockIso = new Date(lockoutTime).toISOString();
      var matchRows = fixtures.map(function (f) {
        return {
          home_team: f.home,
          away_team: f.away,
          match_week_id: parseInt(week),
          lockout_time: lockIso,
          locked: false,
          correct_result: null,
          api_fixture_id: f.apiFixtureId || null,
          home_form: f.homeForm || null,
          away_form: f.awayForm || null,
          prediction_home: f.predictionHome || null,
          prediction_draw: f.predictionDraw || null,
          prediction_away: f.predictionAway || null,
          prediction_advice: f.predictionAdvice || null,
          h2h_summary: f.h2hSummary || null,
          match_stats: f.matchStats || null
        };
      });

      var _ins = await sb()
        .from('predict_matches')
        .insert(matchRows)
        .select();
      if (_ins.error) throw new Error('seedWeek insert matches: ' + _ins.error.message);

      return { ok: true, week: week, matchesCreated: (_ins.data || []).length };
    },

    /* ────────────────────────────────────────────────────────────
       setResults(week, results)
       Set correct_result on matches and lock them.
       results: [ { match_id, correct } ]  correct = 'HOME'/'DRAW'/'AWAY'
       ──────────────────────────────────────────────────────────── */
    async setResults(week, results) {
      if (!week || !Array.isArray(results)) throw new Error('week and results required');

      var updated = 0;
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var correct = String(r.correct).toUpperCase();
        if (['HOME', 'DRAW', 'AWAY'].indexOf(correct) === -1) continue;

        var _upd = await sb()
          .from('predict_matches')
          .update({ correct_result: correct, locked: true })
          .eq('id', parseInt(r.match_id));
        if (_upd.error) throw new Error('setResults match ' + r.match_id + ': ' + _upd.error.message);
        updated++;
      }

      // Also close the match week
      await sb()
        .from('predict_match_weeks')
        .update({ status: 'closed' })
        .eq('id', parseInt(week));

      return { ok: true, updated: updated };
    },

    /* ────────────────────────────────────────────────────────────
       scoreMatch(matchId)
       Score all predictions for a single match.
       Returns count of updated predictions.
       ──────────────────────────────────────────────────────────── */
    async scoreMatch(matchId) {
      if (!matchId) throw new Error('matchId required');
      matchId = parseInt(matchId);

      // Get the match result
      var _m = await sb()
        .from('predict_matches')
        .select('id, correct_result')
        .eq('id', matchId)
        .single();
      if (_m.error) throw new Error('scoreMatch match: ' + _m.error.message);

      var correct = (_m.data.correct_result || '').toUpperCase();
      if (['HOME', 'DRAW', 'AWAY'].indexOf(correct) === -1) {
        throw new Error('Match ' + matchId + ' has no valid result set');
      }

      // Get all predictions for this match
      var _p = await sb()
        .from('predict_predictions')
        .select('id, pick')
        .eq('match_id', matchId);
      if (_p.error) throw new Error('scoreMatch predictions: ' + _p.error.message);

      var preds = _p.data || [];
      var updated = 0;

      for (var i = 0; i < preds.length; i++) {
        var pick = (preds[i].pick || '').toUpperCase();
        var pts = (pick === correct) ? 1 : 0;
        var _u = await sb()
          .from('predict_predictions')
          .update({ points_awarded: pts })
          .eq('id', preds[i].id);
        if (!_u.error) updated++;
      }

      return { ok: true, updated: updated };
    },

    /* ────────────────────────────────────────────────────────────
       scoreWeek(week, force)
       Score all predictions for a week.
       1 point per correct pick, 5 bonus for all 5 correct.
       Updates predict_predictions.points_awarded and
       predict_users.points/correct_results/incorrect_results/full_houses/blanks.
       ──────────────────────────────────────────────────────────── */
    async scoreWeek(week, force) {
      if (!week) throw new Error('week required');
      week = parseInt(week);

      // 1. Get all matches for this week with results
      var _m = await sb()
        .from('predict_matches')
        .select('id, correct_result')
        .eq('match_week_id', week);
      if (_m.error) throw new Error('scoreWeek matches: ' + _m.error.message);
      var matches = _m.data || [];

      var resultMap = {};
      matches.forEach(function (m) {
        if (m.correct_result) resultMap[m.id] = m.correct_result.toUpperCase();
      });

      var matchIds = matches.map(function (m) { return m.id; });
      if (matchIds.length === 0) throw new Error('No matches found for week ' + week);

      var allSet = matches.every(function (m) { return !!m.correct_result; });
      if (!allSet && !force) throw new Error('Not all match results set for week ' + week);

      // 2. Get all predictions for this week
      var _p = await sb()
        .from('predict_predictions')
        .select('id, user_id, match_id, pick, points_awarded')
        .in('match_id', matchIds);
      if (_p.error) throw new Error('scoreWeek predictions: ' + _p.error.message);
      var preds = _p.data || [];

      // 3. Score each prediction
      var predUpdates = [];
      preds.forEach(function (p) {
        var correct = resultMap[p.match_id];
        if (!correct) return;
        var pick = (p.pick || '').toUpperCase();
        var pts = (pick === correct) ? 1 : 0;
        predUpdates.push({ id: p.id, user_id: p.user_id, points_awarded: pts });
      });

      for (var i = 0; i < predUpdates.length; i++) {
        var pu = predUpdates[i];
        await sb()
          .from('predict_predictions')
          .update({ points_awarded: pu.points_awarded })
          .eq('id', pu.id);
      }

      // 4. Aggregate per-user stats for this week
      var affectedUserIds = [];
      predUpdates.forEach(function (u) {
        if (affectedUserIds.indexOf(u.user_id) === -1) affectedUserIds.push(u.user_id);
      });

      // 5. Get user names for reporting
      var nameMap = {};
      if (affectedUserIds.length > 0) {
        var _names = await sb()
          .from('predict_users')
          .select('id, username, full_name')
          .in('id', affectedUserIds);
        if (!_names.error && _names.data) {
          _names.data.forEach(function (u) { nameMap[u.id] = u.username || u.full_name || ('User ' + u.id); });
        }
      }

      // 6. Determine FH/blanks for this week
      var weekUserStats = {};
      predUpdates.forEach(function (u) {
        if (!weekUserStats[u.user_id]) weekUserStats[u.user_id] = { correct: 0, total: 0 };
        weekUserStats[u.user_id].total++;
        if (u.points_awarded === 1) weekUserStats[u.user_id].correct++;
      });

      var fullHouseNames = [];
      var blanksNames = [];

      Object.keys(weekUserStats).forEach(function (uid) {
        var s = weekUserStats[uid];
        if (s.total === 5 && s.correct === 5) {
          fullHouseNames.push(nameMap[parseInt(uid)] || ('User ' + uid));
        }
        if (s.total >= 5 && s.correct === 0) {
          blanksNames.push(nameMap[parseInt(uid)] || ('User ' + uid));
        }
      });

      // 7. Recalculate all-time totals for each affected user
      for (var j = 0; j < affectedUserIds.length; j++) {
        var uid = affectedUserIds[j];

        var _allPreds = await sb()
          .from('predict_predictions')
          .select('points_awarded, match_id, predict_matches(match_week_id)')
          .eq('user_id', uid)
          .not('points_awarded', 'is', null);

        if (_allPreds.error) continue;

        var allUserPreds = _allPreds.data || [];
        var totalPoints = 0;
        var totalCorrect = 0;
        var totalIncorrect = 0;
        var weekGroups = {};

        allUserPreds.forEach(function (p) {
          totalPoints += (p.points_awarded || 0);
          if (p.points_awarded === 1) totalCorrect++;
          else totalIncorrect++;

          var pWeek = p.predict_matches ? p.predict_matches.match_week_id : null;
          if (pWeek == null) return;
          if (!weekGroups[pWeek]) weekGroups[pWeek] = { correct: 0, total: 0 };
          weekGroups[pWeek].total++;
          if (p.points_awarded === 1) weekGroups[pWeek].correct++;
        });

        var userFullHouses = 0;
        var userBlanks = 0;
        Object.keys(weekGroups).forEach(function (wk) {
          var g = weekGroups[wk];
          if (g.total === 5 && g.correct === 5) {
            userFullHouses++;
            totalPoints += 5;
          }
          if (g.total >= 5 && g.correct === 0) userBlanks++;
        });

        await sb()
          .from('predict_users')
          .update({
            points: totalPoints,
            correct_results: totalCorrect,
            incorrect_results: totalIncorrect,
            full_houses: userFullHouses,
            blanks: userBlanks
          })
          .eq('id', uid);
      }

      return {
        ok: true,
        week: week,
        predictionsScored: predUpdates.length,
        fullHouseNames: fullHouseNames,
        blanksNames: blanksNames
      };
    },

    /* ────────────────────────────────────────────────────────────
       getMissingPredictions(week)
       Returns users who haven't submitted picks for a given week.
       ──────────────────────────────────────────────────────────── */
    async getMissingPredictions(week) {
      if (!week) throw new Error('week required');
      week = parseInt(week);

      var _m = await sb()
        .from('predict_matches')
        .select('id, home_team, away_team')
        .eq('match_week_id', week);
      if (_m.error) throw new Error('getMissingPredictions matches: ' + _m.error.message);
      var matches = _m.data || [];
      var matchIds = matches.map(function (m) { return m.id; });

      var _u = await sb()
        .from('predict_users')
        .select('id, username, full_name');
      if (_u.error) throw new Error('getMissingPredictions users: ' + _u.error.message);
      var allUsers = _u.data || [];

      var _p = await sb()
        .from('predict_predictions')
        .select('user_id, match_id')
        .in('match_id', matchIds);
      if (_p.error) throw new Error('getMissingPredictions predictions: ' + _p.error.message);
      var preds = _p.data || [];

      var matchResults = matches.map(function (m) {
        var predUserIds = preds
          .filter(function (p) { return p.match_id === m.id; })
          .map(function (p) { return p.user_id; });

        var missing = allUsers.filter(function (u) {
          return predUserIds.indexOf(u.id) === -1;
        });

        return {
          matchId: m.id,
          fixture: m.home_team + ' v ' + m.away_team,
          predictionsCount: predUserIds.length,
          expectedUsers: allUsers.length,
          missingCount: missing.length,
          missingUsers: missing.map(function (u) {
            return { id: u.id, name: u.username || u.full_name || ('User ' + u.id) };
          })
        };
      });

      return { week: week, expectedUsers: allUsers.length, matches: matchResults };
    },

    /* ────────────────────────────────────────────────────────────
       getPredictionsByMatch(matchIds)
       Returns all predictions for given match IDs (admin inspector).
       ──────────────────────────────────────────────────────────── */
    async getPredictionsByMatch(matchIds) {
      if (!matchIds) throw new Error('matchIds required');

      var ids;
      if (typeof matchIds === 'string') {
        ids = matchIds.split(',').map(function (s) { return parseInt(s.trim()); }).filter(function (n) { return !isNaN(n); });
      } else {
        ids = matchIds.map(function (n) { return parseInt(n); });
      }
      if (ids.length === 0) throw new Error('No valid match IDs');

      var _p = await sb()
        .from('predict_predictions')
        .select('id, user_id, match_id, pick, points_awarded, predict_matches(match_week_id)')
        .in('match_id', ids)
        .order('match_id', { ascending: true });
      if (_p.error) throw new Error('getPredictionsByMatch: ' + _p.error.message);
      var preds = _p.data || [];

      var userIds = [];
      preds.forEach(function (p) {
        if (userIds.indexOf(p.user_id) === -1) userIds.push(p.user_id);
      });

      var nameMap = {};
      if (userIds.length > 0) {
        var _u = await sb()
          .from('predict_users')
          .select('id, username, full_name')
          .in('id', userIds);
        if (!_u.error && _u.data) {
          _u.data.forEach(function (u) {
            nameMap[u.id] = u.username || u.full_name || ('User ' + u.id);
          });
        }
      }

      var rows = preds.map(function (p) {
        return {
          id: p.id,
          userId: p.user_id,
          userName: nameMap[p.user_id] || ('User ' + p.user_id),
          matchId: p.match_id,
          pick: p.pick,
          week: p.predict_matches ? p.predict_matches.match_week_id : null,
          pointsAwarded: p.points_awarded
        };
      });

      return { requestedMatchIds: ids, total: rows.length, rows: rows };
    }
  };

  // Expose globally
  window.PredictData = PredictData;
})();
