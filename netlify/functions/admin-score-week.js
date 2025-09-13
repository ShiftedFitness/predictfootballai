const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

// helpers
const K = (s) => String(s || '').toUpperCase();
const relId = (v) => Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
const resp = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body)
});
const nameOf = (u) => u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${u?.id ?? ''}`;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return resp(405, 'POST only');
    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) return resp(401, 'Unauthorised');

    const { week } = JSON.parse(event.body || '{}');
    if (!week) return resp(400, 'week required');

    const [matchesAll, predsAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.predictions, 20000),
      listAll(ADALO.col.users, 5000)
    ]);

    const matches = matchesAll
      .filter(m => Number(m['Week']) === Number(week))
      .sort((a,b)=> Number(a.id) - Number(b.id));
    if (!matches.length) return resp(400, `No matches for week ${week}`);

    const correctByMatch = Object.fromEntries(matches.map(m => [ String(m.id), K(m['Correct Result']) ]));

    const matchIds = new Set(matches.map(m => String(m.id)));
    const weekPreds = predsAll.filter(p => matchIds.has(String(relId(p['Match']))));

    // pre-run awarded points per user
    const preAwardedByUser = {};
    for (const p of weekPreds) {
      const uid = String(relId(p['User']));
      const pts = Number(p['Points Awarded'] ?? 0);
      preAwardedByUser[uid] = (preAwardedByUser[uid] || 0) + pts;
    }

    const perUserDelta = {};
    let predictionsUpdated = 0;

    for (const p of weekPreds) {
      const uid = String(relId(p['User']));
      const mid = String(relId(p['Match']));
      if (typeof p['Points Awarded'] === 'number') continue;

      const pick = K(p['Pick']);
      const correct = correctByMatch[mid];
      const point = (pick && correct && pick === correct) ? 1 : 0;

      await adaloFetch(`${ADALO.col.predictions}/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ 'Points Awarded': point })
      });
      predictionsUpdated++;

      if (!perUserDelta[uid]) perUserDelta[uid] = { correct: 0, total: 0 };
      perUserDelta[uid].total   += 1;
      perUserDelta[uid].correct += point;
    }

    const participatingUserIds = Array.from(new Set(weekPreds.map(p => String(relId(p['User'])))));
    const userUpdates = [];
    const fullHouseUserIds = [];  // <- NEW

    for (const uid of participatingUserIds) {
      const u = usersAll.find(x => String(x.id) === uid);
      if (!u) continue;

      const addCorrect   = perUserDelta[uid]?.correct || 0;
      const addIncorrect = perUserDelta[uid] ? (perUserDelta[uid].total - perUserDelta[uid].correct) : 0;

      const weeklyCorrectTotal = (preAwardedByUser[uid] || 0) + addCorrect;

      // +5 bonus for 5/5 after this run
      const bonus = (weeklyCorrectTotal === 5) ? 5 : 0;
      if (bonus === 5) fullHouseUserIds.push(uid); // <- NEW: collect full houses

      const newPoints    = Number(u['Points'] ?? 0) + addCorrect + bonus;
      const newCorrect   = Number(u['Correct Results'] ?? 0) + addCorrect;
      const newIncorrect = Number(u['Incorrect Results'] ?? 0) + addIncorrect;

      const ck = findFieldKey(u, 'Current Week');
      const currentWeekValue = ck ? Number(u[ck] ?? week) : Number(week);
      const newCurrentWeek = currentWeekValue + 1;

      const body = { 'Points': newPoints, 'Correct Results': newCorrect, 'Incorrect Results': newIncorrect };
      if (ck) body[ck] = newCurrentWeek; else body['Current Week'] = newCurrentWeek;

      await adaloFetch(`${ADALO.col.users}/${uid}`, { method: 'PUT', body: JSON.stringify(body) });

      userUpdates.push({
        uid,
        name: nameOf(u),                          // <- include name for convenience
        addPoints: addCorrect + bonus,
        addCorrect,
        addIncorrect,
        weeklyCorrectAfterRun: weeklyCorrectTotal,
        currentWeek: newCurrentWeek
      });
    }

    // Build a friendly list of full-house names
    const fullHouseNames = fullHouseUserIds
      .map(id => usersAll.find(u => String(u.id) === String(id)))
      .filter(Boolean)
      .map(nameOf);

    return resp(200, {
      ok: true,
      week,
      predictionsUpdated,
      usersUpdated: userUpdates.length,
      detail: userUpdates,
      fullHouses: fullHouseUserIds,     // array of user IDs who hit 5/5
      fullHouseNames                    // same, as names
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
