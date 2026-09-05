/**
 * ask.js — Ask TeleStats.
 *
 * Natural-language questions answered from the TeleStats database, and only
 * from the TeleStats database.
 *
 * THE PIPELINE
 *
 *   question
 *     -> _ask_parse      pattern first, model only as a fallback
 *     -> _ask_entities   spans of the user's own text become ids, or fail
 *     -> _ask_intents    one of three whitelisted, parameterised queries
 *     -> rows
 *     -> a sentence built from those rows and nothing else
 *
 * The model never writes SQL, never names a table, never sees a connection,
 * and never supplies a fact. It labels the question; the database answers it.
 * When there is no answer this says so rather than producing a plausible one —
 * a fabricated football fact is worse than no feature.
 *
 * POST { question: string, source?: string }
 */

const { createClient } = require('@supabase/supabase-js');
const parse = require('./_ask_parse');
const intents = require('./_ask_intents');
const teams = require('./_teams');

const SUPABASE_URL = process.env.Supabase_Project_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.Supabase_Service_Role || process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Configurable because the real numbers depend on model and database cost,
 * which nobody knows yet. Deliberately generous: the point of this feature is
 * that people discover it, and a wall at question three teaches them not to
 * bother.
 */
const LIMITS = {
  anonymous: Number(process.env.ASK_LIMIT_ANON || 10),
  free: Number(process.env.ASK_LIMIT_FREE || 30),
  paid: Number(process.env.ASK_LIMIT_PRO || 200),
  windowMinutes: Number(process.env.ASK_LIMIT_WINDOW || 60),
};

/**
 * Best-effort throttle.
 *
 * In-memory, so it is PER LAMBDA INSTANCE and a determined caller can get
 * around it by being routed elsewhere. That is a known limitation, not an
 * oversight: a real limit needs shared storage, and it should be added before
 * this is promoted out of beta. It is enough to stop an accidental loop, which
 * is what actually costs money today.
 */
const hits = new Map();
function throttle(key, max) {
  const now = Date.now();
  const windowMs = LIMITS.windowMinutes * 60_000;
  const seen = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (seen.length >= max) {
    return { ok: false, retryMinutes: Math.ceil((windowMs - (now - seen[0])) / 60_000) };
  }
  seen.push(now);
  hits.set(key, seen);
  if (hits.size > 5000) hits.clear();          // crude, bounded, good enough
  return { ok: true, remaining: max - seen.length };
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

// ─── Answer text, built only from rows ──────────────────────────────────────

const list = (xs) => xs.length <= 1 ? (xs[0] || '')
  : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * "in the Premier League" but "in League One". Some competition names take the
 * article and some do not; getting it wrong is the tell that a sentence was
 * assembled rather than written.
 */
const TAKES_THE = new Set(['Premier League', 'Championship', 'Champions League',
                           'FA Cup', 'EFL Cup', 'Community Shield']);
const inComp = (name) => (!name || name === 'all competitions')
  ? '' : ` in ${TAKES_THE.has(name) ? 'the ' : ''}${name}`;

/**
 * Every sentence below is assembled from counts and names that came out of the
 * query. No model is involved, so no sentence can contain a fact the database
 * did not supply.
 */
function summarise(plan, result) {
  const s = result.scope || {};
  const where = inComp(s.competition);

  if (plan.intent === 'players_for_teams') {
    const who = list(s.teams || []);
    if (!result.count) return `No player in the TeleStats dataset has appeared for ${who}${where}.`;
    const nat = s.nationality ? `${s.nationality} ` : '';
    return result.count === 1
      ? `One ${nat}player has appeared for ${who}${where}: ${result.rows[0].player}.`
      : `${result.count} ${nat}players have appeared for ${who}${where}.`;
  }

  if (plan.intent === 'top_players_for_team') {
    const team = (s.teams || [])[0];
    if (!result.count) return `No players found for ${team}${where} in the TeleStats dataset.`;
    const nat = s.nationality ? `${s.nationality} ` : '';
    const measure = s.measure === 'goals' ? 'goals' : 'appearances';
    const top = result.rows[0];
    return `${result.count} ${nat}players in the dataset played for ${team}${where}. ` +
           `${top.player} leads on ${measure} with ${top[measure]}.`;
  }

  if (plan.intent === 'player_clubs') {
    if (!result.count) return `No player matching "${s.query}" is in the TeleStats dataset.`;
    const p = result.rows[0];
    return `${p.name} appears for ${p.clubs.length} ` +
           `${p.clubs.length === 1 ? 'club' : 'clubs'} in the dataset.`;
  }
  return '';
}

// ─── Handler ────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST only' });
  if (!SUPABASE_URL || !SUPABASE_KEY) return respond(500, { error: 'Not configured' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return respond(400, { error: 'Malformed request' });
  }

  const tier = ['anonymous', 'free', 'paid'].includes(body.tier) ? body.tier : 'anonymous';
  const ip = (event.headers['x-nf-client-connection-ip'] ||
              event.headers['client-ip'] || 'unknown');
  const gate = throttle(`${ip}:${tier}`, LIMITS[tier]);
  if (!gate.ok) {
    return respond(429, {
      error: `That is ${LIMITS[tier]} questions in ${LIMITS.windowMinutes} minutes. ` +
             `Try again in ${gate.retryMinutes} minute${gate.retryMinutes === 1 ? '' : 's'}.`,
      retry_minutes: gate.retryMinutes,
    });
  }

  const started = Date.now();
  const plan = await parse.parse(body.question);
  if (plan.error) {
    // A refusal is a legitimate answer, not a server fault.
    return respond(200, { answered: false, message: plan.error, remaining: gate.remaining });
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    const result = await intents.execute(db, plan);

    return respond(200, {
      answered: true,
      message: summarise(plan, result),
      rows: result.rows,
      count: result.count,
      remaining: gate.remaining,

      // Provenance. What was asked of the database, so an answer can be
      // checked rather than trusted.
      provenance: {
        intent: plan.intent,
        interpreted_by: plan.via,
        teams: (result.scope && result.scope.teams) || null,
        competition: (result.scope && result.scope.competition) || null,
        nationality: (result.scope && result.scope.nationality) || null,
        dataset: 'TeleStats football database',
        coverage: '/tools/data.html',
        query_ms: result.ms,
        total_ms: Date.now() - started,
      },

      // Structured and scalar, safe for GA4. The user's raw question is
      // deliberately NOT here and must never be sent to analytics.
      analytics: {
        intent: plan.intent,
        interpreted_by: plan.via,
        team_count: ((result.scope && result.scope.teams) || []).length,
        has_competition_filter: Boolean(result.scope && result.scope.competition &&
                                        result.scope.competition !== 'all competitions'),
        has_nationality_filter: Boolean(result.scope && result.scope.nationality),
        result_count: result.count,
        latency_ms: Date.now() - started,
      },
    });
  } catch (err) {
    if (err instanceof intents.InvalidPlan) {
      return respond(200, { answered: false, message: err.message, remaining: gate.remaining });
    }
    // Never leak an internal message to the caller.
    console.error('[ask]', err);
    return respond(500, { error: 'Something went wrong looking that up.' });
  }
};

exports.LIMITS = LIMITS;
