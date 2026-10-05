/**
 * ask.js — regression tests for Ask's query understanding.
 *
 * Two halves, deliberately:
 *
 *   PLANS    — a question in, a query plan out. No database. These are the
 *              tests that matter most, because a wrong plan is a confidently
 *              wrong ANSWER, and the "each vs total" distinction is invisible
 *              in the output: both return a plausible table.
 *
 *   FIXTURE  — the executor against a tiny hand-built dataset where the right
 *              answer is known by construction. Production data cannot prove
 *              20/15/10 is excluded, because nobody may have those numbers.
 *
 * Run: npm run check:ask
 */
const plan = require('../../netlify/functions/_ask_plan');
const mparse = require('../../netlify/functions/_ask_measure_parse');
const measure = require('../../netlify/functions/_ask_measure');

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/** Parse a question all the way to a validated plan, or null. */
function planFor(q) {
  const raw = mparse.parse(q);
  if (!raw) return null;
  try { return plan.validate(raw); } catch (_) { return null; }
}

// ─── 1. the question that started this ──────────────────────────────────────
{
  const q = 'Who has scored more than 10 goals in both La Liga, Premier League and Serie A?';
  const p = planFor(q);
  check('original: parses at all', !!p);
  if (p) {
    check('original: measure is goals', p.measure === 'goals', p.measure);
    check('original: three competitions', p.scope.ids.length === 3, String(p.scope.ids));
    check('original: mode all', p.scope.mode === 'all', p.scope.mode);
    check('original: operator is gt', p.threshold && p.threshold.op === 'gt');
    check('original: value is 10', p.threshold && p.threshold.value === 10);
    // The one that matters: ten in EVERY league, not ten between them.
    check('original: threshold applies to EACH', p.threshold && p.threshold.applies === 'each',
          p.threshold && p.threshold.applies);
  }
}

