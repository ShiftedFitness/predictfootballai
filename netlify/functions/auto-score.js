/**
 * auto-score.js
 *
 * Automated match result checker & week scorer (Supabase version).
 *
 * Flow:
 *   1. Finds the latest week that has unscored matches (missing correct_result)
 *   2. For each unscored match that has an api_fixture_id, checks football-data.org
 *      to see if the match has finished (FINISHED/AWARDED)
 *   3. If finished, determines the result (HOME/DRAW/AWAY) from the score
 *      and writes it to the predict_matches row
 *   4. Once ALL matches in the week have results, triggers the week scoring
 *      logic (same as admin-score-week)
 *
 * Scheduled via netlify.toml: runs at 7am and 10pm UTC daily.
 * Also callable as HTTP endpoint with x-admin-secret header.
 *
 * GET or POST /auto-score
 *   → { ok, week, matchesChecked, resultsSet, weekScored, ... }
 */

const { sb, respond } = require('./_supabase.js');

const FD_BASE = 'https://api.football-data.org/v4';

async function fdFetch(path) {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) throw new Error('FOOTBALL_DATA_KEY not configured');

  const url = `${FD_BASE}/${path}`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': key } });

  if (res.status === 429) throw new Error('football-data.org rate limit reached');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`football-data.org ${res.status}: ${text}`);
  }
  return res.json();
}

// football-data.org free tier = 10 req/min. Auto-score checks max 5 matches.
const delay = (ms = 6500) => new Promise(r => setTimeout(r, ms));

const U = (s) => String(s || '').trim().toUpperCase();

function resultFromScore(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 'HOME';
  if (awayGoals > homeGoals) return 'AWAY';
  return 'DRAW';
}

// ── Scoring logic (mirrors admin-score-week.js) ─────────────────────────────

