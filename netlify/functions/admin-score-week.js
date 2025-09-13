const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

// helpers
const K = (s) => String(s || '').toUpperCase();
const relId = (v) => Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
const resp = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body)
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return resp(405, 'POST only');
    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) return resp(401, 'Unauthorised');

    const { week, bumpCurrentWeekForAll } = JSON.parse(event.body || '{}');
    if (!week) return resp(400, 'week required');

    // Load data
    const [matchesAll, predsAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.predictions, 20000),
      listAll(ADALO.col.users, 5000)
    ]);

    // Week’s matches
    const matches = matchesAll
      .filter(m => Number(m['Week']) === Number(week))
      .sort((a,b)=> Number(a.id) - Number(b.id));
    if (!matches.length) return resp(400, `No matches for week ${week}`);

    // Map correct results
    const correctByMatch = Object.fromEntries(matches.map(m => [ String(m.id), K(m['Correct Result']) ]));

    // Predictions for this week
    const matchIds = new Set(matches.map(m => String(m.id)));
    const weekPreds = predsAll.filter(p => matchIds.has(String(relId(p['Match']))));

    // 1) Award per prediction (only where Points Awarded is null)
    const perUserDelta = {}; // uid -> {correct, total}
    let predictionsUpdated = 0;

    for (const p of weekPreds) {
      const uid = String(relId(p['User']));
      const mid = String(relId(p['Match']));

      if (typeof p['Points Awarded'] === 'number') continue; // already scored

      const pick = K(p['Pick']);
      const correct = correctByMatch[mid];
      const point = (pick && correct && pick === correct) ? 1 : 0;

      await adaloFetch(`${ADALO.col.predictions}/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ 'Points Awarded': point })
      });
      predictionsUpdated++;

      if (!perUserDelta[uid]) perUserDelta[uid] = { correct: 0, total: 0 };
      perUserDelta[uid].total += 1;
      perUserDelta[uid].correct += point;
    }

    // 2) Sum the week after updates to compute bonus and totals
    const awardedByUser = {};
    for (const p of weekPreds) {
      const uid = String(relId(p['User']));
      const pts = Number(p['Points Awarded'] ?? 0);
      awardedByUser[uid] = (awardedByUser[uid] || 0) + pts;
    }

    // Users who participated this week (had at least one prediction)
    const participatingUserIds = Array.from(new Set(weekPreds.map(p => String(relId(p['User'])))));

    // 3) Update user totals + bump "Current Week"
    const userUpdates = [];
    for (const uid of participatingUserIds) {
      const u = usersAll.find(x => String(x.id) === uid);
      if (!u) continue;

      // Deltas from this run only
      const addCorrect = perUserDelta[uid]?.correct || 0;
      const addIncorrect = perUserDelta[uid] ? (perUserDelta[uid].total - perUserDelta[uid].correct) : 0;

      // Bonus (simple & safe since you said you won't re-score): +5 if total correct for the week === 5
      const weeklyCorrect = awardedByUser[uid] || 0;
      const bonus = (weeklyCorrect === 5) ? 5 : 0;

      const newPoints    = Number(u['Points'] ?? 0) + addCorrect + bonus;
      const newCorrect   = Number(u['Correct Results'] ?? 0) + addCorrect;
      const newIncorrect = Number(u['Incorrect Results'] ?? 0) + addIncorrect;

      // Bump "Current Week" +1 (per-user field)
      const ck = findFieldKey(u, 'Current Week'); // tolerant to case/spacing
      const currentWeekValue = ck ? Number(u[ck] ?? week) : Number(week);
      const newCurrentWeek = currentWeekValue + 1;

      const body = {
        'Points': newPoints,
        'Correct Results': newCorrect,
        'Incorrect Results': newIncorrect
      };
      if (ck) body[ck] = newCurrentWeek; else body['Current Week'] = newCurrentWeek;

      await adaloFetch(`${ADALO.col.users}/${uid}`, { method: 'PUT', body: JSON.stringify(body) });

      userUpdates.push({
        uid,
        addPoints: addCorrect + bonus,
        addCorrect,
        addIncorrect,
        weeklyCorrect,
        currentWeek: newCurrentWeek
      });
    }

    // Optional: bump EVERYONE’s "Current Week" (you probably don't need this)
    if (bumpCurrentWeekForAll === true) {
      for (const u of usersAll) {
        const ck = findFieldKey(u, 'Current Week');
        const curr = ck ? Number(u[ck] ?? week) : Number(week);
        const body = {}; body[ck || 'Current Week'] = curr + 1;
        await adaloFetch(`${ADALO.col.users}/${u.id}`, { method: 'PUT', body: JSON.stringify(body) });
      }
    }

    return resp(200, {
      ok: true,
      week,
      predictionsUpdated,
      usersUpdated: userUpdates.length,
      detail: userUpdates
    });

  } catch (e) {
    return resp(500, e.message);
  }
};

function findFieldKey(record, needle) {
  const target = needle.toLowerCase().replace(/\s+/g,'');
  for (const k of Object.keys(record)) {
    const norm = k.toLowerCase().replace(/\s+/g,'');
    if (norm === target) return k;
  }
  return null;
}
