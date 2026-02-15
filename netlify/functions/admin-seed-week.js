const { ADALO, adaloFetch } = require('./_adalo.js');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return r(405, 'POST only');
    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) return r(401, 'Unauthorised');

    const { week, lockoutTime, fixtures } = JSON.parse(event.body || '{}');
    // fixtures: [{home, away, apiFixtureId?, homeForm?, awayForm?, ...}, ...]  (expect 5)
    if (!week || !lockoutTime || !Array.isArray(fixtures) || fixtures.length !== 5)
      return r(400, 'week, lockoutTime, and 5 fixtures required');

    const created = [];
    for (const f of fixtures) {
      const body = {
        'Week': Number(week),
        'Home Team': f.home,
        'Away Team': f.away,
        'Lockout Time': lockoutTime,
        'Locked': false,
        'Correct Result': ''
      };

      // Enrichment fields (optional — backward compatible with old-style seeds)
      if (f.apiFixtureId != null)    body['API Fixture ID']    = Number(f.apiFixtureId);
      if (f.homeForm != null)        body['Home Form']         = String(f.homeForm).slice(0, 10);
      if (f.awayForm != null)        body['Away Form']         = String(f.awayForm).slice(0, 10);
      if (f.predictionHome != null)  body['Prediction Home']   = String(f.predictionHome);
      if (f.predictionDraw != null)  body['Prediction Draw']   = String(f.predictionDraw);
      if (f.predictionAway != null)  body['Prediction Away']   = String(f.predictionAway);
      if (f.predictionAdvice != null) body['Prediction Advice'] = String(f.predictionAdvice).slice(0, 500);
      if (f.h2hSummary != null)      body['H2H Summary']       = typeof f.h2hSummary === 'string'
                                                                    ? f.h2hSummary.slice(0, 5000)
                                                                    : JSON.stringify(f.h2hSummary).slice(0, 5000);
      if (f.matchStats != null)      body['Match Stats']       = typeof f.matchStats === 'string'
                                                                    ? f.matchStats.slice(0, 5000)
                                                                    : JSON.stringify(f.matchStats).slice(0, 5000);

      const rec = await adaloFetch(`${ADALO.col.matches}`, { method:'POST', body: JSON.stringify(body) });
      created.push(rec);
    }
    return r(200, { ok:true, created: created.length });
  } catch (e) {
    return r(500, e.message);
  }
};

function r(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body) };
}
