const { ADALO, listAll } = require('./_adalo.js');
const crypto = require('crypto');

exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl);
    const week = Number(url.searchParams.get('week'));
    const userId = url.searchParams.get('userId');
    if (!week || !userId) return resp(400, 'week & userId required');

    const matches = (await listAll(ADALO.col.matches))
      .filter(m => Number(m['Week']) === week)
      .sort((a,b)=>Number(a.id)-Number(b.id));

    const allPreds = await listAll(ADALO.col.predictions);
    const predsForWeek = allPreds.filter(p => matches.some(m => String(m.id) === String(p['Match'])));

    // % splits per match
    const perMatch = matches.map(m => {
      const ps = predsForWeek.filter(p => String(p['Match']) === String(m.id));
      const total = ps.length || 1;
      const pct = (val) => Math.round(100 * ps.filter(p => String(p['Pick']).toUpperCase() === val).length / total);
      return {
        match_id: m.id,
        home_team: m['Home Team'],
        away_team: m['Away Team'],
        pct: { HOME: pct('HOME'), DRAW: pct('DRAW'), AWAY: pct('AWAY') }
      };
    });

    // Who has my exact 5-pick sequence (ordered by id for stability)
    const mine = predsForWeek
      .filter(p => String(p['User']) === String(userId))
      .sort((a,b)=> Number(a['Match']) - Number(b['Match']));
    const mySeq = mine.map(p => (p['Pick']||'')[0]).join('');
    const myFp = fingerprint(week, mySeq);

    const byUser = {};
    for (const p of predsForWeek) {
      const uid = String(p['User']);
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(p);
    }
    const samePickUsers = Object.entries(byUser)
      .filter(([uid]) => uid !== String(userId))
      .filter(([, arr]) => {
        const seq = arr
          .sort((a,b)=> Number(a['Match']) - Number(b['Match']))
          .map(p => (p['Pick']||'')[0]).join('');
        return fingerprint(week, seq) === myFp;
      })
      .map(([uid]) => uid);

    return resp(200, { perMatch, samePickUsers });
  } catch (e) {
    return resp(500, e.message);
  }
};

function fingerprint(week, seq) {
  return crypto.createHash('sha256').update(`${week}|${seq}`).digest('hex');
}
function resp(status, body) {
  return { statusCode: status, headers: { 'Content-Type':'application/json' }, body: typeof body==='string'? JSON.stringify({error: body}) : JSON.stringify(body) };
}
