/**
 * auto-score.js
 *
 * Automated match result checker & week scorer.
 *
 * Flow:
 *   1. Finds the latest week in Adalo that has unscored matches
 *   2. For each unscored match that has an API Fixture ID, checks API-Football
 *      to see if the match has finished (FT/AET/PEN)
 *   3. If finished, determines the result (HOME/DRAW/AWAY) from the score
 *      and writes it to the Adalo match record
 *   4. Once ALL 5 matches in the week have results, triggers the week scoring
 *      logic (same as admin-score-week)
 *
 * Designed to be called daily via a cron/scheduler. Uses 1 football-data.org call
 * per unscored match (max 5), well within the 10/min free tier rate limit.
 *
 * Auth: x-admin-secret header required (same as other admin endpoints).
 *
 * GET or POST /auto-score
 *   → { ok, week, matchesChecked, resultsSet, weekScored, ... }
 */

const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

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

// Determine match result from final score
function resultFromScore(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 'HOME';
  if (awayGoals > homeGoals) return 'AWAY';
  return 'DRAW';
}

// ── Scoring logic (mirrors admin-score-week.js) ─────────────────────────────
const U = (s) => String(s || '').trim().toUpperCase();

function relId(v) {
  if (!v) return '';
  if (Array.isArray(v)) return v[0] ?? '';
  if (typeof v === 'object' && v.id != null) return v.id;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed[0] ?? '';
      if (typeof parsed === 'object' && parsed !== null && parsed.id != null) return parsed.id;
    } catch { /* plain string */ }
    return v;
  }
  return v;
}

function findKey(rec, label) {
  const want = label.toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
  for (const k of Object.keys(rec)) {
    const norm = k.toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
    if (norm === want) return k;
  }
  return null;
}

