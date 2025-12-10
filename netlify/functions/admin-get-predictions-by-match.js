// netlify/functions/admin-get-predictions-by-match.js
//
// Usage:
//   GET /.netlify/functions/admin-get-predictions-by-match?matchId=88
//   Header: x-admin-secret: YOUR_ADMIN_SECRET
//
// Optional: support multiple IDs:
//   ?matchId=88,89,90

const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

// robust relation helper (same style as elsewhere)
function relId(v) {
  if (!v) return '';

  if (Array.isArray(v)) return v[0] ?? '';

  if (typeof v === 'object' && v.id != null) return v.id;

  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed[0] ?? '';
      if (typeof parsed === 'object' && parsed !== null && parsed.id != null) return parsed.id;
    } catch {
      // plain string like "88"
    }
    return v;
  }

  return v;
}

const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const displayName = (u) =>
  u?.['Username'] || u?.['Name'] || u?.['Full Name'] || `User ${u?.id ?? ''}`;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return respond(405, { error: 'GET only' });
    }

    // admin auth
    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
      return respond(401, { error: 'Unauthorised' });
    }

    const q = event.queryStringParameters || {};
    const matchIdParam = q.matchId;

    if (!matchIdParam) {
      return respond(400, { error: 'matchId query param required (e.g. ?matchId=88 or ?matchId=88,89)' });
    }

    // support comma-separated IDs: "88,89,90"
    const matchIdsRequested = String(matchIdParam)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (!matchIdsRequested.length) {
      return respond(400, { error: 'No valid match IDs provided' });
    }

    const matchIdSet = new Set(matchIdsRequested.map(String));

    // Load predictions + users
    const [predsAll, usersAll] = await Promise.all([
      listAll(ADALO.col.predictions, 20000),
      listAll(ADALO.col.users, 5000),
    ]);

    const usersById = Object.fromEntries(
      (usersAll || []).map(u => [ String(u.id), u ])
    );

    const rows = (predsAll || [])
      .filter(p => matchIdSet.has(String(relId(p['Match']))))
      .map(p => {
        const uid = String(relId(p['User']));
        const mid = String(relId(p['Match']));
        const user = usersById[uid];

        return {
          id: p.id,                         // prediction record id
          userId: uid,
          userName: displayName(user),
          matchId: mid,
          week: Number(p['Week'] ?? 0),
          pick: p['Pick'] || null,
          pointsAwarded: typeof p['Points Awarded'] === 'number'
            ? Number(p['Points Awarded'])
            : null,
          raw: p                            // include full record in case you want it
        };
      });

    // sort nicely: by matchId, then userName
    rows.sort((a, b) =>
      (Number(a.matchId) - Number(b.matchId)) ||
      a.userName.localeCompare(b.userName)
    );

    return respond(200, {
      ok: true,
      requestedMatchIds: matchIdsRequested,
      total: rows.length,
      rows,
    });
  } catch (e) {
    console.error('admin-get-predictions-by-match error:', e);
    return respond(500, { error: e.message || String(e) });
  }
};
