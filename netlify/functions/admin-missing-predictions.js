// netlify/functions/admin-missing-predictions.js
//
// Report, for each match (optionally in a given week), which users
// do NOT have predictions for that match.
//
// Usage:
//   GET /.netlify/functions/admin-missing-predictions
//     ?week=11              (optional)
//   Headers:
//     x-admin-secret: YOUR_ADMIN_SECRET
//
// Response example:
//   {
//     ok: true,
//     weekFilter: 11,
//     expectedUsers: 24,
//     matches: [
//       {
//         matchId: "55",
//         week: 11,
//         fixture: "Team A v Team B",
//         predictionsCount: 23,
//         missingCount: 1,
//         missingUsers: [{ id: "4", name: "Babz" }],
//         summary: "Match 55 (Week 11, Team A v Team B): 23/24 predictions – missing 1 (userIds: 4)"
//       },
//       ...
//     ],
//     summaryLines: [
//       "Match 55 ...",
//       "Match 56 ..."
//     ]
//   }

const { sb, respond, requireAdmin, handleOptions } = require('./_supabase.js');

const displayName = (u) =>
  u?.username || u?.full_name || `User ${u?.id ?? ''}`;

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    if (event.httpMethod !== 'GET') {
      return respond(405, 'GET only');
    }

    const adminErr = requireAdmin(event);
    if (adminErr) return adminErr;

    const q = event.queryStringParameters || {};
    const weekFilterRaw = q.week;
    const weekFilter = weekFilterRaw ? Number(weekFilterRaw) : null;

    const client = sb();

    // 1) Load matches, predictions, users
    const [
      { data: matchesAll, error: matchError },
      { data: predsAll, error: predError },
      { data: usersAll, error: usersError }
    ] = await Promise.all([
      client.from('predict_matches').select('*'),
      client.from('predict_predictions').select('*'),
      client.from('predict_users').select('*')
    ]);

    if (matchError) throw new Error(`Failed to fetch matches: ${matchError.message}`);
    if (predError) throw new Error(`Failed to fetch predictions: ${predError.message}`);
    if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`);

    const matchesSafe = matchesAll || [];
    const predsSafe = predsAll || [];
    const usersSafe = usersAll || [];

    // expected users = all users in the table
    const expectedUsers = usersSafe.map(u => ({
      id: String(u.id),
      name: displayName(u),
    }));
    const expectedUserIds = new Set(expectedUsers.map(u => u.id));

    // filter matches by week if provided
    const matchesFiltered = matchesSafe
      .filter(m => {
        if (!weekFilter) return true;
        const w = Number(m.week_number);
        return !Number.isNaN(w) && w === weekFilter;
      })
      .sort((a, b) => Number(a.id) - Number(b.id));

    // group predictions by match
    const predsByMatch = {};
    for (const p of predsSafe) {
      const mid = String(p.match_id);
      if (!mid) continue;
      if (!predsByMatch[mid]) predsByMatch[mid] = [];
      predsByMatch[mid].push(p);
    }

    const matchesOut = [];
    const summaryLines = [];

    for (const m of matchesFiltered) {
      const mid = String(m.id);
      const wk = Number(m.week_number);
      const fixture = `${m.home_team} v ${m.away_team}`;

      const predsForMatch = predsByMatch[mid] || [];

      // who has made a prediction for this match
      const havePredUserIds = new Set(
        predsForMatch.map(p => String(p.user_id))
      );

      // who is missing
      const missingUsers = expectedUsers.filter(u => !havePredUserIds.has(u.id));
      const predictionsCount = havePredUserIds.size;
      const missingCount = missingUsers.length;

      let summary;
      if (missingCount === 0) {
        summary = `Match ${mid} (Week ${wk}, ${fixture}): ${predictionsCount}/${expectedUsers.length} predictions – no-one missing`;
      } else {
        const idsStr = missingUsers.map(u => u.id).join(', ');
        summary = `Match ${mid} (Week ${wk}, ${fixture}): ${predictionsCount}/${expectedUsers.length} predictions – missing ${missingCount} (userIds: ${idsStr})`;
      }

      matchesOut.push({
        matchId: mid,
        week: wk,
        fixture,
        predictionsCount,
        expectedUsers: expectedUsers.length,
        missingCount,
        missingUsers,
        summary,
      });
      summaryLines.push(summary);
    }

    return respond(200, {
      ok: true,
      weekFilter: weekFilter,
      expectedUsers: expectedUsers.length,
      matchCount: matchesOut.length,
      matches: matchesOut,
      summaryLines,
    });
  } catch (e) {
    console.error('admin-missing-predictions error:', e);
    return respond(500, e.message || 'Unknown error');
  }
};
