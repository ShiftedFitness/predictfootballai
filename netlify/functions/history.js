// netlify/functions/history.js
const { ADALO, listAll } = require('./_adalo.js');

function toKey(x){ return String(x||'').trim().toUpperCase(); } // HOME/DRAW/AWAY

function safePoints(pick, correct, pointsAwarded) {
  if (typeof pointsAwarded === 'number') return pointsAwarded;
  if (!pick || !correct) return 0;
  return toKey(pick) === toKey(correct) ? 1 : 0;
}

function displayName(u){
  return u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${u?.id ?? ''}`;
}

exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl);
    const userId       = url.searchParams.get('userId');             // REQUIRED (the viewer)
    const currentWeekQ = url.searchParams.get('week');               // "current week" from URL (used for defaulting)
    const viewWeekQ    = url.searchParams.get('viewWeek');           // explicit week to view (overrides default logic)
    const compareIdQ   = url.searchParams.get('compareId');          // optional; default 1 (AI)

    if (!userId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'userId required' }) };
    }

    // Load everything we need
    const [matchesAll, predsAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.predictions, 10000),
      listAll(ADALO.col.users, 2000)
    ]);

    // Build list of users for UI (by name)
    const usersList = usersAll.map(u => ({ id: String(u.id), name: displayName(u) }))
                              .sort((a,b)=> a.name.localeCompare(b.name));

    // Weeks available (ascending & descending)
    const weeksAsc = Array.from(new Set(
      matchesAll.map(m => Number(m['Week'])).filter(n => !Number.isNaN(n))
    )).sort((a,b)=>a-b);
    const weeksDesc = [...weeksAsc].reverse();

    // Helper: is a given week "locked" by time or flag?
    const isWeekLocked = (wk) => {
      const ms = matchesAll.filter(m => Number(m['Week']) === Number(wk));
      if (ms.length === 0) return false;
      const earliest = ms.map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
                         .filter(Boolean).sort((a,b)=>a-b)[0];
      const now = new Date();
      return (earliest && now >= earliest) || ms.some(m => m['Locked'] === true);
    };

    // Determine which week to show
    let currentWeek = currentWeekQ ? Number(currentWeekQ) : (weeksAsc[weeksAsc.length-1] ?? 1);
    let viewWeek;

    if (viewWeekQ) {
      // User explicitly asked to view this week
      viewWeek = Number(viewWeekQ);
    } else {
      // Default logic based on currentWeek param
      const currentExists = weeksAsc.includes(currentWeek);
      if (!currentExists) {
        // If currentWeek not present in data, fall back to latest available
        currentWeek = weeksAsc[weeksAsc.length-1] ?? 1;
      }
      if (isWeekLocked(currentWeek)) {
        viewWeek = currentWeek;
      } else {
        // Use the nearest previous week that exists
        const prev = [...weeksDesc].find(w => w < currentWeek);
        viewWeek = prev ?? currentWeek; // if none, show current anyway
      }
    }

    // Matches for the week we are showing
    const matches = matchesAll
      .filter(m => Number(m['Week']) === Number(viewWeek))
      .sort((a,b)=> Number(a.id) - Number(b.id));

    // Correct results lookup
    const correctByMatch = Object.fromEntries(
      matches.map(m => [ String(m.id), toKey(m['Correct Result']) ])
    );

    // Predictions for that week
    const weekPreds = predsAll.filter(p => matches.some(m => String(m.id) === String(p['Match'])));
    const forUser = (uid) => weekPreds.filter(p => String(p['User']) === String(uid))
                                      .sort((a,b)=> Number(a['Match']) - Number(b['Match']));

    const compareId = String(compareIdQ || '1'); // default AI=1
    const mine   = forUser(userId);
    const theirs = forUser(compareId);

    // Build rows
    const rows = matches.map(m => {
      const me  = mine.find(p => String(p['Match']) === String(m.id));
      const him = theirs.find(p => String(p['Match']) === String(m.id));
      const myPick  = toKey(me?.['Pick']);
      const hisPick = toKey(him?.['Pick']);
      const correct = correctByMatch[String(m.id)] || '';
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
    const meUser  = usersAll.find(u => String(u.id) === String(userId));
    const himUser = usersAll.find(u => String(u.id) === String(compareId));

    return {
      currentWeek,                 // what was passed in URL (or latest if missing)
      viewWeek,                    // week actually being displayed
      availableWeeks: weeksDesc,   // descending for UI
      weekLocked: isWeekLocked(viewWeek),
      users: usersList,            // [{id,name}] for name dropdown
      me: {
        id: String(userId), name: displayName(meUser),
        correct: myCorrect, total: myTotal, accuracy: myAcc, points: myPoints
      },
      compare: {
        id: String(compareId), name: displayName(himUser),
        correct: hisCorrect, total: hisTotal, accuracy: hisAcc, points: hisPoints
      },
      rows
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
