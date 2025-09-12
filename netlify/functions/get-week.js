const { ADALO, listAll } = require('./_adalo.js');

exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl);
    const week = Number(url.searchParams.get('week'));
    const userId = url.searchParams.get('userId');
    if (!week || !userId) return resp(400, 'week & userId required');

    // 1) Matches for this week
    const allMatches = await listAll(ADALO.col.matches);
    const matches = allMatches
      .filter(m => Number(m['Week']) === week)
      // stable ordering: by numeric id (or add Match Number and sort on it)
      .sort((a,b) => Number(a.id) - Number(b.id));

    // 2) User's predictions (filter locally)
    const allPreds = await listAll(ADALO.col.predictions);
    const userPreds = allPreds.filter(p => String(p['User']) === String(userId) &&
                                           matches.some(m => String(m.id) === String(p['Match'])));

    // 3) Lock logic — treat the set as locked if now >= earliest "Lockout Time" OR any is Locked
    const now = new Date();
    const earliest = matches
      .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
      .filter(Boolean)
      .sort((a,b)=>a-b)[0];
    const locked = (earliest && now >= earliest) || matches.some(m => m['Locked'] === true);

    return resp(200, { week, locked, matches, predictions: userPreds });
  } catch (e) {
    return resp(500, e.message);
  }
};

function resp(status, body) {
  return { statusCode: status, headers: { 'Content-Type':'application/json' }, body: typeof body==='string'? JSON.stringify({error: body}) : JSON.stringify(body) };
}
