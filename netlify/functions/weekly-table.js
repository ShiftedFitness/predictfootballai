// netlify/functions/weekly-table.js
const { ADALO, listAll } = require('./_adalo.js');

const U = (s)=> String(s||'').trim().toUpperCase();
const relId = (v)=> Array.isArray(v) ? (v[0] ?? '') : (v ?? '');

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const week = Number(q.week);
    if (!week) return json(400, { error: 'week required' });

    const [matchesAll, predsAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.predictions, 20000),
      listAll(ADALO.col.users, 2000),
    ]);

    const matches = (matchesAll||[])
      .filter(m => Number(m['Week']) === week)
      .sort((a,b)=> Number(a.id) - Number(b.id));

    if (!matches.length) {
      return json(200, { week, locked:false, rows:[], matches:[] });
    }

    // Is week past deadline?
    const earliest = matches
      .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
      .filter(Boolean).sort((a,b)=>a-b)[0];
    const locked = (!!earliest && Date.now() >= earliest.getTime()) || matches.some(m => m['Locked'] === true);

    // Order + correct results for each match
    const orderIds = matches.map(m => String(m.id));
    const correctById = Object.fromEntries(matches.map(m => [String(m.id), U(m['Correct Result'])]));

    // Pull predictions for this week
    const matchIdSet = new Set(orderIds);
    const weekPreds = (predsAll||[]).filter(p => matchIdSet.has(String(relId(p['Match']))));

    // Group by user
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

      const u = usersAll.find(x => String(x.id) === uid);
      const name = u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${uid}`;
      const points = pts.reduce((s,v)=> s + (isNaN(v)?0:v), 0);

      return { userId: uid, name, week, points, picks: compact, picksRaw, correct: correctB };
    });

    // Sort by points then name
    rows.sort((a,b)=> (b.points - a.points) || a.name.localeCompare(b.name));

    // Expose match meta + whether a result exists for each
    const matchesOut = matches.map(m => ({
      id: m.id,
      home: m['Home Team'],
      away: m['Away Team'],
      correct: U(m['Correct Result'])   // "HOME" | "DRAW" | "AWAY" | ""
    }));

    return json(200, { week, locked, rows, matches: matchesOut });
  } catch (e) {
    return json(500, { error: String(e) });
  }
};

function json(status, body){
  return { statusCode: status, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}, body: JSON.stringify(body) };
}
