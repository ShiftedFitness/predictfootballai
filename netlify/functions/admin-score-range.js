// netlify/functions/admin-score-range.js
//
// Batch-score a range of weeks by reusing admin-score-week.
//
// Usage (after resetting users back to 0):
//   POST /.netlify/functions/admin-score-range
//   Headers:
//     x-admin-secret: YOUR_ADMIN_SECRET
//   Body:
//     { "startWeek": 1, "endWeek": 15, "force": true }
//
// This will call admin-score-week for each week in [startWeek..endWeek].

const adminScoreWeek = require('./admin-score-week.js');

const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return respond(405, { error: 'POST only' });
    }

    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
      return respond(401, { error: 'Unauthorised' });
    }

    const { startWeek, endWeek, force } = JSON.parse(event.body || '{}');

    const sW = Number(startWeek ?? 1);
    const eW = Number(endWeek ?? sW);

    if (!sW || !eW || eW < sW) {
      return respond(400, { error: 'valid startWeek and endWeek required' });
    }

    const results = [];

    for (let week = sW; week <= eW; week++) {
      // Call admin-score-week internally
      const res = await adminScoreWeek.handler(
        {
          httpMethod: 'POST',
          headers: {
            'x-admin-secret': secret
          },
          body: JSON.stringify(
            force ? { week, force: true } : { week }
          ),
        },
        {}
      );

      let body = {};
      try {
        body = res.body ? JSON.parse(res.body) : {};
      } catch {
        body = { rawBody: res.body };
      }

      results.push({
        week,
        status: res.statusCode,
        predictionsUpdated: body.predictionsUpdated ?? 0,
        usersUpdated: body.usersUpdated ?? 0,
        error: body.error || null
      });
    }

    return respond(200, {
      ok: true,
      startWeek: sW,
      endWeek: eW,
      force: !!force,
      results
    });
  } catch (e) {
    return respond(500, { error: e.message || 'Unknown error' });
  }
};
