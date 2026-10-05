/**
 * _ask_measure.js — executes a players_by_measure plan.
 *
 * One query shape answers the whole family: pick the rows for the scopes in
 * the plan, fold them per player per scope, then apply the comparison. Club
 * questions and competition questions differ only in which column the scope
 * is matched on, which is why "players for both Arsenal and Chelsea" and "10+
 * goals in each of three leagues" no longer need separate code.
 *
 * ── Correctness notes that matter ─────────────────────────────────────────
 * - Folded on player_id, never on name. Two players share a name eventually,
 *   and a join on names silently merges them.
 * - agg_player_club_comp is one row per player PER CLUB PER COMPETITION, so a
 *   striker who scored for three clubs in La Liga has three rows. They are
 *   summed into one La Liga total, which is what "goals in La Liga" means.
 *   Taking the max, or the first, would under-count exactly the well-travelled
 *   players these questions are usually about.
 * - `applies: 'each'` tests the threshold against EVERY scope separately.
 *   25/8/5 does not qualify for "more than 10 in each"; 20/15/12 does. Getting
 *   this wrong returns a plausible, wrong, much longer list.
 */

/** One page at a time; PostgREST caps a request at 1000 rows. */
const PAGE = 1000;
const MAX_ROWS = 40000;

/**
 * Per-instance result cache.
 *
 * A plan is a complete description of the query, so the same plan always has
 * the same answer until the data changes. Ten minutes is short enough that a
 * refresh shows through quickly and long enough that a question somebody
 * shares does not re-scan for every visitor.
 */
const CACHE = new Map();
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 60;

function cacheKey(plan) {
  return JSON.stringify([
    plan.measure, plan.scope.kind, plan.scope.ids, plan.scope.mode,
    plan.scope.exclude, plan.threshold, plan.filters, plan.sort, plan.limit,
  ]);
}

async function fetchAll(buildQuery) {
  const out = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/** Does one value satisfy the plan's comparison? */
function passes(value, t) {
  if (!t) return true;
  switch (t.op) {
    case 'gt': return value > t.value;
    case 'gte': return value >= t.value;
    case 'lt': return value < t.value;
    case 'lte': return value <= t.value;
    case 'eq': return value === t.value;
    case 'between': return value >= Math.min(t.value, t.value2) &&
                            value <= Math.max(t.value, t.value2);
    default: return true;
  }
}

async function run(db, plan) {
  const key = cacheKey(plan);
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.value, cached: true };

  const col = plan.scope.kind === 'competition' ? 'competition_name' : 'club_id';
  const measureCol = plan.measure === 'goals' ? 'goals' : 'appearances';

  // ── the rows ───────────────────────────────────────────────────────────
  // Required scopes AND excluded ones, because "played in A but never B"
  // cannot be answered from A's rows alone — the only way to know somebody
  // never appeared in B is to have looked at B.
  const wanted = plan.scope.ids.concat(plan.scope.exclude || []);

  const build = () => {
    let q = db.from('agg_player_club_comp')
      .select('player_id, player_name, nationality, competition_name, club_id, ' +
              'club_name, appearances, goals, first_season, last_season');
    if (wanted) q = q.in(col, wanted);
    // Rows worth nothing are not worth fetching. A row contributing 0 cannot
    // change a sum and cannot establish presence, so dropping them server-side
    // is lossless and cuts the scan substantially.
    //
    // NOT filtered at the threshold itself, tempting as that is: a striker
    // with 6 and 5 goals at two clubs has 11 in that competition, and
    // filtering rows at >10 would drop both and lose them. The threshold can
    // only be applied AFTER the per-competition totals exist.
    q = q.gt(measureCol, 0);
    if (plan.filters.nationality) q = q.eq('nationality', plan.filters.nationality);
    if (plan.filters.clubIds.length) q = q.in('club_id', plan.filters.clubIds);
    // A season range is a window on a career that may straddle it, so the
    // test is overlap, not containment.
    if (plan.filters.seasonTo) q = q.lte('first_season', plan.filters.seasonTo);
    if (plan.filters.seasonFrom) q = q.gte('last_season', plan.filters.seasonFrom);
    return q.order('player_id');
  };

  const rows = await fetchAll(build);

  // ── fold: player → scope → measure ────────────────────────────────────
  const players = new Map();
  for (const r of rows) {
    const key = r.player_id;
    let p = players.get(key);
    if (!p) {
      p = { id: key, name: r.player_name, nationality: r.nationality,
            per: new Map(), total: 0, clubs: new Set() };
      players.set(key, p);
    }
    const scopeKey = plan.scope.kind === 'competition' ? r.competition_name : r.club_id;
    const v = Number(r[measureCol]) || 0;
    // Summed, not replaced: multiple clubs in one competition are one total.
    p.per.set(scopeKey, (p.per.get(scopeKey) || 0) + v);
    if (r.club_name) p.clubs.add(r.club_name);
  }

  // ── apply the logic ───────────────────────────────────────────────────
  const t = plan.threshold;
  const out = [];
  for (const p of players.values()) {
    const vals = plan.scope.ids.map((id) => p.per.get(id) || 0);
    const present = plan.scope.ids.filter((id) => (p.per.get(id) || 0) > 0);

    // An excluded scope they actually appeared in disqualifies them outright,
    // whatever else they did.
    if ((plan.scope.exclude || []).some((id) => (p.per.get(id) || 0) > 0)) continue;

    let ok;
    if (plan.scope.mode === 'any') {
      ok = t && t.applies === 'each'
        ? plan.scope.ids.some((id) => passes(p.per.get(id) || 0, t))
        : present.length > 0 && passes(vals.reduce((a, b) => a + b, 0), t);
    } else {
      // 'all' — present in every named scope.
      if (present.length !== plan.scope.ids.length) { ok = false; }
      else if (!t) { ok = true; }
      else if (t.applies === 'each') { ok = vals.every((v) => passes(v, t)); }
      else { ok = passes(vals.reduce((a, b) => a + b, 0), t); }
    }
    if (!ok) continue;

    const per = {};
    plan.scope.ids.forEach((id, i) => {
      per[plan.scope.labels[i]] = vals[i];
    });
    out.push({
      player: p.name,
      nationality: p.nationality || null,
      per,
      total: vals.reduce((a, b) => a + b, 0),
      clubs: [...p.clubs].slice(0, 6),
    });
  }

  out.sort((a, b) => (plan.sort === 'name'
    ? String(a.player).localeCompare(String(b.player))
    : b.total - a.total));

  const value = {
    rows: out.slice(0, plan.limit),
    matched: out.length,
    columns: plan.scope.labels,
    measure: plan.measure,
    scanned: rows.length,
  };

  if (CACHE.size >= CACHE_MAX) CACHE.clear();   // never an unbounded map
  CACHE.set(key, { at: Date.now(), value });
  return value;
}

module.exports = { run, passes };
