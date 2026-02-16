// netlify/functions/weeks.js
const { sb, respond, handleOptions } = require('./_supabase.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    const client = sb();

    // Fetch all match weeks
    const { data: matchWeeks, error: weeksError } = await client
      .from('predict_match_weeks')
      .select('*')
      .order('week_number', { ascending: true });

    if (weeksError) throw new Error(`Failed to fetch weeks: ${weeksError.message}`);

    const weeks = (matchWeeks || []).map(w => w.week_number).sort((a, b) => a - b);

    if (!weeks.length) {
      return respond(200, { weeks: [], latest: null, recommendedPickWeek: null, recommendedViewWeek: null, detail: [] });
    }

    // Get matches to determine lock status
    const { data: matchRows, error: matchError } = await client
      .from('predict_matches')
      .select('*');

    if (matchError) throw new Error(`Failed to fetch matches: ${matchError.message}`);

    const matchesByWeek = {};
    for (const m of (matchRows || [])) {
      const w = m.week_number;
      if (!matchesByWeek[w]) matchesByWeek[w] = [];
      matchesByWeek[w].push(m);
    }

    const now = Date.now();
    const info = weeks.map(w => {
      const arr = matchesByWeek[w] || [];
      const earliest = arr
        .map(m => m.lockout_time ? new Date(m.lockout_time).getTime() : null)
        .filter(Boolean)
        .sort((a, b) => a - b)[0] ?? null;
      const locked = (earliest && earliest <= now) || arr.some(m => m.locked === true);
      return { week: w, earliest, locked };
    });

    const latest = weeks[weeks.length - 1];
    const latestInfo = info.find(x => x.week === latest);

    return respond(200, {
      weeks,
      latest,
      recommendedPickWeek: latest,
      recommendedViewWeek: latestInfo && latestInfo.locked ? latest : (weeks.length > 1 ? weeks[weeks.length - 2] : latest),
      detail: info
    });
  } catch (e) {
    return respond(500, e.message);
  }
};
