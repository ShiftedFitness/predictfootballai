export const handler = async (event) => {
  try {
    const { player, valid, scores=[501,501] } = JSON.parse(event.body || "{}");
    if (!valid) return { statusCode:200, body:JSON.stringify({ scores }) };
    // simple minus random score (20-60)
    const minus = Math.floor(Math.random()*40)+20;
    scores[player] = Math.max(0, scores[player]-minus);
    return { statusCode:200, body:JSON.stringify({ scores }) };
  } catch (err) {
    return { statusCode:500, body:JSON.stringify({ error:err.message }) };
  }
};
