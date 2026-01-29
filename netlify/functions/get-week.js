// netlify/functions/get-week.js
// Fetches matches for a given week. Requires either:
// - A valid userId (for users to see their predictions)
// - The x-admin-secret header (for admin access without userId)
const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

function relId(v) {
  if (!v) return '';
  if (Array.isArray(v)) return v[0] ?? '';
  if (typeof v === 'object' && v.id != null) return v.id;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed[0] ?? '';
      if (typeof parsed === 'object' && parsed !== null && parsed.id != null) return parsed.id;
    } catch {}
    return v;
  }
  return v;
}

exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl);
    const week = Number(url.searchParams.get('week'));
    const userId = String(url.searchParams.get('userId') || '').trim();

    // Check for admin access via x-admin-secret header
    const adminSecret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    const isAdmin = process.env.ADMIN_SECRET && adminSecret === process.env.ADMIN_SECRET;

    // ✅ Require week always; require userId OR admin access
    if (!week) {
      return resp(400, 'week parameter required');
    }

    const hasValidUserId = userId && userId !== '0' && userId !== 'undefined' && userId !== 'null';
    if (!hasValidUserId && !isAdmin) {
      return resp(401, 'week & valid userId required (login required)');
    }

    // 1) Matches for this week
    const allMatches = await listAll(ADALO.col.matches, 2000);
    const matches = (allMatches || [])
      .filter(m => Number(m['Week']) === week)
      .sort((a,b) => Number(a.id) - Number(b.id));

    // 2) Lock logic
    const now = new Date();
    const earliest = matches
      .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
      .filter(Boolean)
      .sort((a,b)=>a-b)[0];
    const locked = (earliest && now >= earliest) || matches.some(m => m['Locked'] === true);

    // 3) Predictions: fetch by Week (fast) then filter to this user + these matches
    //    For admin access, return empty predictions (admin doesn't need user predictions)
    let predictionsOut = [];

    if (hasValidUserId) {
      const matchIdSet = new Set(matches.map(m => String(m.id)));

      let predsForWeek = [];
      try {
        const page = await adaloFetch(
          `${ADALO.col.predictions}?filterKey=Week&filterValue=${encodeURIComponent(week)}`
        );
        predsForWeek = page?.records ?? page ?? [];
      } catch (e) {
        // fallback: if Week isn't set on older data
        const allPreds = await listAll(ADALO.col.predictions, 20000);
        predsForWeek = allPreds || [];
      }

      const userPreds = (predsForWeek || []).filter(p => {
        const uid = String(relId(p['User']));
        const mid = String(relId(p['Match']));
        return uid === userId && matchIdSet.has(mid);
      });

      // IMPORTANT: normalize prediction shape for the widget: ensure Match is the matchId string
      predictionsOut = userPreds.map(p => ({
        id: p.id,
        User: String(relId(p['User'])),
        Match: String(relId(p['Match'])),
        Pick: (p['Pick'] || '').toString().trim().toUpperCase(),
        Week: Number(p['Week'] ?? week),
        'Points Awarded': (typeof p['Points Awarded'] === 'number') ? p['Points Awarded'] : undefined
      }));
    }

    return resp(200, { week, locked, matches, predictions: predictionsOut, isAdmin });
  } catch (e) {
    return resp(500, e.message);
  }
};

function resp(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' },
    body: typeof body === 'string'
      ? JSON.stringify({ error: body })
      : JSON.stringify(body)
  };
}
