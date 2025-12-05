// netlify/functions/admin-score-week.js
// PredictFootball – score a whole week of fixtures
// Handles normal scoring + "force rescore" and is paranoid about Adalo's relation formats 🙃

const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

// -------------------------
// Helpers
// -------------------------

// trim + uppercase
const U = (s) => String(s || '').trim().toUpperCase();

// RELATION ID EXTRACTOR – handles array, object, JSON string, raw, etc.
function relId(v) {
  if (!v) return '';

  // Case 1: Array: [66]
  if (Array.isArray(v)) return v[0] ?? '';

  // Case 2: Object: { id: 66 }
  if (typeof v === 'object' && v.id != null) return v.id;

  // Case 3: String numeric or JSON string
  if (typeof v === 'string') {
    // Try JSON parse first
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed[0] ?? '';
      if (typeof parsed === 'object' && parsed !== null && parsed.id != null) return parsed.id;
      // If it parses but isn't one of the above, fall through to raw
    } catch {
      // not JSON, just a plain string
    }
    return v;
  }

  // Fallback: plain number or something similar
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

// Normalises keys like "Current Week", "current_week", etc.
function findKey(rec, label) {
  const want = label.toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
  for (const k of Object.keys(rec)) {
    const norm = k.toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
    if (norm === want) return k;
  }
  return null;
}

// Utility: increment a single user's Current Week by +1 (for manual surgery if needed)
async function incrementUserWeek(uid, usersAll) {
  const user = usersAll.find(u => String(u.id) === String(uid));
  if (!user) return { ok: false, error: 'User not found' };

  const ck = findKey(user, 'Current Week');
  if (!ck) return { ok: false, error: 'Current Week field not found on user' };

  const curr = Number(user[ck] || 0);
  const newVal = curr + 1;

  await adaloFetch(`${ADALO.col.users}/${uid}`, {
    method: 'PUT',
    body: JSON.stringify({ [ck]: newVal })
  });

  return { ok: true, uid, old: curr, new: newVal };
}

// -------------------------
// MAIN HANDLER
// -------------------------

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return respond(405, 'POST only');

    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
      return respond(401, 'Unauthorised');
    }

    const { week, force } = JSON.parse(event.body || '{}');
    if (!week) return respond(400, 'week required');

    // ============================
    // MANUAL OVERRIDE SWITCH
    // ============================
    // 1) Send { "force": true } in the POST body  (used by Force Rescore button)
    // 2) Or set env var FORCE_SCORE_WEEK=true to force without touching the UI
    const FORCE_OVERRIDE = process.env.FORCE_SCORE_WEEK === 'true';
    const allowForce = !!force || FORCE_OVERRIDE;

    // 1) Load all relevant collections
    const [matchesAll, predsAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.predictions, 20000),
      listAll(ADALO.col.users, 5000),
    ]);

    const weekNum = Number(week);

    const matches = (matchesAll || [])
      .filter(m => Number(m['Week']) === weekNum)
      .sort((a, b) => Number(a.id) - Number(b.id));

    if (!matches.length) {
      return respond(400, {
        error: `No matches for week ${week}`,
        debug: {
          week: weekNum,
          matchesTotal: matchesAll.length,
          predsTotal: predsAll.length,
          usersTotal: usersAll.length
        }
      });
    }

    // ---------------------------------
    // Guard: prevent accidental double-scoring (unless forced)
    // ---------------------------------
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
            predsTotal: predsAll.length,
            usersTotal: usersAll.length,
            scoredUsersPreview: scoredUsers.slice(0, 5)
          }
        });
      }
    }

    // Map matchId -> correct result
    const correctByMatch = Object.fromEntries(
      matches.map(m => [String(m.id), U(m['Correct Result'])])
    );
    const matchIds = new Set(matches.map(m => String(m.id)));

    // Predictions belonging to this week (via Match relation)
    const weekPreds = (predsAll || []).filter(p => {
      const midRaw = relId(p['Match']);
      const mid = String(midRaw);
      return matchIds.has(mid);
    });

    // 2) Recompute & overwrite Points Awarded when needed (idempotent and corrective)
    let predictionsUpdated = 0;
    for (const p of weekPreds) {
      const pick = U(p['Pick']);
      const mid = String(relId(p['Match']));
      const correct = correctByMatch[mid];

      // If correct result missing, count as 0 (but typically results are set first)
      const should = (pick && correct && pick === correct) ? 1 : 0;
      const current = (typeof p['Points Awarded'] === 'number') ? Number(p['Points Awarded']) : null;

      // Write when missing OR wrong
      if (current === null || current !== should) {
        await adaloFetch(`${ADALO.col.predictions}/${p.id}`, {
          method: 'PUT',
          body: JSON.stringify({ 'Points Awarded': should })
        });
        predictionsUpdated++;
      }
    }

    // 3) Reload predictions AFTER fixing to compute final weekly correct
    const predsAfter = await listAll(ADALO.col.predictions, 20000);
    const weekAfter = predsAfter.filter(p => {
      const midRaw = relId(p['Match']);
      const mid = String(midRaw);
      return matchIds.has(mid);
    });

    const weeklyCorrectFinalByUser = {};
    for (const p of weekAfter) {
      const uid = String(relId(p['User']));
      const pts = Number(p['Points Awarded'] ?? 0);
      weeklyCorrectFinalByUser[uid] = (weeklyCorrectFinalByUser[uid] || 0) + pts; // 0..5
    }
    const participatingUserIds = Array.from(new Set(weekAfter.map(p => String(relId(p['User'])))));

    // 4) Update users: add FULL weekly points (correct + bonus) & bump Current Week +1
    //    ALSO increment FH (full house) and Blanks counters.
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
        weekPredsCount: weekPreds.length,
        weekAfterCount: weekAfter.length,
        predsTotal: predsAll.length,
        usersTotal: usersAll.length,
        sampleWeekPreds: weekPreds.slice(0, 5).map(p => ({
          id: p.id,
          pick: p['Pick'],
          match: relId(p['Match']),
          user: relId(p['User']),
          pointsAwarded: p['Points Awarded']
        }))
      }
    });

  } catch (e) {
    return respond(500, e.message || 'Unknown error');
  }
};
