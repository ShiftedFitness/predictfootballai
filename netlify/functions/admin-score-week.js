const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

const U = (s) => String(s || '').toUpperCase();
const relId = (v) => Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body)
});
const nameOf = (u) => u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${u?.id ?? ''}`;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return respond(405, 'POST only');
    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) return respond(401, 'Unauthorised');

    const { week } = JSON.parse(event.body || '{}');
    if (!week) return respond(400, 'week required');

    // Load
    const [matchesAll, predsAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.predictions, 20000),
      listAll(ADALO.col.users, 5000),
    ]);

    const matches = matchesAll
      .filter(m => Number(m['Week']) === Number(week))
      .sort((a,b)=> Number(a.id) - Number(b.id));
    if (!matches.length) return respond(400, `No matches for week ${week}`);

    const correctByMatch = Object.fromEntries(matches.map(m => [ String(m.id), U(m['Correct Result']) ]));
    const matchIds = new Set(matches.map(m => String(m.id)));
    const weekPreds = predsAll.filter(p => matchIds.has(String(relId(p['Match']))));

    // Award 0/1 where null
    let predictionsUpdated = 0;
    for (const p of weekPreds) {
      if (typeof p['Points Awarded'] === 'number') continue;
      const pick = U(p['Pick']);
      const correct = correctByMatch[String(relId(p['Match']))];
      const point = (pick && correct && pick === correct) ? 1 : 0;
      await adaloFetch(`${ADALO.col.predictions}/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ 'Points Awarded': point })
      });
      predictionsUpdated++;
    }

    // Re-read predictions to get FINAL weekly correct counts (0..5)
    const predsAfter = await listAll(ADALO.col.predictions, 20000);
    const weekAfter = predsAfter.filter(p => matchIds.has(String(relId(p['Match']))));

    const weeklyCorrectFinalByUser = {};
    for (const p of weekAfter) {
      const uid = String(relId(p['User']));
      const pts = Number(p['Points Awarded'] ?? 0);
      weeklyCorrectFinalByUser[uid] = (weeklyCorrectFinalByUser[uid] || 0) + pts;
    }
    const participatingUserIds = Array.from(new Set(weekAfter.map(p => String(relId(p['User'])))));

    const updates = [];
    for (const uid of participatingUserIds) {
      const u = usersAll.find(x => String(x.id) === uid);
      if (!u) continue;

      const weeklyCorrectFinal = weeklyCorrectFinalByUser[uid] || 0;    // 0..5
      const bonus = (weeklyCorrectFinal === 5) ? 5 : 0;
      const pointsToAdd = weeklyCorrectFinal + bonus;                    // ALWAYS add full weekly total

      const newPoints    = Number(u['Points'] ?? 0) + pointsToAdd;
      const newCorrect   = Number(u['Correct Results'] ?? 0) + weeklyCorrectFinal;
      const newIncorrect = Number(u['Incorrect Results'] ?? 0) + (5 - weeklyCorrectFinal);

      // bump Current Week +1
      const ck = findKey(u, 'Current Week');
      const currW = ck ? Number(u[ck] ?? week) : Number(week);
      const body = {
        'Points': newPoints,
        'Correct Results': newCorrect,
        'Incorrect Results': newIncorrect,
        [ck || 'Current Week']: currW + 1
      };

      await adaloFetch(`${ADALO.col.users}/${uid}`, { method: 'PUT', body: JSON.stringify(body) });

      updates.push({
        uid,
        name: nameOf(u),
        weeklyCorrectFinal,
        bonusApplied: bonus,
        pointsAdded: pointsToAdd
      });
    }

    const fullHouseNames = updates.filter(u => u.weeklyCorrectFinal === 5).map(u => u.name);

    return respond(200, {
      ok: true,
      week,
      predictionsUpdated,
      usersUpdated: updates.length,
      fullHouseNames,
      detail: updates
    });

  } catch (e) {
    return respond(500, e.message);
  }
};

function findKey(rec, label){
  const want = label.toLowerCase().replace(/\s+/g,'');
  for (const k of Object.keys(rec)) {
    const norm = k.toLowerCase().replace(/\s+/g,'');
    if (norm === want) return k;
  }
  return null;
}
