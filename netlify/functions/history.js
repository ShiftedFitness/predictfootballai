// netlify/functions/history.js
const { ADALO, listAll } = require('./_adalo.js');

function toKey(x){ return String(x).trim().toUpperCase(); } // HOME/DRAW/AWAY

function safePoints(pick, correct, pointsAwarded) {
  // Prefer stored weekly points; fallback to 1/0 by correctness
  if (typeof pointsAwarded === 'number') return pointsAwarded;
  if (!pick || !correct) return 0;
  return toKey(pick) === toKey(correct) ? 1 : 0;
}

exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl);
    const userId = url.searchParams.get('userId');           // REQUIRED
    const compareId = url.searchParams.get('compareId') || '1'; // default AI id = 1
    let weekParam = url.searchParams.get('week');            // optional

    if (!userId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'userId required' }) };
    }

    // Load collections
    const matchesAll = await listAll(ADALO.col.matches, 1000);
    const predsAll   = await listAll(ADALO.col.predictions, 5000);
    const usersAll   = await listAll(ADALO.col.users, 2000);

    // Compile list of weeks that exist
    const weeksSet = new Set(matchesAll.map(m => Number(m['Week'])).filter(n => !isNaN(n)));
    const weeks = Array.from(weeksSet).sort((a,b)=>a-b);

    // Determine default week if not provided:
    // - Take latest week (max)
    // - If earliest lockout for latest week is in future AND there is at least week-1, use latest-1
    let week;
    if (weekParam) {
      week = Number(weekParam);
    } else {
      const latest = weeks[weeks.length - 1];
      week = latest;
      const latestMatches = matchesAll.filter(m => Number(m['Week']) === latest);
      const earliest = latestMatches
        .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
        .filter(Boolean)
        .sort((a,b)=>a-b)[0];
      const now = new Date();
      const latestLockedByTime = earliest && now >= earliest;
      if (!latestLockedByTime && weeks.includes(latest - 1)) {
        week = latest - 1;
      }
    }

    // Get matches for chosen week (ordered by id)
    const matches = matchesAll
      .filter(m => Number(m['Week']) === Number(week))
      .sort((a,b)=>Number(a.id) - Number(b.id));

    // Helper: username
    const nameOf = (id) => {
      const u = usersAll.find(x => String(x.id) === String(id));
      return u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${id}`;
    };

    const correctKeyByMatch = Object.fromEntries(matches.map(m => [String(m.id), toKey(m['Correct Result'] || '')]));

    // Pull predictions for user & comparator in this week
    const predsForWeek = predsAll.filter(p => matches.some(m => String(m.id) === String(p['Match'])));
    const byUser = (uid) => predsForWeek.filter(p => String(p['User']) === String(uid));

    const mine = byUser(userId).sort((a,b)=>Number(a['Match']) - Number(b['Match']));
    const theirs = byUser(compareId).sort((a,b)=>Number(a['Match']) - Number(b['Match']));

    // Build rows
    const rows = matches.map(m => {
      const meP  = mine.find(p => String(p['Match']) === String(m.id));
      const himP = theirs.find(p => String(p['Match']) === String(m.id));
      const myPick   = toKey(meP?.['Pick'] || '');
      const hisPick  = toKey(himP?.['Pick'] || '');
      const correct  = correctKeyByMatch[String(m.id)] || '';
      const myPts    = safePoints(myPick, correct, typeof meP?.['Points Awarded'] === 'number' ? meP['Points Awarded'] : undefined);
      const hisPts   = safePoints(hisPick, correct, typeof himP?.['Points Awarded'] === 'number' ? himP['Points Awarded'] : undefined);
      const myCorrect = (myPick && correct) ? (myPick === correct) : false;

      return {
        match_id: m.id,
        fixture: `${m['Home Team']} v ${m['Away Team']}`,
        myPick, hisPick, correct,
        myPoint: myPts, hisPoint: hisPts,
        myCorrect
      };
    });

    // Summaries
    const myCorrectCt  = rows.filter(r => r.myCorrect).length;
    const myTotalCt    = rows.filter(r => r.myPick).length; // only counted if picked
    const myPoints     = rows.reduce((s,r)=> s + (Number(r.myPoint) || 0), 0);

    const hisCorrectCt = rows.filter(r => toKey(r.hisPick) && r.hisPick === r.correct).length;
    const hisTotalCt   = rows.filter(r => r.hisPick).length;
    const hisPoints    = rows.reduce((s,r)=> s + (Number(r.hisPoint) || 0), 0);

    const myAcc  = myTotalCt > 0 ? myCorrectCt / myTotalCt : 0;
    const hisAcc = hisTotalCt > 0 ? hisCorrectCt / hisTotalCt : 0;

    // Deadline state for this week
    const earliest = matches
      .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
      .filter(Boolean)
      .sort((a,b)=>a-b)[0];
    const now = new Date();
    const weekLocked = !!earliest && now >= earliest || matches.some(m => m['Locked'] === true);

    return {
      week: Number(week),
      availableWeeks: weeks,
      weekLocked,
      me: {
        id: String(userId),
        name: nameOf(userId),
        correct: myCorrectCt,
        total: myTotalCt,
        accuracy: myAcc,
        points: myPoints
      },
      compare: {
        id: String(compareId),
        name: nameOf(compareId),
        correct: hisCorrectCt,
        total: hisTotalCt,
        accuracy: hisAcc,
        points: hisPoints
      },
      rows
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
