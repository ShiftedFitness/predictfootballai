/**
 * _teams.js — one source of truth for teams: slug, names, and game scopes.
 *
 * WHY THIS EXISTS
 *
 * Every game currently carries its own hardcoded array of club names —
 * xi_start and xi_score have 41 club ids each, match_start has 144 club names,
 * hol_start and alpha_start build 141 scopes from five league arrays. Five
 * copies of the same list, each slightly different, each matched as an exact
 * string.
 *
 * That is how Bullseye came to serve an empty board for Málaga: the club was
 * renamed in the database and four of the five lists never heard about it. It
 * is also why 73 English clubs — every Championship, League One and League Two
 * side, plus Southend, Carlisle, Bury and the rest — have no playable game at
 * all, despite having hundreds of players each in the data.
 *
 * So: one list, keyed on club_id, generated from the database, read from a
 * committed manifest. Names stop being identifiers.
 *
 * THE TWO NAMES
 *
 *   name       what a human reads and what Google indexes.
 *              "Sheffield Wednesday", "Eintracht Braunschweig"
 *   game_name  the exact string the games match against club_name in the
 *              database. "Sheffield Weds", "BTSV"
 *
 * They differ for 13 clubs. Using the wrong one silently returns nothing,
 * which is the failure mode this module exists to end.
 *
 * BACKWARD COMPATIBILITY
 *
 * Legacy scope ids ('epl_club_arsenal', 'laliga_club_realmadrid') are still
 * produced by each game's own list and still work. This module adds ids of the
 * form 'team_<slug>_<competition-slug>' alongside them. Nothing is removed
 * until every caller has moved over.
 */

const MANIFEST = require('../../data/teams/slugs.json');

// ─── The teams ──────────────────────────────────────────────────────────────

/**
 * A club FBref holds as two squads but TeleStats presents as one carries
 * `merged_into` (see scripts/teams/merge_clubs.js). It is dropped from the
 * team list so it gets no page, no scope and no hub entry — but the entry
 * stays in the manifest and byClubId() still resolves it, to the surviving
 * club, so an old scope id or a played round filed under the losing club_id
 * still lands somewhere real.
 */
const ALL_ENTRIES = Object.values(MANIFEST.teams);
const TEAMS = ALL_ENTRIES.filter((t) => !t.merged_into);

const BY_SLUG = new Map(TEAMS.map((t) => [t.slug, t]));
const BY_SLUG_ALL = new Map(ALL_ENTRIES.map((t) => [t.slug, t]));
const BY_ID = new Map(TEAMS.map((t) => [t.club_id, t]));
// A merged club's id points at the club it merged into.
for (const t of ALL_ENTRIES) {
  if (t.merged_into) BY_ID.set(t.club_id, BY_SLUG_ALL.get(t.merged_into) || null);
}

/**
 * A club with too little behind it is still reachable and playable, but it
 * should not be offered to a search engine as a destination. The threshold is
 * deliberately low: the median club here has 255 players, and only 13 of 313
 * fall below this.
 */
const INDEXABLE_MIN_PLAYERS = 25;

/**
 * The frontend groups scopes by a short league key. The existing games use
 * 'epl', 'laliga' and so on; the three new English tiers need their own.
 */
const LEAGUE_KEYS = {
  'Premier League': 'epl',
  'Championship': 'championship',
  'League One': 'leagueone',
  'League Two': 'leaguetwo',
  'La Liga': 'laliga',
  'Serie A': 'seriea',
  'Bundesliga': 'bundesliga',
  'Ligue 1': 'ligue1',
};

/**
 * A competition name as a URL segment.
 *
 * Accents are FOLDED, not stripped. Segunda División is the first competition
 * with one, and dropping the character rather than folding it produced
 * "segunda-divisi-n" — a scope id that is ugly in a URL and that nothing
 * resolves. None of the other twelve competitions has an accent, so this
 * changes no existing id; it is asserted in scripts/fbref/preflight.js terms
 * by the fact that every game still answers its old scopes.
 */
const competitionSlug = (name) =>
  String(name)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ─── Lookups ────────────────────────────────────────────────────────────────

const all = () => TEAMS;
const bySlug = (slug) => {
  const s = String(slug || '').toLowerCase();
  const hit = BY_SLUG.get(s);
  if (hit) return hit;
  // A merged slug resolves to its survivor rather than to nothing, so an old
  // bookmark or inbound link reaches the club it is about.
  const merged = BY_SLUG_ALL.get(s);
  return merged && merged.merged_into ? BY_SLUG.get(merged.merged_into) || null : null;
};
const byClubId = (id) => BY_ID.get(Number(id)) || null;

/** Teams that have earned a place in the sitemap. */
const indexable = () => TEAMS.filter((t) => t.players >= INDEXABLE_MIN_PLAYERS);

