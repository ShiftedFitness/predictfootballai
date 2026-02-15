/**
 * player-lookup.js — Player database lookup tool
 *
 * Endpoints (via `action` query param on GET):
 *   search   → Search players by name (partial match)
 *   detail   → Full player detail: all seasons, stats per club, current season
 *
 * Query params:
 *   action=search&q=<name>        → returns up to 30 matching players
 *   action=detail&uid=<player_uid> → returns full player breakdown
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

const COMP_NAMES = {
  1: 'La Liga', 2: 'UCL', 3: 'Serie A',
  6: 'Ligue 1', 7: 'Premier League', 9: 'Bundesliga',
};

function respond(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  try {
    const url = new URL(event.rawUrl);
    const action = url.searchParams.get('action');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    if (action === 'search') {
      return await handleSearch(supabase, url);
    } else if (action === 'detail') {
      return await handleDetail(supabase, url);
    } else {
      return respond(400, { error: 'action must be "search" or "detail"' });
    }
  } catch (e) {
    console.error('player-lookup error:', e);
    return respond(500, { error: e.message });
  }
};

/**
 * Search players by name — returns up to 30 matches, deduplicated by name.
 * Historical data can have multiple UIDs for the same player (different
 * nationality formats, birth years, mojibake). We group by player_name
 * and return the UID with the most historical data as the canonical one.
 */
async function handleSearch(supabase, url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q || q.length < 2) {
    return respond(400, { error: 'q must be at least 2 characters' });
  }

  // Search by name
  const { data, error } = await supabase
    .from('players')
    .select('player_uid, player_name, nationality_raw, birth_year')
    .or(`player_name.ilike.%${q}%,player_uid.ilike.%${q}%`)
    .order('player_name')
    .limit(100);

  if (error) throw error;

  // Deduplicate by player_name — keep the entry with birth_year set, prefer shorter nationality
  const byName = {};
  for (const p of (data || [])) {
    const key = (p.player_name || '').toLowerCase();
    if (!byName[key]) {
      byName[key] = p;
    } else {
      // Prefer entry with birth_year, then shorter uid (likely canonical)
      const existing = byName[key];
      if (!existing.birth_year && p.birth_year) byName[key] = p;
      else if (p.player_uid.length < existing.player_uid.length) byName[key] = p;
    }
  }

  const results = Object.values(byName).slice(0, 30);
  return respond(200, { results });
}

/**
 * Full player detail — all season stats grouped by club + current season.
 * Aggregates across ALL UIDs for the same player name to handle historical
 * data fragmentation (different nationality formats, birth years, mojibake).
 */
async function handleDetail(supabase, url) {
  const uid = (url.searchParams.get('uid') || '').trim();
  if (!uid) {
    return respond(400, { error: 'uid parameter required' });
  }

  // 1. Player info
  const { data: player, error: pErr } = await supabase
    .from('players')
    .select('*')
    .eq('player_uid', uid)
    .single();

  if (pErr || !player) {
    return respond(404, { error: 'Player not found' });
  }

  // 2. Find ALL UIDs for this player name (handles fragmented historical data)
  const { data: allPlayerEntries } = await supabase
    .from('players')
    .select('player_uid')
    .eq('player_name', player.player_name);

  const allUids = (allPlayerEntries || []).map(p => p.player_uid);
  if (!allUids.includes(uid)) allUids.push(uid);

  // 3. All season stats from the combined view across ALL UIDs
  const { data: stats, error: sErr } = await supabase
    .from('v_all_player_season_stats')
    .select('*')
    .in('player_uid', allUids)
    .order('season_label', { ascending: true });

  if (sErr) throw sErr;

  // 3. Look up club names for all club_ids in the stats
  const clubIds = [...new Set((stats || []).map(s => s.club_id).filter(Boolean))];
  let clubMap = {};
  if (clubIds.length > 0) {
    const { data: clubs } = await supabase
      .from('clubs')
      .select('club_id, club_name')
      .in('club_id', clubIds);
    if (clubs) {
      clubs.forEach(c => { clubMap[c.club_id] = c.club_name; });
    }
  }

  // 4. Separate historical vs current season
  const historical = (stats || []).filter(s => s.source === 'historical');
  const current = (stats || []).filter(s => s.source === 'current');

  // 5. Build club-grouped summaries
  const clubGroups = {};
  for (const s of historical) {
    const clubName = clubMap[s.club_id] || `Club #${s.club_id}`;
    const compName = COMP_NAMES[s.competition_id] || `Comp #${s.competition_id}`;
    const key = `${clubName} (${compName})`;
    if (!clubGroups[key]) {
      clubGroups[key] = { club: clubName, competition: compName, seasons: [] };
    }
    clubGroups[key].seasons.push({
      season: s.season_label,
      appearances: s.appearances ?? 0,
      goals: s.goals ?? 0,
      assists: s.assists ?? 0,
      clean_sheets: s.clean_sheets ?? 0,
      minutes: s.minutes_played ?? 0,
      position: s.position_group,
    });
  }

  // Sort seasons within each club group chronologically
  Object.values(clubGroups).forEach(g => {
    g.seasons.sort((a, b) => a.season.localeCompare(b.season));
  });

  // 6. Current season summary
  const currentSeason = current.map(s => ({
    club: clubMap[s.club_id] || `Club #${s.club_id}`,
    competition: COMP_NAMES[s.competition_id] || `Comp #${s.competition_id}`,
    season: s.season_label,
    appearances: s.appearances ?? 0,
    goals: s.goals ?? 0,
    assists: s.assists ?? 0,
    clean_sheets: s.clean_sheets ?? 0,
    minutes: s.minutes_played ?? 0,
    position: s.position_group,
    saves: s.saves ?? 0,
    tackles: s.tackles ?? 0,
    interceptions: s.interceptions ?? 0,
    yellow_cards: s.yellow_cards ?? 0,
    red_cards: s.red_cards ?? 0,
  }));

  // 7. Career totals
  const allStats = stats || [];
  const totals = {
    appearances: allStats.reduce((s, r) => s + (r.appearances || 0), 0),
    goals: allStats.reduce((s, r) => s + (r.goals || 0), 0),
    assists: allStats.reduce((s, r) => s + (r.assists || 0), 0),
    clean_sheets: allStats.reduce((s, r) => s + (r.clean_sheets || 0), 0),
    seasons: [...new Set(allStats.map(r => r.season_label))].length,
    clubs: [...new Set(allStats.map(r => clubMap[r.club_id] || r.club_id))].length,
  };

  return respond(200, {
    player: {
      uid: player.player_uid,
      name: player.player_name,
      nationality: player.nationality_raw,
      birth_year: player.birth_year,
    },
    totals,
    currentSeason,
    clubHistory: Object.values(clubGroups),
    rawStats: stats,
  });
}
