/**
 * refresh-odds.js
 *
 * Keeps the market percentages on predict_matches current.
 *
 * seedWeek() writes prediction_home/draw/away once, when the admin creates
 * the week. Markets move — team news, injuries, rotation — so by the time
 * someone picks on Saturday morning those numbers could be days old. This
 * re-reads Polymarket and updates any fixture that has not locked yet.
 *
 * Runs every 12 hours (netlify.toml), a few hours ahead of each picks-ai
 * run so the AI always reasons over the freshest prices players can see.
 *
 * Deliberately does NOT touch matches whose lockout has passed. Once picks
 * are in, the stored percentage is the historical record of what players
 * were looking at when they chose, and rewriting it would make the "You v
 * AI" rationale and the probability summary retrospectively dishonest.
 *
 * No API key: Polymarket's Gamma API is public, read-only, unauthenticated.
 *
 * Also callable manually with x-admin-secret:
 *   POST /refresh-odds              → refresh all open, unlocked fixtures
 *   POST /refresh-odds {dryRun:true} → report what would change
 */

const { sb, respond, requireAdmin, handleOptions, currentSeason } = require('./_supabase.js');
const { fetchEplMatchMarkets, findMarketForFixture } = require('./_polymarket.js');

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  const isScheduled =
    !event.httpMethod ||
    (event.headers?.['user-agent'] || '').includes('Netlify Clockwork');

  if (!isScheduled) {
    const adminErr = await requireAdmin(event);
    if (adminErr) return adminErr;
  }

  const body = isScheduled ? {} : JSON.parse(event.body || '{}');
  const dryRun = !!body.dryRun;

  try {
    const db = sb();
    const season = await currentSeason(db);

    // Weeks still being played this season.
    let weekQuery = db.from('predict_match_weeks').select('id, week_number');
    if (season) weekQuery = weekQuery.eq('season', season);
    const { data: weeks, error: weeksErr } = await weekQuery;
    if (weeksErr) throw new Error(`Week lookup failed: ${weeksErr.message}`);
    if (!weeks?.length) return respond(200, { ok: true, message: 'No weeks this season.' });

    const weekIds = weeks.map((w) => w.id);
    const numByWeekId = Object.fromEntries(weeks.map((w) => [w.id, w.week_number]));

    const { data: matches, error: matchErr } = await db
      .from('predict_matches')
      .select('id, match_week_id, home_team, away_team, lockout_time, locked, prediction_home, prediction_draw, prediction_away')
      .in('match_week_id', weekIds);
    if (matchErr) throw new Error(`Match lookup failed: ${matchErr.message}`);

    // Only fixtures still open for picking.
    const now = Date.now();
    const open = (matches || []).filter((m) => {
      if (m.locked) return false;
      if (!m.lockout_time) return true;
      return new Date(m.lockout_time).getTime() > now;
    });

    if (!open.length) {
      return respond(200, { ok: true, message: 'No unlocked fixtures to refresh.' });
    }

    const markets = await fetchEplMatchMarkets();
    if (!markets.length) {
      // Polymarket unreachable — leave the existing numbers alone rather
      // than blanking them. The model-derived fallbacks stay valid.
      return respond(200, {
        ok: true,
        message: 'No markets returned; existing percentages left untouched.',
        fixturesConsidered: open.length
      });
    }

    const changes = [];
    let unchanged = 0;
    let noMarket = 0;

    for (const m of open) {
      const mk = findMarketForFixture(markets, m.home_team, m.away_team, m.lockout_time);
      if (!mk) { noMarket++; continue; }

      const same =
        Number(m.prediction_home) === mk.home &&
        Number(m.prediction_draw) === mk.draw &&
        Number(m.prediction_away) === mk.away;
      if (same) { unchanged++; continue; }

      const change = {
        matchId: m.id,
        week: numByWeekId[m.match_week_id],
        fixture: `${m.home_team} v ${m.away_team}`,
        from: `${m.prediction_home ?? '-'}/${m.prediction_draw ?? '-'}/${m.prediction_away ?? '-'}`,
        to: `${mk.home}/${mk.draw}/${mk.away}`
      };

      if (!dryRun) {
        const { error: updErr } = await db
          .from('predict_matches')
          .update({
            prediction_home: mk.home,
            prediction_draw: mk.draw,
            prediction_away: mk.away
          })
          .eq('id', m.id);
        if (updErr) {
          change.error = updErr.message;
          console.error(`refresh-odds: match ${m.id} failed: ${updErr.message}`);
        }
      }
      changes.push(change);
    }

    if (!dryRun && changes.length) {
      console.log(`refresh-odds: updated ${changes.length} fixture(s)`);
    }

    return respond(200, {
      ok: true,
      dryRun,
      season,
      fixturesConsidered: open.length,
      updated: changes.length,
      unchanged,
      noMarketFound: noMarket,
      changes
    });
  } catch (e) {
    console.error('refresh-odds error:', e);
    return respond(500, e.message || 'Unknown error');
  }
};
