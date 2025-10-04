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
    if (!matches.length) return json(200, { week, rows: [], locked:false });

    // Is week past deadline?
    const earliest = matches.map(m=> m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
                            .filter(Boolean).sort((a,b)=>a-b)[0];
    const locked = (!!earliest && Date.now() >= earliest.getTime()) || matches.some(m => m['Locked']===true);

    // Map match order & correct result
    const order = matches.map(m => String(m.id));
    const correctBy = Object.fromEntries(matches.map(m => [String(m.id), U(m['Correct Result'])]));

    // All predictions for this week
    const matchIds = new Set(order);
    const weekPreds = (predsAll||[]).filter(p => matchIds.has(String(relId(p['Match']))));

    // Group by user
    const byUser = {};
    for (const p of weekPreds) {
      const uid = String(relId(p['User']));
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(p);
    }

    const rows = Object.entries(byUser).map(([uid, arr])=>{
      // normalize to match order
      const byMatch = Object.fromEntries(arr.map(p => [String(relId(p['Match'])), p]));
      const picks = order.map(mid => U(byMatch[mid]?.['Pick']));
      const pts   = order.map(mid => Number(byMatch[mid]?.['Points Awarded'] ?? 0));
      const corr  = order.map((mid,i) => (picks[i] && correctBy[mid]) ? (picks[i] === correctBy[mid]) : false);

      // compact picks like H / X / 2
      const mk = (p)=> p==='HOME'?'1':(p==='AWAY'?'2':(p==='DRAW'?'X':'-'));
      const compact = picks.map(mk).join(' ');

      const user = usersAll.find(u => String(u.id) === uid);
      const name = user?.['Username'] || user?.['Name'] || user?.['Full Name'] || `User ${uid}`;
      const points = pts.reduce((s,v)=> s + (isNaN(v)?0:v), 0);
      return { userId: uid, name, week, points, picks: compact, correct: corr, picksRaw: picks };
    });

    // sort by points desc then name
    rows.sort((a,b)=> (b.points - a.points) || a.name.localeCompare(b.name));

    return json(200, { week, locked, rows, matches: matches.map(m=>({id:m.id, home:m['Home Team'], away:m['Away Team']})) });
  } catch (e) {
    return json(500, { error: String(e) });
  }
};

function json(status, body){
  return { statusCode: status, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}, body: JSON.stringify(body) };
}
