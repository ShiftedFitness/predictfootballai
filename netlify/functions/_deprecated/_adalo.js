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

  if (res.ok) {
    // Some endpoints (like DELETE) return 204 No Content
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      // not JSON, just return raw text wrapper
      return { raw: text };
    }
  }

  const RETRYABLE = [429, 500, 502, 503, 504];
  if (RETRYABLE.includes(res.status) && attempt < 3) {
    const baseDelay = 300;
    const delay = baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 150);
    await new Promise(r => setTimeout(r, delay));
    return adaloFetch(path, opts, attempt + 1);
  }

  const text = await res.text().catch(() => '');
  throw new Error(`Adalo ${path} ${res.status}: ${text || res.statusText}`);
}

/**
 * Pull records from a collection with pagination.
 *
 * Backwards-compatible with old calls:
 *   listAll(col.matches, 1000)        // maxRecords=1000
 *   listAll(col.predictions, 20000)   // maxRecords=20000
 *
 * New style (optional):
 *   listAll(col.predictions, 5000, 250) // maxRecords=5000, pageSize=250
 */
async function listAll(collectionId, maxRecordsOrPageSize, maybePageSize) {
  let maxRecords = 2000;
  let pageSize = 200;

  if (typeof maxRecordsOrPageSize === 'number' && typeof maybePageSize === 'number') {
    // listAll(col, maxRecords, pageSize)
    maxRecords = maxRecordsOrPageSize || 2000;
    pageSize = maybePageSize || 200;
  } else if (typeof maxRecordsOrPageSize === 'number') {
    // listAll(col, maxRecords)
    maxRecords = maxRecordsOrPageSize;
  }

  let all = [];
  let offset = 0;

  while (all.length < maxRecords) {
    const limit = Math.min(pageSize, maxRecords - all.length);
    const page = await adaloFetch(`${collectionId}?limit=${limit}&offset=${offset}`);
    const records = Array.isArray(page?.records) ? page.records :
                    Array.isArray(page) ? page :
                    [];

    if (!records.length) break;

    all = all.concat(records);

    if (records.length < limit) break; // last page
    offset += records.length;

    // tiny pause to be polite
    await new Promise(r => setTimeout(r, 60));
  }

  return all;
}

module.exports = { ADALO, adaloFetch, listAll };
