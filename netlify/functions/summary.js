const { ADALO, adaloFetch, listAll } = require('./_adalo.js');
const crypto = require('crypto');

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
    const url = new URL(event.rawUrl);
    const week = Number(url.searchParams.get('week'));
    const userId = url.searchParams.get('userId');
    const debugMode = url.searchParams.get('debug') === '1' || process.env.DEBUG_SUMMARY === '1';

    if (!week || !userId) return resp(400, 'week & userId required');

    // 1) Fetch matches for this week
    const allMatches = await listAll(ADALO.col.matches, 2000);
    const matches = (allMatches || [])
      .filter(m => Number(m['Week']) === week)
      .sort((a, b) => Number(a.id) - Number(b.id));

    const matchIdSet = new Set(matches.map(m => String(m.id)));

    // 2) Fetch predictions using Week filter (fast, avoids pagination issues)
    let predsForWeek = [];
    let fetchMethod = 'week-filter';

    try {
      const page = await adaloFetch(
        `${ADALO.col.predictions}?filterKey=Week&filterValue=${encodeURIComponent(week)}`
      );
      predsForWeek = page?.records ?? page ?? [];
      if (!Array.isArray(predsForWeek)) predsForWeek = [];
    } catch (e) {
      fetchMethod = 'week-filter-failed';
      predsForWeek = [];
    }

    // Fallback: if Week filter returns nothing (older data without Week field),
    // try scanning all predictions (use high limit)
    if (predsForWeek.length === 0) {
      fetchMethod = 'listAll-fallback';
      const allPreds = await listAll(ADALO.col.predictions, 20000);
      // Filter to predictions that match our week's matches
      predsForWeek = (allPreds || []).filter(p => {
        const mid = String(relId(p['Match']));
        return matchIdSet.has(mid);
      });
    }

    // Filter to only predictions for this week's matches (safety check)
    const validPreds = predsForWeek.filter(p => {
      const mid = String(relId(p['Match']));
      return matchIdSet.has(mid);
    });

    // 3) Build per-match stats with counts and percentages
    const perMatch = matches.map(m => {
      const mid = String(m.id);
      const ps = validPreds.filter(p => String(relId(p['Match'])) === mid);

      const count = {
        HOME: ps.filter(p => String(p['Pick'] || '').toUpperCase() === 'HOME').length,
        DRAW: ps.filter(p => String(p['Pick'] || '').toUpperCase() === 'DRAW').length,
        AWAY: ps.filter(p => String(p['Pick'] || '').toUpperCase() === 'AWAY').length
      };
      const total = count.HOME + count.DRAW + count.AWAY;

      const pct = {
        HOME: total ? Math.round(100 * count.HOME / total) : 0,
        DRAW: total ? Math.round(100 * count.DRAW / total) : 0,
        AWAY: total ? Math.round(100 * count.AWAY / total) : 0
      };

      return {
        match_id: m.id,
        home_team: m['Home Team'],
        away_team: m['Away Team'],
        pct,
        count,
        total
      };
    });

    // 4) Find users with exact same 5-pick sequence as current user
    const myPreds = validPreds
      .filter(p => String(relId(p['User'])) === String(userId))
      .sort((a, b) => Number(relId(a['Match'])) - Number(relId(b['Match'])));
    const mySeq = myPreds.map(p => (p['Pick'] || '')[0]).join('');
    const myFp = fingerprint(week, mySeq);

    // Group predictions by user
    const byUser = {};
    for (const p of validPreds) {
      const uid = String(relId(p['User']));
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(p);
    }

    const samePickUsers = Object.entries(byUser)
      .filter(([uid]) => uid !== String(userId))
      .filter(([, arr]) => {
        const seq = arr
          .sort((a, b) => Number(relId(a['Match'])) - Number(relId(b['Match'])))
          .map(p => (p['Pick'] || '')[0]).join('');
        return fingerprint(week, seq) === myFp;
      })
      .map(([uid]) => uid);

    // 5) Build response
    const response = { perMatch, samePickUsers };

    // Add debug info if requested
    if (debugMode) {
      const uniqueUsers = new Set(validPreds.map(p => String(relId(p['User']))));
      response.debug = {
        week,
        fetchMethod,
        matchesForWeek: matches.length,
        matchIds: matches.map(m => m.id),
        predsForWeekCount: validPreds.length,
        uniqueUsersCount: uniqueUsers.size,
        perMatchTotals: perMatch.map(pm => ({ match_id: pm.match_id, total: pm.total })),
        myPicksCount: myPreds.length,
        mySequence: mySeq
      };
    }

    return resp(200, response);
  } catch (e) {
    return resp(500, e.message);
  }
};

function fingerprint(week, seq) {
  return crypto.createHash('sha256').update(`${week}|${seq}`).digest('hex');
}

function resp(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body)
  };
}
