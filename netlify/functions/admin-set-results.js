// netlify/functions/admin-set-results.js
const { sb, respond, requireAdmin, handleOptions } = require('./_supabase.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    if (event.httpMethod !== 'POST') return respond(405, 'POST only');

    const adminErr = requireAdmin(event);
    if (adminErr) return adminErr;

    const { week, results } = JSON.parse(event.body || '{}');
    if (!week || !Array.isArray(results) || !results.length) {
      return respond(400, 'week and results[] required');
    }

    const client = sb();

    // Fetch matches for this week
    const { data: matches, error: matchError } = await client
      .from('predict_matches')
      .select('*')
      .eq('week_number', Number(week));

    if (matchError) throw new Error(`Failed to fetch matches: ${matchError.message}`);
    if (!matches || !matches.length) {
      return respond(400, `No matches for week ${week}`);
    }

    // Apply results
    const resultById = Object.fromEntries(
      results.map(r => [String(r.match_id), String(r.correct || '').toUpperCase()])
    );

    const updates = [];
    for (const m of matches) {
      const correct = resultById[String(m.id)];
      if (!['HOME', 'DRAW', 'AWAY'].includes(correct)) continue;

      const { data: updated, error: updateError } = await client
        .from('predict_matches')
        .update({ correct_result: correct, locked: true })
        .eq('id', m.id)
        .select();

      if (updateError) throw new Error(`Failed to update match: ${updateError.message}`);
      updates.push(updated?.[0] || m);
    }

    return respond(200, { ok: true, updated: updates.length });
  } catch (e) {
    return respond(500, e.message);
  }
};
