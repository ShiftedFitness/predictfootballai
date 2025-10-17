// netlify/functions/weeks.js
const { listAll } = require('./_adalo.js');

exports.handler = async () => {
  try {
    const matches = await listAll(process.env.ADALO_MATCHES_ID, 200);

    const byWeek = {};
    for (const m of (matches || [])) {
      const w = Number(m['Week']);
      if (Number.isNaN(w)) continue;
      if (!byWeek[w]) byWeek[w] = [];
      byWeek[w].push(m);
    }
    const weeks = Object.keys(byWeek).map(n => Number(n)).sort((a,b)=>a-b);
    if (!weeks.length) {
      return json(200, { weeks: [], latest: null, recommendedPickWeek: null, recommendedViewWeek: null });
    }

    const now = Date.now();
    const info = weeks.map(w => {
      const arr = byWeek[w];
      const earliest = arr
        .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']).getTime() : null)
        .filter(Boolean).sort((a,b)=>a-b)[0] ?? null;
      const locked = (earliest && earliest <= now) || arr.some(m => m['Locked'] === true);
      return { week: w, earliest, locked };
    });

    const latest = weeks[weeks.length - 1];
    const latestInfo = info.find(x => x.week === latest);

    return json(200, {
      weeks,
      latest,
      recommendedPickWeek: latest,
      recommendedViewWeek: latestInfo && latestInfo.locked ? latest : (weeks.length > 1 ? weeks[weeks.length-2] : latest),
      detail: info
    });
  } catch (e) {
    return json(500, { error: String(e) });
  }
};

function json(status, body){
  return { statusCode: status, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}, body: JSON.stringify(body) };
}
