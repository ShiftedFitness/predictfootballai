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
 *   - SECONDARY: H2H historical record (fetched only during enrich)
 *   - FACTOR: Home advantage (~8% boost, based on EPL historical average)
 *   - FACTOR: Recent form (last 5 matches from standings)
 *
 * Auth: x-admin-secret header OR Supabase JWT (admin user) required.
 * Env:  FOOTBALL_DATA_KEY (API token from football-data.org)
 *
 * football-data.org free tier: 10 requests/minute, EPL included forever.
 * We use careful rate limiting (6.5s between calls) to stay within limits.
 *
 * API call budget:
 *   list  = 2-3 calls (standings + optional comp info + matchday) — fast!
 *   enrich = 6 calls (standings + 5 H2H) — ~35s with rate limiting
 */

const { requireAdmin } = require('./_supabase');

const FD_BASE = 'https://api.football-data.org/v4';
const EPL_CODE = 'PL';   // Premier League competition code

// ── API helper ──────────────────────────────────────────────────────────────
async function fdFetch(path, retryCount = 0) {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) throw Object.assign(new Error('FOOTBALL_DATA_KEY not configured'), { status: 500 });

  const url = `${FD_BASE}/${path}`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': key } });

  if (res.status === 429) {
    // Retry once after waiting if we hit rate limit
    if (retryCount < 1) {
      console.warn(`Rate limited on ${path}, waiting 12s and retrying...`);
      await new Promise(r => setTimeout(r, 12000));
      return fdFetch(path, retryCount + 1);
    }
    throw Object.assign(new Error('football-data.org rate limit reached. Wait a minute and try again.'), { status: 429 });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`football-data.org ${res.status}: ${text}`), { status: res.status });
  }
  return res.json();
}

// Delay between API calls — football-data.org free tier = 10 requests/minute
// 6.5s between calls = ~9.2 calls/minute, safely under the 10/min limit
const delay = (ms = 6500) => new Promise(r => setTimeout(r, ms));

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
// Blends league position with recent form and optionally H2H record.
//
// Position-based (65% weight): uses a strength rating derived from league position.
//   - Position 1 → strength ~0.95, position 20 → strength ~0.05
//   - The gap between strengths drives the base win probability.
//
// Form-based (15% weight): recent results from standings (last 5 matches).
//   - Converts WWDLL → 0.73 win rate → favours teams in good form.
//
// H2H-based (up to 20% weight): if available, adjusts based on historical record.
//
// Home advantage: +6% to home win probability (EPL avg ~46% home, ~27% draw, ~27% away).

function formToWinRate(formStr) {
  // Convert form string like "W,L,W,D,W" or "WLWDW" to a win rate (0-1)
  if (!formStr) return 0.40;  // neutral default
  const chars = formStr.replace(/,/g, '').toUpperCase();
  if (chars.length === 0) return 0.40;
  let score = 0;
  for (const c of chars) {
    if (c === 'W') score += 1.0;
    else if (c === 'D') score += 0.4;
    // L = 0
  }
  return score / chars.length;
}

function computePrediction(homeTeamId, awayTeamId, standings, h2hAgg) {
  const homeStanding = standings[homeTeamId];
  const awayStanding = standings[awayTeamId];

  // ── Step 1: Position-based probability (primary signal) ──
  const homePos = homeStanding?.position || 10;
  const awayPos = awayStanding?.position || 10;

  // Strength: position 1 → 1.0, position 20 → 0.0
  const homeStrength = 1 - (homePos - 1) / 19;
  const awayStrength = 1 - (awayPos - 1) / 19;

  // Sigmoid on strength difference — steepness 3.5 gives realistic spread
  // At equal positions → 0.50, position 1 vs 20 → ~0.97
  const diff = homeStrength - awayStrength;
  const homeExpected = 1 / (1 + Math.exp(-3.5 * diff));

  // Draw probability peaks when teams are close, drops with larger gaps
  const posDiff = Math.abs(homePos - awayPos);
  const drawBase = Math.max(0.12, 0.28 - posDiff * 0.010);

  let hPct = homeExpected * (1 - drawBase);
  let aPct = (1 - homeExpected) * (1 - drawBase);
  let dPct = drawBase;

  // ── Step 2: Form adjustment (nudges based on recent results) ──
  const homeFormRate = formToWinRate(homeStanding?.form);
  const awayFormRate = formToWinRate(awayStanding?.form);

  // Form difference: positive means home in better form
  const formDiff = homeFormRate - awayFormRate;
  // Nudge probabilities by up to ±6% based on form
  const formNudge = formDiff * 0.12;
  hPct += formNudge;
  aPct -= formNudge * 0.7;
  dPct -= formNudge * 0.3;

  // ── Step 3: Home advantage (+6%) ──
  hPct += 0.06;
  aPct -= 0.03;
  dPct -= 0.03;

  // ── Step 4: Blend with H2H if available (up to 20% weight) ──
  if (h2hAgg && h2hAgg.numberOfMatches >= 2) {
    const h2hTotal = h2hAgg.numberOfMatches;
    const h2hHome = (h2hAgg.homeTeam?.wins || 0) / h2hTotal;
    const h2hDraw = (h2hAgg.homeTeam?.draws || 0) / h2hTotal;
    const h2hAway = (h2hAgg.awayTeam?.wins || 0) / h2hTotal;

    // Weight H2H more with more data points (max 20% at 5+ matches)
    const h2hWeight = Math.min(0.20, h2hTotal * 0.04);
    const baseWeight = 1 - h2hWeight;

    hPct = hPct * baseWeight + h2hHome * h2hWeight;
    dPct = dPct * baseWeight + h2hDraw * h2hWeight;
    aPct = aPct * baseWeight + h2hAway * h2hWeight;
  }

  // ── Step 5: Clamp & normalize to ensure sensible percentages ──
  hPct = Math.max(0.05, hPct);
  dPct = Math.max(0.05, dPct);
  aPct = Math.max(0.05, aPct);

  const sum = hPct + dPct + aPct;
  const home = Math.round((hPct / sum) * 100);
  const draw = Math.round((dPct / sum) * 100);
  const away = 100 - home - draw;  // Ensure they sum to exactly 100

  return { home, draw, away };
}

