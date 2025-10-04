const { ADALO, listAll } = require('./_adalo.js');

exports.handler = async () => {
  try {
    const users = await listAll(ADALO.col.users, 2000);

    const rows = (users || []).map(u => {
      const id   = String(u.id);
      const name = u['Username'] || u['Name'] || u['Full Name'] || `User ${id}`;
      const pts  = Number(u['Points'] ?? 0);
      const cor  = Number(u['Correct Results'] ?? 0);
      const inc  = Number(u['Incorrect Results'] ?? 0);
      const total = cor + inc;
      const acc   = total > 0 ? cor / total : 0;
      const fh    = Number(u['FH'] ?? 0);       // << NEW
      const blanks= Number(u['Blanks'] ?? 0);   // (not used in sort, but handy in UI later)
      return { id, name, points: pts, correct: cor, incorrect: inc, total, accuracy: acc, fh, blanks };
    });

    // Sort: Points desc, then FH desc, then Accuracy desc, then name asc
    rows.sort((a,b)=>{
      if (b.points !== a.points) return b.points - a.points;
      if (b.fh     !== a.fh)     return b.fh     - a.fh;
      if (b.accuracy!== a.accuracy) return b.accuracy - a.accuracy;
      return a.name.localeCompare(b.name);
    });
    rows.forEach((r,i)=> r.position = i+1);

    return { statusCode: 200, headers:{'Content-Type':'application/json'}, body: JSON.stringify({ leaderboard: rows }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
