/**
 * _build_parse.js — a sentence about football into a validated game config.
 *
 * Deterministic. No model call, by design and not by thrift:
 *
 *   - The things a config can contain are a CLOSED set — four game types, 355
 *     clubs, 12 competitions, a handful of nationalities and two metrics.
 *     Resolving closed sets is what patterns are for.
 *   - A model that writes configs is a model that can write a config naming a
 *     club we do not hold, a competition that club never played in, or a
 *     filter the engines do not implement. Everything it produced would have
 *     to be validated against these same lists anyway, so the lists may as
 *     well do the work.
 *   - It is free and it answers in milliseconds.
 *
 * It reuses _ask_entities.js, which already turns free text into VALIDATED
 * club, competition and nationality ids — the same resolver Ask trusts, so a
 * club named here is a club that exists.
 *
 * What it will not do is guess. Anything it could not understand comes back in
 * `unsupported` so the caller can say so, because silently dropping half of
 * somebody's request and showing them a game is worse than admitting it.
 */
const entities = require('./_ask_entities');
const teams = require('./_teams');

/** Only what the builder, the preview and the publish flow all really do. */
const GAME_TYPES = [
  { key: 'starting_xi', name: 'Starting XI',
    re: /\b(starting\s*(xi|11|eleven)|best\s*(xi|11|eleven)|line[- ]?up|formation)\b/i },
  { key: 'bullseye', name: 'Bullseye',
    re: /\b(bulls?eye|501|darts?|countdown|reach\s*zero)\b/i },
  { key: 'higher_lower', name: 'Higher or Lower',
    re: /\b(higher\s*(or|\/|and)?\s*lower|hi\s*lo|h[io]l\b|guess\s*which)\b/i },
  { key: 'player_alphabet', name: 'Player Alphabet',
    re: /\b(alphabet|a\s*(to|-)\s*z|a-?z\b|every\s*letter)\b/i },
];

const METRICS = [
  { key: 'goals', re: /\b(goals?|scor(?:ed|ing|ers?))\b/i },
  { key: 'appearances', re: /\b(appearances?|apps?|games?\s*played|caps?)\b/i },
];

/**
 * Filters people ask for that nothing here implements. Named explicitly so
 * the answer can be "we cannot do that yet" rather than a game that quietly
 * ignored the only interesting part of the request.
 */
const UNSUPPORTED = [
  { re: /\b(assists?)\b/i, what: 'assists' },
  { re: /\b(clean\s*sheets?|save[sd]?\b)/i, what: 'goalkeeping stats' },
  { re: /\b(transfer\s*fees?|market\s*value|wages?|salar)/i, what: 'transfer fees and wages' },
  { re: /\b(trophies|honours|titles?\s*won|won\s*the\s*league)\b/i, what: 'honours' },
  { re: /\b(injur|suspend|red\s*cards?|yellow\s*cards?|bookings?)\b/i, what: 'disciplinary records' },
  { re: /\b(born\s*in|age[sd]?\s*(under|over)|younger|older)\b/i, what: 'age filters' },
  { re: /\b(manager|coach|head\s*coach)\b/i, what: 'managers' },
];

function detectGame(text) {
  for (const g of GAME_TYPES) if (g.re.test(text)) return g;
  return null;
}

function detectMetric(text) {
  for (const m of METRICS) if (m.re.test(text)) return m.key;
  return null;
}

/**
 * The competitions a config can legitimately use.
 *
 * When clubs are named, a competition only counts if those clubs ACTUALLY
 * PLAYED IN IT. "Liverpool in League Two" is not a hard game, it is an empty
 * one, and the honest answer is to drop the competition rather than build it.
 */
function competitionsFor(found, clubs) {
  if (!found) return [];
  if (!clubs.length) return [found];
  const played = clubs.some((c) => c.competitions.includes(found));
  return played ? [found] : [];
}

function parse(text) {
  const raw = String(text || '').slice(0, 300);
  const notes = [];
  const unsupported = [];

  for (const u of UNSUPPORTED) {
    if (u.re.test(raw)) unsupported.push(u.what);
  }

  const game = detectGame(raw);
  const clubs = entities.findTeams(raw) || [];
  const nationality = entities.findNationality(raw);
  const comp = entities.findCompetition(raw);
  const metric = detectMetric(raw);

  const comps = competitionsFor(comp, clubs);
  if (comp && !comps.length) {
    notes.push(`${clubs.map((c) => c.name).join(' and ')} have no records in ` +
               `${comp}, so that filter was left out.`);
  }

  return {
    raw,
    game: game ? game.key : null,
    gameName: game ? game.name : null,
    clubs: clubs.map((c) => ({ slug: c.slug, name: c.name, players: c.players })),
    competitions: comps,
    nationality: nationality || null,
    metric: metric || null,
    unsupported,
    notes,
  };
}

/**
 * What still needs asking. One question at a time: a form pretending to be a
 * conversation is worse than the form.
 */
function missing(p) {
  if (!p.game) {
    return {
      field: 'game',
      question: 'Which game would you like to build?',
      options: GAME_TYPES.map((g) => ({ value: g.key, label: g.name })),
    };
  }
  if (!p.clubs.length && !p.nationality && !p.competitions.length) {
    return {
      field: 'scope',
      question: 'Which club, competition or nationality should it cover?',
      options: null,
    };
  }
  return null;
}

module.exports = { parse, missing, GAME_TYPES, UNSUPPORTED };
