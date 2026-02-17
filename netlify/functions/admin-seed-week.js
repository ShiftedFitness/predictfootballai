// netlify/functions/admin-seed-week.js
const { sb, respond, requireAdmin, handleOptions } = require('./_supabase.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    if (event.httpMethod !== 'POST') return respond(405, 'POST only');

    const adminErr = await requireAdmin(event);
    if (adminErr) return adminErr;

    const { week, lockoutTime, fixtures } = JSON.parse(event.body || '{}');
    // fixtures: [{home, away, apiFixtureId?, homeForm?, awayForm?, ...}, ...]  (expect 5)
    if (!week || !lockoutTime || !Array.isArray(fixtures) || fixtures.length !== 5) {
      return respond(400, 'week, lockoutTime, and 5 fixtures required');
    }

    const client = sb();

    // 1) Create or update match_week record
    const { data: existingWeek, error: checkError } = await client
      .from('predict_match_weeks')
      .select('*')
      .eq('week_number', Number(week))
      .limit(1);

    if (checkError) throw new Error(`Failed to check week: ${checkError.message}`);

    if (!existingWeek || existingWeek.length === 0) {
      // Create new week
      const { error: weekCreateError } = await client
        .from('predict_match_weeks')
        .insert([{
          week_number: Number(week),
          status: 'open'
        }]);

      if (weekCreateError) throw new Error(`Failed to create week: ${weekCreateError.message}`);
    }

    // 2) Create matches
    const created = [];
    for (const f of fixtures) {
      const matchPayload = {
        week_number: Number(week),
        home_team: f.home || f.home_team,
        away_team: f.away || f.away_team,
        lockout_time: lockoutTime,
        locked: false,
        correct_result: ''
      };

      // Enrichment fields (optional — backward compatible with old-style seeds)
      if (f.apiFixtureId != null) matchPayload.api_fixture_id = Number(f.apiFixtureId);
      if (f.homeForm != null) matchPayload.home_form = String(f.homeForm).slice(0, 10);
      if (f.awayForm != null) matchPayload.away_form = String(f.awayForm).slice(0, 10);
      if (f.predictionHome != null) matchPayload.prediction_home = String(f.predictionHome);
      if (f.predictionDraw != null) matchPayload.prediction_draw = String(f.predictionDraw);
      if (f.predictionAway != null) matchPayload.prediction_away = String(f.predictionAway);
      if (f.predictionAdvice != null) matchPayload.prediction_advice = String(f.predictionAdvice).slice(0, 500);
      if (f.h2hSummary != null) {
        matchPayload.h2h_summary = typeof f.h2hSummary === 'string'
          ? f.h2hSummary.slice(0, 5000)
          : f.h2hSummary;
      }
      if (f.matchStats != null) {
        matchPayload.match_stats = typeof f.matchStats === 'string'
          ? f.matchStats.slice(0, 5000)
          : f.matchStats;
      }

      const { data: rec, error: insertError } = await client
        .from('predict_matches')
        .insert([matchPayload])
        .select();

      if (insertError) throw new Error(`Failed to create match: ${insertError.message}`);
      created.push(rec?.[0] || matchPayload);
    }

    return respond(200, { ok: true, created: created.length });
  } catch (e) {
    return respond(500, e.message);
  }
};
