// netlify/functions/submit-picks.js
const { sb, respond, handleOptions } = require('./_supabase.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    if (event.httpMethod !== 'POST') return respond(405, 'POST only');

    const body = JSON.parse(event.body || '{}');
    const userIdRaw = body.userId;
    const weekRaw = body.week;
    const picks = body.picks;

    // Login required: reject missing / invalid userId
    const userId = String(userIdRaw || '').trim();
    if (!userId || userId === '0' || userId === 'null' || userId === 'undefined') {
      return respond(401, 'Login required (valid userId missing)');
    }

    const weekNum = Number(weekRaw);
    if (!weekNum || !Array.isArray(picks) || picks.length !== 5) {
      return respond(400, 'userId, week, and 5 picks required');
    }

    const client = sb();

    // 1) Fetch matches for this week
    const { data: matchRows, error: matchError } = await client
      .from('predict_matches')
      .select('*')
      .eq('week_number', weekNum)
      .order('id', { ascending: true });

    if (matchError) throw new Error(`Failed to fetch matches: ${matchError.message}`);

    const matches = matchRows || [];
    if (matches.length !== 5) {
      return respond(400, 'Expected 5 matches for this week.');
    }

    // Build set of valid match IDs for safety
    const matchIdSet = new Set(matches.map(m => String(m.id)));

    // 2) Check deadline/lock
    const now = new Date();
    const earliest = matches
      .map(m => m.lockout_time ? new Date(m.lockout_time) : null)
      .filter(Boolean)
      .sort((a, b) => a - b)[0];

    const deadlinePassed =
      (earliest && now >= earliest) ||
      matches.some(m => m.locked === true);

    if (deadlinePassed) {
      return respond(403, 'Deadline passed. Picks locked.');
    }

    // 3) Existing predictions for THIS USER in THIS WEEK
    const { data: existingPreds, error: predError } = await client
      .from('predict_predictions')
      .select('*')
      .eq('user_id', userId)
      .eq('week_number', weekNum);

    if (predError) throw new Error(`Failed to fetch predictions: ${predError.message}`);

    const byMatchId = Object.fromEntries(
      (existingPreds || []).map(p => [String(p.match_id), p])
    );

    // 4) Upsert predictions (always write week_number)
    const results = [];
    for (const p of picks) {
      const matchId = String(p.match_id || '').trim();
      const pickVal = String(p.pick || '').trim().toUpperCase(); // HOME/DRAW/AWAY

      if (!matchId || !matchIdSet.has(matchId)) {
        return respond(400, `Invalid match_id ${matchId} for week ${weekNum}`);
      }

      if (!['HOME', 'DRAW', 'AWAY'].includes(pickVal)) {
        return respond(400, 'Pick must be HOME/DRAW/AWAY');
      }

      const payload = {
        user_id: userId,
        match_id: parseInt(matchId, 10),
        week_number: weekNum,
        pick: pickVal
      };

      const ex = byMatchId[matchId];
      if (ex) {
        // Update existing
        const { data: updated, error: updateError } = await client
          .from('predict_predictions')
          .update(payload)
          .eq('id', ex.id)
          .select();

        if (updateError) throw new Error(`Failed to update prediction: ${updateError.message}`);
        results.push(updated?.[0] || ex);
      } else {
        // Create new
        const { data: created, error: insertError } = await client
          .from('predict_predictions')
          .insert([payload])
          .select();

        if (insertError) throw new Error(`Failed to create prediction: ${insertError.message}`);
        results.push(created?.[0] || payload);
      }
    }

    return respond(200, { ok: true, saved: results.length });
  } catch (e) {
    return respond(500, e.message);
  }
};
