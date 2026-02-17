// netlify/functions/get-week.js
// Fetches matches for a given week. Requires either:
// - A valid userId (for users to see their predictions)
// - The x-admin-secret header (for admin access without userId)
const { sb, respond, requireAdmin, handleOptions } = require('./_supabase.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(event.rawUrl);
    const week = Number(url.searchParams.get('week'));
    const userId = String(url.searchParams.get('userId') || '').trim();

    // Check for admin access via x-admin-secret header
    const adminCheckErr = await requireAdmin(event);
    const isAdmin = !adminCheckErr;

    // Require week always; require userId OR admin access
    if (!week) {
      return respond(400, 'week parameter required');
    }

    const hasValidUserId = userId && userId !== '0' && userId !== 'undefined' && userId !== 'null';
    if (!hasValidUserId && !isAdmin) {
      return respond(401, 'week & valid userId required (login required)');
    }

    const client = sb();

    // 1) Matches for this week
    const { data: matchRows, error: matchError } = await client
      .from('predict_matches')
      .select('*')
      .eq('week_number', week)
      .order('id', { ascending: true });

    if (matchError) throw new Error(`Failed to fetch matches: ${matchError.message}`);

    const matches = (matchRows || []).map(m => ({
      id: m.id,
      'Week': m.week_number,
      'Home Team': m.home_team,
      'Away Team': m.away_team,
      'Lockout Time': m.lockout_time,
      'Locked': m.locked,
      'Correct Result': m.correct_result || ''
    }));

    // 2) Lock logic
    const now = new Date();
    const earliest = matches
      .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    const locked = (earliest && now >= earliest) || matches.some(m => m['Locked'] === true);

    // 3) Predictions: fetch by week (filtered by match_id) then filter to this user
    let predictionsOut = [];

    if (hasValidUserId) {
      const matchIdSet = new Set(matches.map(m => String(m.id)));

      const { data: predRows, error: predError } = await client
        .from('predict_predictions')
        .select('*')
        .eq('week_number', week);

      if (predError) throw new Error(`Failed to fetch predictions: ${predError.message}`);

      const userPreds = (predRows || []).filter(p =>
        String(p.user_id) === userId && matchIdSet.has(String(p.match_id))
      );

      // IMPORTANT: normalize prediction shape for the widget
      predictionsOut = userPreds.map(p => ({
        id: p.id,
        User: String(p.user_id),
        Match: String(p.match_id),
        Pick: (p.pick || '').toString().trim().toUpperCase(),
        Week: Number(p.week_number),
        'Points Awarded': (typeof p.points_awarded === 'number') ? p.points_awarded : undefined
      }));
    }

    return respond(200, { week, locked, matches, predictions: predictionsOut, isAdmin });
  } catch (e) {
    return respond(500, e.message);
  }
};
