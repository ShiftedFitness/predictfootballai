// netlify/functions/history.js
const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

// ---------- helpers ----------
const toKey = (x) => String(x ?? '').trim().toUpperCase(); // HOME/DRAW/AWAY

function getRelId(v) {
  if (!v) return '';

  // Case 1: Array: [66]
  if (Array.isArray(v)) return v[0] ?? '';

  // Case 2: Object: { id: 66 }
  if (typeof v === 'object' && v.id != null) return v.id;

  // Case 3: String numeric or JSON string
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed[0] ?? '';
      if (typeof parsed === 'object' && parsed !== null && parsed.id != null) return parsed.id;
    } catch {
      // not JSON, just plain string like "66"
    }
    return v;
  }

  // Fallback: number etc.
  return v;
}

const sameId = (a, b) => String(a) === String(b);

const ok = (body) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const fail = (code, msg) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: msg }),
});

function displayName(u) {
  return u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${u?.id ?? ''}`;
}

function safePoints(pick, correct, pointsAwarded) {
  if (typeof pointsAwarded === 'number') return pointsAwarded;
  if (!pick || !correct) return 0;
  return toKey(pick) === toKey(correct) ? 1 : 0;
}

// ---------- handler ----------
exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const userIdParam = q.userId;
    const currentWeekQ = q.week;
    const viewWeekQ = q.viewWeek;
    const compareIdQ = q.compareId;

    if (!userIdParam) return fail(400, 'userId required');
    const userId = String(userIdParam);
    const compareId = String(compareIdQ || '1'); // default AI=1

    // 1) Load matches + users (small enough)
    let matchesAll = [], usersAll = [];
    try {
      [matchesAll, usersAll] = await Promise.all([
        listAll(ADALO.col.matches, 1000),
        listAll(ADALO.col.users, 2000),
      ]);
    } catch (e) {
      console.error('Adalo fetch failed (matches/users)', e);
      return fail(500, 'Failed to fetch data from Adalo – check env vars/IDs');
    }
    matchesAll = matchesAll || [];
    usersAll = usersAll || [];

    // 2) Weeks present
    const weeksAsc = Array.from(
      new Set(
        matchesAll
          .map((m) => Number(m['Week']))
          .filter((n) => !Number.isNaN(n))
      )
    ).sort((a, b) => a - b);
    const weeksDesc = [...weeksAsc].reverse();

    const isWeekLocked = (wk) => {
      const ms = matchesAll.filter((m) => Number(m['Week']) === Number(wk));
      if (!ms.length) return false;
      const earliest = ms
        .map((m) => (m['Lockout Time'] ? new Date(m['Lockout Time']) : null))
        .filter(Boolean)
        .sort((a, b) => a - b)[0];
      const now = new Date();
      return (
        (earliest && now >= earliest.getTime()) ||
        ms.some((m) => m['Locked'] === true)
      );
    };

    // Only locked weeks are navigable in the UI
    const lockedWeeks = weeksDesc.filter((w) => isWeekLocked(w));

    // 3) currentWeek & viewWeek logic
    let currentWeek = currentWeekQ
      ? Number(currentWeekQ)
      : weeksAsc[weeksAsc.length - 1] ?? 1;
    if (!weeksAsc.includes(currentWeek) && weeksAsc.length) {
      currentWeek = weeksAsc[weeksAsc.length - 1];
    }

    let viewWeek;
    if (viewWeekQ) {
      const requested = Number(viewWeekQ);
      viewWeek = isWeekLocked(requested)
        ? requested
        : (lockedWeeks[0] ?? requested);
    } else {
      // default to latest locked week at/before currentWeek
      const latestLocked = lockedWeeks.find((w) => w <= currentWeek) ?? lockedWeeks[0];
      viewWeek = latestLocked ?? currentWeek;
    }

    const weekLocked = isWeekLocked(viewWeek);

    // 4) Matches for viewWeek
    const matches = matchesAll
      .filter((m) => Number(m['Week']) === Number(viewWeek))
      .sort((a, b) => Number(a.id) - Number(b.id));

    const correctByMatch = Object.fromEntries(
      matches.map((m) => [String(m.id), toKey(m['Correct Result'])])
    );
    const matchIdSet = new Set(matches.map((m) => String(m.id)));

    let weekPreds = [];

    // 5) Only fetch predictions if the week is locked.
    if (weekLocked) {
      try {
        const page = await adaloFetch(
          `${ADALO.col.predictions}?filterKey=Week&filterValue=${encodeURIComponent(
            viewWeek
          )}`
        );
        const predsForWeek = page?.records ?? page ?? [];
        weekPreds = predsForWeek.filter((p) =>
          matchIdSet.has(String(getRelId(p['Match'])))
        );
      } catch (e) {
        console.error(
          'history.js: Week-filtered predictions fetch failed, will fallback to listAll',
          e
        );
        weekPreds = [];
      }

      // Fallback for old data without Week set
      if (!weekPreds.length) {
        try {
          const predsAll = await listAll(ADALO.col.predictions, 20000);
          weekPreds = (predsAll || []).filter((p) =>
            matchIdSet.has(String(getRelId(p['Match'])))
          );
        } catch (e) {
          console.error('history.js: fallback listAll(predictions) failed', e);
          return fail(500, 'Failed to fetch predictions');
        }
      }
    } else {
      // Not locked: do not fetch any predictions at all
      weekPreds = [];
    }

    // 6) Users list for dropdown (locked weeks only)
    let usersList = usersAll.map((u) => ({
      id: String(u.id),
      name: displayName(u),
    }));
    if (!usersList.length && weekPreds.length) {
      const uniq = Array.from(
        new Set(weekPreds.map((p) => String(getRelId(p['User']))))
      );
      usersList = uniq.map((id) => ({ id, name: `User ${id}` }));
    }
    usersList.sort((a, b) => a.name.localeCompare(b.name));

    // 7) Per-user predictions
    const forUser = (uid) =>
      weekPreds
        .filter((p) => sameId(getRelId(p['User']), uid))
        .sort(
          (a, b) =>
            Number(getRelId(a['Match'])) - Number(getRelId(b['Match']))
        );

    const mine = forUser(userId);
    const theirs = forUser(compareId);

    // 8) Rows for the table
    const rows = matches.map((m) => {
      const mid = String(m.id);
      const me = mine.find(
        (p) => String(getRelId(p['Match'])) === mid
      );
      const him = theirs.find(
        (p) => String(getRelId(p['Match'])) === mid
      );

      const myPick = weekLocked ? toKey(me?.['Pick'] || '') : '';
      const hisPick = weekLocked ? toKey(him?.['Pick'] || '') : '';
      const correct = correctByMatch[mid] || '';

      const myPt = weekLocked
        ? safePoints(
            myPick,
            correct,
            typeof me?.['Points Awarded'] === 'number'
              ? me['Points Awarded']
              : undefined
          )
        : 0;
      const hisPt = weekLocked
        ? safePoints(
            hisPick,
            correct,
            typeof him?.['Points Awarded'] === 'number'
              ? him['Points Awarded']
              : undefined
          )
        : 0;

      return {
        match_id: m.id,
        fixture: `${m['Home Team']} v ${m['Away Team']}`,
        myPick,
        hisPick,
        correct,
        myPoint: myPt,
        hisPoint: hisPt,
        myCorrect: weekLocked && !!myPick && !!correct && myPick === correct,
      };
    });

    // 9) Summaries
    const myCorrect = rows.filter((r) => r.myCorrect).length;
    const myTotal = rows.filter((r) => r.myPick).length;
    const myPoints = rows.reduce((s, r) => s + (r.myPoint || 0), 0);

    const hisCorrect = rows.filter(
      (r) => !!r.hisPick && r.hisPick === r.correct
    ).length;
    const hisTotal = rows.filter((r) => r.hisPick).length;
    const hisPoints = rows.reduce((s, r) => s + (r.hisPoint || 0), 0);

    const myAcc = myTotal > 0 ? myCorrect / myTotal : 0;
    const hisAcc = hisTotal > 0 ? hisCorrect / hisTotal : 0;

    // 10) Names
    const meUser = usersAll.find((u) => sameId(u.id, userId));
    const himUser = usersAll.find((u) => sameId(u.id, compareId));

    return ok({
      currentWeek,
      viewWeek,
      availableWeeks: lockedWeeks,      // only locked weeks are navigable
      weekLocked,
      users: usersList,
      me: {
        id: userId,
        name: meUser ? displayName(meUser) : `User ${userId}`,
        correct: myCorrect,
        total: myTotal,
        accuracy: myAcc,
        points: myPoints,
      },
      compare: {
        id: compareId,
        name: himUser
          ? displayName(himUser)
          : usersList.find((u) => sameId(u.id, compareId))?.name ||
            `User ${compareId}`,
        correct: hisCorrect,
        total: hisTotal,
        accuracy: hisAcc,
        points: hisPoints,
      },
      rows,
    });
  } catch (e) {
    console.error('history.js top-level error:', e);
    return fail(500, String(e));
  }
};
