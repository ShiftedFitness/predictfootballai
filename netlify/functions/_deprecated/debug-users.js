const { ADALO, listAll } = require('./_adalo.js');
exports.handler = async () => {
  try {
    const users = await listAll(ADALO.col.users, 1000);
    return { statusCode:200, headers:{'Content-Type':'application/json'}, body: JSON.stringify({count: users.length, sample: users.slice(0,5)}) };
  } catch (e) { return { statusCode:500, body: e.message }; }
};
