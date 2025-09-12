// netlify/functions/history.js
const { ADALO, listAll } = require('./_adalo.js');

// ---- helpers ----
const toKey = (x) => String(x ?? '').trim().toUpperCase(); // HOME/DRAW/AWAY

const getRelId = (v) => Array.isArray(v) ? (v[0] ?? '') : v ?? '';   // handles ["2"] or 2 or ""
const sameId = (a,b) => String(a) === String(b);

function displayName(u){
  return u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${u?.id ?? ''}`;
}

function safePoints(pick, correct, pointsAwarded) {
  if (typeof pointsAwarded === 'number') return pointsAwarded;
  if (!pick || !correct) return 0;
  return toKey(pick) === toKey(correct) ? 1 : 0;
}

exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl);
    const userIdParam  = url.searchParams.get('userId');     // REQUIRED
    const currentWeekQ = url.searchParams.get('week');       // "current week" from URL
    const viewWeekQ    = url.searchParams.get('viewWeek');   // explicit week to view (from UI)
    const compareIdQ   = url.searchParams.get('compareId');  // optional; default 1 (AI)

    if (!userIdParam) {
      return { statusCode: 400, body: JSON.stringify({ error: 'userId required' }) };
    }
    const userId    = String(userIdParam);
    const compareId = String(compareIdQ || '1'); // AI default

    // ---- load collections ----
    const [matchesAll, predsAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.predictions, 10000),
      listAll(ADALO.col.users, 2000)
    ]);

    // weeks present
    const weeksAsc = Array.from(new Set(
      (matchesAll || []).map(m => Number(m['Week'])).filter(n => !Number.isNaN(n))
    )).sort((a,b)=>a-b);
    const weeksDesc = [...weeksAsc].reverse();

    // helper: is a week locked by deadline or flag?
    const isWeekLocked = (wk) => {
      const ms = (matchesAll || []).filter(m => Number(m['Week']) === Number(wk));
      if (ms.length === 0) return false;
      const earliest = ms.map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
                         .filter(Boolean).sort((a,b)=>a-b)[0];
      const now = new Date();
      return (earliest && now >= earliest) || ms.some(m => m['Locked'] === true);
    };

    // choose currentWeek (from URL or latest available)
    let currentWeek = currentWeekQ ? Number(currentWeekQ) : (weeksAsc[weeksAsc.length-1] ?? 1);
    if (!weeksAsc.includes(currentWeek) && weeksAsc.length) currentWeek = weeksAsc[weeksAsc.length-1];

    // decide which week to view
    let viewWeek;
    if (viewWeekQ) {
      viewWeek = Number(viewWeekQ);
    } else {
      viewWeek = isWeekLocked(currentWeek)
        ? currentWeek
        : (weeksDesc.find(w => w < currentWeek) ?? currentWeek);
    }

    // matches for viewWeek
    const matches = (matchesAll || [])
      .filter(m => Number(m['Week']) === Number(viewWeek))
      .sort((a,b)=> Number(a.id) - Number(b.id));

    // correct results per match
    const correctByMatch = Object.fromEntries(
      matches.map(m => [ String(m.id), toKey(m['Correct Result']) ])
    );

    // filter predictions that belong to matches in this week
    const matchIdsSet = new Set(matches.map(m => String(m.id)));
    const weekPreds = (predsAll || []).filter(p => matchIdsSet.has(String(getRelId(p['Match']))));

    // build users list for UI: prefer Users table; if empty, derive from predictions seen
    let usersList = (usersAll || []).map(u => ({ id: String(u.id), name: displayName(u) }));
    if (!usersList.length) {
      const uniq = Array.from(new Set(weekPreds.map(p => String(getRelId(p['User'])))));
      usersList = uniq.map(id => ({ id, name: `User ${id}` }));
    }
    usersList.sort((a,b)=> a.name.localeCompare(b.name));

    // predictions for the viewer + comparator (handle array relations)
    const predsFor = (uid) => weekPreds
      .filter(p => sameId(getRelId(p['User']), uid))
      .sort((a,b)=> Number(getRelId(a['Match'])) - Number(getRelId(b['Match'])));

    const mine   = predsFor(userId);
    const theirs = predsFor(compareId);

    // rows
    const rows = matches.map(m => {
      const midStr = String(m.id);
      const me  = mine.find(p => String(getRelId(p['Match'])) === midStr);
      const him = theirs.find(p => String(getRelId(p['Match'])) === midStr);

      const myPick  = toKey(me?.['Pick']);
      const hisPick = toKey(him?.['Pick']);
      const correct = correctByMatch[midStr] || '';

      const myPt  = safePoints(myPick, correct, typeof me?.['Points Awarded']==='number' ? me['Points Awarded'] : undefined);
      const hisPt = safePoints(hisPick, correct, typeof him?.['Points Awarded']==='number' ? him['Points Awarded'] : undefined);

      return {
        match_id: m.id,
        fixture: `${m['Home Team']} v ${m['Away Team']}`,
        myPick, hisPick, correct,
        myPoint: myPt, hisPoint: hisPt,
        myCorrect: !!myPick && !!correct && myPick === correct
      };
    });

    // summaries
    const myCorrect  = rows.filter(r => r.myCorrect).length;
    const myTotal    = rows.filter(r => r.myPick).length;
    const myPoints   = rows.reduce((s,r)=> s + (r.myPoint||0), 0);

    const hisCorrect = rows.filter(r => !!r.hisPick && r.hisPick === r.correct).length;
    const hisTotal   = rows.filter(r => r.hisPick).length;
    const hisPoints  = rows.reduce((s,r)=> s + (r.hisPoint||0), 0);

    const myAcc  = myTotal  > 0 ? myCorrect  / myTotal  : 0;
    const hisAcc = hisTotal > 0 ? hisCorrect / hisTotal : 0;

    // names from Users table (fallback if missing)
    const meUser  = (usersAll || []).find(u => sameId(u.id, userId));
    const himUser = (usersAll || []).find(u => sameId(u.id, compareId));
    const meName  = meUser ? displayName(meUser) : `User ${userId}`;
    const himName = himUser ? displayName(himUser) : (usersList.find(u => sameId(u.id, compareId))?.name || `User ${compareId}`);

    return {
      currentWeek,
      viewWeek,
      availableWeeks: weeksDesc,   // for dropdown (descending)
      weekLocked: isWeekLocked(viewWeek),
      users: usersList,            // [{id,name}] for name dropdown
      me:      { id: userId,   name: meName,  correct: myCorrect, total: myTotal, accuracy: myAcc, points: myPoints },
      compare: { id: compareId, name: himName, correct: hisCorrect, total: hisTotal, accuracy: hisAcc, points: hisPoints },
      rows
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
