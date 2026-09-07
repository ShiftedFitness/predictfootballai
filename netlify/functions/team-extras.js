/**
 * team-extras.js — the two parts of a team page that cannot be static.
 *
 * Team pages are generated as real HTML so that Googlebot sees the players,
 * the records and the game links without running a line of JavaScript. Two
 * things on the page are wrong to bake in that way:
 *
 *   leaderboard   who has played this club's games and how they did. Changes
 *                 every time somebody plays; a build-time copy would be stale
 *                 within the hour and would put 313 near-identical pages of
 *                 usernames in front of a search engine.
 *
 *   community     quizzes other people have built about this club. Created at
 *                 any moment by anyone, so a rebuild cannot be the thing that
 *                 makes a new one visible.
 *
 * Neither is content anybody arrives from a search for, so nothing is lost by
 * fetching them after the page has painted.
 *
 * GET/POST ?slug=plymouth-argyle
 */

const { sb, respond, handleOptions } = require('./_supabase.js');
const teams = require('./_teams');
const entities = require('./_ask_entities');

const LEADERBOARD_SIZE = 10;
const COMMUNITY_SIZE = 12;

/**
 * Which club a community game is about.
 *
 * There is no club tag on ts_community_games — a creator names a game, they do
 * not classify it — so the club is read out of the title and description with
 * the same resolver Ask TeleStats uses. That is a derivation from what the
 * creator actually wrote, not a guess: "Liverpool & Manchester United All Time
 * XI" resolves to both clubs because both names are in it, and a game whose
 * title names no club is simply not tagged rather than being filed somewhere
 * plausible.
 *
 * Titles are user text. They are resolved, never trusted, and never
 * interpolated anywhere but as an escaped string in the response.
 */
function clubsForGame(game) {
  const text = `${game.title || ''} ${game.description || ''}`;
  return entities.findTeams(text).map((t) => t.slug);
}

/** Score is not comparable across game types, so rank within each. */
function rankSessions(sessions, usersById) {
  const best = new Map();
  for (const s of sessions) {
    if (s.completed === false) continue;
    const key = `${s.user_id}|${s.game_type}`;
    const score = Number(s.score);
    if (!Number.isFinite(score)) continue;
    const prev = best.get(key);
    if (!prev || score > prev.score) {
      best.set(key, { user_id: s.user_id, game_type: s.game_type, score, at: s.played_at });
    }
  }

  const byGame = new Map();
  for (const row of best.values()) {
    if (!byGame.has(row.game_type)) byGame.set(row.game_type, []);
    byGame.get(row.game_type).push(row);
  }

  const out = [];
  for (const [game_type, rows] of byGame) {
    rows.sort((a, b) => b.score - a.score || String(a.at).localeCompare(String(b.at)));
    out.push({
      game_type,
      entries: rows.slice(0, LEADERBOARD_SIZE).map((r, i) => ({
        position: i + 1,
        // A player with no username is shown as a player, not as a uuid.
        name: (usersById.get(r.user_id) || {}).username || 'Anonymous',
        level: (usersById.get(r.user_id) || {}).level || null,
        score: r.score,
      })),
    });
  }
  // Most-played first, so the busiest board is the one a visitor sees.
  out.sort((a, b) => b.entries.length - a.entries.length);
  return out;
}

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const params = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { /* GET */ }

  const team = teams.bySlug(params.slug || body.slug);
  if (!team) return respond(400, { error: 'Unknown team' });

  try {
    const client = sb();
    const { exact, prefixes } = teams.playCategories(team);

    // ── Leaderboard ─────────────────────────────────────────────────────────
    // Two reads rather than one `or`: PostgREST's or() takes its filters in a
    // single string, and a club name is not something to be building query
    // strings out of. `in` and `like` each take their values as parameters.
    const sessions = [];
    if (exact.length) {
      const { data, error } = await client
        .from('ts_game_sessions')
        .select('user_id, game_type, score, completed, played_at')
        .in('game_category', exact)
        .order('score', { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      for (const r of data || []) sessions.push(r);
    }
    for (const prefix of prefixes) {
      const { data, error } = await client
        .from('ts_game_sessions')
        .select('user_id, game_type, score, completed, played_at')
        .like('game_category', `${prefix}%`)
        .order('score', { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      for (const r of data || []) sessions.push(r);
    }

    const userIds = [...new Set(sessions.map((s) => s.user_id).filter(Boolean))];
    const usersById = new Map();
    if (userIds.length) {
      const { data } = await client.from('ts_users')
        .select('id, username, level').in('id', userIds.slice(0, 500));
      for (const u of data || []) usersById.set(u.id, u);
    }
    const leaderboard = rankSessions(sessions, usersById);

    // ── Community games ─────────────────────────────────────────────────────
    const { data: games } = await client
      .from('ts_community_games')
      .select('id, title, description, game_type, play_count, upvotes, created_at')
      .eq('status', 'published')
      .order('play_count', { ascending: false })
      .limit(500);

    const community = (games || [])
      .filter((g) => clubsForGame(g).includes(team.slug))
      .slice(0, COMMUNITY_SIZE)
      .map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        game_type: g.game_type,
        plays: g.play_count || 0,
        upvotes: g.upvotes || 0,
      }));

    return respond(200, {
      slug: team.slug,
      team: team.name,
      leaderboard,
      // How many rounds this club's games have been played, all types together.
      plays: sessions.length,
      community,
      community_total: (games || []).length,
    });
  } catch (e) {
    console.error('[team-extras]', e);
    return respond(500, { error: 'Could not load team extras' });
  }
};
