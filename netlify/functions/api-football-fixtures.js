/**
 * api-football-fixtures.js
 *
 * Proxy for football-data.org v4 API (free tier, current season included).
 *
 * Two actions:
 *   ?action=list   — GET upcoming EPL matchday fixtures with standings + predictions
 *   ?action=enrich — POST with fixture IDs to fetch H2H, form, computed predictions
 *
 * Prediction model:
 *   - PRIMARY: League position gap (1st vs 20th = massive favourite)
 *   - SECONDARY: H2H historical record
 *   - FACTOR: Home advantage (~8% boost, based on EPL historical average)
 *
 * Auth: x-admin-secret header required.
 * Env:  FOOTBALL_DATA_KEY (API token from football-data.org)
 *
 * football-data.org free tier: 10 requests/minute, EPL included forever.
 * We add 700ms delays between calls to stay well within limits.
 */

const FD_BASE = 'https://api.football-data.org/v4';
const EPL_CODE = 'PL';   // Premier League competition code

// ── API helper ──────────────────────────────────────────────────────────────
async function fdFetch(path) {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) throw Object.assign(new Error('FOOTBALL_DATA_KEY not configured'), { status: 500 });

  const url = `${FD_BASE}/${path}`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': key } });

  if (res.status === 429) {
    throw Object.assign(new Error('football-data.org rate limit reached. Wait a minute and try again.'), { status: 429 });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`football-data.org ${res.status}: ${text}`), { status: res.status });
  }
  return res.json();
}

// Polite delay to respect 10 req/min rate limit
const delay = (ms = 700) => new Promise(r => setTimeout(r, ms));

// ── Standings cache (shared between list and enrich in same invocation) ─────
let standingsCache = null;  // { byTeamId: Map, fetchedAt: Date }

async function getStandings() {
  // Cache for the lifetime of this function invocation
  if (standingsCache) return standingsCache;

  const data = await fdFetch(`competitions/${EPL_CODE}/standings`);
  const table = data.standings?.[0]?.table || [];  // [0] = TOTAL standings

  const byTeamId = {};
  for (const row of table) {
    byTeamId[row.team.id] = {
      position: row.position,
      points: row.points,
      played: row.playedGames,
      won: row.won,
      draw: row.draw,
      lost: row.lost,
      gf: row.goalsFor,
      ga: row.goalsAgainst,
      gd: row.goalDifference,
      form: row.form || '',       // e.g. "W,L,W,D,W"
      teamName: row.team.name,
      teamShort: row.team.shortName || row.team.tla || ''
    };
  }

  standingsCache = byTeamId;
  return byTeamId;
}

// ── Prediction model ─────────────────────────────────────────────────────────
// Blends league position with H2H record.
//
// Position-based: uses a strength rating derived from league position.
//   - Position 1 → strength ~0.95, position 20 → strength ~0.05
//   - The gap between strengths drives the base win probability.
//
// H2H-based: if available, adjusts the base probability based on historical record.
//
// Home advantage: +8% to home win probability (EPL historical average is ~46% home,
// ~27% draw, ~27% away — the ~8% gap from 38% baseline accounts for home advantage).

