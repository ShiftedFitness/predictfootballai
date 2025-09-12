const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return resp(405, 'POST only');
    const { userId, week, picks } = JSON.parse(event.body || '{}');
    if (!userId || !week || !Array.isArray(picks) || picks.length !== 5)
      return resp(400, 'userId, week, and 5 picks required');

    // Fetch matches for week
    const matches = (await listAll(ADALO.col.matches))
      .filter(m => Number(m['Week']) === Number(week))
      .sort((a,b)=>Number(a.id)-Number(b.id));

    if (matches.length !== 5) return resp(400, 'Expected 5 matches for this week.');

    // Check deadline/lock
    const now = new Date();
    const earliest = matches
      .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
      .filter(Boolean)
      .sort((a,b)=>a-b)[0];
    const deadlinePassed = (earliest && now >= earliest) || matches.some(m => m['Locked'] === true);
    if (deadlinePassed) return resp(403, 'Deadline passed. Picks locked.');

    // Existing predictions for this user in these matches
    const allPreds = await listAll(ADALO.col.predictions);
    const mine = allPreds.filter(p => String(p['User']) === String(userId));
    const byMatchId = Object.fromEntries(mine.map(p => [String(p['Match']), p]));

    // Upsert predictions
    const results = [];
    for (const p of picks) {
      const matchId = String(p.match_id);
      const pickVal = String(p.pick || '').toUpperCase(); // HOME/DRAW/AWAY
      if (!['HOME','DRAW','AWAY'].includes(pickVal)) return resp(400, 'Pick must be HOME/DRAW/AWAY');

      const payload = {
        'User': userId,
        'Match': matchId,
        'Pick': pickVal
      };

      const ex = byMatchId[matchId];
      if (ex) {
        const updated = await adaloFetch(`${ADALO.col.predictions}/${ex.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        results.push(updated);
      } else {
        const created = await adaloFetch(`${ADALO.col.predictions}`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        results.push(created);
      }
    }

    return resp(200, { ok: true, saved: results.length });
  } catch (e) {
    return resp(500, e.message);
  }
};

function resp(status, body) {
  return { statusCode: status, headers: { 'Content-Type':'application/json' }, body: typeof body==='string'? JSON.stringify({error: body}) : JSON.stringify(body) };
}
