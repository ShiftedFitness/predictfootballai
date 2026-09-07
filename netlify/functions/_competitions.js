/**
 * _competitions.js — turn a scope into the competition ids to filter on.
 *
 * Every game had its own copy of "look the competition name up, cache the id",
 * and when team pages started offering "all competitions" every copy needed the
 * same null-handling bolted on. Five copies of one rule is how Málaga ended up
 * missing from four club lists; there is no reason to repeat the shape of that
 * mistake for competition filtering.
 *
 * A scope says what it covers in one of three ways:
 *
 *   competitionName: 'League One'          one competition
 *   competitionNames: ['Premier League',   a chosen subset, from a team page
 *                      'Championship']
 *   competitionName: null                  everything the database has
 *
 * All three come back as an ARRAY of competition ids, so callers filter with
 * `.in('competition_id', ids)` in every case and never branch. "All" is the
 * literal list of every competition, which is exactly equivalent to no filter
 * at all and avoids a second code path that only runs sometimes.
 */

let allIds = null;
const byName = new Map();

/** One competition's id, cached across invocations of a warm Lambda. */
async function idForName(supabase, name) {
  if (byName.has(name)) return byName.get(name);
  const { data } = await supabase
    .from('competitions')
    .select('competition_id')
    .eq('competition_name', name)
    .maybeSingle();
  const id = data ? data.competition_id : null;
  if (id) byName.set(name, id);
  return id;
}

async function everyId(supabase) {
  if (allIds) return allIds;
  const { data } = await supabase.from('competitions').select('competition_id');
  allIds = (data || []).map((r) => r.competition_id);
  return allIds;
}

/**
 * The competition ids a scope covers.
 *
 * Returns { ids, missing } — `missing` names any competition the scope asked
 * for that the database does not have, so a caller can answer with a real error
 * instead of a game built from nothing.
 */
async function idsForScope(supabase, scope) {
  const names = Array.isArray(scope && scope.competitionNames) && scope.competitionNames.length
    ? scope.competitionNames
    : (scope && scope.competitionName ? [scope.competitionName] : null);

  if (!names) return { ids: await everyId(supabase), missing: [], all: true };

  const ids = [];
  const missing = [];
  for (const n of names) {
    const id = await idForName(supabase, n);
    if (id) ids.push(id); else missing.push(n);
  }
  return { ids, missing, all: false };
}

module.exports = { idsForScope, idForName, everyId };
