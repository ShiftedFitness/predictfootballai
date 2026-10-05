/**
 * _ask_measure_parse.js — a sentence into a players_by_measure plan.
 *
 * Deterministic. The grammar of a statistical football question is small and
 * regular — a measure, a comparison, a number, some named things, a word
 * joining them — so it is parsed rather than guessed at. That costs nothing,
 * answers in under a millisecond, and cannot invent a competition.
 *
 * Everything it produces goes through _ask_plan.validate() before it can
 * reach the database, so a mis-parse becomes a refusal, never a wrong query.
 */
const entities = require('./_ask_entities');

/**
 * Comparisons, longest phrasing first so "no more than" is not read as
 * "more than" with a stray "no".
 */
const OPS = [
  { re: /\b(?:no|not)\s+(?:more|greater|higher)\s+than\b/i, op: 'lte' },
  { re: /\b(?:no|not)\s+(?:fewer|less|lower)\s+than\b/i, op: 'gte' },
  // "20 or more" puts the number BEFORE the phrase, unlike "at least 20".
  { re: /\b(\d{1,4})\s+or\s+more\b/i, op: 'gte', numberBefore: true },
  { re: /\b(\d{1,4})\s+or\s+(?:fewer|less)\b/i, op: 'lte', numberBefore: true },
  { re: /\b(?:at\s+least|minimum\s+of|\+)\b/i, op: 'gte' },
  { re: /\b(?:at\s+most|maximum\s+of)\b/i, op: 'lte' },
  { re: /\b(?:more|greater|higher)\s+than|\bover\b|\babove\b/i, op: 'gt' },
  { re: /\b(?:fewer|less|lower)\s+than|\bunder\b|\bbelow\b/i, op: 'lt' },
  { re: /\bexactly\b/i, op: 'eq' },
  { re: /\bbetween\b/i, op: 'between' },
];

const GOALS_RE = /\b(goals?|goalscorers?|scorers?|scoring|scored|netted)\b/i;
const APPS_RE = /\b(appearances?|apps?|games?|matches|played|turned out|featured|caps?)\b/i;

/** all / each / both → every one of them. */
const ALL_RE = /\b(all|each|both|every|apiece)\b/i;
/**
 * any / either → at least one of them.
 *
 * A bare "or" is NOT enough on its own: "20 or more goals" contains one, and
 * reading that as a logical OR turned "at least 20 in La Liga" into "any of
 * La Liga" — a different question with a much longer answer. The operator
 * phrases are stripped before this is tested (see anyMode), so the only "or"
 * left is one actually joining two things.
 */
const ANY_RE = /\b(any|either|or)\b/i;

/** Phrases where "or" belongs to the comparison, not to the logic. */
const OR_IN_OP_RE = /\b\d+\s*(?:or\s+(?:more|fewer|less|above|over|under|below))\b/gi;

function anyMode(q) {
  const stripped = String(q).replace(OR_IN_OP_RE, ' ');
  return ANY_RE.test(stripped) && !ALL_RE.test(stripped);
}
/** never / but not → in the first, not the second. */
const NONE_RE = /\b(never|but\s+not|but\s+never|excluding|without\s+(?:ever\s+)?playing)\b/i;

/** A season range: "between 2000 and 2010", "since 2015", "in the 1990s". */
function seasons(q) {
  const between = q.match(/\bbetween\s+((?:19|20)\d{2})\s+and\s+((?:19|20)\d{2})\b/i);
  if (between) return { from: Number(between[1]), to: Number(between[2]) };
  const since = q.match(/\b(?:since|after|from)\s+((?:19|20)\d{2})\b/i);
  if (since) return { from: Number(since[1]), to: null };
  const before = q.match(/\b(?:before|until|up\s+to)\s+((?:19|20)\d{2})\b/i);
  if (before) return { from: null, to: Number(before[1]) };
  const decade = q.match(/\b(?:in\s+the\s+)?((?:19|20)\d0)s\b/i);
  if (decade) {
    const d = Number(decade[1]);
    return { from: d, to: d + 9 };
  }
  return { from: null, to: null };
}

/**
 * The number the comparison applies to.
 *
 * Deliberately NOT any number in the sentence: "top 10 scorers with more than
 * 20 goals" has two, and taking the first would compare against the wrong
 * one. The number is read from just after the operator phrase.
 */