// ─── Scopes ─────────────────────────────────────────────────────────────────

/**
 * One scope per club PER COMPETITION, not one per club.
 *
 * The games resolve a scope to a single competition_id and club_id and filter
 * on both; none of them currently accepts "all competitions". Per-competition
 * scopes therefore work today with no change to any game engine, and they give
 * the more interesting product anyway — "Sunderland in League One" is a
 * different and better puzzle than "Sunderland, everything, ever".
 *
 * The all-tiers variant needs the engines to accept a null competition and is
 * left for later. The team PAGE can still show all-time totals, because
 * agg_player_club already merges competitions.
 */
/**
 * Every competition a club in the manifest plays in, with how many clubs play
 * in it. Derived rather than listed, so a new competition needs no edit here.
 */
function competitions() {
  const out = new Map();
  for (const t of TEAMS) {
    for (const comp of t.competitions) {
      const e = out.get(comp) || { name: comp, slug: competitionSlug(comp), clubs: [] };
      e.clubs.push(t.slug);
      out.set(comp, e);
    }
  }
  return [...out.values()].sort((a, b) => b.clubs.length - a.clubs.length);
}

/**
 * The scope for a WHOLE competition — every club in it at once.
 *
 * Five of these existed as legacy ids baked into two games' own arrays
 * ('epl_alltime', 'laliga_alltime' …), so the Championship, both lower English
 * tiers, Segunda and the cups had no competition-wide game at all. These are
 * generated from the data instead, so every competition has one and a new one
 * arrives with it.
 *
 * type is 'league', which every handler already reads as "do not filter by
 * club" — the same branch the legacy all-time scopes go down.
 */
function competitionScopes() {
  return competitions().map((c) => ({
    id: `comp_${c.slug}`,
    label: `${c.name} — all clubs`,
    type: 'league',
    league: LEAGUE_KEYS[c.name] || c.slug,
    competitionName: c.name,
    clubName: null,
    clubId: null,
    slug: null,
    teamName: null,
    competitionSlug: c.slug,
  }));
}

function scopes() {
  const out = competitionScopes();
  for (const t of TEAMS) {
    // "All competitions" — everything the club has ever played, merged.
    // competitionName is null, and every game treats that as "do not filter by
    // competition". This is the scope a supporter actually wants first:
    // Sunderland across all four divisions, not Sunderland in League One.
    if (t.competitions.length > 1) {
      out.push({
        id: `team_${t.slug}_all`,
        label: `${t.name} (all competitions)`,
        type: 'club',
        league: 'all',
        competitionName: null,
        clubName: t.game_name,
        clubId: t.club_id,
        slug: t.slug,
        teamName: t.name,
      });
    }
    for (const comp of t.competitions) {
      out.push({
        id: `team_${t.slug}_${competitionSlug(comp)}`,
        label: `${t.name} (${comp})`,
        type: 'club',
        league: LEAGUE_KEYS[comp] || competitionSlug(comp),
        competitionName: comp,
        clubName: t.game_name,     // the string the database will match
        clubId: t.club_id,
        slug: t.slug,
        teamName: t.name,          // the string a human should see
      });
    }
  }
  return out;
}

let _scopeIndex = null;
function scopeIndex() {
  if (!_scopeIndex) _scopeIndex = new Map(scopes().map((s) => [s.id, s]));
  return _scopeIndex;
}

/**
 * Resolve one of this module's scope ids. Returns null for anything else —
 * including every legacy id — so a caller can fall through to its own list
 * without this module having to know about them.
 *
 * Also understands a SUBSET id built by joining competition slugs with "+":
 *
 *   team_sunderland_premier-league+championship
 *
 * Those are resolved by parsing rather than by lookup, deliberately. A club in
 * four divisions has eleven possible two- and three-competition subsets;
 * pre-enumerating them would put thousands of scopes into every game's picker
 * to serve a choice that is made on the team page, one club at a time.
 */
function resolve(scopeId) {
  const id = String(scopeId || '');
  const direct = scopeIndex().get(id);
  if (direct) return direct;
  return resolveSubset(id);
}

