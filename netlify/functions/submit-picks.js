// netlify/functions/submit-picks.js
const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

// Robust relation ID extractor (handles array, object, JSON string, raw)
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
      // not JSON
    }
    return v;
  }

  return v;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return resp(405, 'POST only');

    const body = JSON.parse(event.body || '{}');
    const userIdRaw = body.userId;
    const weekRaw = body.week;
    const picks = body.picks;

    // ✅ Login required: reject missing / invalid userId
    const userId = String(userIdRaw || '').trim();
    if (!userId || userId === '0' || userId === 'null' || userId === 'undefined') {
      return resp(401, 'Login required (valid userId missing)');
    }

    const weekNum = Number(weekRaw);
    if (!weekNum || !Array.isArray(picks) || picks.length !== 5) {
      return resp(400, 'userId, week, and 5 picks required');
    }

    // 1) Fetch matches for this week (matches table is small enough to listAll)
    const matches = (await listAll(ADALO.col.matches, 2000))
      .filter(m => Number(m['Week']) === weekNum)
      .sort((a, b) => Number(a.id) - Number(b.id));

    if (matches.length !== 5) {
      return resp(400, 'Expected 5 matches for this week.');
    }

    // Build set of valid match IDs for safety
    const matchIdSet = new Set(matches.map(m => String(m.id)));

    // 2) Check deadline/lock
    const now = new Date();
    const earliest = matches
      .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
      .filter(Boolean)
      .sort((a, b) => a - b)[0];

    const deadlinePassed =
      (earliest && now >= earliest) ||
      matches.some(m => m['Locked'] === true);

    if (deadlinePassed) {
      return resp(403, 'Deadline passed. Picks locked.');
    }

    // 3) Existing predictions for THIS USER in THIS WEEK
    //    Prefer Week filter (fast). Fallback for older data if Week filter returns nothing.
    let predsForWeek = [];
    try {
      const predsPage = await adaloFetch(
        `${ADALO.col.predictions}?filterKey=Week&filterValue=${encodeURIComponent(weekNum)}`
      );
      predsForWeek = predsPage?.records ?? predsPage ?? [];
    } catch (e) {
      predsForWeek = [];
    }

    // If Week filter returns nothing, fallback to scanning (should be rare now)
    if (!Array.isArray(predsForWeek) || predsForWeek.length === 0) {
      const allPreds = await listAll(ADALO.col.predictions, 20000);
      predsForWeek = allPreds || [];
    }

    const mine = predsForWeek.filter(p => {
      const uid = String(relId(p['User']));
      const mid = String(relId(p['Match']));
      return uid === userId && matchIdSet.has(mid);
    });

    const byMatchId = Object.fromEntries(
      mine.map(p => [String(relId(p['Match'])), p])
    );

    // 4) Upsert predictions (always write Week)
    const results = [];
    for (const p of picks) {
      const matchId = String(p.match_id || '').trim();
      const pickVal = String(p.pick || '').trim().toUpperCase(); // HOME/DRAW/AWAY

      if (!matchId || !matchIdSet.has(matchId)) {
        return resp(400, `Invalid match_id ${matchId} for week ${weekNum}`);
      }

      if (!['HOME', 'DRAW', 'AWAY'].includes(pickVal)) {
        return resp(400, 'Pick must be HOME/DRAW/AWAY');
      }

      const payload = {
        'User': userId,
        'Match': matchId,
        'Pick': pickVal,
        'Week': weekNum
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
  return {
    statusCode: status,
    headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' },
    body: typeof body === 'string'
      ? JSON.stringify({ error: body })
      : JSON.stringify(body)
  };
}
