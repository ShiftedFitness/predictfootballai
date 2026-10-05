/**
 * featured.js — what the Daily | Trending | Community module shows.
 *
 * One endpoint for the whole module so the homepage and /games/ cannot drift
 * into two answers, and one cached aggregate so a page view does not run an
 * analytics query.
 *
 * ── On the word "Trending" ────────────────────────────────────────────────
 * It only says Trending when it IS. ts_game_sessions holds 221 rows all time
 * and 7 in the last week, and CLAUDE.md already records that most finished
 * rounds never reach the table, so what is there is a sample of a sample.
 * Ranking six games by that and calling the winner trending would be inventing
 * a fact — the exact thing the rest of this site refuses to do.
 *
 * So: below MIN_PLAYS the response is `mode: "featured"` and an editorial
 * list, which the UI labels Featured. Above it, the same shape is computed
 * from real plays and labelled Trending. Nothing needs changing when the
 * traffic arrives; the label follows the evidence.
 */
const { sb, respond, handleOptions } = require('./_supabase');
const teams = require('./_teams');

/** Below this many plays in the window, there is nothing to rank honestly. */
const MIN_PLAYS = 30;
const WINDOW_DAYS = 7;

/** Cached in the Lambda instance. Aggregates, not per-visitor data. */
let CACHE = { at: 0, body: null };
const CACHE_MS = 10 * 60 * 1000;

const GAME_PAGES = {
  higher_lower: { name: 'Higher or Lower', path: '/games/hol.html' },
  starting_xi: { name: 'Starting XI', path: '/games/xi.html' },
  bullseye: { name: 'Bullseye', path: '/games/bullseye.html' },
  who_am_i: { name: 'Who Am I?', path: '/games/whoami.html' },
  player_alphabet: { name: 'Player Alphabet', path: '/games/alpha.html' },
  alphabet: { name: 'Player Alphabet', path: '/games/alpha.html' },
  pop_quiz: { name: 'Trivia Quiz', path: '/games/quiz.html' },
  quiz: { name: 'Trivia Quiz', path: '/games/quiz.html' },
};

/** Where a community game is actually PLAYED, not the hub it is listed on. */
const COMMUNITY_PAGES = {
  bullseye: 'bullseye', starting_xi: 'xi', higher_lower: 'hol',
  player_alphabet: 'alpha', alphabet: 'alpha',
};

/**
 * The editorial fallback. Clubs with deep records so the links are worth
 * following, spread across competitions. Labelled Featured, never Trending.
 */
const EDITORIAL = [
  { game: 'higher_lower', slug: 'liverpool' },
  { game: 'starting_xi', slug: 'arsenal' },
  { game: 'bullseye', slug: 'manchester-united' },
  { game: 'who_am_i', slug: 'barcelona' },
  { game: 'player_alphabet', slug: 'chelsea' },
];

function playable(gameType, scopeId, label) {
  const g = GAME_PAGES[gameType];
  if (!g) return null;
  return {
    game: gameType,
    name: g.name,
    label,
    url: `${g.path}?scope=${encodeURIComponent(scopeId)}&play=1`,
  };
}

exports.handler = async (event) => {
  const cors = handleOptions(event);
  if (cors) return cors;

  if (CACHE.body && Date.now() - CACHE.at < CACHE_MS) {
    return respond(200, { ...CACHE.body, cached: true });
  }

  const supabase = sb();
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();

  let mode = 'featured';
  let items = [];

  try {
    const { data: rows } = await supabase
      .from('ts_game_sessions')
      .select('game_type, game_category')
      .gte('played_at', since)
      .limit(5000);

    const plays = (rows || []).length;
    if (plays >= MIN_PLAYS) {
      // Rank club+game combinations by real plays in the window.
      // teamForCategory() returns the TEAM RECORD, not a slug. Interpolating
      // it straight into a scope id gave `team_[object Object]_all` — a broken
      // link in every trending row, which would only have appeared once there
      // was enough traffic to leave `featured` mode.
      const counts = new Map();
      for (const r of rows) {
        if (!r.game_type || !r.game_category) continue;
        const team = teams.teamForCategory(r.game_category);
        if (!team || !team.slug) continue;
        const key = `${r.game_type}|${team.slug}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      items = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, n]) => {
          const [gameType, slug] = key.split('|');
          const t = teams.bySlug(slug);
          if (!t) return null;
          const it = playable(gameType, `team_${slug}_all`, t.name);
          return it ? { ...it, plays: n } : null;
        })
        .filter(Boolean);
      if (items.length >= 3) mode = 'trending';
      else items = [];
    }
  } catch (err) {
    console.error('[featured] play counts unavailable:', err.message);
  }

  if (!items.length) {
    items = EDITORIAL.map(({ game, slug }) => {
      const t = teams.bySlug(slug);
      return t ? playable(game, `team_${slug}_all`, t.name) : null;
    }).filter(Boolean);
    mode = 'featured';
  }

  // Community: published games, busiest first, linked to where they PLAY.
  let community = [];
  try {
    const { data: games } = await supabase
      .from('ts_community_games')
      .select('id, title, game_type, play_count')
      .eq('status', 'published')
      .order('play_count', { ascending: false })
      .limit(6);
    community = (games || []).map((g) => {
      const page = COMMUNITY_PAGES[g.game_type];
      const gp = GAME_PAGES[g.game_type];
      return {
        id: g.id,
        title: g.title,
        game: gp ? gp.name : g.game_type,
        plays: g.play_count || 0,
        // No page reads ?community= for quiz or whoami, so those honestly
        // point at the hub rather than starting a generic round.
        url: page ? `/games/${page}.html?community=${encodeURIComponent(g.id)}` : '/community/',
      };
    });
  } catch (err) {
    console.error('[featured] community unavailable:', err.message);
  }

  const body = { mode, windowDays: WINDOW_DAYS, items, community };
  CACHE = { at: Date.now(), body };
  return respond(200, body);
};