function computePrediction(homeTeamId, awayTeamId, standings, h2hAgg) {
  const homeStanding = standings[homeTeamId];
  const awayStanding = standings[awayTeamId];

  // ── Step 1: Position-based probability ──
  // Convert position (1-20) to strength (0.95-0.05)
  const homePos = homeStanding?.position || 10;
  const awayPos = awayStanding?.position || 10;
  const homeStrength = 1 - (homePos - 1) / 19;  // pos 1 → 1.0, pos 20 → 0.0
  const awayStrength = 1 - (awayPos - 1) / 19;

  // Expected score from strength difference (logistic-like curve)
  // When strengths are equal → 0.5, when one dominates → approaches 0.9
  const diff = homeStrength - awayStrength;
  const homeExpected = 1 / (1 + Math.exp(-4 * diff));  // Sigmoid with steepness 4

  // Convert expected score to H/D/A probabilities
  // Draw probability is highest when teams are close, lowest when far apart
  const posDiff = Math.abs(homePos - awayPos);
  const drawBase = Math.max(0.10, 0.30 - posDiff * 0.012);  // 30% when equal, drops with gap

  let hPct = homeExpected * (1 - drawBase);
  let aPct = (1 - homeExpected) * (1 - drawBase);
  let dPct = drawBase;

  // ── Step 2: Home advantage boost (+8%) ──
  hPct += 0.08;
  aPct -= 0.05;
  dPct -= 0.03;

  // ── Step 3: Blend with H2H if available (30% weight) ──
  if (h2hAgg && h2hAgg.numberOfMatches >= 2) {
    const h2hTotal = h2hAgg.numberOfMatches;
    const h2hHome = (h2hAgg.homeTeam?.wins || 0) / h2hTotal;
    const h2hDraw = (h2hAgg.homeTeam?.draws || 0) / h2hTotal;
    const h2hAway = (h2hAgg.awayTeam?.wins || 0) / h2hTotal;

    // Weight H2H more if we have more matches (max 30% weight at 5+ matches)
    const h2hWeight = Math.min(0.30, h2hTotal * 0.06);
    const posWeight = 1 - h2hWeight;

    hPct = hPct * posWeight + h2hHome * h2hWeight;
    dPct = dPct * posWeight + h2hDraw * h2hWeight;
    aPct = aPct * posWeight + h2hAway * h2hWeight;
  }

  // ── Step 4: Clamp & normalize ──
  hPct = Math.max(0.03, hPct);
  dPct = Math.max(0.03, dPct);
  aPct = Math.max(0.03, aPct);

  const sum = hPct + dPct + aPct;
  const home = Math.round((hPct / sum) * 100);
  const draw = Math.round((dPct / sum) * 100);
  const away = 100 - home - draw;  // Ensure they sum to exactly 100

  return { home, draw, away };
}

