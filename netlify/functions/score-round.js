exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { player, scores, deduct } = body;

    // Validate inputs
    if (!Array.isArray(scores) || scores.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Scores array required" }) };
    }
    if (typeof player !== "number" || player < 0 || player >= scores.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid player index" }) };
    }

    const s = scores.map(n => Number.isFinite(n) ? Number(n) : 501);
    const d = Math.max(0, Number(deduct || 0));

    const current = s[player];
    const next = current - d;

    let bust = false, win = false, message = "";

    if (d === 0) {
      bust = true; message = "No appearances to deduct.";
    } else if (next < 0) {
      bust = true; message = "💥 Bust! Score unchanged.";
    } else if (next === 0) {
      s[player] = 0; win = true; message = "🎯 Checkout! You win!";
    } else {
      s[player] = next; message = `−${d} → ${next}`;
    }

    return { statusCode: 200, body: JSON.stringify({ scores: s, bust, win, message }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
