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
    const userId = url.searchParams.get('userId');             // REQUIRED (main user to show)
    const weekParam = url.searchParams.get('week');            // optional (overrides default)
    const compareIdParam = url.searchParams.get('compareId');  // optional; default 1

    if (!userId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'userId required' }) };
    }

    // Load all needed data
    const [matchesAll, predsAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.predictions, 10000),
      listAll(ADALO.col.users, 2000)
    ]);

    // Build users list for the UI (name dropdown)
    const usersList = usersAll.map(u => ({ id: String(u.id), name: displayName(u) }))
                              .sort((a,b)=> a.name.localeCompare(b.name));

    // Determine compare user id
    const defaultCompareId = '1';
    const compareId = String(compareIdParam || defaultCompareId);

    // Weeks present
    const weeks = Array.from(new Set(
      matchesAll.map(m => Number(m['Week'])).filter(n => !Number.isNaN(n))
    )).sort((a,b)=>a-b);

    // Choose week
    let week;
    if (weekParam) {
      week = Number(weekParam);
    } else {
      const latest = weeks[weeks.length - 1];
      week = latest;
      const latestMatches = matchesAll.filter(m => Number(m['Week']) === latest);
      const earliest = latestMatches
        .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
        .filter(Boolean).sort((a,b)=>a-b)[0];
      const now = new Date();
      const latestLocked = !!earliest && now >= earliest;
      if (!latestLocked && weeks.includes(latest - 1)) week = latest - 1;
    }

    // Matches for chosen week
    const matches = matchesAll
      .filter(m => Number(m['Week']) === Number(week))
      .sort((a,b)=> Number(a.id) - Number(b.id));

    // Correct results lookup
    const correctByMatch = Object.fromEntries(
      matches.map(m => [ String(m.id), toKey(m['Correct Result']) ])
    );

    // Filter predictions for this week
    const weekPreds = predsAll.filter(p => matches.some(m => String(m.id) === String(p['Match'])));
    const predsFor = (uid) => weekPreds.filter(p => String(p['User']) === String(uid))
                                       .sort((a,b)=> Number(a['Match']) - Number(b['Match']));

    const mine   = predsFor(userId);
    const theirs = predsFor(compareId);

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

    // Lock state
    const earliest = matches
      .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
      .filter(Boolean).sort((a,b)=>a-b)[0];
    const now = new Date();
    const weekLocked = (!!earliest && now >= earliest) || matches.some(m => m['Locked'] === true);

    // Names
    const meUser  = usersAll.find(u => String(u.id) === String(userId));
    const himUser = usersAll.find(u => String(u.id) === String(compareId));

    return {
      week: Number(week),
      availableWeeks: weeks,
      weekLocked,
      users: usersList, // for name dropdown
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
