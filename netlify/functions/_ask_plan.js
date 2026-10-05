/**
 * _ask_plan.js — the typed query plan, and the only thing allowed to become a
 * database query.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Ask had three intents, each a hand-written question shape: players for two
 * clubs, top players at one club, clubs of one player. Every one was
 * club-centric, none took a threshold, and competitions were a single optional
 * filter. So "who scored more than 10 goals in La Liga, the Premier League and
 * Serie A" had no shape to land in and was refused — not because the data was
 * missing (nine players qualify) but because the vocabulary could not express
 * the question.
 *
 * This replaces the shapes with COMPONENTS: a measure, a set of scopes, a
 * logical mode over them, a comparison, and some filters. "Players for both
 * Arsenal and Chelsea" and "20+ goals in each of three leagues" are then the
 * same plan with different values, and thousands of combinations work without
 * anybody writing a fourth question shape.
 *
 * ── The security boundary ────────────────────────────────────────────────
 * A plan is DATA, never code. Nothing here is interpolated into SQL: ids are
 * checked against the real club and competition lists before they travel, the
 * operator is one of six names, and numbers are coerced and clamped. A model
 * may propose a plan; `validate()` decides whether one exists. Anything that
 * fails is refused with a reason rather than repaired into something that
 * runs.
 */
const teams = require('./_teams');

/** Every competition the database holds. Nothing else may enter a plan. */
const COMPETITIONS = [
  'Premier League', 'Championship', 'League One', 'League Two',
  'FA Cup', 'EFL Cup', 'Champions League',
  'La Liga', 'Segunda División', 'Serie A', 'Bundesliga', 'Ligue 1',
];
const COMP_SET = new Set(COMPETITIONS);

/** What can be counted. Only columns that genuinely exist per player. */
const MEASURES = ['goals', 'appearances'];

/** Comparisons, by name. A name can never become an injection. */
const OPS = {
  gt: { sym: '>', say: 'more than' },
  gte: { sym: '>=', say: 'at least' },
  lt: { sym: '<', say: 'fewer than' },
  lte: { sym: '<=', say: 'at most' },
  eq: { sym: '=', say: 'exactly' },
  between: { sym: '..', say: 'between' },
};

/** How a set of scopes combines. */
const MODES = ['all', 'any', 'none'];

/** Whether a threshold applies to each scope separately or to the total. */
const APPLIES = ['each', 'total'];

const MAX_SCOPES = 6;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const MAX_VALUE = 2000;

class InvalidPlan extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind || 'unparsed';
  }
}

/**
 * Number(null) is 0, and 0 is finite — so a null season passed the check and
 * clamped to the floor, stamping "1888-1888" onto every plan that had no
 * season filter at all. Absent has to be tested before numeric.
 */
const clampInt = (v, lo, hi, dflt) => {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
};

/**
 * Check a proposed plan and return a clean one, or throw.
 *
 * Returns a NEW object built field by field. Nothing from the input survives
 * except values that passed a check, so an extra key a model invented cannot
 * ride along into the executor.
 */
