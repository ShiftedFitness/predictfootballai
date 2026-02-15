/**
 * api-football-fixtures.js
 *
 * Proxy for API-Football v3. Two actions:
 *   ?action=list   — GET upcoming EPL fixtures (next 10)
 *   ?action=enrich — POST with fixture IDs to fetch predictions, form, H2H
 *
 * Auth: x-admin-secret header required.
 * Env:  API_FOOTBALL_KEY
 */

const API_BASE = process.env.API_FOOTBALL_URL || 'https://v3.football.api-sports.io';
const EPL_LEAGUE_ID = 39;

// Determine current EPL season year: Aug–May → if month >= 8, season = thisYear; else lastYear
function getCurrentSeason() {
  const now = new Date();
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

// Thin wrapper around API-Football fetch
async function apiFetch(endpoint, params = {}) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw Object.assign(new Error('API_FOOTBALL_KEY not configured'), { status: 500 });

  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE}/${endpoint}${qs ? '?' + qs : ''}`;

  const res = await fetch(url, {
    headers: { 'x-apisports-key': key }
  });

  if (res.status === 429) {
    throw Object.assign(new Error('API-Football daily limit reached. Try again tomorrow.'), { status: 429 });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`API-Football ${res.status}: ${text}`), { status: res.status });
  }

  const json = await res.json();
  // API-Football wraps errors inside response body
  if (json.errors && Object.keys(json.errors).length > 0) {
    const msg = Object.values(json.errors).join('; ');
    throw Object.assign(new Error(`API-Football error: ${msg}`), { status: 400 });
  }
  return json;
}

// ── ACTION: list ──────────────────────────────────────────────────────────────
// Returns all EPL fixtures for the next upcoming matchweek (round).
// Strategy: fetch 1 upcoming fixture to discover its round, then fetch all
// fixtures for that round. This avoids the "next 10" problem where ad-hoc
// rescheduled fixtures from different rounds pollute the list.
// Also fetches quick predictions for each to calculate difficulty scores.
async function listFixtures() {
  const season = getCurrentSeason();

  // Step 1: discover the next round by fetching the very next fixture (1 API call)
  const probe = await apiFetch('fixtures', {
    league: EPL_LEAGUE_ID,
    season,
    next: 1
  });

  const nextFixture = probe.response?.[0];
  if (!nextFixture) {
    return { ok: true, season, round: null, count: 0, fixtures: [], message: 'No upcoming fixtures found' };
  }

  const round = nextFixture.league?.round;
  if (!round) {
    throw Object.assign(new Error('Could not determine matchweek round from API'), { status: 500 });
  }

  // Step 2: fetch ALL fixtures for that round (1 API call)
  const data = await apiFetch('fixtures', {
    league: EPL_LEAGUE_ID,
    season,
    round
  });

  // Finished-match statuses to exclude (FT = Full Time, AET = After Extra Time, PEN = Penalties)
  const finishedStatuses = new Set(['FT', 'AET', 'PEN']);

  const fixtures = (data.response || [])
    .filter(f => !finishedStatuses.has(f.fixture.status?.short))
    .map(f => ({
      fixtureId:   f.fixture.id,
      date:        f.fixture.date,
      status:      f.fixture.status?.short || 'NS',
      round:       f.league?.round || '',
      homeTeam:    f.teams.home.name,
      homeTeamId:  f.teams.home.id,
      homeLogo:    f.teams.home.logo,
      awayTeam:    f.teams.away.name,
      awayTeamId:  f.teams.away.id,
      awayLogo:    f.teams.away.logo,
      // Will be populated below
      quickPrediction: null,
      difficulty: 0
    }));

  // Fetch predictions for each fixture to calculate difficulty
  // Difficulty = how close to 33/33/33 (Shannon entropy, higher = harder to call)
  for (const fix of fixtures) {
    try {
      const predData = await apiFetch('predictions', { fixture: fix.fixtureId });
      const pred = predData.response?.[0];
      if (pred?.predictions?.percent) {
        const h = parseInt(pred.predictions.percent.home) || 0;
        const d = parseInt(pred.predictions.percent.draw) || 0;
        const a = parseInt(pred.predictions.percent.away) || 0;
        fix.quickPrediction = { home: h, draw: d, away: a };

        // Shannon entropy (higher = more uncertain = harder to call)
        // Max entropy for 3 outcomes is log2(3) ≈ 1.585
        const total = h + d + a || 1;
        const probs = [h/total, d/total, a/total].filter(p => p > 0);
        fix.difficulty = probs.reduce((sum, p) => sum - p * Math.log2(p), 0);
      }
    } catch (e) {
      console.warn(`Quick prediction failed for fixture ${fix.fixtureId}:`, e.message);
      // Non-fatal: fixture still shows, just without difficulty score
    }
  }

  // Rank by difficulty (highest first) and mark suggested top 5
  const sorted = [...fixtures].sort((a, b) => b.difficulty - a.difficulty);
  const suggestedIds = new Set(sorted.slice(0, 5).map(f => f.fixtureId));
  fixtures.forEach(f => { f.suggested = suggestedIds.has(f.fixtureId); });

  return { ok: true, season, round, count: fixtures.length, fixtures };
}

// ── ACTION: enrich ────────────────────────────────────────────────────────────
// Accepts array of fixtures, returns predictions + form + H2H for each
// If quickPrediction is provided per fixture (from list step), skips re-fetching predictions
// and only fetches full prediction data (H2H, comparison) + team form
async function enrichFixtures(body) {
  const { fixtures } = body || {};
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw Object.assign(new Error('fixtures array required'), { status: 400 });
  }

  const season = getCurrentSeason();
  const enrichment = [];

  for (const fix of fixtures) {
    const item = {
      fixtureId: fix.fixtureId,
      predictions: null,
      homeForm: '',
      awayForm: '',
      h2h: [],
      comparison: null,
      advice: ''
    };

    // 1) Predictions (includes H2H + comparison)
    // Always fetch full predictions for H2H and comparison data
    try {
      const predData = await apiFetch('predictions', { fixture: fix.fixtureId });
      const pred = predData.response?.[0];
      if (pred) {
        item.predictions = {
          home: parseInt(pred.predictions?.percent?.home) || 0,
          draw: parseInt(pred.predictions?.percent?.draw) || 0,
          away: parseInt(pred.predictions?.percent?.away) || 0
        };
        item.advice = pred.predictions?.advice || '';

        // Comparison stats from predictions response
        if (pred.comparison) {
          item.comparison = {};
          for (const [key, val] of Object.entries(pred.comparison)) {
            item.comparison[key] = {
              home: parseInt(val.home) || 0,
              away: parseInt(val.away) || 0
            };
          }
        }

        // H2H from predictions response (last 5)
        if (Array.isArray(pred.h2h)) {
          item.h2h = pred.h2h.slice(0, 5).map(h => ({
            date:       h.fixture?.date,
            homeTeam:   h.teams?.home?.name,
            awayTeam:   h.teams?.away?.name,
            homeGoals:  h.goals?.home ?? null,
            awayGoals:  h.goals?.away ?? null,
            homeWinner: h.teams?.home?.winner,
            awayWinner: h.teams?.away?.winner
          }));
        }
      }
    } catch (e) {
      console.warn(`Predictions failed for fixture ${fix.fixtureId}:`, e.message);
      // Fall back to quickPrediction from list step if available
      if (fix.quickPrediction) {
        item.predictions = fix.quickPrediction;
      }
    }

    // 2) Home team form
    if (fix.homeTeamId) {
      try {
        const statsData = await apiFetch('teams/statistics', {
          league: EPL_LEAGUE_ID,
          season,
          team: fix.homeTeamId
        });
        const form = statsData.response?.form || '';
        item.homeForm = form.slice(-5); // last 5 results
      } catch (e) {
        console.warn(`Home form failed for team ${fix.homeTeamId}:`, e.message);
      }
    }

    // 3) Away team form
    if (fix.awayTeamId) {
      try {
        const statsData = await apiFetch('teams/statistics', {
          league: EPL_LEAGUE_ID,
          season,
          team: fix.awayTeamId
        });
        const form = statsData.response?.form || '';
        item.awayForm = form.slice(-5);
      } catch (e) {
        console.warn(`Away form failed for team ${fix.awayTeamId}:`, e.message);
      }
    }

    enrichment.push(item);
  }

  return { ok: true, enrichment };
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
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
      const result = await listFixtures();
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
