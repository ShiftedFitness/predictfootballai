/**
 * featured-player.js — a random notable player with their Premier League career.
 *
 * GET → one player with 100+ Premier League appearances, plus a club-by-club
 * breakdown of that career.
 *
 * REWRITTEN 4 Sep 2026. The previous version had been returning
 * {"error":"No players found"} in production for an unknown length of time. It
 * queried v_all_player_season_stats for columns named `competition`, `season`
 * and `club` — that view has never had them; it carries competition_id,
 * season_label and club_id. Every query errored, `data` came back null, and
 * the handler reported no players rather than the failure.
 *
 * This version reads v_game_player_club_comp, which is already aggregated one
 * row per player per club per competition and carries competition_name
 * outright. That is both correct and a great deal cheaper: picking a notable
 * player is now one indexed read rather than a scan of every season row in the
 * database.
 */

const { sb, respond, handleOptions } = require('./_supabase');

const PREMIER_LEAGUE = 'Premier League';
const NOTABLE_APPEARANCES = 100;

/** Names arrived mojibaked from an old import; repair them on the way out. */
function fixMojibake(s) {
  if (!/[ÃÂ][\x80-\xBF -ÿ]/.test(s || '')) return s;
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    return fixed.includes('�') ? s : fixed;
  } catch { return s; }
}

exports.handler = async (event) => {
  const cors = handleOptions(event);
  if (cors) return cors;
  if (event.httpMethod !== 'GET') return respond(405, 'GET only');

  const client = sb();

  try {
    // How many player-club pairs clear the bar? Used only to pick an offset,
    // so it is a head request with no rows crossing the wire.
    const { count, error: countErr } = await client
      .from('v_game_player_club_comp')
      .select('player_uid', { count: 'exact', head: true })
      .eq('competition_name', PREMIER_LEAGUE)
      .gte('appearances', NOTABLE_APPEARANCES);

    if (countErr) return respond(500, { error: countErr.message });
    if (!count) return respond(404, { error: 'No notable players found' });

    // Random offset into the set, rather than pulling the set and choosing in
    // JavaScript. One row comes back.
    //
    // The offset is drawn ONCE and used for both ends of the range. Drawing it
    // twice gives a start past the end often enough to matter, and PostgREST
    // answers that with "Requested range not satisfiable" rather than an empty
    // result — a 500 on a page that should simply show a different player.
    const offset = Math.floor(Math.random() * count);
    const { data: picked, error: pickErr } = await client
      .from('v_game_player_club_comp')
      .select('player_uid, player_name, nationality_norm')
      .eq('competition_name', PREMIER_LEAGUE)
      .gte('appearances', NOTABLE_APPEARANCES)
      .order('player_uid')
      .range(offset, offset);

    if (pickErr) return respond(500, { error: pickErr.message });
    if (!picked || !picked.length) return respond(404, { error: 'No notable players found' });

    const player = picked[0];

    // The whole Premier League career, one row per club.
    const { data: spells, error: spellErr } = await client
      .from('v_game_player_club_comp')
      .select('club_name, appearances, goals, assists, minutes, seasons, first_season_start_year, last_season_start_year')
      .eq('player_uid', player.player_uid)
      .eq('competition_name', PREMIER_LEAGUE)
      .order('appearances', { ascending: false });

    if (spellErr) return respond(500, { error: spellErr.message });
    if (!spells || !spells.length) return respond(404, { error: 'No career found' });

    const total = spells.reduce(
      (a, s) => ({
        appearances: a.appearances + (s.appearances || 0),
        goals: a.goals + (s.goals || 0),
        assists: a.assists + (s.assists || 0),
        minutes: a.minutes + (s.minutes || 0),
      }),
      { appearances: 0, goals: 0, assists: 0, minutes: 0 }
    );

    const years = spells.flatMap((s) => [s.first_season_start_year, s.last_season_start_year]).filter(Boolean);
    const season = (y) => (y == null ? null : `${y}/${String(y + 1).slice(2)}`);

    return respond(200, {
      player: {
        uid: player.player_uid,
        name: fixMojibake(player.player_name),
        nationality: player.nationality_norm || '',
      },
      competition: PREMIER_LEAGUE,
      totals: total,
      span: years.length
        ? { from: season(Math.min(...years)), to: season(Math.max(...years)) }
        : null,
      clubs: spells.map((s) => ({
        club: s.club_name,
        appearances: s.appearances,
        goals: s.goals,
        assists: s.assists,
        seasons: s.seasons,
        from: season(s.first_season_start_year),
        to: season(s.last_season_start_year),
      })),
    });
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
