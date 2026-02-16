// netlify/functions/leaderboard.js
const { sb, respond, handleOptions } = require('./_supabase.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  try {
    const client = sb();

    // Fetch all users
    const { data: users, error: usersError } = await client
      .from('predict_users')
      .select('*');

    if (usersError) throw new Error(`Failed to fetch users: ${usersError.message}`);

    const rows = (users || []).map(u => {
      const id = String(u.id);
      const name = u.username || u.full_name || `User ${id}`;
      const pts = Number(u.points ?? 0);
      const cor = Number(u.correct_results ?? 0);
      const inc = Number(u.incorrect_results ?? 0);
      const total = cor + inc;
      const acc = total > 0 ? cor / total : 0;
      const fh = Number(u.full_houses ?? 0);
      const blanks = Number(u.blanks ?? 0);
      return { id, name, points: pts, correct: cor, incorrect: inc, total, accuracy: acc, fh, blanks };
    });

    // Sort: Points desc, then FH desc, then Accuracy desc, then name asc
    rows.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.fh !== a.fh) return b.fh - a.fh;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return a.name.localeCompare(b.name);
    });
    rows.forEach((r, i) => r.position = i + 1);

    return respond(200, { leaderboard: rows });
  } catch (e) {
    return respond(500, e.message);
  }
};
