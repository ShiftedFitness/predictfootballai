/**
 * _ask_entities.js — turn words in a question into database ids.
 *
 * This is the security boundary's first half, and it is deliberately dumb.
 *
 * A model is good at reading "who played for Spurs and the Gunners" and
 * noticing there are two clubs in it. A model is NOT allowed to decide what
 * Spurs means, because a hallucinated club id is indistinguishable from a real
 * one by the time it reaches a query. So: the model may only ever hand back
 * SPANS OF THE USER'S OWN TEXT, and this file resolves those spans against the
 * teams manifest and the nationality list. Anything that does not resolve is
 * reported as unresolved and the question is refused.
 *
 * Nothing here talks to a model, and nothing here builds a query.
 */

const teams = require('./_teams');

// ─── Nicknames ──────────────────────────────────────────────────────────────

/**
 * What people type versus what the database calls a club. The manifest already
 * carries the official name and the game-matching name; this covers the third
 * thing — what a supporter actually says. Kept short and obvious on purpose:
 * a wrong alias here silently answers a question about the wrong club, which
 * is worse than failing to answer at all.
 */
const ALIASES = {
  'spurs': 'tottenham-hotspur',
  'the gunners': 'arsenal',
  'gunners': 'arsenal',
  'man utd': 'manchester-united',
  'man united': 'manchester-united',
  'united': 'manchester-united',
  'man city': 'manchester-city',
  'city': 'manchester-city',
  'wolves': 'wolverhampton-wanderers',
  'the wolves': 'wolverhampton-wanderers',
  'brighton': 'brighton-and-hove-albion',
  'west brom': 'west-bromwich-albion',
  'wba': 'west-bromwich-albion',
  'forest': 'nottingham-forest',
  "nott'm forest": 'nottingham-forest',
  'qpr': 'queens-park-rangers',
  'sheff wed': 'sheffield-wednesday',
  'sheffield weds': 'sheffield-wednesday',
  'sheff utd': 'sheffield-united',
  'inter milan': 'internazionale',
  'inter': 'internazionale',
  'ac milan': 'milan',
  'psg': 'paris-saint-germain',
  'atletico': 'atletico-madrid',
  'atleti': 'atletico-madrid',
  'barca': 'barcelona',
  'bayern': 'bayern-munich',
  'gladbach': 'monchengladbach',
  'argyle': 'plymouth-argyle',
  'the shrimpers': 'southend-united',
  'boro': 'middlesbrough',
  'palace': 'crystal-palace',
  'villa': 'aston-villa',
  'saints': 'southampton',
  'hammers': 'west-ham-united',
  'the hammers': 'west-ham-united',
  'toffees': 'everton',
  'blades': 'sheffield-united',
  'owls': 'sheffield-wednesday',
  'magpies': 'newcastle-united',
  'canaries': 'norwich-city',
  'baggies': 'west-bromwich-albion',
  'clarets': 'burnley',
  'cherries': 'bournemouth',
  'foxes': 'leicester-city',
  'hornets': 'watford',
  'seagulls': 'brighton-and-hove-albion',
};

// ─── Nationalities ──────────────────────────────────────────────────────────

/**
 * Demonyms to the three-letter codes the database stores. Only the ones that
 * plausibly appear in a football question — this is not a country list.
 */
const NATIONALITIES = {
  english: 'ENG', england: 'ENG',
  scottish: 'SCO', scotland: 'SCO',
  welsh: 'WAL', wales: 'WAL',
  irish: 'IRL', ireland: 'IRL',
  'northern irish': 'NIR',
  french: 'FRA', france: 'FRA',
  spanish: 'ESP', spain: 'ESP',
  german: 'GER', germany: 'GER',
  italian: 'ITA', italy: 'ITA',
  dutch: 'NED', netherlands: 'NED', holland: 'NED',
  portuguese: 'POR', portugal: 'POR',
  brazilian: 'BRA', brazil: 'BRA',
  argentine: 'ARG', argentinian: 'ARG', argentina: 'ARG',
  belgian: 'BEL', belgium: 'BEL',
  danish: 'DEN', denmark: 'DEN',
  swedish: 'SWE', sweden: 'SWE',
  norwegian: 'NOR', norway: 'NOR',
  nigerian: 'NGA', nigeria: 'NGA',
  ghanaian: 'GHA', ghana: 'GHA',
  ivorian: 'CIV',
  senegalese: 'SEN', senegal: 'SEN',
  american: 'USA', usa: 'USA',
  australian: 'AUS', australia: 'AUS',
  japanese: 'JPN', japan: 'JPN',
  korean: 'KOR',
  croatian: 'CRO', croatia: 'CRO',
  serbian: 'SRB', serbia: 'SRB',
  polish: 'POL', poland: 'POL',
  czech: 'CZE',
  turkish: 'TUR', turkey: 'TUR',
  greek: 'GRE', greece: 'GRE',
  mexican: 'MEX', mexico: 'MEX',
  colombian: 'COL', colombia: 'COL',
  uruguayan: 'URU', uruguay: 'URU',
  egyptian: 'EGY', egypt: 'EGY',
  moroccan: 'MAR', morocco: 'MAR',
  algerian: 'ALG', algeria: 'ALG',
  icelandic: 'ISL', iceland: 'ISL',
  finnish: 'FIN', finland: 'FIN',
  austrian: 'AUT', austria: 'AUT',
  swiss: 'SUI', switzerland: 'SUI',
  jamaican: 'JAM', jamaica: 'JAM',
};

