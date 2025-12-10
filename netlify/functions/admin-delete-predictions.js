// netlify/functions/admin-delete-predictions.js
//
// DELETE multiple predictions by ID.
// Usage:
//   POST /.netlify/functions/admin-delete-predictions
//   Header: x-admin-secret
//   Body: { "ids": [77,78,...] }

const { ADALO } = require('./_adalo.js');

const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// direct delete without trying to parse JSON
async function adaloDeletePrediction(id, attempt = 0) {
  const url = `${ADALO.base}/${ADALO.col.predictions}/${id}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${ADALO.key}`,
      'Content-Type': 'application/json'
    }
  });

  if (res.ok) {
    // 204 No Content is fine – we don't try to res.json() here
    return true;
  }

  const RETRYABLE = [429, 500, 502, 503, 504];
  if (RETRYABLE.includes(res.status) && attempt < 3) {
    const base = 300;
    const delay = base * Math.pow(2, attempt) + Math.floor(Math.random() * 150);
    await new Promise(r => setTimeout(r, delay));
    return adaloDeletePrediction(id, attempt + 1);
  }

  const text = await res.text().catch(() => '');
  throw new Error(`Adalo DELETE ${id} ${res.status}: ${text || res.statusText}`);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST')
      return respond(405, { error: 'POST only' });

    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET)
      return respond(401, { error: 'Unauthorised' });

    const body = JSON.parse(event.body || '{}');
    const ids = Array.isArray(body.ids) ? body.ids : [];

    if (!ids.length)
      return respond(400, { error: 'ids array required' });

    const deleted = [];
    const errors = [];

    for (const id of ids) {
      try {
        await adaloDeletePrediction(id);
        deleted.push(id);
      } catch (e) {
        errors.push({ id, error: e.message || String(e) });
      }
    }

    return respond(200, {
      ok: true,
      deleted,
      errors,
    });
  } catch (e) {
    return respond(500, { error: e.message || 'Unknown error' });
  }
};
