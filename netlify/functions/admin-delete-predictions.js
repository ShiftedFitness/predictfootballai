// netlify/functions/admin-delete-predictions.js
//
// DELETE multiple predictions by ID.
// Usage:
//   POST /.netlify/functions/admin-delete-predictions
//   Header: x-admin-secret
//   Body: { "ids": [77,78,...] }

const { ADALO, adaloFetch } = require('./_adalo.js');

const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST')
      return respond(405, { error: 'POST only' });

    const secret = (event.headers['x-admin-secret'] || '').trim();
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
        await adaloFetch(`${ADALO.col.predictions}/${id}`, {
          method: 'DELETE'
        });
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
