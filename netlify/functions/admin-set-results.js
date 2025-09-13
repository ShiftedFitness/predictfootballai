const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return resp(405, 'POST only');
    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) return resp(401, 'Unauthorised');

    const { week, results } = JSON.parse(event.body || '{}');
    if (!week || !Array.isArray(results) || !results.length) return resp(400, 'week and results[] required');

    // Fetch matches for this week
    const matches = (await listAll(ADALO.col.matches)).filter(m => Number(m['Week']) === Number(week));
    if (!matches.length) return resp(400, `No matches for week ${week}`);

    // Apply results
    const resultById = Object.fromEntries(results.map(r => [String(r.match_id), String(r.correct || '').toUpperCase()]));
    const updates = [];
    for (const m of matches) {
      const correct = resultById[String(m.id)];
      if (!['HOME','DRAW','AWAY'].includes(correct)) continue;
      const body = { 'Correct Result': correct, 'Locked': true }; // lock week once results entered
      const updated = await adaloFetch(`${ADALO.col.matches}/${m.id}`, { method: 'PUT', body: JSON.stringify(body) });
      updates.push(updated);
    }

    return resp(200, { ok: true, updated: updates.length });
  } catch (e) {
    return resp(500, e.message);
  }
};

function resp(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body) };
}
