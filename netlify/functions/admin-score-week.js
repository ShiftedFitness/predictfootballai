// netlify/functions/admin-score-week.js
//
// Re-scores a single week:
// - Recomputes Points Awarded for each prediction in that week
// - For each user who made predictions in that week, adds weekly points,
//   FH (full houses) and Blanks (0-correct weeks).
//
// Request:
//   POST with header x-admin-secret
//   Body: { "week": 12, "force": true }
//
// Response:
//   { ok:true, week:12, predictionsUpdated:..., usersUpdated:..., ... }

const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

// Helpers
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
    } catch {
      // plain string
    }
    return v;
  }

  return v;
}

const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const nameOf = (u) =>
  u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${u?.id ?? ''}`;

function findKey(rec, label) {
  const want = label.toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
  for (const k of Object.keys(rec)) {
    const norm = k.toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
    if (norm === want) return k;
  }
  return null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return respond(405, { error: 'POST only' });

    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
      return respond(401, { error: 'Unauthorised' });
    }

    const { week, force } = JSON.parse(event.body || '{}');
    if (!week) return respond(400, { error: 'week required' });

    const weekNum = Number(week);

    const FORCE_OVERRIDE = process.env.FORCE_SCORE_WEEK === 'true';
    const allowForce = !!force || FORCE_OVERRIDE;

    // 1) Load matches + users
    const [matchesAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.users, 5000),
    ]);

    const matches = (matchesAll || [])
      .filter(m => Number(m['Week']) === weekNum)
      .sort((a, b) => Number(a.id) - Number(b.id));

    if (!matches.length) {
      return respond(400, { error: `No matches for week ${weekNum}` });
    }

    const usersSafe = usersAll || [];

    const isWeekLocked = (wk) => {
      const ms = matchesAll.filter(m => Number(m['Week']) === Number(wk));
      if (!ms.length) return false;
      const earliest = ms
        .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
        .filter(Boolean).sort((a,b)=>a-b)[0];
      const now = new Date();
      return (earliest && now >= earliest) || ms.some(m => m['Locked'] === true);
    };

    // Guard: prevent accidental double-scoring (unless forced)
    if (!allowForce) {
      const scoredUsers = [];
      for (const u of usersSafe) {
        const ck = findKey(u, 'Current Week');
        if (!ck) continue;
        const currW = Number(u[ck] || 0);
        if (currW > weekNum) {
          scoredUsers.push(nameOf(u));
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
      matches.map(m => [String(m.id), U(m['Correct Result'])])
    );
    const matchIds = new Set(matches.map(m => String(m.id)));

    // 3) Load predictions for THIS week
    let predsForWeek = [];
    try {
      const page = await adaloFetch(
        `${ADALO.col.predictions}?filterKey=Week&filterValue=${encodeURIComponent(weekNum)}`
      );
      const arr = page?.records ?? page ?? [];
      predsForWeek = (arr || []).filter(p =>
        matchIds.has(String(relId(p['Match'])))
      );
    } catch (e) {
      console.error('admin-score-week: Week-filtered predictions fetch failed, fallback to listAll', e);
      predsForWeek = [];
    }

    if (!predsForWeek.length) {
      // Fallback for old data without Week set
      const predsAll = await listAll(ADALO.col.predictions, 20000);
      predsForWeek = (predsAll || []).filter(p =>
        matchIds.has(String(relId(p['Match'])))
      );
    }

    // 4) Recompute Points Awarded *and* collect per-user stats
    let predictionsUpdated = 0;

    // statsByUser: uid -> { predCount, correctCount }
    const statsByUser = {};

    for (const p of predsForWeek) {
      const uid = String(relId(p['User']));
      const mid = String(relId(p['Match']));
      if (!uid || !matchIds.has(mid)) continue;

      const pick = U(p['Pick']);
      const correct = correctByMatch[mid];
      const should = (pick && correct && pick === correct) ? 1 : 0;

      // stats
      if (!statsByUser[uid]) {
        statsByUser[uid] = { predCount: 0, correctCount: 0 };
      }
      statsByUser[uid].predCount += 1;
      statsByUser[uid].correctCount += should;

      // update Points Awarded if needed
      const current = (typeof p['Points Awarded'] === 'number') ? Number(p['Points Awarded']) : null;
      if (current === null || current !== should) {
        await adaloFetch(`${ADALO.col.predictions}/${p.id}`, {
          method: 'PUT',
          body: JSON.stringify({ 'Points Awarded': should })
        });
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
      const bonus    = (weeklyCorrectFinal === 5) ? 5 : 0;
      const fhInc    = (weeklyCorrectFinal === 5) ? 1 : 0;
      const blankInc = (weeklyCorrectFinal === 0) ? 1 : 0;  // played but 0 correct

      const pointsToAdd = weeklyCorrectFinal + bonus;

      const newPoints   = Number(u['Points'] ?? 0) + pointsToAdd;
      const newCorrect  = Number(u['Correct Results'] ?? 0) + weeklyCorrectFinal;
      const newIncorrect= Number(u['Incorrect Results'] ?? 0) + (stats.predCount - weeklyCorrectFinal);
      const newFH       = Number(u['FH'] ?? 0) + fhInc;
      const newBlanks   = Number(u['Blanks'] ?? 0) + blankInc;

      const ck = findKey(u, 'Current Week');
      const currW = ck ? Number(u[ck] ?? weekNum) : weekNum;

      const body = {
        'Points': newPoints,
        'Correct Results': newCorrect,
        'Incorrect Results': newIncorrect,
        'FH': newFH,
        'Blanks': newBlanks,
        [ck || 'Current Week']: currW + 1
      };

      await adaloFetch(`${ADALO.col.users}/${uid}`, {
        method: 'PUT',
        body: JSON.stringify(body)
      });

      updates.push({
        uid,
        name: nameOf(u),
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
    const blanksNames    = updates.filter(u => u.weeklyCorrectFinal === 0).map(u => u.name);

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
        predsForWeekCount: predsForWeek.length,
        usersTotal: usersSafe.length
      }
    });

  } catch (e) {
    console.error('admin-score-week error:', e);
    return respond(500, { error: e.message || 'Unknown error' });
  }
};