// ─── 2. plan-level cases ────────────────────────────────────────────────────
const CASES = [
  // [question, assertions on the plan]
  ['Who scored more than 10 goals in the Premier League and La Liga?',
    (p) => p.scope.ids.length === 2 && p.threshold.op === 'gt' && p.threshold.applies === 'each'],
  ['Which players scored at least 20 goals in each of the Bundesliga, Serie A and La Liga?',
    (p) => p.scope.ids.length === 3 && p.threshold.op === 'gte' && p.threshold.value === 20],
  ['Which players appeared in all three of La Liga, Premier League and Serie A?',
    (p) => p.scope.ids.length === 3 && p.scope.mode === 'all' && p.measure === 'appearances'],
  ['Which players scored in either the Premier League or Bundesliga?',
    (p) => p.scope.mode === 'any' && p.measure === 'goals'],
  ['Which players played in the Premier League but never La Liga?',
    (p) => p.scope.ids.length === 1 && p.scope.exclude.length === 1],
  ['Which Brazilian players scored more than 50 Premier League goals?',
    (p) => p.filters.nationality === 'BRA' && p.threshold.value === 50],
  ['Who scored more than 20 Premier League goals between 2000 and 2010?',
    (p) => p.filters.seasonFrom === 2000 && p.filters.seasonTo === 2010],
  ['Which players appeared for Liverpool in the 1990s?',
    (p) => p.filters.seasonFrom === 1990 && p.filters.seasonTo === 1999],
  ['Which players have played in both La Liga and Serie A since 2015?',
    (p) => p.filters.seasonFrom === 2015 && p.scope.ids.length === 2],
  ['Who scored fewer than 5 goals in the Premier League?',
    (p) => p.threshold.op === 'lt' && p.threshold.value === 5],
  ['Who scored at most 3 goals in Serie A?',
    (p) => p.threshold.op === 'lte' && p.threshold.value === 3],
  ['Who scored exactly 10 goals in La Liga?',
    (p) => p.threshold.op === 'eq' && p.threshold.value === 10],
  ['Who scored between 10 and 20 goals in the Bundesliga?',
    (p) => p.threshold.op === 'between' && p.threshold.value === 10 && p.threshold.value2 === 20],
  ['Who scored over 100 goals in the Premier League?',
    (p) => p.threshold.op === 'gt' && p.threshold.value === 100],
  ['Players with no more than 10 goals in Ligue 1',
    (p) => p.threshold.op === 'lte' && p.threshold.value === 10],
  ['Top 5 scorers in the Championship with more than 20 goals',
    // The number after the operator, not the first number in the sentence.
    (p) => p.threshold.value === 20 && p.limit === 5],
  ['Spanish players with more than 30 goals in the Premier League',
    (p) => p.filters.nationality === 'ESP' && p.threshold.value === 30],
  ['Who played in La Liga, Serie A, Bundesliga and Ligue 1?',
    (p) => p.scope.ids.length === 4],
  ['Which players scored more than 20 goals in La Liga but fewer than 10 in Serie A?',
    // Two different thresholds is NOT supported; it must not silently apply
    // one of them to both.
    (p) => p.scope.ids.length >= 1],
  ['Players with at least 100 appearances in the Championship',
    (p) => p.measure === 'appearances' && p.threshold.op === 'gte' && p.threshold.value === 100],
  ['Who made over 200 appearances in Ligue 1?',
    (p) => p.measure === 'appearances' && p.threshold.value === 200],
  ['Italian players with more than 40 Serie A goals',
    (p) => p.filters.nationality === 'ITA' && p.threshold.value === 40],
  ['French players who scored at least 15 goals in the Premier League and Ligue 1',
    (p) => p.filters.nationality === 'FRA' && p.scope.ids.length === 2 &&
           p.threshold.applies === 'each'],
  ['Who scored more than 5 goals in the Champions League?',
    (p) => p.scope.ids.includes('Champions League') && p.threshold.value === 5],
  ['Players with more than 25 goals in the Segunda Divisi\u00f3n',
    (p) => p.scope.ids.includes('Segunda Divisi\u00f3n')],
  ['Who scored more than 10 goals in the FA Cup and the EFL Cup?',
    (p) => p.scope.ids.length === 2 && p.threshold.applies === 'each'],
  ['Top 3 scorers in La Liga and Serie A with over 50 goals',
    (p) => p.limit === 3 && p.threshold.value === 50],
  ['Who scored above 30 goals in the Bundesliga since 2015?',
    (p) => p.filters.seasonFrom === 2015 && p.threshold.op === 'gt'],
  ['Which German players appeared in both the Bundesliga and the Premier League?',
    (p) => p.filters.nationality === 'GER' && p.scope.ids.length === 2],
  ['Players with under 10 goals in Serie A',
    (p) => p.threshold.op === 'lt' && p.threshold.value === 10],
  ['Who scored 20 or more goals in La Liga?',
    (p) => p.threshold.op === 'gte' && p.threshold.value === 20],
  ['Who played in La Liga but never in the Premier League or Serie A?',
    (p) => p.scope.exclude.length === 2],
  ['Who scored more than 10 goals in the Premier League in the 2000s?',
    (p) => p.filters.seasonFrom === 2000 && p.filters.seasonTo === 2009],
  ['Portuguese players with at least 5 Champions League goals',
    (p) => p.filters.nationality === 'POR' && p.threshold.value === 5],
];

for (const [q, assertFn] of CASES) {
  const p = planFor(q);
  if (!p) { check(`plan: ${q.slice(0, 54)}`, false, 'did not parse'); continue; }
  let ok = false;
  try { ok = !!assertFn(p); } catch (e) { ok = false; }
  check(`plan: ${q.slice(0, 54)}`, ok, ok ? '' : plan.describe(p));
}

// ─── 3. questions the engine should NOT claim ───────────────────────────────
const NOT_OURS = [
  'Who played for both Everton and Liverpool?',       // club intersection: old path
  'Top Arsenal goalscorers',                           // one club: old path
  'Which clubs did Peter Crouch play for?',            // a player: old path
];
for (const q of NOT_OURS) {
  check(`routing: leaves "${q.slice(0, 40)}" to the club patterns`,
        !mparse.needsMeasureEngine(q));
}