const nameOf = (u) => u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${u?.id ?? ''}`;

async function scoreWeek(weekNum, matchesAll) {
  const matches = matchesAll.filter(m => Number(m['Week']) === weekNum);
  if (!matches.length) return { scored: false, reason: 'No matches' };

  // Check all matches have results
  const allHaveResults = matches.every(m => {
    const r = U(m['Correct Result']);
    return ['HOME', 'DRAW', 'AWAY'].includes(r);
  });
  if (!allHaveResults) return { scored: false, reason: 'Not all matches have results yet' };

  const matchIds = new Set(matches.map(m => String(m.id)));
  const correctByMatch = Object.fromEntries(matches.map(m => [String(m.id), U(m['Correct Result'])]));

  // Load users
  const usersAll = await listAll(ADALO.col.users, 5000);
  const usersSafe = usersAll || [];

  // Guard: skip if already scored (any user has Current Week > this week)
  for (const u of usersSafe) {
    const ck = findKey(u, 'Current Week');
    if (!ck) continue;
    if (Number(u[ck] || 0) > weekNum) {
      return { scored: false, reason: `Week ${weekNum} appears already scored (user ${nameOf(u)} Current Week > ${weekNum})` };
    }
  }

  // Load predictions for this week
  let predsForWeek = [];
  try {
    const page = await adaloFetch(
      `${ADALO.col.predictions}?filterKey=Week&filterValue=${encodeURIComponent(weekNum)}`
    );
    const arr = page?.records ?? page ?? [];
    predsForWeek = (arr || []).filter(p => matchIds.has(String(relId(p['Match']))));
  } catch {
    predsForWeek = [];
  }

  if (!predsForWeek.length) {
    const predsAll = await listAll(ADALO.col.predictions, 20000);
    predsForWeek = (predsAll || []).filter(p => matchIds.has(String(relId(p['Match']))));
  }

  if (!predsForWeek.length) return { scored: false, reason: 'No predictions found for this week' };

  // Score predictions
  const statsByUser = {};
  let predictionsUpdated = 0;

  for (const p of predsForWeek) {
    const uid = String(relId(p['User']));
    const mid = String(relId(p['Match']));
    if (!uid || !matchIds.has(mid)) continue;

    const pick = U(p['Pick']);
    const correct = correctByMatch[mid];
    const should = (pick && correct && pick === correct) ? 1 : 0;

    if (!statsByUser[uid]) statsByUser[uid] = { predCount: 0, correctCount: 0 };
    statsByUser[uid].predCount += 1;
    statsByUser[uid].correctCount += should;

    const current = (typeof p['Points Awarded'] === 'number') ? Number(p['Points Awarded']) : null;
    if (current === null || current !== should) {
      await adaloFetch(`${ADALO.col.predictions}/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ 'Points Awarded': should })
      });
      predictionsUpdated++;
    }
  }

  // Update user totals
  const updates = [];
  for (const uid of Object.keys(statsByUser)) {
    const u = usersSafe.find(x => String(x.id) === uid);
    if (!u) continue;

    const stats = statsByUser[uid];
    const weeklyCorrect = stats.correctCount;
    const bonus    = (weeklyCorrect === 5) ? 5 : 0;
    const fhInc    = (weeklyCorrect === 5) ? 1 : 0;
    const blankInc = (weeklyCorrect === 0) ? 1 : 0;
    const pointsToAdd = weeklyCorrect + bonus;

    const ck = findKey(u, 'Current Week');
    const currW = ck ? Number(u[ck] ?? weekNum) : weekNum;

    const body = {
      'Points': Number(u['Points'] ?? 0) + pointsToAdd,
      'Correct Results': Number(u['Correct Results'] ?? 0) + weeklyCorrect,
      'Incorrect Results': Number(u['Incorrect Results'] ?? 0) + (stats.predCount - weeklyCorrect),
      'FH': Number(u['FH'] ?? 0) + fhInc,
      'Blanks': Number(u['Blanks'] ?? 0) + blankInc,
      [ck || 'Current Week']: currW + 1
    };

    await adaloFetch(`${ADALO.col.users}/${uid}`, { method: 'PUT', body: JSON.stringify(body) });
    updates.push({ uid, name: nameOf(u), weeklyCorrect, pointsAdded: pointsToAdd, fhInc, blankInc });
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
// Works both as:
//   - HTTP endpoint with x-admin-secret header
//   - Netlify scheduled function (no auth needed — Netlify invokes internally)
//
// Netlify scheduled functions set event.httpMethod to undefined and don't have
// normal HTTP headers. We allow unauthenticated access ONLY when the function
// is invoked by Netlify's scheduler (no httpMethod present).
exports.handler = async (event) => {
  try {
    const isScheduledInvocation = !event.httpMethod;
    if (!isScheduledInvocation) {
      const secret = (event.headers?.['x-admin-secret'] || event.headers?.['X-Admin-Secret'] || '').trim();
      if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
        return resp(401, { error: 'Unauthorised' });
      }
    }

    // 1. Load all matches, find the latest week with unscored matches
    const allMatches = await listAll(ADALO.col.matches, 2000);

    // Group by week
    const byWeek = {};
    for (const m of (allMatches || [])) {
      const w = Number(m['Week']);
      if (Number.isNaN(w)) continue;
      if (!byWeek[w]) byWeek[w] = [];
      byWeek[w].push(m);
    }

    const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
    if (!weeks.length) return resp(200, { ok: true, message: 'No weeks found in database' });

    // Find weeks that have unscored matches (missing Correct Result)
    // Start from the latest and work backwards — typically only the latest week needs checking
    let targetWeek = null;
    for (let i = weeks.length - 1; i >= 0; i--) {
      const w = weeks[i];
      const matches = byWeek[w];
      const hasUnscored = matches.some(m => {
        const r = U(m['Correct Result']);
        return !['HOME', 'DRAW', 'AWAY'].includes(r);
      });
      if (hasUnscored) {
        // Check this week has at least some matches with API Fixture IDs
        const hasApiIds = matches.some(m => m['API Fixture ID']);
        if (hasApiIds) {
          targetWeek = w;
          break;
        }
      }
    }

    if (targetWeek === null) {
      return resp(200, { ok: true, message: 'All weeks are fully scored. Nothing to do.' });
    }

    const weekMatches = byWeek[targetWeek];
    const log = [];
    let resultsSetCount = 0;
    let apiCallsUsed = 0;

    // 2. For each unscored match with an API Fixture ID, check the API
    for (const m of weekMatches) {
      const existing = U(m['Correct Result']);
      if (['HOME', 'DRAW', 'AWAY'].includes(existing)) {
        log.push({ match: `${m['Home Team']} v ${m['Away Team']}`, status: 'already_scored', result: existing });
        continue;
      }

      const fixtureId = m['API Fixture ID'];
      if (!fixtureId) {
        log.push({ match: `${m['Home Team']} v ${m['Away Team']}`, status: 'no_api_id', result: null });
        continue;
      }

      // Fetch fixture status from football-data.org
      try {
        await delay();
        const fixture = await fdFetch(`matches/${fixtureId}`);
        apiCallsUsed++;

        if (!fixture || !fixture.status) {
          log.push({ match: `${m['Home Team']} v ${m['Away Team']}`, status: 'api_not_found', fixtureId });
          continue;
        }

        if (fixture.status !== 'FINISHED' && fixture.status !== 'AWARDED') {
          log.push({
            match: `${m['Home Team']} v ${m['Away Team']}`,
            status: 'not_finished',
            fixtureStatus: fixture.status,
            fixtureId
          });
          continue;
        }

        // Match is finished — determine result
        const homeGoals = fixture.score?.fullTime?.home;
        const awayGoals = fixture.score?.fullTime?.away;

        if (homeGoals == null || awayGoals == null) {
          log.push({ match: `${m['Home Team']} v ${m['Away Team']}`, status: 'no_score_data', fixtureId });
          continue;
        }

        const result = resultFromScore(homeGoals, awayGoals);

        // Write result to Adalo
        await adaloFetch(`${ADALO.col.matches}/${m.id}`, {
          method: 'PUT',
          body: JSON.stringify({ 'Correct Result': result, 'Locked': true })
        });

        // Update our in-memory copy so the scoring check below sees it
        m['Correct Result'] = result;
        resultsSetCount++;

        log.push({
          match: `${m['Home Team']} v ${m['Away Team']}`,
          status: 'result_set',
          result,
          score: `${homeGoals}-${awayGoals}`,
          fixtureId
        });

      } catch (e) {
        log.push({
          match: `${m['Home Team']} v ${m['Away Team']}`,
          status: 'api_error',
          error: e.message,
          fixtureId
        });
      }
    }

    // 3. Check if all matches now have results — if so, score the week
    let weekScoringResult = null;
    const allNowScored = weekMatches.every(m => {
      const r = U(m['Correct Result']);
      return ['HOME', 'DRAW', 'AWAY'].includes(r);
    });

    if (allNowScored) {
      // Re-fetch matches to get latest state (our in-memory updates may be enough but let's be safe)
      const freshMatches = await listAll(ADALO.col.matches, 2000);
      weekScoringResult = await scoreWeek(targetWeek, freshMatches);
    }

    return resp(200, {
      ok: true,
      week: targetWeek,
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
    return resp(500, { error: e.message || 'Unknown error' });
  }
};

function resp(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
