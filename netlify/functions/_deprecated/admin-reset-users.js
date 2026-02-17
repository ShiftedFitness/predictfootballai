// netlify/functions/admin-reset-users.js
const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body),
});

function findKey(rec, label) {
  const want = label.toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
  for (const k of Object.keys(rec)) {
    const norm = k.toLowerCase().replace(/\s+/g, '').replace(/_/g, '');
    if (norm === want) return k;
  }
  return null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return respond(405, 'POST only');

    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
      return respond(401, 'Unauthorised');
    }

    const { resetWeek } = JSON.parse(event.body || '{}');
    const baseWeek = typeof resetWeek === 'number' ? resetWeek : Number(resetWeek || 1);

    const users = await listAll(ADALO.col.users, 5000);

    const updates = [];
    for (const u of users) {
      const ck = findKey(u, 'Current Week');

      const body = {
        'Points': 0,
        'Correct Results': 0,
        'Incorrect Results': 0,
        'FH': 0,
        'Blanks': 0,
      };

      // reset Current Week to baseline
      body[ck || 'Current Week'] = baseWeek;

      await adaloFetch(`${ADALO.col.users}/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      updates.push({
        uid: u.id,
        name: u['Username'] || u['Name'] || u['Full Name'] || `User ${u.id}`,
      });
    }

    return respond(200, {
      ok: true,
      usersReset: updates.length,
      resetWeek: baseWeek,
    });
  } catch (e) {
    return respond(500, e.message || 'Unknown error');
  }
};
