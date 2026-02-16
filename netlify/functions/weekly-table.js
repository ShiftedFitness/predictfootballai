// netlify/functions/weekly-table.js
// Returns per-week table used by league_v2.html "Matchweek" tab
const { sb, respond, handleOptions } = require('./_supabase.js');

const U = (s) => String(s || '').trim().toUpperCase();

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    const q = event.queryStringParameters || {};
    const week = Number(q.week);
    if (!week) return respond(400, 'week required');

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

    const matchesAllSafe = matchesAll || [];
    const usersAllSafe = usersAll || [];

    // Helper: is a given week locked?
    const isWeekLocked = (wk, matches) => {
      const ms = (matches || []).filter(m => Number(m.week_number) === Number(wk));
      if (!ms.length) return false;
      const earliest = ms
        .map(m => m.lockout_time ? new Date(m.lockout_time) : null)
        .filter(Boolean)
        .sort((a, b) => a - b)[0];
      const now = new Date();
      return (!!earliest && now >= earliest.getTime()) || ms.some(m => m.locked === true);
    };

    // all weeks that exist
    const weeksAsc = Array.from(new Set(
      matchesAllSafe
        .map(m => Number(m.week_number))
        .filter(n => !Number.isNaN(n))
    )).sort((a, b) => a - b);
    const weeksDesc = [...weeksAsc].reverse();

    // only *locked* weeks are "available" to view picks
    const availableWeeks = weeksDesc.filter(w => isWeekLocked(w, matchesAllSafe));

    const matches = matchesAllSafe
      .filter(m => Number(m.week_number) === week)
      .sort((a, b) => Number(a.id) - Number(b.id));

    if (!matches.length) {
      return respond(200, { week, locked: false, rows: [], matches: [], availableWeeks });
    }

    // 2) Is THIS week past deadline?
    const earliest = matches
      .map(m => m.lockout_time ? new Date(m.lockout_time) : null)
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    const locked = (!!earliest && Date.now() >= earliest.getTime()) || matches.some(m => m.locked === true);

    // 3) Order + correct results for each match
    const orderIds = matches.map(m => String(m.id));
    const correctById = Object.fromEntries(matches.map(m => [String(m.id), U(m.correct_result)]));
    const matchIdSet = new Set(orderIds);

    // If week is NOT locked → do NOT expose picks at all
    if (!locked) {
      const matchesOut = matches.map(m => ({
        id: m.id,
        home: m.home_team,
        away: m.away_team,
        correct: U(m.correct_result)
      }));
      return respond(200, { week, locked, rows: [], matches: matchesOut, availableWeeks });
    }

    // 4) Pull predictions for THIS week
    const { data: weekPreds, error: predError } = await client
      .from('predict_predictions')
      .select('*')
      .eq('week_number', week);

    if (predError) throw new Error(`Failed to fetch predictions: ${predError.message}`);

    const validWeekPreds = (weekPreds || []).filter(p =>
      matchIdSet.has(String(p.match_id))
    );

    // 5) Group by user
    const byUser = {};
    for (const p of validWeekPreds) {
      const uid = String(p.user_id);
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(p);
    }

    const rows = Object.entries(byUser).map(([uid, arr]) => {
      const byMatch = Object.fromEntries(arr.map(p => [String(p.match_id), p]));
      const picksRaw = orderIds.map(mid => U(byMatch[mid]?.pick));
      const pts = orderIds.map(mid => Number(byMatch[mid]?.points_awarded ?? 0));
      const correctB = orderIds.map(mid => {
        const c = correctById[mid];
        const pr = U(byMatch[mid]?.pick);
        return c && pr ? (c === pr) : false;
      });

      // compact picks like 1 / 2 / X
      const toSymbol = p => p === 'HOME' ? '1' : (p === 'AWAY' ? '2' : (p === 'DRAW' ? 'X' : '-'));
      const compact = picksRaw.map(toSymbol).join(' ');

      const u = usersAllSafe.find(x => String(x.id) === uid);
      const name = u?.username || u?.full_name || `User ${uid}`;
      const points = pts.reduce((s, v) => s + (isNaN(v) ? 0 : v), 0);

      return { userId: uid, name, week, points, picks: compact, picksRaw, correct: correctB };
    });

    // Sort by points then name
    rows.sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name));

    // 6) Expose match meta + whether a result exists for each
    const matchesOut = matches.map(m => ({
      id: m.id,
      home: m.home_team,
      away: m.away_team,
      correct: U(m.correct_result)
    }));

    return respond(200, { week, locked, rows, matches: matchesOut, availableWeeks });
  } catch (e) {
    console.error('weekly-table error', e);
    return respond(500, e.message);
  }
};