// ── ACTION: list ──────────────────────────────────────────────────────────────
// Returns all EPL fixtures for the given or next upcoming matchday.
// Uses 2-3 API calls only: standings + optional comp info + matchday fixtures.
// Quick predictions are computed from position + form (no H2H — saves API budget).
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

    // Compute quick prediction from position + form (no H2H — saves API calls)
    const pred = computePrediction(m.homeTeam?.id, m.awayTeam?.id, standings, null);

    // Shannon entropy for difficulty (higher = closer to three-way toss-up)
    const total = pred.home + pred.draw + pred.away || 1;
    const probs = [pred.home/total, pred.draw/total, pred.away/total].filter(p => p > 0);
    const difficulty = probs.reduce((sum, p) => sum - p * Math.log2(p), 0);

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
      quickPrediction: pred,
      difficulty
    };
  });

  // Rank by difficulty and mark suggested top 5
  const sorted = [...fixtures].sort((a, b) => b.difficulty - a.difficulty);
  const suggestedIds = new Set(sorted.slice(0, 5).map(f => f.fixtureId));
  fixtures.forEach(f => { f.suggested = suggestedIds.has(f.fixtureId); });

  return { ok: true, round, matchday, count: fixtures.length, fixtures };
}

// ── ACTION: enrich ────────────────────────────────────────────────────────────
// Accepts array of selected fixtures (max 5), returns H2H detail + form + predictions.
// Uses standings for form (free — no extra calls) and fetches H2H per fixture.
// Total API calls: 1 (standings, usually cached) + N (H2H per fixture) = ~6 calls.
async function enrichFixtures(body) {
  const { fixtures } = body || {};
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw Object.assign(new Error('fixtures array required'), { status: 400 });
  }

  // Fetch standings (may already be cached from list call in same invocation)
  const standings = await getStandings();

  const enrichment = [];
  const warnings = [];

  for (const fix of fixtures) {
    const item = {
      fixtureId: fix.fixtureId,
      predictions: null,
      homeForm: '',
      awayForm: '',
      h2h: [],
      advice: '',
      homePosition: null,
      awayPosition: null,
      homePoints: null,
      awayPoints: null
    };

    // Standings data (position + form — no extra API calls!)
    const homeS = standings[fix.homeTeamId] || {};
    const awayS = standings[fix.awayTeamId] || {};
    item.homePosition = homeS.position || null;
    item.awayPosition = awayS.position || null;
    item.homePoints = homeS.points ?? null;
    item.awayPoints = awayS.points ?? null;

    // Form from standings: "W,L,W,D,W" → "WLWDW"
    const rawHomeForm = homeS.form || '';
    const rawAwayForm = awayS.form || '';
    item.homeForm = rawHomeForm.replace(/,/g, '').slice(-5);
    item.awayForm = rawAwayForm.replace(/,/g, '').slice(-5);

    if (!item.homeForm) warnings.push(`No form data for home team (id:${fix.homeTeamId})`);
    if (!item.awayForm) warnings.push(`No form data for away team (id:${fix.awayTeamId})`);

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

      if (!h2hAgg || h2hAgg.numberOfMatches === 0) {
        warnings.push(`No H2H history for fixture ${fix.fixtureId}`);
      }
    } catch (e) {
      console.warn(`H2H failed for fixture ${fix.fixtureId}:`, e.message);
      warnings.push(`H2H fetch failed for fixture ${fix.fixtureId}: ${e.message}`);
    }

    // Compute prediction from position + form + H2H
    item.predictions = computePrediction(fix.homeTeamId, fix.awayTeamId, standings, h2hAgg);

    // Generate advice text
    const posGap = Math.abs((homeS.position || 10) - (awayS.position || 10));
    const homeHigher = (homeS.position || 10) < (awayS.position || 10);

    let adviceParts = [];

    // Position context
    if (homeS.position && awayS.position) {
      const higher = homeHigher ? homeS : awayS;
      const lower = homeHigher ? awayS : homeS;
      adviceParts.push(`${homeHigher ? 'Home' : 'Away'} side sit ${higher.position}${ordinal(higher.position)} (${higher.points || '?'}pts) vs ${lower.position}${ordinal(lower.position)} (${lower.points || '?'}pts).`);
    }

    // Form context
    if (item.homeForm && item.awayForm) {
      const homeWins = (item.homeForm.match(/W/g) || []).length;
      const awayWins = (item.awayForm.match(/W/g) || []).length;
      if (Math.abs(homeWins - awayWins) >= 2) {
        const betterSide = homeWins > awayWins ? 'Home' : 'Away';
        adviceParts.push(`${betterSide} side in better recent form.`);
      }
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

  return { ok: true, enrichment, warnings: warnings.length > 0 ? warnings : undefined };
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

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return resp(204, '');
  }

  try {
    // Auth check: accepts x-admin-secret OR Supabase JWT (admin user)
    const authError = await requireAdmin(event);
    if (authError) return authError;

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
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-secret, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Cache-Control': 'no-store'
    },
    body: typeof body === 'string' ? JSON.stringify({ error: body }) : JSON.stringify(body)
  };
}
