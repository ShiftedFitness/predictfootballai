// netlify/functions/_adalo.js
const ADALO = {
  base: process.env.ADALO_API_BASE,
  key: process.env.ADALO_API_KEY,
  col: {
    matches: process.env.ADALO_MATCHES_ID,
    predictions: process.env.ADALO_PREDICTIONS_ID,
    users: process.env.ADALO_USERS_ID
  }
};

// Low-level fetch with retries for transient errors
async function adaloFetch(path, opts = {}, attempt = 0) {
  const url = `${ADALO.base}/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${ADALO.key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });

  if (res.ok) return res.json();

  const RETRYABLE = [429, 500, 502, 503, 504];
  if (RETRYABLE.includes(res.status) && attempt < 3) {
    const base = 300;
    const delay = base * Math.pow(2, attempt) + Math.floor(Math.random() * 150);
    await new Promise(r => setTimeout(r, delay));
    return adaloFetch(path, opts, attempt + 1);
  }

  const text = await res.text().catch(() => '');
  throw new Error(`Adalo ${path} ${res.status}: ${text || res.statusText}`);
}

// Pull *all* records with pagination (limit 200)
async function listAll(collectionId, pageSize = 200) {
  let all = [];
  let offset = 0;

  while (true) {
    const page = await adaloFetch(`${collectionId}?limit=${pageSize}&offset=${offset}`);
    const records = page?.records ?? page ?? [];
    if (!Array.isArray(records) || records.length === 0) break;

    all = all.concat(records);
    if (records.length < pageSize) break;
    offset += records.length;

    // tiny pause to be polite
    await new Promise(r => setTimeout(r, 60));
  }
  return all;
}

module.exports = { ADALO, adaloFetch, listAll };
