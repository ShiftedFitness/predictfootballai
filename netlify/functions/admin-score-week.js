// netlify/functions/admin-score-week.js
//
// Re-scores a single week:
// - Recomputes Points Awarded for each prediction in that week
// - For each user who made predictions in that week, adds weekly points,
//   full_houses and blanks (0-correct weeks).
//
// Request:
//   POST with header x-admin-secret
//   Body: { "week": 12, "force": true }
//
// Response:
//   { ok:true, week:12, predictionsUpdated:..., usersUpdated:..., ... }

const { sb, respond, requireAdmin, handleOptions } = require('./_supabase.js');

const U = (s) => String(s || '').trim().toUpperCase();

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    if (event.httpMethod !== 'POST') return respond(405, 'POST only');

    const adminErr = await requireAdmin(event);
    if (adminErr) return adminErr;

    const { week, force } = JSON.parse(event.body || '{}');
    if (!week) return respond(400, 'week required');

    const weekNum = Number(week);
    const FORCE_OVERRIDE = process.env.FORCE_SCORE_WEEK === 'true';
    const allowForce = !!force || FORCE_OVERRIDE;

    const client = sb();

    // 1) Load matches + users
    const [
      { data: matchesAll, error: matchError },
      { data: usersAll, error: usersError }
    ] = await Promise.all([
      client.from('predict_matches').select('*'),
      client.from('predict_users').select('*')
    ]);

    if (matchError) throw new Error(`Failed to fetch matches: ${matchError.message}`);
    if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`);

    const matches = (matchesAll || [])
      .filter(m => Number(m.week_number) === weekNum)
      .sort((a, b) => Number(a.id) - Number(b.id));

    if (!matches.length) {
      return respond(400, `No matches for week ${weekNum}`);
    }

    const usersSafe = usersAll || [];

    const isWeekLocked = (wk, allMatches) => {
      const ms = (allMatches || []).filter(m => Number(m.week_number) === Number(wk));
      if (!ms.length) return false;
      const earliest = ms
        .map(m => m.lockout_time ? new Date(m.lockout_time) : null)
        .filter(Boolean)
        .sort((a, b) => a - b)[0];
      const now = new Date();
      return (earliest && now >= earliest) || ms.some(m => m.locked === true);
    };

    // Guard: prevent accidental double-scoring (unless forced)
    if (!allowForce) {
      const scoredUsers = [];
      for (const u of usersSafe) {
        const currW = Number(u.current_week || 0);
        if (currW > weekNum) {
          scoredUsers.push(u.username || u.full_name || `User ${u.id}`);
        }
      }

      if (scoredUsers.length > 0) {
        return respond(200, {
          ok: true,
          week: weekNum,
          predictionsUpdated: 0,
          usersUpdated: 0,
          fullHouseNames: [],
          blanksNames: [],
          detail: [
            `Week ${weekNum} appears already scored for at least one user (Current Week > ${weekNum}).`,
            'To rescore anyway, send { "force": true } in the body or set FORCE_SCORE_WEEK=true.'
          ]
        });
      }
    }

    // 2) Matches + correct results
    const correctByMatch = Object.fromEntries(
      matches.map(m => [String(m.id), U(m.correct_result)])
    );
    const matchIds = new Set(matches.map(m => String(m.id)));

    // 3) Load predictions for THIS week
    const { data: predsForWeek, error: predError } = await client
      .from('predict_predictions')
      .select('*')
      .eq('week_number', weekNum);

    if (predError) throw new Error(`Failed to fetch predictions: ${predError.message}`);

    const validPreds = (predsForWeek || []).filter(p =>
      matchIds.has(String(p.match_id))
    );

    // 4) Recompute Points Awarded *and* collect per-user stats
    let predictionsUpdated = 0;

    // statsByUser: uid -> { predCount, correctCount }
    const statsByUser = {};

    for (const p of validPreds) {
      const uid = String(p.user_id);
      const mid = String(p.match_id);
      if (!uid || !matchIds.has(mid)) continue;

      const pick = U(p.pick);
      const correct = correctByMatch[mid];
      const should = (pick && correct && pick === correct) ? 1 : 0;

      // stats
      if (!statsByUser[uid]) {
        statsByUser[uid] = { predCount: 0, correctCount: 0 };
      }
      statsByUser[uid].predCount += 1;
      statsByUser[uid].correctCount += should;

      // update Points Awarded if needed
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

    const participatingUserIds = Object.keys(statsByUser);

    // 5) Update users
    const updates = [];

    for (const uid of participatingUserIds) {
      const u = usersSafe.find(x => String(x.id) === uid);
      if (!u) continue;

      const stats = statsByUser[uid];
      const weeklyCorrectFinal = stats.correctCount;  // 0..5
      const bonus = (weeklyCorrectFinal === 5) ? 5 : 0;
      const fhInc = (weeklyCorrectFinal === 5) ? 1 : 0;
      const blankInc = (weeklyCorrectFinal === 0) ? 1 : 0;  // played but 0 correct

      const pointsToAdd = weeklyCorrectFinal + bonus;

      const newPoints = Number(u.points ?? 0) + pointsToAdd;
      const newCorrect = Number(u.correct_results ?? 0) + weeklyCorrectFinal;
      const newIncorrect = Number(u.incorrect_results ?? 0) + (stats.predCount - weeklyCorrectFinal);
      const newFH = Number(u.full_houses ?? 0) + fhInc;
      const newBlanks = Number(u.blanks ?? 0) + blankInc;
      const newCurrentWeek = (Number(u.current_week ?? weekNum)) + 1;

      const { error: userUpdateError } = await client
        .from('predict_users')
        .update({
          points: newPoints,
          correct_results: newCorrect,
          incorrect_results: newIncorrect,
          full_houses: newFH,
          blanks: newBlanks,
          current_week: newCurrentWeek
        })
        .eq('id', u.id);

      if (userUpdateError) throw new Error(`Failed to update user: ${userUpdateError.message}`);

      updates.push({
        uid,
        name: u.username || u.full_name || `User ${u.id}`,
        weeklyCorrectFinal,
        bonusApplied: bonus,
        pointsAdded: pointsToAdd,
        fhInc,
        blankInc,
        newFH,
        newBlanks
      });
    }

    const fullHouseNames = updates.filter(u => u.weeklyCorrectFinal === 5).map(u => u.name);
    const blanksNames = updates.filter(u => u.weeklyCorrectFinal === 0).map(u => u.name);

    return respond(200, {
      ok: true,
      week: weekNum,
      predictionsUpdated,
      usersUpdated: updates.length,
      fullHouseNames,
      blanksNames,
      detail: updates,
      debug: {
        week: weekNum,
        matchesForWeek: matches.length,
        matchIds: matches.map(m => m.id),
        predsForWeekCount: validPreds.length,
        usersTotal: usersSafe.length
      }
    });
  } catch (e) {
    console.error('admin-score-week error:', e);
    return respond(500, e.message || 'Unknown error');
  }
};