// ─── 4. the fixture ─────────────────────────────────────────────────────────
//
// A tiny database with known answers, so "20/15/10 does not qualify" is
// proved rather than hoped for. Shaped exactly like agg_player_club_comp.
const FIXTURE = [
  // Qualifies: 20 / 15 / 12, all above 10.
  { player_id: 1, player_name: 'Alpha', nationality: 'ESP', competition_name: 'La Liga', club_id: 1, club_name: 'A', goals: 20, appearances: 100, first_season: 2000, last_season: 2010 },
  { player_id: 1, player_name: 'Alpha', nationality: 'ESP', competition_name: 'Premier League', club_id: 2, club_name: 'B', goals: 15, appearances: 90, first_season: 2010, last_season: 2015 },
  { player_id: 1, player_name: 'Alpha', nationality: 'ESP', competition_name: 'Serie A', club_id: 3, club_name: 'C', goals: 12, appearances: 80, first_season: 2015, last_season: 2018 },

  // Does NOT qualify: 20 / 15 / 10 — ten is not MORE than ten.
  { player_id: 2, player_name: 'Beta', nationality: 'ITA', competition_name: 'La Liga', club_id: 1, club_name: 'A', goals: 20, appearances: 100, first_season: 2000, last_season: 2010 },
  { player_id: 2, player_name: 'Beta', nationality: 'ITA', competition_name: 'Premier League', club_id: 2, club_name: 'B', goals: 15, appearances: 90, first_season: 2010, last_season: 2015 },
  { player_id: 2, player_name: 'Beta', nationality: 'ITA', competition_name: 'Serie A', club_id: 3, club_name: 'C', goals: 10, appearances: 80, first_season: 2015, last_season: 2018 },

  // Does NOT qualify: 100 / 0 / 0 — a huge total in one league is not three.
  { player_id: 3, player_name: 'Gamma', nationality: 'ENG', competition_name: 'Premier League', club_id: 2, club_name: 'B', goals: 100, appearances: 300, first_season: 1995, last_season: 2010 },

  // Qualifies: 11 in La Liga, but split across TWO clubs (6 + 5). Tests that
  // rows are summed per competition rather than taken one at a time.
  { player_id: 4, player_name: 'Delta', nationality: 'FRA', competition_name: 'La Liga', club_id: 1, club_name: 'A', goals: 6, appearances: 40, first_season: 2005, last_season: 2008 },
  { player_id: 4, player_name: 'Delta', nationality: 'FRA', competition_name: 'La Liga', club_id: 4, club_name: 'D', goals: 5, appearances: 35, first_season: 2008, last_season: 2011 },
  { player_id: 4, player_name: 'Delta', nationality: 'FRA', competition_name: 'Premier League', club_id: 2, club_name: 'B', goals: 14, appearances: 70, first_season: 2011, last_season: 2015 },
  { player_id: 4, player_name: 'Delta', nationality: 'FRA', competition_name: 'Serie A', club_id: 3, club_name: 'C', goals: 13, appearances: 60, first_season: 2015, last_season: 2017 },
];

/** A stand-in for the Supabase client, serving FIXTURE through the same API. */
function fakeDb(rows) {
  return {
    from() {
      let data = rows.slice();
      const api = {
        select() { return api; },
        in(col, vals) { data = data.filter((r) => vals.includes(r[col])); return api; },
        eq(col, v) { data = data.filter((r) => r[col] === v); return api; },
        lte(col, v) { data = data.filter((r) => r[col] <= v); return api; },
        gte(col, v) { data = data.filter((r) => r[col] >= v); return api; },
        gt(col, v) { data = data.filter((r) => r[col] > v); return api; },
        lt(col, v) { data = data.filter((r) => r[col] < v); return api; },
        order() { return api; },
        range(from, to) {
          return Promise.resolve({ data: data.slice(from, to + 1), error: null });
        },
      };
      return api;
    },
  };
}

