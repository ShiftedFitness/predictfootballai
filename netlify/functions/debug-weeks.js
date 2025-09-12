const { ADALO, listAll } = require('./_adalo.js');
exports.handler = async () => {
  try {
    const matches = await listAll(ADALO.col.matches, 1000);
    const weeks = Array.from(new Set(matches.map(m => m['Week']))).sort((a,b)=>a-b);
    return { statusCode:200, headers:{'Content-Type':'application/json'}, body: JSON.stringify({weeks, sample: matches.slice(0,5)}) };
  } catch (e) { return { statusCode:500, body: e.message }; }
};