/** team_<slug>_<comp-slug>+<comp-slug>[+…] → a scope, or null. */
function resolveSubset(id) {
  const m = /^team_([a-z0-9-]+)_([a-z0-9-]+(?:\+[a-z0-9-]+)+)$/.exec(id);
  if (!m) return null;
  const t = bySlug(m[1]);
  if (!t) return null;

  // Every part must be a competition this club actually played in. An id
  // naming a competition the club never entered is a bad id, not an empty
  // result — returning null sends it back through the caller's own list and
  // out as a clean "unknown scope" rather than a game with no players.
  const wanted = m[2].split('+');
  const names = [];
  for (const part of wanted) {
    const comp = t.competitions.find((c) => competitionSlug(c) === part);
    if (!comp) return null;
    if (!names.includes(comp)) names.push(comp);
  }
  if (names.length === t.competitions.length) return scopeIndex().get(`team_${t.slug}_all`) || null;

  return {
    id,
    label: `${t.name} (${names.join(' + ')})`,
    type: 'club',
    league: LEAGUE_KEYS[names[0]] || competitionSlug(names[0]),
    // null so the "is this one competition" guards in the game handlers keep
    // reading false; competitionNames is what actually narrows the query.
    competitionName: null,
    competitionNames: names,
    clubName: t.game_name,
    clubId: t.club_id,
    slug: t.slug,
    teamName: t.name,
  };
}

/** The scope id for a given team and competition, or null if it does not play there. */
function scopeIdFor(slug, competitionName) {
  const t = bySlug(slug);
  if (!t) return null;
  if (competitionName == null) {
    return t.competitions.length > 1 ? `team_${t.slug}_all` : null;
  }
  if (!t.competitions.includes(competitionName)) return null;
  return `team_${t.slug}_${competitionSlug(competitionName)}`;
}

/** The scope id for a team across an arbitrary set of its competitions. */
function scopeIdForMany(slug, competitionNames) {
  const t = bySlug(slug);
  if (!t) return null;
  const picked = t.competitions.filter((c) => competitionNames.includes(c));
  if (!picked.length) return null;
  if (picked.length === 1) return scopeIdFor(slug, picked[0]);
  if (picked.length === t.competitions.length) return `team_${t.slug}_all`;
  return `team_${t.slug}_${picked.map(competitionSlug).join('+')}`;
}

// ─── Play history ───────────────────────────────────────────────────────────

/**
 * Every string that has ever meant "this club" in ts_game_sessions.game_category.
 *
 * Rounds played before the rebuild were filed under whatever id the game's own
 * hardcoded list used at the time — 'epl_club_manchesterunited' in Higher or
 * Lower, 'club_manutd' in Starting XI, 'laliga_club_mlaga' where an accent was
 * dropped rather than folded. A team leaderboard that only knew the new
 * 'team_<slug>_*' ids would show an empty board for the clubs with the most
 * history, which is exactly backwards.
 *
 * The map is not derived by pattern-matching club names here — that is what put
 * "Málaga" in four places and left one behind. It is generated by
 * scripts/teams/legacy_scopes.js, which reads the ids out of the game handlers
 * themselves and joins on the exact database string each one matched.
 *
 * Exact ids and prefixes are returned separately because the caller matches
 * them differently: one is `in`, the other is `like`.
 */
const LEGACY = (() => {
  try {
    return require('../../data/teams/legacy_scopes.json').scopes || {};
  } catch (_) {
    return {};                 // regenerate with scripts/teams/legacy_scopes.js
  }
})();

let _legacyBySlug = null;
function legacyBySlug() {
  if (_legacyBySlug) return _legacyBySlug;
  _legacyBySlug = new Map();
  for (const [id, slug] of Object.entries(LEGACY)) {
    if (!_legacyBySlug.has(slug)) _legacyBySlug.set(slug, []);
    _legacyBySlug.get(slug).push(id);
  }
  return _legacyBySlug;
}

function playCategories(team) {
  const t = typeof team === 'string' ? bySlug(team) : team;
  if (!t) return { exact: [], prefixes: [] };
  return {
    exact: legacyBySlug().get(t.slug) || [],
    prefixes: [`team_${t.slug}_`],
  };
}

/** Which team a played round belongs to, or null. Used to fold history in. */
function teamForCategory(category) {
  const c = String(category || '');
  if (LEGACY[c]) return bySlug(LEGACY[c]);
  const m = /^team_([a-z0-9-]+)_/.exec(c);
  return m ? bySlug(m[1]) : null;
}

// ─── Page helpers ───────────────────────────────────────────────────────────

/**
 * Which of the four English tiers a club has played in, deepest first, for
 * headings like "Championship, League One and League Two".
 */
function tierLabel(team) {
  const NAMES = { 1: 'Premier League', 2: 'Championship', 3: 'League One', 4: 'League Two' };
  return (team.tiers || []).map((t) => NAMES[t]).filter(Boolean);
}

const isEnglish = (team) => (team.tiers || []).length > 0 && team.country === 'ENG';

module.exports = {
  all, bySlug, byClubId, indexable,
  scopes, resolve, scopeIdFor, scopeIdForMany, playCategories, teamForCategory,
  competitions, competitionScopes,
  tierLabel, isEnglish, competitionSlug, LEAGUE_KEYS,
  INDEXABLE_MIN_PLAYERS,
  generatedAt: MANIFEST.generated,
  count: TEAMS.length,
};
