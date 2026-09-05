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

const TEAMS = Object.values(MANIFEST.teams);

const BY_SLUG = new Map(TEAMS.map((t) => [t.slug, t]));
const BY_ID = new Map(TEAMS.map((t) => [t.club_id, t]));

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

const competitionSlug = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ─── Lookups ────────────────────────────────────────────────────────────────

const all = () => TEAMS;
const bySlug = (slug) => BY_SLUG.get(String(slug || '').toLowerCase()) || null;
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
function scopes() {
  const out = [];
  for (const t of TEAMS) {
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
 */
const resolve = (scopeId) => scopeIndex().get(String(scopeId || '')) || null;

/** The scope id for a given team and competition, or null if it does not play there. */
function scopeIdFor(slug, competitionName) {
  const t = bySlug(slug);
  if (!t || !t.competitions.includes(competitionName)) return null;
  return `team_${t.slug}_${competitionSlug(competitionName)}`;
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
  scopes, resolve, scopeIdFor,
  tierLabel, isEnglish, competitionSlug, LEAGUE_KEYS,
  INDEXABLE_MIN_PLAYERS,
  generatedAt: MANIFEST.generated,
  count: TEAMS.length,
};
