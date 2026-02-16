// netlify/functions/summary.js
const { sb, respond, handleOptions } = require('./_supabase.js');
const crypto = require('crypto');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(event.rawUrl);
    const week = Number(url.searchParams.get('week'));
    const userId = url.searchParams.get('userId');
    const debugMode = url.searchParams.get('debug') === '1' || process.env.DEBUG_SUMMARY === '1';

    if (!week || !userId) return respond(400, 'week & userId required');

    const client = sb();

    // 1) Fetch matches for this week
    const { data: matchRows, error: matchError } = await client
      .from('predict_matches')
      .select('*')
      .eq('week_number', week)
      .order('id', { ascending: true });

    if (matchError) throw new Error(`Failed to fetch matches: ${matchError.message}`);

    const matches = matchRows || [];
    const matchIdSet = new Set(matches.map(m => String(m.id)));

    // 2) Fetch predictions for this week
    const { data: predRows, error: predError } = await client
      .from('predict_predictions')
      .select('*')
      .eq('week_number', week);

    if (predError) throw new Error(`Failed to fetch predictions: ${predError.message}`);

    const validPreds = (predRows || []).filter(p =>
      matchIdSet.has(String(p.match_id))
    );

    // 3) Build per-match stats with counts and percentages
    const perMatch = matches.map(m => {
      const mid = String(m.id);
      const ps = validPreds.filter(p => String(p.match_id) === mid);

      const count = {
        HOME: ps.filter(p => (p.pick || '').toUpperCase() === 'HOME').length,
        DRAW: ps.filter(p => (p.pick || '').toUpperCase() === 'DRAW').length,
        AWAY: ps.filter(p => (p.pick || '').toUpperCase() === 'AWAY').length
      };
      const total = count.HOME + count.DRAW + count.AWAY;

      const pct = {
        HOME: total ? Math.round(100 * count.HOME / total) : 0,
        DRAW: total ? Math.round(100 * count.DRAW / total) : 0,
        AWAY: total ? Math.round(100 * count.AWAY / total) : 0
      };

      return {
        match_id: m.id,
        home_team: m.home_team,
        away_team: m.away_team,
        pct,
        count,
        total
      };
    });

    // 4) Find users with exact same 5-pick sequence as current user
    const myPreds = validPreds
      .filter(p => String(p.user_id) === String(userId))
      .sort((a, b) => Number(a.match_id) - Number(b.match_id));
    const mySeq = myPreds.map(p => (p.pick || '')[0]).join('');
    const myFp = fingerprint(week, mySeq);

    // Group predictions by user
    const byUser = {};
    for (const p of validPreds) {
      const uid = String(p.user_id);
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(p);
    }

    const samePickUsers = Object.entries(byUser)
      .filter(([uid]) => uid !== String(userId))
      .filter(([, arr]) => {
        const seq = arr
          .sort((a, b) => Number(a.match_id) - Number(b.match_id))
          .map(p => (p.pick || '')[0]).join('');
        return fingerprint(week, seq) === myFp;
      })
      .map(([uid]) => uid);

    // 5) Build response
    const response = { perMatch, samePickUsers };

    // Add debug info if requested
    if (debugMode) {
      const uniqueUsers = new Set(validPreds.map(p => String(p.user_id)));
      response.debug = {
        week,
        fetchMethod: 'direct-select',
        matchesForWeek: matches.length,
        matchIds: matches.map(m => m.id),
        predsForWeekCount: validPreds.length,
        uniqueUsersCount: uniqueUsers.size,
        perMatchTotals: perMatch.map(pm => ({ match_id: pm.match_id, total: pm.total })),
        myPicksCount: myPreds.length,
        mySequence: mySeq
      };
    }

    return respond(200, response);
  } catch (e) {
    return respond(500, e.message);
  }
};

function fingerprint(week, seq) {
  return crypto.createHash('sha256').update(`${week}|${seq}`).digest('hex');
}
