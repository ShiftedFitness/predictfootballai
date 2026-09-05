/**
 * _ask_parse.js — turn a question into a validated query plan.
 *
 * Deterministic first, model second, and the order matters.
 *
 * Football questions have a rigid shape. "Who played for both X and Y",
 * "top 10 scorers for Z", "which clubs did P play for" — these are patterns,
 * and a pattern cannot hallucinate, costs nothing, and answers in under a
 * millisecond. Most real questions never need a model at all.
 *
 * The model is the fallback for phrasings the patterns miss. Even then it is
 * tightly constrained: it picks an INTENT NAME from a fixed list and returns
 * SPANS OF THE USER'S OWN TEXT for the entities. It never returns an id, never
 * names a table, never writes a query. Those spans go through
 * _ask_entities.js, and anything that fails to resolve is refused.
 *
 * So the worst a confused model can do is choose the wrong question type or
 * point at text that does not resolve. It cannot invent a club, a player or a
 * statistic, because nothing it returns reaches the database unvalidated.
 */

const entities = require('./_ask_entities');

const MAX_QUESTION_LENGTH = 300;

// ─── Deterministic patterns ─────────────────────────────────────────────────

const BOTH_RE = /\b(both|and also|as well as)\b/i;
// `played?` would make only the "d" optional — matching "playe" and "played"
// but never "play", so "did Peter Crouch play for" fell straight through.
const PLAYED_FOR_RE = /\b(play(?:ed|s)?|turn(?:ed)? out|appear(?:ed|ances?)?|featured|represented)\b/i;
const TOP_RE = /\b(most|top|best|leading|highest|record)\b/i;
// "goalscorers" is one word, so there is no boundary before "scorers" and no
// boundary after "goal" — it has to be named directly.
const GOALS_RE = /\b(goals?|goalscorers?|scorers?|scoring|scored|netted)\b/i;
const CLUBS_OF_RE = /\b(which|what)\s+(clubs?|teams?)\b/i;