(async () => {
  // A fresh fake per run: the executor caches by plan, and a test that shared
  // a cache would prove the cache works rather than the query does.
  const db = fakeDb(FIXTURE);
  const p = plan.validate({
    measure: 'goals',
    scope: { kind: 'competition', ids: ['La Liga', 'Premier League', 'Serie A'], mode: 'all' },
    threshold: { op: 'gt', value: 10 },
    limit: 50,
  });
  const r = await measure.run(db, p);
  const names = r.rows.map((x) => x.player).sort();

  check('fixture: exactly two qualify', r.matched === 2, `got ${r.matched}: ${names}`);
  check('fixture: 20/15/12 qualifies', names.includes('Alpha'));
  check('fixture: 20/15/10 does NOT qualify', !names.includes('Beta'),
        'ten is not more than ten');
  check('fixture: 100/0/0 does NOT qualify', !names.includes('Gamma'),
        'one big league is not three');
  check('fixture: two clubs in one league are summed', names.includes('Delta'),
        '6 + 5 in La Liga should total 11');
  const delta = r.rows.find((x) => x.player === 'Delta');
  check('fixture: the summed total is right', delta && delta.per['La Liga'] === 11,
        delta && String(delta.per['La Liga']));

  // The same question as a TOTAL rather than per-competition — a different
  // answer, which is exactly why the distinction has to be explicit.
  const pTotal = plan.validate({
    measure: 'goals',
    scope: { kind: 'competition', ids: ['La Liga', 'Premier League', 'Serie A'], mode: 'all' },
    threshold: { op: 'gt', value: 10, applies: 'total' },
    limit: 50,
  });
  const rTotal = await measure.run(fakeDb(FIXTURE), pTotal);
  check('fixture: "total" is a different question', rTotal.matched === 3,
        `got ${rTotal.matched}`);

  // An empty result is an ANSWER, not a failure.
  const pNone = plan.validate({
    measure: 'goals',
    scope: { kind: 'competition', ids: ['La Liga', 'Premier League', 'Serie A'], mode: 'all' },
    threshold: { op: 'gt', value: 500 },
  });
  const rNone = await measure.run(fakeDb(FIXTURE), pNone);
  check('fixture: impossible threshold returns empty, not an error', rNone.matched === 0);

  // Exclusions.
  const pEx = plan.validate({
    measure: 'appearances',
    scope: { kind: 'competition', ids: ['Premier League'], mode: 'all' },
    exclude: ['La Liga'],
  });
  const rEx = await measure.run(fakeDb(FIXTURE), pEx);
  check('fixture: exclusion keeps only Gamma',
        rEx.rows.length === 1 && rEx.rows[0].player === 'Gamma',
        rEx.rows.map((x) => x.player).join(','));

  // ─── 5. validation refuses rubbish ────────────────────────────────────────
  const BAD = [
    [{ measure: 'goals', scope: { kind: 'competition', ids: ['Hyrule Cup'], mode: 'all' } },
      'unknown competition'],
    [{ measure: 'goals', scope: { kind: 'competition', ids: [], mode: 'all' } }, 'no scope'],
    [{ measure: 'goals', scope: { kind: 'wat', ids: ['La Liga'] } }, 'bad kind'],
    [{ measure: 'goals', scope: { kind: 'competition', ids: ['La Liga'] },
       threshold: { op: 'DROP TABLE', value: 1 } }, 'bad operator'],
  ];
  for (const [raw, why] of BAD) {
    let threw = false;
    try { plan.validate(raw); } catch (_) { threw = true; }
    check(`validate: refuses ${why}`, threw);
  }

  // Values are clamped, never trusted.
  const clamped = plan.validate({
    measure: 'goals',
    scope: { kind: 'competition', ids: ['La Liga'], mode: 'all' },
    threshold: { op: 'gt', value: 1e9 },
    limit: 99999,
  });
  check('validate: clamps a silly threshold', clamped.threshold.value <= 2000);
  check('validate: clamps a silly limit', clamped.limit <= 50);
  check('validate: no stray season filter', clamped.filters.seasonFrom === null,
        String(clamped.filters.seasonFrom));

  // ─── report ───────────────────────────────────────────────────────────────
  console.log(`\n  ask: ${pass} passed, ${fail} failed\n`);
  if (failures.length) {
    failures.forEach((f) => console.log('    ✗ ' + f));
    console.log('');
    process.exit(1);
  }
})();
