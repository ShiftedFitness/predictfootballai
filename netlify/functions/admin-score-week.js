// netlify/functions/admin-score-week.js

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
      // not JSON, just a string like "66"
    }
    return v;
  }

  return v;
}

const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body)
});

const nameOf = (u) =>
  u?.['Username'] ||
  u?.['Name'] ||
  u?.['Full Name'] ||
  `User ${u?.id ?? ''}`;

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
    if (event.httpMethod !== 'POST') return respond(405, 'POST only');

    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
      return respond(401, 'Unauthorised');
    }

    const { week, force } = JSON.parse(event.body || '{}');
    if (!week) return respond(400, 'week required');

    const weekNum = Number(week);

    // Manual override switch
    const FORCE_OVERRIDE = process.env.FORCE_SCORE_WEEK === 'true';
    const allowForce = !!force || FORCE_OVERRIDE;

    // 1) Load matches + users
    const [matchesAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches),
      listAll(ADALO.col.users),
    ]);

    const matches = (matchesAll || [])
      .filter(m => Number(m['Week']) === weekNum)
      .sort((a, b) => Number(a.id) - Number(b.id));

    if (!matches.length) {
      return respond(400, {
        error: `No matches for week ${weekNum}`,
        debug: {
          week: weekNum,
          matchesTotal: matchesAll.length,
          usersTotal: usersAll.length
        }
      });
    }

    // 2) Guard: prevent accidental double-scoring (unless forced)
    if (!allowForce) {
      const scoredUsers = [];
      for (const u of usersAll || []) {
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
          ],
          debug: {
            week: weekNum,
            matchesForWeek: matches.length,
            matchIds: matches.map(m => m.id),
            usersTotal: usersAll.length,
            scoredUsersPreview: scoredUsers.slice(0, 5)
          }
        });
      }
    }

    // 3) Load ONLY this week's predictions using the Week field
    const predsPage = await adaloFetch(
      `${ADALO.col.predictions}?filterKey=Week&filterValue=${encodeURIComponent(weekNum)}`
    );
    const predsForWeek = predsPage?.records ?? predsPage ?? [];

    // Map matchId -> correct result
    const correctByMatch = Object.fromEntries(
      matches.map(m => [String(m.id), U(m['Correct Result'])])
    );
    const matchIds = new Set(matches.map(m => String(m.id)));

    // Filter to predictions that point at matches in this week
    const weekPreds = predsForWeek.filter(p => {
      const mid = String(relId(p['Match']));
      return matchIds.has(mid);
    });

    // 4) Recompute & overwrite Points Awarded when needed
    let predictionsUpdated = 0;
    for (const p of weekPreds) {
      const pick = U(p['Pick']);
      const mid = String(relId(p['Match']));
      const correct = correctByMatch[mid];
      const should = (pick && correct && pick === correct) ? 1 : 0;
      const current = (typeof p['Points Awarded'] === 'number') ? Number(p['Points Awarded']) : null;

      if (current === null || current !== should) {
        await adaloFetch(`${ADALO.col.predictions}/${p.id}`, {
          method: 'PUT',
          body: JSON.stringify({ 'Points Awarded': should })
        });
        predictionsUpdated++;
      }
    }

    // 5) Compute weekly totals per user
    const weeklyCorrectFinalByUser = {};
    for (const p of weekPreds) {
      const uid = String(relId(p['User']));
      const pts = Number(p['Points Awarded'] ?? 0);
      weeklyCorrectFinalByUser[uid] = (weeklyCorrectFinalByUser[uid] || 0) + pts; // 0..5
    }
    const participatingUserIds = Object.keys(weeklyCorrectFinalByUser);

    // 6) Update users: add weekly points, FH, Blanks, bump Current Week
    const updates = [];
    for (const uid of participatingUserIds) {
      const u = usersAll.find(x => String(x.id) === uid);
      if (!u) continue;

      const weeklyCorrectFinal = weeklyCorrectFinalByUser[uid] || 0; // 0..5
      const bonus    = (weeklyCorrectFinal === 5) ? 5 : 0;
      const fhInc    = (weeklyCorrectFinal === 5) ? 1 : 0;
      const blankInc = (weeklyCorrectFinal === 0) ? 1 : 0;
      const pointsToAdd = weeklyCorrectFinal + bonus;

      const newPoints   = Number(u['Points'] ?? 0) + pointsToAdd;
      const newCorrect  = Number(u['Correct Results'] ?? 0) + weeklyCorrectFinal;
      const newIncorrect= Number(u['Incorrect Results'] ?? 0) + (5 - weeklyCorrectFinal);
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
        weekPredsCount: weekPreds.length,
        usersTotal: usersAll.length
      }
    });

  } catch (e) {
    return respond(500, e.message || 'Unknown error');
  }
};
