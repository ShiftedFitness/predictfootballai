// netlify/functions/admin-import-predictions.js
const { ADALO, adaloFetch, listAll } = require('./_adalo.js');

const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body),
});

function U(s) {
  return String(s || '').trim().toUpperCase();
}

// Normalise picks: accepts "H", "HOME", "1", etc.
function normalisePick(raw) {
  const u = U(raw);
  if (u === 'H' || u === 'HOME' || u === '1') return 'HOME';
  if (u === 'A' || u === 'AWAY' || u === '2') return 'AWAY';
  if (u === 'D' || u === 'DRAW' || u === 'X' || u === '0') return 'DRAW';
  return u;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return respond(405, 'POST only');

    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
      return respond(401, 'Unauthorised');
    }

    const body = JSON.parse(event.body || '{}');
    const { predictions, overwriteExisting, defaultWeek } = body;

    if (!Array.isArray(predictions) || predictions.length === 0) {
      return respond(400, 'predictions array required');
    }

    const defWeek = defaultWeek != null ? Number(defaultWeek) : null;

    // Load existing predictions so we can upsert
    const existing = await listAll(ADALO.col.predictions, 5000);

    // key: week-userId-matchId -> prediction record
    const index = new Map();
    for (const p of existing) {
      const w = p['Week'] != null ? Number(p['Week']) : null;
      const uid = String(p['User']);
      const mid = String(p['Match']);
      if (w && uid && mid) {
        const key = `${w}-${uid}-${mid}`;
        if (!index.has(key)) index.set(key, p);
      }
    }

    let created = 0;
    let updated = 0;
    const errors = [];

    for (let i = 0; i < predictions.length; i++) {
      const row = predictions[i];
      const uid = row.userId != null ? String(row.userId) : null;
      const mid = row.matchId != null ? String(row.matchId) : null;
      const w   = row.week != null ? Number(row.week) : defWeek;
      const pickNorm = normalisePick(row.pick);

      if (!uid || !mid || !w || !['HOME', 'AWAY', 'DRAW'].includes(pickNorm)) {
        errors.push({ index: i, reason: 'invalid row', row });
        continue;
      }

      const key = `${w}-${uid}-${mid}`;
      const existingPred = index.get(key);

      const payload = {
        'User': uid,
        'Match': mid,
        'Week': w,
        'Pick': pickNorm,
      };

      try {
        if (existingPred) {
          if (overwriteExisting) {
            const updatedRec = await adaloFetch(`${ADALO.col.predictions}/${existingPred.id}`, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
            updated++;
          } // else skip
        } else {
          const createdRec = await adaloFetch(`${ADALO.col.predictions}`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          created++;
        }
      } catch (e) {
        errors.push({ index: i, reason: e.message || String(e), row });
      }
    }

    return respond(200, {
      ok: true,
      created,
      updated,
      skipped: predictions.length - created - updated - errors.length,
      errors,
    });
  } catch (e) {
    return respond(500, e.message || 'Unknown error');
  }
};
