// netlify/functions/leaderboard.js
const { ADALO, listAll } = require('./_adalo.js');

exports.handler = async () => {
  try {
    const users = await listAll(ADALO.col.users, 1000);

    // Map and normalise fields (case/space sensitive – matches your Adalo setup)
    const rows = (users || []).map(u => {
      const id = String(u.id);
      const name =
        u['Username'] || u['Name'] || u['Full Name'] || u['name'] || `User ${id}`;
      const points = Number(u['Points'] ?? 0);
      const correct = Number(u['Correct Results'] ?? 0);
      const incorrect = Number(u['Incorrect Results'] ?? 0);
      const total = correct + incorrect;
      const accuracy = total > 0 ? correct / total : 0;
      return { id, name, points, correct, incorrect, total, accuracy };
    });

    // Sort: Points desc, then Accuracy desc, then Name asc
    rows.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return a.name.localeCompare(b.name);
    });

    // Assign positions (simple 1..N)
    rows.forEach((r, i) => (r.position = i + 1));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ leaderboard: rows })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