// ── ACTION: list ──────────────────────────────────────────────────────────────
// Returns all EPL fixtures for the given or next upcoming matchday.
// Fetches standings (1 call) + matchday fixtures (1 call) + H2H per fixture.
// Optional: pass requestedMatchday to fetch a specific matchday instead of auto-detecting.
async function listFixtures(requestedMatchday) {
  // 1. Fetch standings (gives position + form for all 20 teams)
  const standings = await getStandings();

  let matchday;

  if (requestedMatchday && requestedMatchday >= 1 && requestedMatchday <= 38) {
    // Admin explicitly requested a specific matchday
    matchday = requestedMatchday;
  } else {
    // Auto-detect: fetch competition info for current matchday
    await delay();
    const comp = await fdFetch(`competitions/${EPL_CODE}`);
    const currentMatchday = comp.currentSeason?.currentMatchday;

    if (!currentMatchday) {
      return { ok: true, round: null, count: 0, fixtures: [], message: 'No current matchday found — season may be over.' };
    }

    matchday = currentMatchday;
  }

  // 2. Fetch matches for the matchday
  await delay();
  let data = await fdFetch(`competitions/${EPL_CODE}/matches?matchday=${matchday}`);
  let matches = data.matches || [];

  // If all matches in this matchday are FINISHED and we're auto-detecting, try the next one
  const allFinished = matches.every(m => m.status === 'FINISHED');

  if (allFinished && !requestedMatchday && matchday < 38) {
    matchday = matchday + 1;
    await delay();
    data = await fdFetch(`competitions/${EPL_CODE}/matches?matchday=${matchday}`);
    matches = data.matches || [];
  }

  // When auto-detecting, filter out finished matches.
  // When admin explicitly requested a matchday, show ALL matches (they may want to see the full round).
  const finishedStatuses = new Set(['FINISHED', 'AWARDED']);
  const upcoming = requestedMatchday
    ? matches  // Show all when explicitly requested
    : matches.filter(m => !finishedStatuses.has(m.status));

  const round = `Matchweek ${matchday}`;

  const fixtures = upcoming.map(m => {
    const homeS = standings[m.homeTeam?.id] || {};
    const awayS = standings[m.awayTeam?.id] || {};

    return {
      fixtureId:   m.id,
      date:        m.utcDate,
      status:      m.status,
      round:       round,
      matchday:    matchday,
      homeTeam:    m.homeTeam?.name || m.homeTeam?.shortName || '',
      homeTeamId:  m.homeTeam?.id,
      homeLogo:    m.homeTeam?.crest || '',
      homePosition: homeS.position || null,
      homePoints:  homeS.points ?? null,
      homeFormRaw: homeS.form || '',
      awayTeam:    m.awayTeam?.name || m.awayTeam?.shortName || '',
      awayTeamId:  m.awayTeam?.id,
      awayLogo:    m.awayTeam?.crest || '',
      awayPosition: awayS.position || null,
      awayPoints:  awayS.points ?? null,
      awayFormRaw: awayS.form || '',
      quickPrediction: null,
      difficulty: 0
    };
  });

  // 4. Fetch H2H per fixture and compute predictions
  for (const fix of fixtures) {
    try {
      await delay();
      const h2hData = await fdFetch(`matches/${fix.fixtureId}/head2head?limit=10`);
      const agg = h2hData.aggregates || null;

      const pred = computePrediction(fix.homeTeamId, fix.awayTeamId, standings, agg);
      fix.quickPrediction = pred;

      // Shannon entropy for difficulty
      const total = pred.home + pred.draw + pred.away || 1;
      const probs = [pred.home/total, pred.draw/total, pred.away/total].filter(p => p > 0);
      fix.difficulty = probs.reduce((sum, p) => sum - p * Math.log2(p), 0);
    } catch (e) {
      console.warn(`H2H failed for fixture ${fix.fixtureId}:`, e.message);
      // Fall back to position-only prediction
      const pred = computePrediction(fix.homeTeamId, fix.awayTeamId, standings, null);
      fix.quickPrediction = pred;
      const total = pred.home + pred.draw + pred.away || 1;
      const probs = [pred.home/total, pred.draw/total, pred.away/total].filter(p => p > 0);
      fix.difficulty = probs.reduce((sum, p) => sum - p * Math.log2(p), 0);
    }
  }

  // Rank by difficulty and mark suggested top 5
  const sorted = [...fixtures].sort((a, b) => b.difficulty - a.difficulty);
  const suggestedIds = new Set(sorted.slice(0, 5).map(f => f.fixtureId));
  fixtures.forEach(f => { f.suggested = suggestedIds.has(f.fixtureId); });

  return { ok: true, round, matchday, count: fixtures.length, fixtures };
}

