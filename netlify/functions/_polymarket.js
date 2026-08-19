/**
 * _polymarket.js
 *
 * Match-outcome probabilities for Premier League fixtures, taken from
 * Polymarket prediction-market prices.
 *
 * WHY THIS EXISTS
 * football-data.org provides no predictions of any kind, so the percentages
 * shown in the app were computed in-house from league position + form
 * (api-football-fixtures.js). That model has a cold-start problem: until
 * results exist the standings table is empty, every team resolves to
 * position 10, and every fixture comes out ~45/28/27 — worst exactly when
 * the season starts.
 *
 * A prediction market has no cold start. Saturday's game is priced today
 * whether or not a ball has been kicked, by people with money at stake.
 * Observed overround on these markets is 1.000–1.015, so the normalised
 * prices are about as close to true probabilities as anything obtainable.
 *
 * WHAT THIS IS NOT
 * Read-only public market data. No key, no wallet, no Relayer API, no
 * orders — nothing here can spend anything.
 *
 * SHAPE OF THE DATA (verified against the live API)
 *   GET /events?tag_slug=epl&closed=false
 *   → event  title "Everton FC vs. Crystal Palace FC"
 *            slug  "epl-eve-cry-2026-08-22"   ← kickoff date lives HERE
 *     with 3 markets:
 *            "Will Everton FC win on 2026-08-22?"          Yes/No
 *            "Will Everton FC vs. Crystal Palace FC end in a draw?"
 *            "Will Crystal Palace FC win on 2026-08-22?"
 *     each carrying outcomePrices as a JSON string, e.g. "[\"0.44\",\"0.56\"]"
 *
 * Polymarket also lists derivative markets on the same fixture (halftime
 * result, second half, first team to score). Those are excluded — the real
 * match-result market is the only one containing a draw leg.
 */

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const EPL_TAG = 'epl';
const FETCH_TIMEOUT_MS = 12000;

// Minimum liquidity before a price is trusted. A thin book can sit at a
// silly price on low volume, and a bad probability is worse than none —
// the caller falls back to the model.
const MIN_LIQUIDITY = 5000;

// ── Team-name matching ──────────────────────────────────────────────────
// Both sources use the same long-form convention ("Tottenham Hotspur FC"),
// but never rely on that — strip the decoration and compare the core name.
function normaliseTeam(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(fc|afc|cf|utd)\b/g, ' ')
    .replace(/\bunited\b/g, 'utd')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Loose comparison: exact after normalising, or one contains the other. */