function thresholdFrom(q, opMatch) {
  const after = q.slice(opMatch.index + opMatch[0].length);
  const m = after.match(/\s*(\d{1,4})/);
  if (!m) return null;
  const value = Number(m[1]);
  const second = after.slice(m.index + m[0].length).match(/^\s*(?:and|to|-|–)\s*(\d{1,4})/);
  return { value, value2: second ? Number(second[1]) : null };
}

function findLimit(q) {
  const m = q.match(/\b(?:top|first|best)\s+(\d{1,2})\b/i);
  if (m) return Number(m[1]);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10 };
  const w = q.match(/\b(?:top|best)\s+(one|two|three|four|five|ten)\b/i);
  return w ? words[w[1].toLowerCase()] : null;
}

/**
 * Parse, or return null to let another strategy try.
 *
 * Returns a PROPOSED plan. _ask_plan.validate() is what decides whether it is
 * a real one.
 */
function parse(question) {
  const q = String(question || '');

  const comps = entities.findCompetitions(q);
  const clubs = entities.findTeams(q);
  const nationality = entities.findNationality(q);

  // Something has to be named, or there is nothing to ask about.
  if (!comps.length && !clubs.length) return null;

  // ── comparison ─────────────────────────────────────────────────────────
  let threshold = null;
  for (const o of OPS) {
    const m = q.match(o.re);
    if (!m) continue;
    if (o.numberBefore) {
      threshold = { op: o.op, value: Number(m[1]), value2: null };
      break;
    }
    const nums = thresholdFrom(q, m);
    if (!nums) continue;
    threshold = { op: o.op, value: nums.value, value2: nums.value2 };
    break;
  }

  // ── measure ────────────────────────────────────────────────────────────
  // Goals wins when both are mentioned: "goals in games" is about goals.
  const measure = GOALS_RE.test(q) ? 'goals' : (APPS_RE.test(q) ? 'appearances' : 'appearances');

  // ── which things, and how they combine ─────────────────────────────────
  // Competitions win over clubs when both appear, because a club name inside
  // a competition question is usually a filter ("Arsenal players in the
  // Champions League"), not the thing being compared across.
  const kind = comps.length >= 1 && comps.length >= clubs.length ? 'competition' : 'club';
  const ids = kind === 'competition' ? comps : clubs.map((c) => c.club_id);
  if (!ids.length) return null;

  let mode = 'all';
  let exclude = [];
  const neg = q.match(NONE_RE);
  if (neg && kind === 'competition') {
    // Everything after "but never" is forbidden; everything before is
    // required. Splitting on the phrase itself is what makes "Premier League
    // but never La Liga" two sets rather than one negated list.
    const before = q.slice(0, neg.index);
    const after = q.slice(neg.index + neg[0].length);
    const req = entities.findCompetitions(before);
    const bad = entities.findCompetitions(after);
    if (req.length && bad.length) {
      return {
        measure,
        scope: { kind: 'competition', ids: req, mode: 'all' },
        exclude: bad,
        threshold,
        filters: {
          nationality,
          seasonFrom: seasons(q).from,
          seasonTo: seasons(q).to,
          clubIds: clubs.map((c) => c.club_id),
        },
        limit: findLimit(q) || 25,
      };
    }
  }
  if (anyMode(q)) mode = 'any';

  // "both" with three named things is still "all three". Rejecting the
  // question over the grammar would be pedantry; the intent is not in doubt.
  // validate() defaults `applies` to 'each' for a multi-scope 'all' plan,
  // which is the reading that matters.

  const s = seasons(q);

  return {
    measure,
    scope: { kind, ids, mode },
    exclude,
    threshold,
    filters: {
      nationality,
      seasonFrom: s.from,
      seasonTo: s.to,
      // A club named inside a competition question narrows it.
      clubIds: kind === 'competition' ? clubs.map((c) => c.club_id) : [],
    },
    limit: findLimit(q) || (threshold ? 25 : 10),
  };
}

/** Does this question need the general engine rather than the old patterns? */
function needsMeasureEngine(question) {
  const q = String(question || '');
  if (entities.findCompetitions(q).length >= 2) return true;
  if (NONE_RE.test(q)) return true;
  for (const o of OPS) {
    const m = q.match(o.re);
    if (!m) continue;
    if (o.numberBefore || thresholdFrom(q, m)) return true;
  }
  return false;
}

module.exports = { parse, needsMeasureEngine, OPS };