// ── ACTION: enrich ────────────────────────────────────────────────────────────
// Accepts array of selected fixtures, returns H2H detail + form + predictions.
// Uses standings for form (saves API calls) and H2H for detailed match history.
async function enrichFixtures(body) {
  const { fixtures } = body || {};
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw Object.assign(new Error('fixtures array required'), { status: 400 });
  }

  // Fetch standings (may already be cached from list call in same invocation)
  const standings = await getStandings();

  const enrichment = [];

  for (const fix of fixtures) {
    const item = {
      fixtureId: fix.fixtureId,
      predictions: null,
      homeForm: '',
      awayForm: '',
      h2h: [],
      advice: '',
      homePosition: null,
      awayPosition: null
    };

    // Standings data (position + form — no extra API calls!)
    const homeS = standings[fix.homeTeamId] || {};
    const awayS = standings[fix.awayTeamId] || {};
    item.homePosition = homeS.position || null;
    item.awayPosition = awayS.position || null;

    // Form from standings: "W,L,W,D,W" → "WLWDW"
    item.homeForm = (homeS.form || '').replace(/,/g, '').slice(-5);
    item.awayForm = (awayS.form || '').replace(/,/g, '').slice(-5);

    // H2H + predictions
    let h2hAgg = null;
    try {
      await delay();
      const h2hData = await fdFetch(`matches/${fix.fixtureId}/head2head?limit=10`);
      h2hAgg = h2hData.aggregates || null;
      const h2hMatches = h2hData.matches || [];

      // Map H2H matches to our format
      item.h2h = h2hMatches.slice(0, 5).map(h => ({
        date:       h.utcDate,
        homeTeam:   h.homeTeam?.name || '',
        awayTeam:   h.awayTeam?.name || '',
        homeGoals:  h.score?.fullTime?.home ?? null,
        awayGoals:  h.score?.fullTime?.away ?? null,
        homeWinner: h.score?.winner === 'HOME_TEAM',
        awayWinner: h.score?.winner === 'AWAY_TEAM'
      }));

    } catch (e) {
      console.warn(`H2H failed for fixture ${fix.fixtureId}:`, e.message);
    }

    // Compute prediction from position + H2H
    item.predictions = computePrediction(fix.homeTeamId, fix.awayTeamId, standings, h2hAgg);

    // Fall back to quickPrediction if prediction computation fails
    if (!item.predictions && fix.quickPrediction) {
      item.predictions = fix.quickPrediction;
    }

    // Generate advice text
    const posGap = Math.abs((homeS.position || 10) - (awayS.position || 10));
    const homeHigher = (homeS.position || 10) < (awayS.position || 10);

    let adviceParts = [];

    // Position context
    if (homeS.position && awayS.position) {
      adviceParts.push(`${homeHigher ? 'Home' : 'Away'} side sit ${homeHigher ? homeS.position : awayS.position}${ordinal(homeHigher ? homeS.position : awayS.position)} vs ${homeHigher ? awayS.position : homeS.position}${ordinal(homeHigher ? awayS.position : homeS.position)}.`);
    }

    // H2H context
    if (h2hAgg && h2hAgg.numberOfMatches > 0) {
      const hw = h2hAgg.homeTeam?.wins || 0;
      const aw = h2hAgg.awayTeam?.wins || 0;
      const dr = h2hAgg.homeTeam?.draws || 0;
      adviceParts.push(`H2H: ${hw}W-${dr}D-${aw}L from ${h2hAgg.numberOfMatches} meetings.`);
    }

    // Verdict
    if (posGap >= 12) {
      adviceParts.push(homeHigher ? 'Strong home favourite.' : 'Away side heavily favoured despite travelling.');
    } else if (posGap >= 6) {
      adviceParts.push(homeHigher ? 'Home advantage + table position points to a home win.' : 'Away side fancied but home advantage could be a factor.');
    } else {
      adviceParts.push('Close in the table — this one could go either way.');
    }

    item.advice = adviceParts.join(' ');

    enrichment.push(item);
  }

  return { ok: true, enrichment };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Reset standings cache per invocation
  standingsCache = null;

  try {
    // Auth check
    const secret = (event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'] || '').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
      return resp(401, 'Unauthorised');
    }

    const url = new URL(event.rawUrl);
    const action = url.searchParams.get('action');

    if (action === 'list') {
      if (event.httpMethod !== 'GET') return resp(405, 'GET only for action=list');
      const mdParam = url.searchParams.get('matchday');
      const requestedMatchday = mdParam ? Number(mdParam) : null;
      const result = await listFixtures(requestedMatchday);
      return resp(200, result);
    }

    if (action === 'enrich') {
      if (event.httpMethod !== 'POST') return resp(405, 'POST only for action=enrich');
      const body = JSON.parse(event.body || '{}');
      const result = await enrichFixtures(body);
      return resp(200, result);
    }

    return resp(400, 'action parameter required: list or enrich');
  } catch (e) {
    const status = e.status || 500;
    return resp(status, e.message);
  }
};

function resp(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    },
    body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body)
  };
}
