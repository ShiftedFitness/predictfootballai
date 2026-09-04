/**
 * competitions.js — the map between FBref's competition ids and ours.
 *
 * These two numbering systems COLLIDE and must never be conflated:
 *   our id 10 = EFL Cup          FBref id 10 = Championship
 *   our id  8 = Championship     FBref id  8 = Champions League
 *   our id  2 = Champions League FBref id  2 = (something else entirely)
 * Every lookup goes through this table. Nothing else should hardcode either.
 *
 * `first` is the earliest season FBref actually holds, read off each
 * competition's own season index on 4 Sep 2026. `have` is what the database
 * held at that date, from the backup — the gap between them is the backfill.
 *
 * Season keys are START years: 1992 means 1992-93.
 */

const COMPETITIONS = [
  // ── England, by tier ────────────────────────────────────────────────────
  { id: 7,  fbref: 9,   slug: 'Premier-League-Stats',      name: 'Premier League',   country: 'ENG', tier: 1, type: 'league', first: 1992, have: [1992, 2025] },
  { id: 8,  fbref: 10,  slug: 'Championship-Stats',        name: 'Championship',     country: 'ENG', tier: 2, type: 'league', first: 2001, have: [2001, 2024] },
  { id: 11, fbref: 15,  slug: 'League-One-Stats',          name: 'League One',       country: 'ENG', tier: 3, type: 'league', first: 2002, have: null },
  { id: 12, fbref: 16,  slug: 'League-Two-Stats',          name: 'League Two',       country: 'ENG', tier: 4, type: 'league', first: 2002, have: null },

  // ── England, cups ───────────────────────────────────────────────────────
  { id: 4,  fbref: 514, slug: 'FA-Cup-Stats',              name: 'FA Cup',           country: 'ENG', tier: null, type: 'cup', first: 2014, have: [2014, 2025] },
  { id: 10, fbref: 690, slug: 'EFL-Cup-Stats',             name: 'EFL Cup',          country: 'ENG', tier: null, type: 'cup', first: 2014, have: [2014, 2025] },

  // Community Shield is a single match per season and FBref labels it with a
  // single year ("2015") inside a two-year path segment ("2015-2016"), so its
  // URLs do not follow the pattern below. 277 rows total. Excluded from the
  // default run until the rest is proven; see buildUrl().
  { id: 5,  fbref: 602, slug: 'FA-Community-Shield-Stats', name: 'Community Shield', country: 'ENG', tier: null, type: 'cup', first: 2015, have: [2015, 2025], irregular: true },

  // ── Europe ──────────────────────────────────────────────────────────────
  { id: 2,  fbref: 8,   slug: 'Champions-League-Stats',    name: 'Champions League', country: 'EUR', tier: null, type: 'continental', first: 1990, have: [1992, 2025] },
  { id: 1,  fbref: 12,  slug: 'La-Liga-Stats',             name: 'La Liga',          country: 'ESP', tier: 1, type: 'league', first: 1988, have: [1992, 2025] },
  { id: 3,  fbref: 11,  slug: 'Serie-A-Stats',             name: 'Serie A',          country: 'ITA', tier: 1, type: 'league', first: 1988, have: [1992, 2025] },
  { id: 9,  fbref: 20,  slug: 'Bundesliga-Stats',          name: 'Bundesliga',       country: 'GER', tier: 1, type: 'league', first: 1988, have: [1992, 2025] },
  { id: 6,  fbref: 13,  slug: 'Ligue-1-Stats',             name: 'Ligue 1',          country: 'FRA', tier: 1, type: 'league', first: 1995, have: [1995, 2025] },
];

/** The season currently being played. 2026 means 2026-27. */
const CURRENT_SEASON = 2026;

/** Page types worth collecting. `stats` exists for every season; the other
 *  two only appear for recent ones, and a miss is not an error. */
const PAGE_TYPES = {
  stats:   { path: 'stats',   table: 'stats_standard', required: true  },
  keepers: { path: 'keepers', table: 'stats_keeper',   required: false },
  defense: { path: 'defense', table: 'stats_defense',  required: false },
};

const seasonLabel = (y) => `${y}-${y + 1}`;

/**
 * FBref serves the season in progress at a path with no season segment, and
 * every finished season at one carrying the season twice.
 */
function buildUrl(comp, year, pageType = 'stats') {
  if (comp.irregular) {
    throw new Error(`${comp.name} has irregular season URLs — handle it explicitly`);
  }
  const type = PAGE_TYPES[pageType].path;
  if (year === CURRENT_SEASON) {
    return `https://fbref.com/en/comps/${comp.fbref}/${type}/${comp.slug}`;
  }
  const s = seasonLabel(year);
  return `https://fbref.com/en/comps/${comp.fbref}/${s}/${type}/${s}-${comp.slug}`;
}

/** Every season FBref holds for a competition, oldest first. */
function allSeasons(comp) {
  const out = [];
  for (let y = comp.first; y <= CURRENT_SEASON; y++) out.push(y);
  return out;
}

/** The seasons we are missing — the backfill, per competition. */
function missingSeasons(comp) {
  if (!comp.have) return allSeasons(comp);
  const [from, to] = comp.have;
  return allSeasons(comp).filter((y) => y < from || y > to);
}

const byId    = (id)   => COMPETITIONS.find((c) => c.id === id);
const byName  = (name) => COMPETITIONS.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
const regular = ()     => COMPETITIONS.filter((c) => !c.irregular);

module.exports = {
  COMPETITIONS, CURRENT_SEASON, PAGE_TYPES,
  buildUrl, allSeasons, missingSeasons, seasonLabel, byId, byName, regular,
};
