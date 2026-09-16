/**
 * competition-extras.js — community games about one competition.
 *
 * The sibling of team-extras.js, and the same reasoning: a competition page is
 * static HTML because its records and clubs are, but community games are
 * created by anybody at any moment and a rebuild cannot be the thing that makes
 * a new one visible.
 *
 * GET ?slug=segunda-division
 */

const { sb, respond, handleOptions } = require('./_supabase.js');
const teams = require('./_teams');
const entities = require('./_ask_entities');

const LIMIT = 12;

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const params = event.queryStringParameters || {};
  const slug = String(params.slug || '');
  const comp = teams.competitions().find((c) => c.slug === slug);
  if (!comp) return respond(400, { error: 'Unknown competition' });

  try {
    const client = sb();
    const { data: games } = await client
      .from('ts_community_games')
      .select('id, title, description, game_type, play_count, upvotes')
      .eq('status', 'published')
      .order('play_count', { ascending: false })
      .limit(500);

    // ts_community_games carries no competition tag — a creator names a game,
    // they do not classify it. So the competition is read out of what they
    // wrote, with the resolver Ask TeleStats already uses: either the
    // competition itself is named, or one of its clubs is. A game naming
    // neither is simply not tagged rather than filed somewhere plausible.
    const clubSlugs = new Set(comp.clubs);
    const matches = (g) => {
      const text = `${g.title || ''} ${g.description || ''}`;
      if (entities.findCompetition(text) === comp.name) return true;
      return entities.findTeams(text).some((t) => clubSlugs.has(t.slug));
    };

    const community = (games || []).filter(matches).slice(0, LIMIT).map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      game_type: g.game_type,
      plays: g.play_count || 0,
      upvotes: g.upvotes || 0,
    }));

    return respond(200, {
      slug: comp.slug,
      competition: comp.name,
      clubs: comp.clubs.length,
      community,
      community_total: (games || []).length,
    });
  } catch (e) {
    console.error('[competition-extras]', e);
    return respond(500, { error: 'Could not load competition extras' });
  }
};
