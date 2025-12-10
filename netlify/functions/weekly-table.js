// netlify/functions/weekly-table.js
const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

const U = (s)=> String(s||'').trim().toUpperCase();

// more robust relation helper
function relId(v){
  if (!v) return '';
  if (Array.isArray(v)) return v[0] ?? '';
  if (typeof v === 'object' && v.id != null) return v.id;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed[0] ?? '';
      if (typeof parsed === 'object' && parsed !== null && parsed.id != null) return parsed.id;
    } catch {
      // plain string like "82"
    }
    return v;
  }
  return v;
}

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const week = Number(q.week);
    if (!week) return json(400, { error: 'week required' });

    // 1) Load matches + users (small enough to listAll)
    const [matchesAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.users, 2000),
    ]);

    const matchesAllSafe = matchesAll || [];
    const usersAllSafe   = usersAll   || [];

    // compute available weeks from matches
    const weeksAsc = Array.from(new Set(
      matchesAllSafe
        .map(m => Number(m['Week']))
        .filter(n => !Number.isNaN(n))
    )).sort((a,b)=>a-b);
    const weeksDesc = [...weeksAsc].reverse();

    // matches for the requested week
    const matches = matchesAllSafe
      .filter(m => Number(m['Week']) === week)
      .sort((a,b)=> Number(a.id) - Number(b.id));

    if (!matches.length) {
      return json(200, { week, locked:false, rows:[], matches:[], availableWeeks: weeksDesc });
    }

    // 2) Is week past deadline?
    const earliest = matches
      .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
      .filter(Boolean).sort((a,b)=>a-b)[0];
    const locked = (!!earliest && Date.now() >= earliest.getTime()) || matches.some(m => m['Locked'] === true);

    // 3) Order + correct results for each match
    const orderIds = matches.map(m => String(m.id));
    const correctById = Object.fromEntries(matches.map(m => [String(m.id), U(m['Correct Result'])]));
    const matchIdSet = new Set(orderIds);

    // 4) Pull predictions for THIS week
    let weekPreds = [];
    try {
      // prefer using Week filter (new schema)
      const page = await adaloFetch(
        `${ADALO.col.predictions}?filterKey=Week&filterValue=${encodeURIComponent(week)}`
      );
      const predsForWeek = page?.records ?? page ?? [];
      weekPreds = (predsForWeek || []).filter(p => matchIdSet.has(String(relId(p['Match']))));
    } catch (e) {
      console.error('weekly-table: Week-filtered predictions fetch failed, falling back to listAll', e);
      weekPreds = [];
    }

    // fallback for old data without Week set
    if (!weekPreds.length) {
      try {
        const predsAll = await listAll(ADALO.col.predictions, 20000);
        weekPreds = (predsAll || []).filter(p =>
          matchIdSet.has(String(relId(p['Match'])))
        );
      } catch (e) {
        console.error('weekly-table: fallback listAll(predictions) failed', e);
        return json(500, { error: 'Failed to fetch predictions' });
      }
    }

    // 5) Group by user
    const byUser = {};
    for (const p of weekPreds) {
      const uid = String(relId(p['User']));
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(p);
    }

    const rows = Object.entries(byUser).map(([uid, arr])=>{
      const byMatch = Object.fromEntries(arr.map(p => [String(relId(p['Match'])), p]));
      const picksRaw = orderIds.map(mid => U(byMatch[mid]?.['Pick']));
      const pts      = orderIds.map(mid => Number(byMatch[mid]?.['Points Awarded'] ?? 0));
      const correctB = orderIds.map(mid => {
        const c = correctById[mid];
        const pr = U(byMatch[mid]?.['Pick']);
        return c && pr ? (c === pr) : false;
      });

      // compact picks like 1 / 2 / X
      const toSymbol = p => p==='HOME'?'1':(p==='AWAY'?'2':(p==='DRAW'?'X':'-'));
      const compact = picksRaw.map(toSymbol).join(' ');

      const u = usersAllSafe.find(x => String(x.id) === uid);
      const name = u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${uid}`;
      const points = pts.reduce((s,v)=> s + (isNaN(v)?0:v), 0);

      return { userId: uid, name, week, points, picks: compact, picksRaw, correct: correctB };
    });

    // Sort by points then name
    rows.sort((a,b)=> (b.points - a.points) || a.name.localeCompare(b.name));

    // 6) Expose match meta + whether a result exists for each
    const matchesOut = matches.map(m => ({
      id: m.id,
      home: m['Home Team'],
      away: m['Away Team'],
      correct: U(m['Correct Result'])   // "HOME" | "DRAW" | "AWAY" | ""
    }));

    return json(200, { week, locked, rows, matches: matchesOut, availableWeeks: weeksDesc });
  } catch (e) {
    console.error('weekly-table error', e);
    return json(500, { error: String(e) });
  }
};

function json(status, body){
  return {
    statusCode: status,
    headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
    body: JSON.stringify(body)
  };
}
