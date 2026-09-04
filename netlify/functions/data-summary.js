/**
 * data-summary.js — coverage and freshness, one row per competition.
 *
 * Backs /tools/data. The point of it is that stale data should be visible
 * rather than silent: the stats behind the games sat seven months out of date
 * without anything on the site saying so.
 *
 * Deliberately schema-tolerant. It reads whatever `player_season_stats`
 * currently is, and asks for a timestamp column by trying the new name then
 * the old one, so it works before the rebuild swap, after it, and during.
 *
 * PostgREST has no GROUP BY, so rather than pull 220,000 rows across the wire
 * to aggregate them, this asks four tiny indexed questions per competition —
 * a head count and three one-row lookups. Eleven competitions, ~44 requests,
 * well under a second, and every one of them hits an index.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.Supabase_Service_Role || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Coverage always comes from the view, which is the one name that means the
// same thing before and after the rebuild: today it unions the historical and
// current tables, afterwards it is the compatibility view over the single one.
const COVERAGE_SOURCE = 'v_all_player_season_stats';

// Freshness is harder, because the view does not carry a timestamp until the
// rebuild adds one. Try each in order and use the first that exists.
const FRESHNESS_SOURCES = [
  { table: 'v_all_player_season_stats', column: 'created_at' },   // after the rebuild
  { table: 'current_season_player_stats', column: 'updated_at' }, // the freshest data today
  { table: 'player_season_stats', column: 'created_at' },         // the historical import
];

function respond(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      // Cheap to compute, but there is no reason to recompute it per visitor.
      'Cache-Control': 'public, max-age=300',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Every freshness source this database actually has. Plural, because no single
 * one covers everything today: the current-season table only holds the six
 * competitions that were being refreshed, while the FA Cup and Championship
 * live entirely in the historical one. Taking the latest across all of them
 * per competition is the only way to avoid printing an em-dash next to data
 * that does have a known age.
 */
async function findFreshnessSources(db) {
  const found = [];
  for (const src of FRESHNESS_SOURCES) {
    const { error } = await db.from(src.table).select(src.column).limit(1);
    if (!error) found.push(src);
  }
  return found;
}

async function summariseCompetition(db, fresh, comp) {
  // PostgREST builds the query in order: select() first, then filters. A
  // filter applied to db.from(table) directly has no query to attach to.
  const pick = (table, cols) =>
    db.from(table).select(cols).eq('competition_id', comp.competition_id);

  const [countRes, firstRes, lastRes, ...freshRes] = await Promise.all([
    db.from(COVERAGE_SOURCE).select('*', { count: 'exact', head: true })
      .eq('competition_id', comp.competition_id),
    pick(COVERAGE_SOURCE, 'season_start_year').order('season_start_year', { ascending: true }).limit(1),
    pick(COVERAGE_SOURCE, 'season_start_year').order('season_start_year', { ascending: false }).limit(1),
    ...fresh.map((src) =>
      pick(src.table, src.column).order(src.column, { ascending: false }).limit(1)
        .then((r) => r.data?.[0]?.[src.column] ?? null)),
  ]);

  const first = firstRes.data?.[0]?.season_start_year ?? null;
  const last = lastRes.data?.[0]?.season_start_year ?? null;

  return {
    competition_id: comp.competition_id,
    competition: comp.competition_name,
    country: comp.country ?? null,
    tier: comp.tier ?? null,
    first_season: first,
    last_season: last,
    // '1992/93' reads better than 1992 on the page, and the maths belongs here
    // rather than in four places in the markup.
    first_season_label: first == null ? null : `${first}/${String(first + 1).slice(2)}`,
    last_season_label: last == null ? null : `${last}/${String(last + 1).slice(2)}`,
    seasons_span: first == null || last == null ? null : last - first + 1,
    rows: countRes.count ?? 0,
    last_updated: freshRes.filter(Boolean).sort().pop() ?? null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return respond(500, { error: 'Missing Supabase configuration' });
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: comps, error: compErr }, fresh] = await Promise.all([
      db.from('competitions')
        .select('competition_id, competition_name, country, tier')
        .order('competition_id'),
      findFreshnessSources(db),
    ]);
    if (compErr) return respond(500, { error: compErr.message });

    const summaries = await Promise.all(
      (comps || []).map((c) => summariseCompetition(db, fresh, c))
    );

    // A competition with no rows is not worth a line on the page.
    const present = summaries.filter((s) => s.rows > 0);

    // English tiers in ladder order, then everything else alphabetically —
    // the pyramid is the thing a reader is looking for.
    present.sort((a, b) => {
      const aEng = a.country === 'ENG' && a.tier;
      const bEng = b.country === 'ENG' && b.tier;
      if (aEng && bEng) return a.tier - b.tier;
      if (aEng !== bEng) return aEng ? -1 : 1;
      return a.competition.localeCompare(b.competition);
    });

    const { data: meta } = await db.from('ingestion_meta').select('key, value, updated_at');

    const freshest = present
      .map((s) => s.last_updated)
      .filter(Boolean)
      .sort()
      .pop() || null;

    return respond(200, {
      generated_at: new Date().toISOString(),
      last_updated: freshest,
      stale_hours: freshest
        ? Math.round((Date.now() - new Date(freshest).getTime()) / 36e5)
        : null,
      totals: {
        competitions: present.length,
        rows: present.reduce((a, s) => a + s.rows, 0),
        earliest_season: Math.min(...present.map((s) => s.first_season).filter((x) => x != null)),
        latest_season: Math.max(...present.map((s) => s.last_season).filter((x) => x != null)),
      },
      competitions: present,
      notes: (meta || []).map((m) => ({ key: m.key, value: m.value, updated_at: m.updated_at })),
    });
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