/** "top 10", "5 players", "best three" → a number, clamped later. */
function findLimit(q) {
  const digits = q.match(/\b(?:top|first|best|give me)\s+(\d{1,2})\b/i) || q.match(/\b(\d{1,2})\s+players?\b/i);
  if (digits) return Number(digits[1]);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const w = q.match(/\b(?:top|best)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  return w ? words[w[1].toLowerCase()] : null;
}

/**
 * Try to read the question without a model.
 * Returns a plan, or null if the shape is not recognised.
 */
function parseDeterministic(question) {
  const q = String(question || '');
  const found = entities.findTeams(q);
  const nationality = entities.findNationality(q);
  const competition = entities.findCompetition(q);
  const limit = findLimit(q);
  const measure = GOALS_RE.test(q) ? 'goals' : 'appearances';

  // "Which clubs did Peter Crouch play for?" — a question about a person, so
  // only when no club was recognised, otherwise "which clubs" plus a club name
  // is really an intersection question.
  if (CLUBS_OF_RE.test(q) && !found.length && PLAYED_FOR_RE.test(q)) {
    const name = q.replace(CLUBS_OF_RE, ' ')
      .replace(/\b(did|does|has|have|play|played|for|the|any|ever)\b/gi, ' ')
      .replace(/[?.!]/g, ' ').replace(/\s+/g, ' ').trim();
    if (name.length >= 3) {
      return { intent: 'player_clubs', params: { player_name: name }, via: 'pattern' };
    }
  }

  if (found.length >= 2) {
    return {
      intent: 'players_for_teams',
      params: {
        club_ids: found.map((t) => t.club_id),
        competition, nationality, measure,
        limit: limit || 10,
      },
      via: 'pattern',
      teams: found.map((t) => t.name),
    };
  }

  if (found.length === 1 && (TOP_RE.test(q) || nationality || limit)) {
    return {
      intent: 'top_players_for_team',
      params: {
        club_ids: [found[0].club_id],
        competition, nationality, measure,
        limit: limit || 10,
      },
      via: 'pattern',
      teams: [found[0].name],
    };
  }

  // One club and nothing else asked — treat as "tell me about this club",
  // which is the leaders list. Better than refusing a bare "Arsenal".
  if (found.length === 1 && PLAYED_FOR_RE.test(q)) {
    return {
      intent: 'top_players_for_team',
      params: { club_ids: [found[0].club_id], competition, nationality, measure, limit: 10 },
      via: 'pattern',
      teams: [found[0].name],
    };
  }

  return null;
}

// ─── Model fallback ─────────────────────────────────────────────────────────

const SYSTEM = `You classify football questions for a statistics database.

Reply with ONLY a JSON object, no prose, no code fence:
{"intent": "...", "team_names": [...], "player_name": null, "nationality": null, "competition": null, "limit": null, "measure": "appearances"}

intent must be exactly one of:
- players_for_teams      players who appeared for EVERY named club
- top_players_for_team   the leading players at ONE club
- player_clubs           the clubs ONE named player appeared for
- unsupported            anything else

RULES YOU MUST FOLLOW:
- team_names, player_name, nationality and competition must be copied VERBATIM
  from the user's question. Never expand, correct, translate or complete them.
  If the user writes "Spurs", return "Spurs" — not "Tottenham Hotspur".
- Never invent a club, player, statistic or fact. You are not answering the
  question, only labelling it.
- measure is "goals" only if the question is about goals or scoring.
- If the question is not about players, clubs or appearances in a football
  database, use "unsupported".`;

async function parseWithModel(question) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;                       // feature degrades to patterns only

  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); } catch (_) { return null; }

  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: SYSTEM,
    messages: [{ role: 'user', content: String(question).slice(0, MAX_QUESTION_LENGTH) }],
  });

  const text = (res.content || []).map((c) => c.text || '').join('').trim();
  let raw;
  try {
    raw = JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim());
  } catch (_) {
    return null;                               // unparseable reply is no reply
  }
  if (!raw || raw.intent === 'unsupported') return null;

  // Everything the model returned is user text. Resolve it here; nothing it
  // said becomes an id without passing through the entity resolver.
  const unresolved = [];
  const clubIds = [];
  for (const name of (raw.team_names || []).slice(0, 4)) {
    const t = entities.resolveTeam(name);
    if (t) clubIds.push(t.club_id); else unresolved.push(String(name));
  }
  const nationality = raw.nationality ? entities.resolveNationality(raw.nationality) : null;
  const competition = raw.competition ? entities.resolveCompetition(raw.competition) : null;

  if (unresolved.length) return { unresolved, via: 'model' };

  if (raw.intent === 'player_clubs') {
    if (!raw.player_name) return null;
    return { intent: 'player_clubs', params: { player_name: String(raw.player_name) }, via: 'model' };
  }
  if (!clubIds.length) return null;

  return {
    intent: raw.intent === 'players_for_teams' && clubIds.length >= 2
      ? 'players_for_teams' : 'top_players_for_team',
    params: {
      club_ids: clubIds, competition, nationality,
      measure: raw.measure === 'goals' ? 'goals' : 'appearances',
      limit: raw.limit || 10,
    },
    via: 'model',
  };
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function parse(question) {
  const q = String(question || '').trim();
  if (!q) return { error: 'Ask a question.' };
  if (q.length > MAX_QUESTION_LENGTH) {
    return { error: `Questions are limited to ${MAX_QUESTION_LENGTH} characters.` };
  }

  const quick = parseDeterministic(q);
  if (quick) return quick;

  const viaModel = await parseWithModel(q).catch(() => null);
  if (viaModel && viaModel.unresolved) {
    return { error: `I could not find ${viaModel.unresolved.map((u) => `"${u}"`).join(' or ')} in the TeleStats dataset.` };
  }
  if (viaModel) return viaModel;

  return {
    error: 'I could not work out what to look up. Try naming two clubs, ' +
           'for example "who played for both Everton and Liverpool?"',
  };
}

module.exports = { parse, parseDeterministic, MAX_QUESTION_LENGTH };
