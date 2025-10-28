import fetch from "node-fetch";
import Fuse from "fuse.js";

const { ADALO_API_BASE, ADALO_API_KEY, PREMIER_LEAGUE_PLAYERS_COLLECTION } = process.env;

export const handler = async (event) => {
  try {
    // support ?fetchAll=true for SPA caching
    const params = new URLSearchParams(event.queryStringParameters);
    if (params.get("fetchAll")) {
      let offset = 0;
      const all = [];
      while (true) {
        const res = await fetch(
          `${ADALO_API_BASE}/collections/${PREMIER_LEAGUE_PLAYERS_COLLECTION}?offset=${offset}&limit=1000`,
          {
            headers: {
              "Authorization": `Bearer ${ADALO_API_KEY}`,
              "Content-Type": "application/json"
            }
          }
        );
        const data = await res.json();
        all.push(...data.records);
        if (!data.offset) break;
        offset = data.offset;
      }
      return {
        statusCode: 200,
        body: JSON.stringify(all.map(p => p.Player))
      };
    }

    const { guess } = JSON.parse(event.body || "{}");
    if (!guess) return { statusCode: 400, body: JSON.stringify({ message: "No guess" }) };

    // fetch small batch (could be cached front-end, but ok for POC)
    const res = await fetch(
      `${ADALO_API_BASE}/collections/${PREMIER_LEAGUE_PLAYERS_COLLECTION}?limit=1000`,
      {
        headers: {
          "Authorization": `Bearer ${ADALO_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    const data = await res.json();
    const list = data.records.map(r => r.Player);

    const fuse = new Fuse(list, { includeScore:true, threshold:0.3 });
    const match = fuse.search(guess)[0];
    if (match) {
      return {
        statusCode: 200,
        body: JSON.stringify({ valid:true, message:`✅ ${match.item} is correct!` })
      };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ valid:false, message:`❌ ${guess} not found.` })
    };
  } catch (err) {
    return { statusCode:500, body:JSON.stringify({ error:err.message }) };
  }
};
