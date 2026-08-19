#!/usr/bin/env node
/**
 * picks-ai-preview.js
 *
 * Shows exactly what Picks AI will do for a matchweek — without a database,
 * without an Anthropic key, and without spending anything.
 *
 * It pulls the REAL live Polymarket prices and runs the REAL prompt-building
 * code from picks-ai.js (via its _internal export), so what you see here is
 * what the deployed function would actually send to Claude. The only thing
 * it does not do is make the API call itself.
 *
 * Useful for:
 *   - sanity-checking a matchweek before the scheduled run
 *   - iterating on the system prompt without burning API budget
 *   - confirming the market data looks sane after a Polymarket change
 *
 *   node scripts/picks-ai-preview.js                  # auto-pick 5 closest games
 *   node scripts/picks-ai-preview.js --all            # every fixture with a market
 *   node scripts/picks-ai-preview.js --prompt         # print the full prompt
 *   node scripts/picks-ai-preview.js --pos 4 --gap 8  # pretend it is 4th, 8 behind
 */

const path = require('path');
const { fetchEplMatchMarkets } = require(path.join(__dirname, '..', 'netlify', 'functions', '_polymarket.js'));
const { _internal } = require(path.join(__dirname, '..', 'netlify', 'functions', 'picks-ai.js'));

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

// Shannon entropy — how close to a three-way toss-up a fixture is. The admin
// UI ranks "suggested" fixtures the same way, so picking the top 5 here
// mirrors what a typical matchweek would contain.
function uncertainty(m) {
  return [m.home, m.draw, m.away]
    .map((p) => p / 100)
    .filter((p) => p > 0)
    .reduce((s, p) => s - p * Math.log2(p), 0);
}

(async () => {
  console.log('Fetching live Polymarket prices…\n');
  const markets = await fetchEplMatchMarkets();
  if (!markets.length) {
    console.error('No markets returned. Polymarket may be unreachable.');
    process.exit(1);
  }

  // Soonest matchday with markets.
  const dates = [...new Set(markets.map((m) => m.date))].sort();
  const matchday = dates[0];
  const sameRound = markets.filter((m) => {
    const gap = Math.abs(Date.parse(m.date) - Date.parse(matchday)) / 86400000;
    return gap <= 3;                       // a matchweek spans Fri-Mon
  });

  const chosen = has('--all')
    ? sameRound
    : sameRound.sort((a, b) => uncertainty(b) - uncertainty(a)).slice(0, 5);

  console.log(`Matchweek starting ${matchday} — ${sameRound.length} fixtures priced, showing ${chosen.length}.\n`);
  console.log('  ' + 'FIXTURE'.padEnd(46) + 'HOME DRAW AWAY   CLOSENESS');
  console.log('  ' + '-'.repeat(74));
  for (const m of chosen) {
    console.log('  ' + `${m.homeName} v ${m.awayName}`.padEnd(46) +
      String(m.home).padStart(4) + String(m.draw).padStart(5) + String(m.away).padStart(5) +
      '   ' + uncertainty(m).toFixed(2));
  }

  // Shape them like predict_matches rows so the real brief-builder can run.
  const matches = chosen.map((m, i) => ({
    id: 1000 + i,
    home_team: m.homeName,
    away_team: m.awayName,
    lockout_time: `${m.date}T11:30:00Z`,
    home_form: '',                     // empty at MW1, exactly as in reality
    away_form: '',
    prediction_home: m.home,
    prediction_draw: m.draw,
    prediction_away: m.away
  }));

  // Strategic context. Defaults describe week 1 with no history; override
  // with --pos / --gap to preview how it behaves later in the season.
  const pos = Number(val('--pos', 0));
  const gap = Number(val('--gap', 0));
  const ctx = pos
    ? {
        standing: {
          position: pos, of: 24, points: 40, fullHouses: 0,
          leaderPoints: 40 + gap, gapToLeader: gap,
          gapToPlayerAbove: 2, gapToPlayerBelow: 3
        },
        weeksPlayed: 12,
        weeksRemaining: 26,
        myWeeklyScores: [
          { week: 8, correct: 3 }, { week: 9, correct: 2 }, { week: 10, correct: 4 },
          { week: 11, correct: 1 }, { week: 12, correct: 3 }
        ],
        field: {
          matchesAnalysed: 60, majorityPickAccuracy: 52,
          fieldPickSplit: { HOME: 58, DRAW: 12, AWAY: 30 },
          actualResultSplit: { HOME: 45, DRAW: 26, AWAY: 29 }
        }
      }
    : { weeksPlayed: 0, weeksRemaining: 37, myWeeklyScores: [] };

  const brief = _internal.buildFixtureBrief(
    matches, 1, _internal.renderStrategicContext(ctx, 'Picks AI')
  );

  console.log('\n' + '='.repeat(78));
  console.log('WHAT PICKS AI IS TOLD ABOUT ITS SITUATION');
  console.log('='.repeat(78));
  console.log(_internal.renderStrategicContext(ctx, 'Picks AI'));

  if (has('--prompt')) {
    console.log('\n' + '='.repeat(78));
    console.log('SYSTEM PROMPT');
    console.log('='.repeat(78));
    console.log(_internal.SYSTEM_PROMPT);
    console.log('\n' + '='.repeat(78));
    console.log('USER MESSAGE');
    console.log('='.repeat(78));
    console.log(brief);
  } else {
    console.log('\n(run with --prompt to see the full system prompt and fixture brief)');
  }

  // Cost, using the same estimator the function logs with.
  const sysTokens = Math.ceil(_internal.SYSTEM_PROMPT.length / 4);
  const briefTokens = Math.ceil(brief.length / 4);
  const searchTokens = _internal.MAX_SEARCHES * 5000;      // rough per-search payload
  const estIn = sysTokens + briefTokens + searchTokens;
  const cost = _internal.estimateCost(
    { input_tokens: estIn, output_tokens: 900 }, _internal.MAX_SEARCHES
  );

  console.log('\n' + '='.repeat(78));
  console.log('COST ESTIMATE');
  console.log('='.repeat(78));
  console.log(`  model            ${_internal.MODEL}`);
  console.log(`  system prompt    ~${sysTokens} tokens`);
  console.log(`  fixture brief    ~${briefTokens} tokens`);
  console.log(`  search results   ~${searchTokens} tokens (${_internal.MAX_SEARCHES} searches)`);
  console.log(`  ---`);
  console.log(`  this week        ~$${cost.toFixed(4)}`);
  console.log(`  full season      ~$${(cost * 38).toFixed(2)} over 38 weeks`);
  console.log(`\n  Searches are $${(_internal.MAX_SEARCHES * 0.01).toFixed(2)} of that — still the dominant cost.`);
  console.log('\nNothing was sent to the Anthropic API and nothing was written to the database.');
})().catch((e) => { console.error('preview failed:', e.message); process.exit(1); });