async function scoreWeek(client, weekNum, matchWeekId, matches) {
  // Check all matches have results
  const allHaveResults = matches.every(m => {
    const r = U(m.correct_result);
    return ['HOME', 'DRAW', 'AWAY'].includes(r);
  });
  if (!allHaveResults) return { scored: false, reason: 'Not all matches have results yet' };

  const matchIds = matches.map(m => m.id);
  const correctByMatch = Object.fromEntries(
    matches.map(m => [String(m.id), U(m.correct_result)])
  );
  const matchIdSet = new Set(matchIds.map(String));

  // Load users
  const { data: usersAll, error: usersError } = await client
    .from('predict_users').select('*');
  if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`);
  const usersSafe = usersAll || [];

  // Guard: skip if already scored (any user has current_week > this week)
  for (const u of usersSafe) {
    const currW = Number(u.current_week || 0);
    if (currW > weekNum) {
      return { scored: false, reason: `Week ${weekNum} appears already scored (user ${u.username || u.full_name} current_week > ${weekNum})` };
    }
  }

  // Load predictions for this week (by match_id)
  const { data: predsForWeek, error: predError } = await client
    .from('predict_predictions')
    .select('*')
    .in('match_id', matchIds);
  if (predError) throw new Error(`Failed to fetch predictions: ${predError.message}`);

  const validPreds = (predsForWeek || []).filter(p => matchIdSet.has(String(p.match_id)));
  if (!validPreds.length) return { scored: false, reason: 'No predictions found for this week' };

  // Score predictions
  const statsByUser = {};
  let predictionsUpdated = 0;

  for (const p of validPreds) {
    const uid = String(p.user_id);
    const mid = String(p.match_id);
    if (!uid || !matchIdSet.has(mid)) continue;

    const pick = U(p.pick);
    const correct = correctByMatch[mid];
    const should = (pick && correct && pick === correct) ? 1 : 0;

    if (!statsByUser[uid]) statsByUser[uid] = { predCount: 0, correctCount: 0 };
    statsByUser[uid].predCount += 1;
    statsByUser[uid].correctCount += should;

    const current = (typeof p.points_awarded === 'number') ? Number(p.points_awarded) : null;
    if (current === null || current !== should) {
      const { error: updateError } = await client
        .from('predict_predictions')
        .update({ points_awarded: should })
        .eq('id', p.id);
      if (updateError) throw new Error(`Failed to update prediction: ${updateError.message}`);
      predictionsUpdated++;
    }
  }

  // Update user totals (incremental — first-time scoring)
  const updates = [];
  for (const uid of Object.keys(statsByUser)) {
    const u = usersSafe.find(x => String(x.id) === uid);
    if (!u) continue;

    const stats = statsByUser[uid];
    const weeklyCorrect = stats.correctCount;
    const bonus = (weeklyCorrect === 5) ? 5 : 0;
    const fhInc = (weeklyCorrect === 5) ? 1 : 0;
    const blankInc = (weeklyCorrect === 0) ? 1 : 0;
    const pointsToAdd = weeklyCorrect + bonus;

    const { error: userUpdateError } = await client
      .from('predict_users')
      .update({
        points: Number(u.points ?? 0) + pointsToAdd,
        correct_results: Number(u.correct_results ?? 0) + weeklyCorrect,
        incorrect_results: Number(u.incorrect_results ?? 0) + (stats.predCount - weeklyCorrect),
        full_houses: Number(u.full_houses ?? 0) + fhInc,
        blanks: Number(u.blanks ?? 0) + blankInc,
        current_week: (Number(u.current_week ?? weekNum)) + 1
      })
      .eq('id', u.id);

    if (userUpdateError) throw new Error(`Failed to update user: ${userUpdateError.message}`);
    updates.push({ uid, name: u.username || u.full_name || `User ${u.id}`, weeklyCorrect, pointsAdded: pointsToAdd, fhInc, blankInc });
  }

  return {
    scored: true,
    predictionsUpdated,
    usersUpdated: updates.length,
    fullHouseNames: updates.filter(u => u.weeklyCorrect === 5).map(u => u.name),
    blanksNames: updates.filter(u => u.weeklyCorrect === 0).map(u => u.name),
    detail: updates
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  try {
    // Netlify scheduled functions: no httpMethod. Allow unauthenticated.
    const isScheduledInvocation = !event.httpMethod;
    if (!isScheduledInvocation) {
      const secret = (event.headers?.['x-admin-secret'] || event.headers?.['X-Admin-Secret'] || '').trim();
      if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
        return respond(401, 'Unauthorised');
      }
    }

    const client = sb();

    // 1. Load all match weeks + their matches, find the latest week with unscored matches
    const { data: allWeeks, error: weeksErr } = await client
      .from('predict_match_weeks')
      .select('id, week_number')
      .order('week_number', { ascending: true });
    if (weeksErr) throw new Error(`Failed to fetch weeks: ${weeksErr.message}`);

    if (!allWeeks || !allWeeks.length) {
      return respond(200, { ok: true, message: 'No weeks found in database' });
    }

    const { data: allMatches, error: matchesErr } = await client
      .from('predict_matches')
      .select('*');
    if (matchesErr) throw new Error(`Failed to fetch matches: ${matchesErr.message}`);

    // Group matches by match_week_id → week_number
    const weekIdToNum = Object.fromEntries(allWeeks.map(w => [w.id, w.week_number]));
    const byWeek = {};
    for (const m of (allMatches || [])) {
      const wk = weekIdToNum[m.match_week_id];
      if (wk == null) continue;
      if (!byWeek[wk]) byWeek[wk] = { matches: [], matchWeekId: m.match_week_id };
      byWeek[wk].matches.push(m);
    }

    const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
    if (!weeks.length) return respond(200, { ok: true, message: 'No weeks with matches found' });

    // Find the latest week that has unscored matches
    let targetWeek = null;
    for (let i = weeks.length - 1; i >= 0; i--) {
      const w = weeks[i];
      const entry = byWeek[w];
      const hasUnscored = entry.matches.some(m => {
        const r = U(m.correct_result);
        return !['HOME', 'DRAW', 'AWAY'].includes(r);
      });
      if (hasUnscored) {
        const hasApiIds = entry.matches.some(m => m.api_fixture_id);
        if (hasApiIds) {
          targetWeek = w;
          break;
        }
      }
    }

    if (targetWeek === null) {
      return respond(200, { ok: true, message: 'All weeks are fully scored. Nothing to do.' });
    }

    const entry = byWeek[targetWeek];
    const weekMatches = entry.matches;
    const matchWeekId = entry.matchWeekId;
    const log = [];
    let resultsSetCount = 0;
    let apiCallsUsed = 0;

    // 2. For each unscored match with an api_fixture_id, check the API
    for (const m of weekMatches) {
      const existing = U(m.correct_result);
      if (['HOME', 'DRAW', 'AWAY'].includes(existing)) {
        log.push({ match: `${m.home_team} v ${m.away_team}`, status: 'already_scored', result: existing });
        continue;
      }

      const fixtureId = m.api_fixture_id;
      if (!fixtureId) {
        log.push({ match: `${m.home_team} v ${m.away_team}`, status: 'no_api_id', result: null });
        continue;
      }

      try {
        await delay();
        const fixture = await fdFetch(`matches/${fixtureId}`);
        apiCallsUsed++;

        if (!fixture || !fixture.status) {
          log.push({ match: `${m.home_team} v ${m.away_team}`, status: 'api_not_found', fixtureId });
          continue;
        }

        if (fixture.status !== 'FINISHED' && fixture.status !== 'AWARDED') {
          log.push({
            match: `${m.home_team} v ${m.away_team}`,
            status: 'not_finished',
            fixtureStatus: fixture.status,
            fixtureId
          });
          continue;
        }

        const homeGoals = fixture.score?.fullTime?.home;
        const awayGoals = fixture.score?.fullTime?.away;

        if (homeGoals == null || awayGoals == null) {
          log.push({ match: `${m.home_team} v ${m.away_team}`, status: 'no_score_data', fixtureId });
          continue;
        }

        const result = resultFromScore(homeGoals, awayGoals);

        // Write result to Supabase
        const { error: updateErr } = await client
          .from('predict_matches')
          .update({ correct_result: result, locked: true })
          .eq('id', m.id);

        if (updateErr) throw new Error(`Failed to update match: ${updateErr.message}`);

        // Update in-memory copy
        m.correct_result = result;
        resultsSetCount++;

        log.push({
          match: `${m.home_team} v ${m.away_team}`,
          status: 'result_set',
          result,
          score: `${homeGoals}-${awayGoals}`,
          fixtureId
        });

      } catch (e) {
        log.push({
          match: `${m.home_team} v ${m.away_team}`,
          status: 'api_error',
          error: e.message,
          fixtureId
        });
      }
    }

    // 3. If all matches now have results, score the week
    let weekScoringResult = null;
    const allNowScored = weekMatches.every(m => {
      const r = U(m.correct_result);
      return ['HOME', 'DRAW', 'AWAY'].includes(r);
    });

    if (allNowScored) {
      weekScoringResult = await scoreWeek(client, targetWeek, matchWeekId, weekMatches);
    }

    return respond(200, {
      ok: true,
      week: targetWeek,
      matchWeekId,
      matchesInWeek: weekMatches.length,
      matchesChecked: log.filter(l => l.status !== 'already_scored').length,
      resultsSet: resultsSetCount,
      apiCallsUsed,
      allMatchesComplete: allNowScored,
      weekScored: weekScoringResult?.scored || false,
      weekScoringDetail: weekScoringResult || null,
      log
    });

  } catch (e) {
    console.error('auto-score error:', e);
    return respond(500, e.message || 'Unknown error');
  }
};
