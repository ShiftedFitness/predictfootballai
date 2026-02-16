// netlify/functions/history.js
const { sb, respond, handleOptions } = require('./_supabase.js');

const toKey = (x) => String(x ?? '').trim().toUpperCase(); // HOME/DRAW/AWAY

function sameId(a, b) {
  return String(a) === String(b);
}

function displayName(u) {
  return u?.username || u?.full_name || `User ${u?.id ?? ''}`;
}

function safePoints(pick, correct, pointsAwarded) {
  if (typeof pointsAwarded === 'number') return pointsAwarded;
  if (!pick || !correct) return 0;
  return toKey(pick) === toKey(correct) ? 1 : 0;
}

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    const q = event.queryStringParameters || {};
    const userIdParam = q.userId;
    const currentWeekQ = q.week;
    const viewWeekQ = q.viewWeek;
    const compareIdQ = q.compareId;

    if (!userIdParam) return respond(400, 'userId required');
    const userId = String(userIdParam);
    const compareId = String(compareIdQ || '1'); // default AI=1

    const client = sb();

    // 1) Load matches + users
    const [
      { data: matchesAll, error: matchError },
      { data: usersAll, error: usersError }
    ] = await Promise.all([
      client.from('predict_matches').select('*'),
      client.from('predict_users').select('*')
    ]);

    if (matchError) throw new Error(`Failed to fetch matches: ${matchError.message}`);
    if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`);

    matchesAll = matchesAll || [];
    usersAll = usersAll || [];

    // 2) Weeks present
    const weeksAsc = Array.from(
      new Set(
        matchesAll
          .map((m) => Number(m.week_number))
          .filter((n) => !Number.isNaN(n))
      )
    ).sort((a, b) => a - b);
    const weeksDesc = [...weeksAsc].reverse();

    const isWeekLocked = (wk) => {
      const ms = matchesAll.filter((m) => Number(m.week_number) === Number(wk));
      if (!ms.length) return false;
      const earliest = ms
        .map((m) => (m.lockout_time ? new Date(m.lockout_time) : null))
        .filter(Boolean)
        .sort((a, b) => a - b)[0];
      const now = new Date();
      return (
        (earliest && now >= earliest.getTime()) ||
        ms.some((m) => m.locked === true)
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
      .filter((m) => Number(m.week_number) === Number(viewWeek))
      .sort((a, b) => Number(a.id) - Number(b.id));

    const correctByMatch = Object.fromEntries(
      matches.map((m) => [String(m.id), toKey(m.correct_result)])
    );
    const matchIdSet = new Set(matches.map((m) => String(m.id)));

    let weekPreds = [];

    // 5) Only fetch predictions if the week is locked.
    if (weekLocked) {
      const { data: predRows, error: predError } = await client
        .from('predict_predictions')
        .select('*')
        .eq('week_number', viewWeek);

      if (predError) {
        console.error('history.js: predictions fetch failed', predError);
      } else {
        weekPreds = (predRows || []).filter((p) =>
          matchIdSet.has(String(p.match_id))
        );
      }
    }

    // 6) Users list for dropdown (locked weeks only)
    let usersList = usersAll.map((u) => ({
      id: String(u.id),
      name: displayName(u),
    }));
    if (!usersList.length && weekPreds.length) {
      const uniq = Array.from(
        new Set(weekPreds.map((p) => String(p.user_id)))
      );
      usersList = uniq.map((id) => ({ id, name: `User ${id}` }));
    }
    usersList.sort((a, b) => a.name.localeCompare(b.name));

    // 7) Per-user predictions
    const forUser = (uid) =>
      weekPreds
        .filter((p) => sameId(p.user_id, uid))
        .sort(
          (a, b) =>
            Number(a.match_id) - Number(b.match_id)
        );

    const mine = forUser(userId);
    const theirs = forUser(compareId);

    // 8) Rows for the table
    const rows = matches.map((m) => {
      const mid = String(m.id);
      const me = mine.find((p) => String(p.match_id) === mid);
      const him = theirs.find((p) => String(p.match_id) === mid);

      const myPick = weekLocked ? toKey(me?.pick || '') : '';
      const hisPick = weekLocked ? toKey(him?.pick || '') : '';
      const correct = correctByMatch[mid] || '';

      const myPt = weekLocked
        ? safePoints(
          myPick,
          correct,
          typeof me?.points_awarded === 'number'
            ? me.points_awarded
            : undefined
        )
        : 0;
      const hisPt = weekLocked
        ? safePoints(
          hisPick,
          correct,
          typeof him?.points_awarded === 'number'
            ? him.points_awarded
            : undefined
        )
        : 0;

      return {
        match_id: m.id,
        fixture: `${m.home_team} v ${m.away_team}`,
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

    return respond(200, {
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
    return respond(500, e.message);
  }
};
