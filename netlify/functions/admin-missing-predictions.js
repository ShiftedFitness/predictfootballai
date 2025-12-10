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

const { ADALO, listAll } = require('./_adalo.js');

// robust relation helper
function relId(v) {
  if (!v) return '';

  if (Array.isArray(v)) return v[0] ?? '';

  if (typeof v === 'object' && v.id != null) return v.id;

  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed[0] ?? '';
      if (typeof parsed === 'object' && parsed !== null && parsed.id != null) return parsed.id;
    } catch {
      // plain string like "55"
    }
    return v;
  }

  return v;
}

const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const displayName = (u) =>
  u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${u?.id ?? ''}`;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return respond(405, { error: 'GET only' });
    }

    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
      return respond(401, { error: 'Unauthorised' });
    }

    const q = event.queryStringParameters || {};
    const weekFilterRaw = q.week;
    const weekFilter = weekFilterRaw ? Number(weekFilterRaw) : null;

    // 1) Load matches, predictions, users
    const [matchesAll, predsAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.predictions, 20000),
      listAll(ADALO.col.users, 5000),
    ]);

    const matchesSafe = matchesAll || [];
    const predsSafe   = predsAll   || [];
    const usersSafe   = usersAll   || [];

    // expected users = all users in the table (you can refine later if needed)
    const expectedUsers = usersSafe.map(u => ({
      id: String(u.id),
      name: displayName(u),
    }));
    const expectedUserIds = new Set(expectedUsers.map(u => u.id));

    // filter matches by week if provided
    const matchesFiltered = matchesSafe
      .filter(m => {
        if (!weekFilter) return true;
        const w = Number(m['Week']);
        return !Number.isNaN(w) && w === weekFilter;
      })
      .sort((a,b)=> Number(a.id) - Number(b.id));

    // group predictions by match
    const predsByMatch = {};
    for (const p of predsSafe) {
      const mid = String(relId(p['Match']));
      if (!mid) continue;
      if (!predsByMatch[mid]) predsByMatch[mid] = [];
      predsByMatch[mid].push(p);
    }

    const matchesOut = [];
    const summaryLines = [];

    for (const m of matchesFiltered) {
      const mid = String(m.id);
      const wk  = Number(m['Week']);
      const fixture = `${m['Home Team']} v ${m['Away Team']}`;

      const predsForMatch = predsByMatch[mid] || [];

      // who has made a prediction for this match
      const havePredUserIds = new Set(
        predsForMatch.map(p => String(relId(p['User'])))
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
    return respond(500, { error: e.message || 'Unknown error' });
  }
};
