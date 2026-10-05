/**
 * build-create.js — turn a sentence into a game config, or explain why not.
 *
 * The parse is deterministic (_build_parse.js). This adds the part that makes
 * it trustworthy: it counts the players that would ACTUALLY be eligible, from
 * the real view the games query, and refuses to hand back a config the
 * database cannot support.
 *
 * That refusal is the point. "Your challenge is ready!" over a pool of four
 * players is worse than saying the pool is too small, because the first one is
 * only discovered after somebody has shared it with their friends.
 *
 * Read-only. The sentence never reaches a query: it is resolved to ids by
 * _ask_entities first, and only ids are used below. There is no path from
 * user text to SQL.
 */
const { sb, respond, handleOptions } = require('./_supabase');
const parser = require('./_build_parse');
const teams = require('./_teams');
const entities = require('./_ask_entities');

/** Below this, a game is not hard, it is just short. */
const MIN_POOL = { starting_xi: 22, bullseye: 25, higher_lower: 12, player_alphabet: 30 };

/** A sentence is at most this long; longer is not a game idea. */
const MAX_LEN = 300;

/** Per-instance, so one visitor cannot spin this in a loop. */
const HITS = new Map();
const RATE = { max: 20, windowMs: 60 * 1000 };

function rateLimited(ip) {
  const now = Date.now();
  const rec = HITS.get(ip) || { n: 0, since: now };
  if (now - rec.since > RATE.windowMs) { rec.n = 0; rec.since = now; }
  rec.n += 1;
  HITS.set(ip, rec);
  if (HITS.size > 500) HITS.clear();          // never a memory leak
  return rec.n > RATE.max;
}

/**
 * How many players a config would really have.
 *
 * Counts DISTINCT players over the same view the games read, with the same
 * filters, so the number shown is the number the game gets.
 */
async function poolSize(supabase, cfg) {
  let q = supabase
    .from('v_game_player_club_comp')
    .select('player_uid, club_name, competition_name, nationality_norm')
    .gt(cfg.metric === 'goals' ? 'goals' : 'appearances', 0)
    .limit(20000);

  if (cfg.clubNames.length) q = q.in('club_name', cfg.clubNames);
  if (cfg.competitions.length) q = q.in('competition_name', cfg.competitions);
  if (cfg.nationality) q = q.eq('nationality_norm', cfg.nationality);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => r.player_uid)).size;
}

exports.handler = async (event) => {
  const cors = handleOptions(event);
  if (cors) return cors;
  if (event.httpMethod !== 'POST') return respond(405, { error: 'POST only' });

  const ip = (event.headers['x-nf-client-connection-ip'] ||
              event.headers['client-ip'] || 'anon');
  if (rateLimited(ip)) {
    return respond(429, { error: 'Too many requests. Give it a moment.' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return respond(400, { error: 'Bad request' }); }

  const text = String(body.text || '').slice(0, MAX_LEN);
  if (!text.trim()) return respond(400, { error: 'Describe the game you want.' });

  const p = parser.parse(text);

  // Something was asked for that nothing here does. Say which part, rather
  // than building a game that ignored it.
  const ask = parser.missing(p);
  if (ask) {
    return respond(200, { ok: false, needs: ask, parsed: p });
  }

  // The config, in the shape the existing builder and engines already use.
  const clubNames = p.clubs.map((c) => {
    const t = teams.bySlug(c.slug);
    // The database stores "Sheffield Weds", not "Sheffield Wednesday".
    return t ? t.game_name : c.name;
  });
  const cfg = {
    gameType: p.game,
    gameName: p.gameName,
    clubs: p.clubs,
    clubNames,
    competitions: p.competitions,
    nationality: p.nationality,
    metric: p.metric || 'appearances',
  };

  let pool;
  try {
    pool = await poolSize(sb(), cfg);
  } catch (err) {
    console.error('[build-create] pool count failed:', err.message);
    return respond(500, { error: 'Could not check the player pool just now.' });
  }

  const need = MIN_POOL[cfg.gameType] || 20;
  if (pool < need) {
    return respond(200, {
      ok: false,
      tooSmall: true,
      pool,
      need,
      parsed: p,
      // A specific suggestion, derived from what they actually asked for.
      suggestion: cfg.competitions.length
        ? 'Try removing the competition filter to include every competition.'
        : cfg.nationality
          ? 'Try removing the nationality filter, or adding another club.'
          : 'Try adding another club, or widening to a whole competition.',
    });
  }

  // "Spanish players", not "ESP players". _ask_entities maps the adjective to
  // the code on the way in; this maps it back for anything a person reads.
  const ADJ = {};
  for (const [word, code] of Object.entries(entities.NATIONALITIES)) {
    // The first spelling for a code is the adjective ("spanish"), the second
    // the country ("spain"); the adjective is the one that reads as a label.
    if (!ADJ[code]) ADJ[code] = word.charAt(0).toUpperCase() + word.slice(1);
  }

  const title = [
    cfg.clubs.map((c) => c.name).join(' & '),
    cfg.nationality ? `${ADJ[cfg.nationality] || cfg.nationality} players` : '',
    cfg.competitions.join(' + '),
  ].filter(Boolean).join(' \u2014 ') || 'Custom challenge';

  return respond(200, {
    ok: true,
    config: cfg,
    pool,
    title: `${title} \u2014 ${cfg.gameName}`,
    notes: p.notes,
    unsupported: p.unsupported,
  });
};