function validate(raw) {
  if (!raw || typeof raw !== 'object') throw new InvalidPlan('No plan', 'unparsed');

  const measure = MEASURES.includes(raw.measure) ? raw.measure : 'appearances';

  // ── scope ──────────────────────────────────────────────────────────────
  const kind = raw.scope && raw.scope.kind;
  if (kind !== 'competition' && kind !== 'club') {
    throw new InvalidPlan('A question needs at least one club or competition.', 'no_scope');
  }
  const mode = MODES.includes(raw.scope.mode) ? raw.scope.mode : 'all';

  const ids = [];
  const labels = [];
  for (const rawId of (raw.scope.ids || []).slice(0, MAX_SCOPES)) {
    if (kind === 'competition') {
      const name = String(rawId);
      // The allowlist IS the validation. An unknown competition is refused,
      // never passed through to see what happens.
      if (!COMP_SET.has(name)) {
        throw new InvalidPlan(`TeleStats does not hold records for "${name}".`, 'unknown_scope');
      }
      if (!ids.includes(name)) { ids.push(name); labels.push(name); }
    } else {
      const id = Number(rawId);
      if (!Number.isInteger(id)) throw new InvalidPlan('Unknown club.', 'unknown_scope');
      const t = teams.byClubId(id);
      if (!t) throw new InvalidPlan('Unknown club.', 'unknown_scope');
      if (!ids.includes(id)) { ids.push(id); labels.push(t.name); }
    }
  }
  if (!ids.length) {
    throw new InvalidPlan('A question needs at least one club or competition.', 'no_scope');
  }
  // ── exclusions ─────────────────────────────────────────────────────────
  // "Played in the Premier League but never La Liga" is TWO sets: one
  // required, one forbidden. A single mode over one list cannot say that — it
  // could only exclude both, which is a different and empty question.
  const exclude = [];
  const excludeLabels = [];
  for (const rawId of (raw.exclude || []).slice(0, MAX_SCOPES)) {
    if (kind === 'competition') {
      const name = String(rawId);
      if (!COMP_SET.has(name)) {
        throw new InvalidPlan(`TeleStats does not hold records for "${name}".`, 'unknown_scope');
      }
      if (!exclude.includes(name) && !ids.includes(name)) {
        exclude.push(name); excludeLabels.push(name);
      }
    } else {
      const t = teams.byClubId(Number(rawId));
      if (t && !exclude.includes(t.club_id) && !ids.includes(t.club_id)) {
        exclude.push(t.club_id); excludeLabels.push(t.name);
      }
    }
  }

  // ── threshold ──────────────────────────────────────────────────────────
  let threshold = null;
  if (raw.threshold && raw.threshold.op) {
    const op = String(raw.threshold.op);
    if (!OPS[op]) throw new InvalidPlan('Unsupported comparison.', 'unsupported');
    const value = clampInt(raw.threshold.value, 0, MAX_VALUE, null);
    if (value == null) throw new InvalidPlan('That comparison needs a number.', 'unparsed');
    const value2 = op === 'between'
      ? clampInt(raw.threshold.value2, 0, MAX_VALUE, null) : null;
    if (op === 'between' && value2 == null) {
      throw new InvalidPlan('A range needs two numbers.', 'unparsed');
    }
    threshold = {
      op,
      value,
      value2,
      // "More than 10 goals in each of three leagues" means ten in EVERY one.
      // Defaulting to 'total' there would quietly answer a different, much
      // easier question — the single most important distinction in this file.
      applies: APPLIES.includes(raw.threshold.applies)
        ? raw.threshold.applies
        : (ids.length > 1 && mode === 'all' ? 'each' : 'total'),
    };
  }

  // ── filters ────────────────────────────────────────────────────────────
  const f = raw.filters || {};
  const filters = {
    nationality: typeof f.nationality === 'string' && /^[A-Z]{3}$/.test(f.nationality)
      ? f.nationality : null,
    seasonFrom: clampInt(f.seasonFrom, 1888, 2100, null),
    seasonTo: clampInt(f.seasonTo, 1888, 2100, null),
    clubIds: [],
  };
  for (const cid of (f.clubIds || []).slice(0, MAX_SCOPES)) {
    const t = teams.byClubId(Number(cid));
    if (t && !filters.clubIds.includes(t.club_id)) filters.clubIds.push(t.club_id);
  }
  if (filters.seasonFrom && filters.seasonTo && filters.seasonFrom > filters.seasonTo) {
    const a = filters.seasonFrom; filters.seasonFrom = filters.seasonTo; filters.seasonTo = a;
  }

  return {
    intent: 'players_by_measure',
    measure,
    scope: { kind, ids, labels, mode, exclude, excludeLabels },
    threshold,
    filters,
    sort: raw.sort === 'name' ? 'name' : 'total',
    limit: clampInt(raw.limit, 1, MAX_LIMIT, DEFAULT_LIMIT),
  };
}

/**
 * The plan in words, so the page can show how the question was read.
 *
 * Shown to the user precisely because natural language is ambiguous: if
 * "both" over three leagues was read as "each of three", they should be able
 * to see that before trusting the table.
 */
function describe(plan) {
  const m = plan.measure;
  const n = plan.scope.labels.length;
  const list = plan.scope.labels.join(', ').replace(/, ([^,]*)$/, ' and $1');
  const t = plan.threshold;

  let head = 'Players';
  if (t) {
    const op = OPS[t.op].say;
    const val = t.op === 'between' ? `${t.value} and ${t.value2}` : t.value;
    head += ` with ${op} ${val} ${m}`;
  } else {
    head += ` by ${m}`;
  }

  let where;
  if (plan.scope.mode === 'any') where = `in any of ${list}`;
  else if (n === 1) where = `in ${list}`;
  else where = t && t.threshold !== 'total' && t.applies === 'each'
    ? `in EACH of ${list}`
    : `across ${list}`;

  if (plan.scope.excludeLabels.length) {
    where += `, but never in ${plan.scope.excludeLabels.join(' or ')}`;
  }

  const extra = [];
  if (plan.filters.nationality) extra.push(plan.filters.nationality);
  if (plan.filters.seasonFrom || plan.filters.seasonTo) {
    extra.push(`${plan.filters.seasonFrom || '…'}–${plan.filters.seasonTo || '…'}`);
  }
  return `${head} ${where}${extra.length ? ` (${extra.join(', ')})` : ''}`;
}

module.exports = {
  validate, describe, InvalidPlan,
  COMPETITIONS, COMP_SET, MEASURES, OPS, MODES, APPLIES,
  MAX_SCOPES, MAX_LIMIT, DEFAULT_LIMIT,
};
