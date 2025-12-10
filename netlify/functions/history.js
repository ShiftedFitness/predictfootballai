// netlify/functions/history.js
const { ADALO, listAll } = require('./_adalo.js');

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

const sameId = (a,b) => String(a) === String(b);
const ok = (body) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control':'no-store' }, body: JSON.stringify(body) });
const fail = (code, msg) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) });

function displayName(u){
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
    const userIdParam  = q.userId;
    const currentWeekQ = q.week;
    const viewWeekQ    = q.viewWeek;
    const compareIdQ   = q.compareId;

    if (!userIdParam) return fail(400, 'userId required');
    const userId    = String(userIdParam);
    const compareId = String(compareIdQ || '1'); // default AI=1

    // Load data defensively
    let matchesAll = [], predsAll = [], usersAll = [];
    try {
      [matchesAll, predsAll, usersAll] = await Promise.all([
        listAll(ADALO.col.matches, 1000),
        listAll(ADALO.col.predictions, 10000),
        listAll(ADALO.col.users, 2000)
      ]);
    } catch (e) {
      console.error('Adalo fetch failed', e);
      return fail(500, 'Failed to fetch data from Adalo – check env vars/IDs');
    }
    matchesAll = matchesAll || [];
    predsAll   = predsAll || [];
    usersAll   = usersAll || [];

    // Weeks present
    const weeksAsc = Array.from(new Set(
      matchesAll.map(m => Number(m['Week'])).filter(n => !Number.isNaN(n))
    )).sort((a,b)=>a-b);
    const weeksDesc = [...weeksAsc].reverse();

    const isWeekLocked = (wk) => {
      const ms = matchesAll.filter(m => Number(m['Week']) === Number(wk));
      if (!ms.length) return false;
      const earliest = ms.map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
                         .filter(Boolean).sort((a,b)=>a-b)[0];
      const now = new Date();
      return (earliest && now >= earliest) || ms.some(m => m['Locked'] === true);
    };

    // Choose currentWeek (from URL or latest)
    let currentWeek = currentWeekQ ? Number(currentWeekQ) : (weeksAsc[weeksAsc.length-1] ?? 1);
    if (!weeksAsc.includes(currentWeek) && weeksAsc.length) currentWeek = weeksAsc[weeksAsc.length-1];

    // Decide viewWeek
    let viewWeek;
    if (viewWeekQ) {
      viewWeek = Number(viewWeekQ);
    } else {
      viewWeek = isWeekLocked(currentWeek)
        ? currentWeek
        : (weeksDesc.find(w => w < currentWeek) ?? currentWeek);
    }

    // Matches for viewWeek
    const matches = matchesAll
      .filter(m => Number(m['Week']) === Number(viewWeek))
      .sort((a,b)=> Number(a.id) - Number(b.id));

    // Correct results
    const correctByMatch = Object.fromEntries(
      matches.map(m => [ String(m.id), toKey(m['Correct Result']) ])
    );

    // Filter predictions belonging to this week
    const matchIdSet = new Set(matches.map(m => String(m.id)));
    const weekPreds = predsAll.filter(p => matchIdSet.has(String(getRelId(p['Match']))));

    // Build users list (names) for the dropdown
    let usersList = usersAll.map(u => ({ id: String(u.id), name: displayName(u) }));
    if (!usersList.length) {
      // fallback: derive from predictions
      const uniq = Array.from(new Set(weekPreds.map(p => String(getRelId(p['User'])))));
      usersList = uniq.map(id => ({ id, name: `User ${id}` }));
    }
    usersList.sort((a,b)=> a.name.localeCompare(b.name));

    // Predictions for viewer + comparator
    const forUser = (uid) => weekPreds
      .filter(p => sameId(getRelId(p['User']), uid))
      .sort((a,b)=> Number(getRelId(a['Match'])) - Number(getRelId(b['Match'])));

    const mine   = forUser(userId);
    const theirs = forUser(compareId);

    // Rows
    const rows = matches.map(m => {
      const mid = String(m.id);
      const me  = mine.find(p => String(getRelId(p['Match'])) === mid);
      const him = theirs.find(p => String(getRelId(p['Match'])) === mid);

      const myPick  = toKey(me?.['Pick']);
      const hisPick = toKey(him?.['Pick']);
      const correct = correctByMatch[mid] || '';

      const myPt  = safePoints(myPick, correct, typeof me?.['Points Awarded'] === 'number' ? me['Points Awarded'] : undefined);
      const hisPt = safePoints(hisPick, correct, typeof him?.['Points Awarded'] === 'number' ? him['Points Awarded'] : undefined);

      return {
        match_id: m.id,
        fixture: `${m['Home Team']} v ${m['Away Team']}`,
        myPick, hisPick, correct,
        myPoint: myPt, hisPoint: hisPt,
        myCorrect: !!myPick && !!correct && myPick === correct
      };
    });

    // Summaries
    const myCorrect  = rows.filter(r => r.myCorrect).length;
    const myTotal    = rows.filter(r => r.myPick).length;
    const myPoints   = rows.reduce((s,r)=> s + (r.myPoint||0), 0);

    const hisCorrect = rows.filter(r => !!r.hisPick && r.hisPick === r.correct).length;
    const hisTotal   = rows.filter(r => r.hisPick).length;
    const hisPoints  = rows.reduce((s,r)=> s + (r.hisPoint||0), 0);

    const myAcc  = myTotal  > 0 ? myCorrect  / myTotal  : 0;
    const hisAcc = hisTotal > 0 ? hisCorrect / hisTotal : 0;

    // Names
    const meUser  = usersAll.find(u => sameId(u.id, userId));
    const himUser = usersAll.find(u => sameId(u.id, compareId));

    return ok({
      currentWeek,
      viewWeek,
      availableWeeks: weeksDesc,
      weekLocked: isWeekLocked(viewWeek),
      users: usersList,
      me:      { id: userId,   name: meUser ? displayName(meUser) : `User ${userId}`,   correct: myCorrect, total: myTotal, accuracy: myAcc, points: myPoints },
      compare: { id: compareId, name: himUser ? displayName(himUser) : (usersList.find(u=>sameId(u.id,compareId))?.name || `User ${compareId}`),
                 correct: hisCorrect, total: hisTotal, accuracy: hisAcc, points: hisPoints },
      rows
    });
  } catch (e) {
    console.error('history.js top-level error:', e);
    return fail(500, String(e));
  }
};
