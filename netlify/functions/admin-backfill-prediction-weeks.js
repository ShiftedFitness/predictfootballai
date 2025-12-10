// netlify/functions/admin-backfill-prediction-weeks.js
//
// One-off backfill to set Week on predictions that are missing it,
// using the Week from the related Match record.
//
// Only applies to predictions whose Match ID is between 1 and 65.
//
// Usage:
//   POST /.netlify/functions/admin-backfill-prediction-weeks
//   Headers:
//     x-admin-secret: YOUR_ADMIN_SECRET
//
// Response:
//   {
//     ok:true,
//     totalPreds: ...,
//     updated: ...,
//     skippedAlreadyHadWeek: ...,
//     skippedOutsideRange: ...,
//     skippedNoMatch: ...,
//     errors: [...]
//   }

const { ADALO, listAll, adaloFetch } = require('./_adalo.js');

const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// robust relId, same style as elsewhere
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
      // plain string like "55"
    }
    return v;
  }

  return v;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return respond(405, { error: 'POST only' });
    }

    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
      return respond(401, { error: 'Unauthorised' });
    }

    // 1) Load matches + predictions
    const [matchesAll, predsAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.predictions, 20000),
    ]);

    const matches = matchesAll || [];
    const preds   = predsAll   || [];

    // 2) Map: matchId -> week
    const weekByMatchId = {};
    for (const m of matches) {
      const mid = String(m.id);
      const wk  = Number(m['Week']);
      if (!Number.isNaN(wk) && wk > 0) {
        weekByMatchId[mid] = wk;
      }
    }

    let updated = 0;
    let skippedAlreadyHadWeek = 0;
    let skippedOutsideRange   = 0;
    let skippedNoMatch        = 0;
    const errors = [];

    // 3) For each prediction, if Week missing/0 AND matchId between 1 and 65, set Week
    for (const p of preds) {
      const currentWeek = Number(p['Week'] ?? 0);
      if (currentWeek && !Number.isNaN(currentWeek)) {
        skippedAlreadyHadWeek++;
        continue; // already has a Week
      }

      const midRaw = relId(p['Match']);
      const mid    = String(midRaw || '');
      const midNum = Number(mid);

      // only touch matches 1..65
      if (Number.isNaN(midNum) || midNum < 1 || midNum > 65) {
        skippedOutsideRange++;
        continue;
      }

      const wk = weekByMatchId[mid];
      if (!wk) {
        // can't infer week (match missing or no Week on match)
        skippedNoMatch++;
        errors.push({ id: p.id, reason: `No week found for match ${mid}` });
        continue;
      }

      try {
        await adaloFetch(`${ADALO.col.predictions}/${p.id}`, {
          method: 'PUT',
          body: JSON.stringify({ 'Week': wk })
        });
        updated++;
      } catch (e) {
        errors.push({ id: p.id, reason: e.message || String(e) });
      }
    }

    return respond(200, {
      ok: true,
      totalPreds: preds.length,
      updated,
      skippedAlreadyHadWeek,
      skippedOutsideRange,
      skippedNoMatch,
      errors,
    });
  } catch (e) {
    return respond(500, { error: e.message || 'Unknown error' });
  }
};