const COMPETITIONS = {
  'premier league': 'Premier League', 'epl': 'Premier League', 'prem': 'Premier League',
  'championship': 'Championship',
  'league one': 'League One', 'league 1': 'League One',
  'league two': 'League Two', 'league 2': 'League Two',
  'la liga': 'La Liga',
  'serie a': 'Serie A',
  'bundesliga': 'Bundesliga',
  'ligue 1': 'Ligue 1', 'ligue un': 'Ligue 1',
  'champions league': 'Champions League', 'ucl': 'Champions League',
  'fa cup': 'FA Cup',
  'efl cup': 'EFL Cup', 'league cup': 'EFL Cup', 'carabao cup': 'EFL Cup',
};

// ─── Matching ───────────────────────────────────────────────────────────────

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** slug/name index, built once. */
let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  INDEX = new Map();
  for (const t of teams.all()) {
    const add = (k) => { const n = norm(k); if (n && !INDEX.has(n)) INDEX.set(n, t); };
    add(t.name);
    add(t.game_name);
    add(t.slug.replace(/-/g, ' '));
    // People drop the suffix: "West Ham" for West Ham United, "Plymouth" for
    // Plymouth Argyle, "Leeds" for Leeds United. Index every shortening that
    // strips trailing club words — but ONLY where it is unambiguous across all
    // 313 clubs. "Sheffield" resolves to two clubs and must stay unresolved;
    // answering the wrong one is far worse than asking which was meant.
    const SUFFIXES = new Set(['united', 'city', 'town', 'rovers', 'wanderers',
                              'albion', 'athletic', 'county', 'fc', 'afc',
                              'hotspur', 'argyle', 'palace', 'forest', 'villa']);
    const words = norm(t.name).split(' ');
    for (let cut = words.length - 1; cut >= 1; cut--) {
      if (!SUFFIXES.has(words[cut])) break;          // only strip from the end
      const short = words.slice(0, cut).join(' ');
      if (short.length < 4) continue;
      const clash = teams.all().some((o) => {
        if (o.slug === t.slug) return false;
        const ow = norm(o.name).split(' ');
        for (let c = ow.length; c >= 1; c--) {
          if (ow.slice(0, c).join(' ') === short) return true;
        }
        return false;
      });
      if (!clash) add(short);
    }
  }
  for (const [alias, slug] of Object.entries(ALIASES)) {
    const t = teams.bySlug(slug);
    if (t) INDEX.set(norm(alias), t);
  }
  return INDEX;
}

/**
 * Resolve one span of user text to a team. Exact-ish only: no edit distance,
 * no "did you mean". A near-miss that silently resolves to the wrong club is
 * the failure this whole file exists to prevent, so an unrecognised span comes
 * back null and the caller says it could not find it.
 */
function resolveTeam(text) {
  const n = norm(text);
  if (!n) return null;
  const idx = index();
  if (idx.has(n)) return idx.get(n);
  // Allow a trailing "fc" or a leading "the".
  const stripped = n.replace(/^the /, '').replace(/ fc$/, '').trim();
  return idx.get(stripped) || null;
}

const resolveNationality = (text) => NATIONALITIES[norm(text)] || null;
const resolveCompetition = (text) => COMPETITIONS[norm(text)] || null;

/**
 * Find every team mentioned anywhere in a question, longest name first so
 * "Manchester United" is not eaten by "Manchester City"'s first word.
 */
function findTeams(question) {
  const n = ' ' + norm(question) + ' ';
  const found = [];
  const seen = new Set();
  const keys = [...index().keys()].sort((a, b) => b.length - a.length);
  let masked = n;
  for (const k of keys) {
    if (k.length < 4) continue;
    const at = masked.indexOf(' ' + k + ' ');
    if (at === -1) continue;
    const t = index().get(k);
    if (seen.has(t.slug)) continue;
    seen.add(t.slug);
    found.push({ team: t, matched: k, at });
    // Blank the span so a shorter name cannot match inside it.
    masked = masked.slice(0, at) + ' '.repeat(k.length + 2) + masked.slice(at + k.length + 2);
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.team);
}

function findNationality(question) {
  const n = ' ' + norm(question) + ' ';
  for (const key of Object.keys(NATIONALITIES).sort((a, b) => b.length - a.length)) {
    if (n.includes(' ' + key + ' ')) return NATIONALITIES[key];
  }
  return null;
}

function findCompetition(question) {
  const n = ' ' + norm(question) + ' ';
  for (const key of Object.keys(COMPETITIONS).sort((a, b) => b.length - a.length)) {
    if (n.includes(' ' + key + ' ')) return COMPETITIONS[key];
  }
  return null;
}

module.exports = {
  resolveTeam, resolveNationality, resolveCompetition,
  findTeams, findNationality, findCompetition,
  norm, ALIASES, NATIONALITIES, COMPETITIONS,
};
