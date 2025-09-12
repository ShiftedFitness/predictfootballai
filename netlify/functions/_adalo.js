const ADALO = {
  base: process.env.ADALO_API_BASE,
  key: process.env.ADALO_API_KEY,
  col: {
    matches: process.env.ADALO_MATCHES_ID,
    predictions: process.env.ADALO_PREDICTIONS_ID,
    users: process.env.ADALO_USERS_ID
  }
};

async function adaloFetch(path, opts = {}) {
  const res = await fetch(`${ADALO.base}/${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${ADALO.key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Adalo ${path} ${res.status}: ${txt}`);
  }
  return res.json();
}

// convenience – fetch a lot and filter locally
async function listAll(collectionId, limit = 1000) {
  const data = await adaloFetch(`${collectionId}?limit=${limit}`);
  return data.records || data; // Adalo returns {records:[...]}
}

module.exports = { ADALO, adaloFetch, listAll };