function teamsMatch(a, b) {
  const x = normaliseTeam(a);
  const y = normaliseTeam(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "manchester utd" vs "manchester" — accept containment on a token basis
  // rather than substring, so "united" alone never matches two clubs.
  const xt = x.split(' ');
  const yt = y.split(' ');
  const shared = xt.filter((t) => yt.includes(t) && t.length > 2);
  return shared.length >= Math.min(xt.length, yt.length);
}

function dateFromSlug(slug) {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(String(slug || ''));
  return m ? m[1] : null;
}

function isoDate(d) {
  try { return new Date(d).toISOString().slice(0, 10); } catch (e) { return null; }
}

/** Whole days between two YYYY-MM-DD strings. */
function daysApart(a, b) {
  if (!a || !b) return 99;
  return Math.abs((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

// ── Fetch + parse ───────────────────────────────────────────────────────

async function gammaFetch(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${GAMMA_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Polymarket ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parsePrices(raw) {
  // outcomePrices arrives as a JSON-encoded string, not an array.
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.map(Number) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Turn one Gamma event into { home, away, date, prices } — or null when it
 * is not a clean three-way match-result market.
 */
function parseGameEvent(event) {
  const title = String(event.title || '');
  if (!title.includes(' vs. ')) return null;

  // Derivative markets append " - Halftime Result", " - Second Half", etc.
  if (title.includes(' - ')) return null;

  const markets = event.markets || [];
  if (markets.length !== 3) return null;

  const [homeName, awayName] = title.split(' vs. ').map((s) => s.trim());
  if (!homeName || !awayName) return null;

  let home = null, draw = null, away = null;
  let liquidity = 0;
  let sawDrawLeg = false;

  for (const m of markets) {
    const q = String(m.question || '');
    const prices = parsePrices(m.outcomePrices);
    if (!prices.length) return null;

    const yes = prices[0];               // outcomes are ["Yes","No"]
    if (!Number.isFinite(yes)) return null;
    liquidity += Number(m.liquidity || 0);

    if (/end in a draw/i.test(q)) {
      draw = yes;
      sawDrawLeg = true;
    } else if (teamsMatch(q.replace(/^Will\s+/i, '').split(' win on')[0], homeName)) {
      home = yes;
    } else if (teamsMatch(q.replace(/^Will\s+/i, '').split(' win on')[0], awayName)) {
      away = yes;
    }
  }

  // The draw leg is what distinguishes the match-result market from every
  // derivative market on the same fixture.
  if (!sawDrawLeg || home == null || away == null || draw == null) return null;

  const total = home + draw + away;
  if (!(total > 0.8 && total < 1.25)) return null;   // implausible book, skip

  const pctHome = Math.round((home / total) * 100);
  const pctDraw = Math.round((draw / total) * 100);

  return {
    homeName,
    awayName,
    date: dateFromSlug(event.slug) || isoDate(event.startDate),
    slug: event.slug,
    liquidity,
    // Strip the overround so the three sum to EXACTLY 100. Rounding each
    // independently can total 99 or 101, which would quietly bias the
    // Poisson-binomial in picks-widget.js — so derive the last from the
    // other two, the same way computePrediction() does.
    home: pctHome,
    draw: pctDraw,
    away: 100 - pctHome - pctDraw,
    rawTotal: Number(total.toFixed(4))
  };
}

/**
 * Every currently-open EPL match-result market.
 * Returns [] on any failure — this is an enhancement, never a hard
 * dependency, and the caller falls back to the in-house model.
 */
async function fetchEplMatchMarkets() {
  try {
    const events = await gammaFetch(
      `/events?tag_slug=${EPL_TAG}&closed=false&limit=200&order=startDate&ascending=true`
    );
    const list = Array.isArray(events) ? events : (events.data || []);
    return list.map(parseGameEvent).filter(Boolean);
  } catch (e) {
    console.warn('Polymarket fetch failed, falling back to model:', e.message);
    return [];
  }
}

/**
 * Find the market for one fixture.
 * @param markets  output of fetchEplMatchMarkets()
 * @param homeTeam football-data.org home team name
 * @param awayTeam football-data.org away team name
 * @param kickoff  ISO datetime of kickoff (used to disambiguate the reverse
 *                 fixture later in the season)
 */
function findMarketForFixture(markets, homeTeam, awayTeam, kickoff) {
  const want = isoDate(kickoff);

  const candidates = markets.filter(
    (m) => teamsMatch(m.homeName, homeTeam) && teamsMatch(m.awayName, awayTeam)
  );
  if (!candidates.length) return null;

  // Same pairing happens twice a season at the same ground only in cup
  // competitions, but dates still disambiguate reliably. Allow a day either
  // side for timezone drift between the two sources.
  const dated = candidates
    .map((m) => ({ m, gap: daysApart(m.date, want) }))
    .sort((a, b) => a.gap - b.gap);

  const best = dated[0];
  if (!best || best.gap > 2) return null;
  if (best.m.liquidity < MIN_LIQUIDITY) return null;

  return best.m;
}

module.exports = {
  fetchEplMatchMarkets,
  findMarketForFixture,
  normaliseTeam,
  teamsMatch,
  parseGameEvent,
  MIN_LIQUIDITY
};
