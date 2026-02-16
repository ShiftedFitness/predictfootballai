// netlify/functions/admin-get-predictions-by-match.js
//
// Usage:
//   GET /.netlify/functions/admin-get-predictions-by-match?matchId=88
//   Header: x-admin-secret: YOUR_ADMIN_SECRET
//
// Optional: support multiple IDs:
//   ?matchId=88,89,90

const { sb, respond, requireAdmin, handleOptions } = require('./_supabase.js');

const displayName = (u) =>
  u?.username || u?.full_name || `User ${u?.id ?? ''}`;

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    if (event.httpMethod !== 'GET') {
      return respond(405, 'GET only');
    }

    const adminErr = requireAdmin(event);
    if (adminErr) return adminErr;

    const q = event.queryStringParameters || {};
    const matchIdParam = q.matchId;

    if (!matchIdParam) {
      return respond(400, 'matchId query param required (e.g. ?matchId=88 or ?matchId=88,89)');
    }

    // support comma-separated IDs: "88,89,90"
    const matchIdsRequested = String(matchIdParam)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (!matchIdsRequested.length) {
      return respond(400, 'No valid match IDs provided');
    }

    const client = sb();

    // Load predictions + users
    const [
      { data: predsAll, error: predError },
      { data: usersAll, error: usersError }
    ] = await Promise.all([
      client.from('predict_predictions').select('*'),
      client.from('predict_users').select('*')
    ]);

    if (predError) throw new Error(`Failed to fetch predictions: ${predError.message}`);
    if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`);

    const usersById = Object.fromEntries(
      (usersAll || []).map(u => [String(u.id), u])
    );

    const matchIdSet = new Set(matchIdsRequested.map(String));

    const rows = (predsAll || [])
      .filter(p => matchIdSet.has(String(p.match_id)))
      .map(p => {
        const uid = String(p.user_id);
        const mid = String(p.match_id);
        const user = usersById[uid];

        return {
          id: p.id,                         // prediction record id
          userId: uid,
          userName: displayName(user),
          matchId: mid,
          week: Number(p.week_number ?? 0),
          pick: p.pick || null,
          pointsAwarded: typeof p.points_awarded === 'number'
            ? Number(p.points_awarded)
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
    return respond(500, e.message || String(e));
  }
};
