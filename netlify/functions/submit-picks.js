// netlify/functions/submit-picks.js
const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

// Robust relation ID extractor (handles array, object, JSON string, raw)
function relId(v) {
  if (!v) return '';

  // [66]
  if (Array.isArray(v)) return v[0] ?? '';

  // { id: 66 }
  if (typeof v === 'object' && v.id != null) return v.id;

  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed[0] ?? '';
      if (typeof parsed === 'object' && parsed !== null && parsed.id != null) return parsed.id;
    } catch {
      // not JSON, just a string like "66"
    }
    return v;
  }

  return v;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return resp(405, 'POST only');

    const { userId, week, picks } = JSON.parse(event.body || '{}');
    if (!userId || !week || !Array.isArray(picks) || picks.length !== 5) {
      return resp(400, 'userId, week, and 5 picks required');
    }

    const weekNum = Number(week);

    // 1) Fetch matches for this week
    const matches = (await listAll(ADALO.col.matches))
      .filter(m => Number(m['Week']) === weekNum)
      .sort((a, b) => Number(a.id) - Number(b.id));

    if (matches.length !== 5) {
      return resp(400, 'Expected 5 matches for this week.');
    }

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
    //    Use filterKey=Week so we don't pull the whole predictions table
    const predsPage = await adaloFetch(
      `${ADALO.col.predictions}?filterKey=Week&filterValue=${encodeURIComponent(weekNum)}`
    );
    const predsForWeek = predsPage?.records ?? predsPage ?? [];

    const mine = predsForWeek.filter(
      p => String(relId(p['User'])) === String(userId)
    );

    const byMatchId = Object.fromEntries(
      mine.map(p => [String(relId(p['Match'])), p])
    );

    // 4) Upsert predictions (always write Week)
    const results = [];
    for (const p of picks) {
      const matchId = String(p.match_id);
      const pickVal = String(p.pick || '').toUpperCase(); // HOME/DRAW/AWAY

      if (!['HOME', 'DRAW', 'AWAY'].includes(pickVal)) {
        return resp(400, 'Pick must be HOME/DRAW/AWAY');
      }

      const payload = {
        'User': userId,
        'Match': matchId,
        'Pick': pickVal,
        'Week': weekNum   // 👈 NEW: store week on the prediction
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
    headers: { 'Content-Type':'application/json' },
    body: typeof body === 'string'
      ? JSON.stringify({ error: body })
      : JSON.stringify(body)
  };
}
