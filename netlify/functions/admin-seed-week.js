const { ADALO, adaloFetch } = require('./_adalo.js');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return r(405, 'POST only');
    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) return r(401, 'Unauthorised');

    const { week, lockoutTime, fixtures } = JSON.parse(event.body || '{}');
    // fixtures: [{home:"...", away:"..."}, ...]  (expect 5)
    if (!week || !lockoutTime || !Array.isArray(fixtures) || fixtures.length !== 5)
      return r(400, 'week, lockoutTime, and 5 fixtures required');

    const created = [];
    for (const f of fixtures) {
      const body = {
        'Week': Number(week),
        'Home Team': f.home,
        'Away Team': f.away,
        'Lockout Time': lockoutTime,
        'Locked': false,
        'Correct Result': ''
      };
      const rec = await adaloFetch(`${ADALO.col.matches}`, { method:'POST', body: JSON.stringify(body) });
      created.push(rec);
    }
    return r(200, { ok:true, created: created.length });
  } catch (e) {
    return r(500, e.message);
  }
};

function r(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body) };
}
