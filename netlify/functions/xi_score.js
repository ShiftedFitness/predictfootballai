/**
 * xi_score.js — Starting XI scoring / evaluation  (v1.1)
 *
 * POST body: { scopeId, formation, objective, picks: [{ slotIdx, playerId }] }
 *
 * Returns: per-slot correct/incorrect, score, and optionally reveals answers
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

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

/**
 * Fetch all rows from a Supabase query, paginating past the 1000-row default.
 * queryFn: a function that returns a fresh Supabase query builder.
 */
async function fetchAll(queryFn) {
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFn().range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function fixMojibake(str) {
  if (!str) return str;
  try {
    if (/[\xC0-\xDF][\x80-\xBF]/.test(str)) {
      const bytes = new Uint8Array([...str].map(c => c.charCodeAt(0)));
      const decoded = new TextDecoder('utf-8').decode(bytes);
      if (decoded && !decoded.includes('\uFFFD')) return decoded;
    }
  } catch (_) { /* ignore */ }
  return str;
}

// ============================================================
// FORMATIONS (duplicated here for standalone function)
// ============================================================

const FORMATIONS = {
  '4-4-2': { slots: [
    { idx: 0, bucket: 'GK' }, { idx: 1, bucket: 'DEF' }, { idx: 2, bucket: 'DEF' },
    { idx: 3, bucket: 'DEF' }, { idx: 4, bucket: 'DEF' },
    { idx: 5, bucket: 'MID' }, { idx: 6, bucket: 'MID' }, { idx: 7, bucket: 'MID' }, { idx: 8, bucket: 'MID' },
    { idx: 9, bucket: 'FWD' }, { idx: 10, bucket: 'FWD' },
  ]},
  '4-3-3': { slots: [
    { idx: 0, bucket: 'GK' }, { idx: 1, bucket: 'DEF' }, { idx: 2, bucket: 'DEF' },
    { idx: 3, bucket: 'DEF' }, { idx: 4, bucket: 'DEF' },
    { idx: 5, bucket: 'MID' }, { idx: 6, bucket: 'MID' }, { idx: 7, bucket: 'MID' },
    { idx: 8, bucket: 'FWD' }, { idx: 9, bucket: 'FWD' }, { idx: 10, bucket: 'FWD' },
  ]},
  '3-5-2': { slots: [
    { idx: 0, bucket: 'GK' }, { idx: 1, bucket: 'DEF' }, { idx: 2, bucket: 'DEF' }, { idx: 3, bucket: 'DEF' },
    { idx: 4, bucket: 'MID' }, { idx: 5, bucket: 'MID' }, { idx: 6, bucket: 'MID' },
    { idx: 7, bucket: 'MID' }, { idx: 8, bucket: 'MID' },
    { idx: 9, bucket: 'FWD' }, { idx: 10, bucket: 'FWD' },
  ]},
  '3-4-3': { slots: [
    { idx: 0, bucket: 'GK' }, { idx: 1, bucket: 'DEF' }, { idx: 2, bucket: 'DEF' }, { idx: 3, bucket: 'DEF' },
    { idx: 4, bucket: 'MID' }, { idx: 5, bucket: 'MID' }, { idx: 6, bucket: 'MID' }, { idx: 7, bucket: 'MID' },
    { idx: 8, bucket: 'FWD' }, { idx: 9, bucket: 'FWD' }, { idx: 10, bucket: 'FWD' },
  ]},
};

const SCOPES = [
  { id: 'epl_alltime', label: 'Premier League (All-time)', type: 'league', clubName: null },
  { id: 'club_sunderland', label: 'Sunderland', type: 'club', clubName: 'Sunderland' },
  { id: 'club_manutd', label: 'Manchester United', type: 'club', clubName: 'Manchester United' },
  { id: 'club_arsenal', label: 'Arsenal', type: 'club', clubName: 'Arsenal' },
  { id: 'club_liverpool', label: 'Liverpool', type: 'club', clubName: 'Liverpool' },
  { id: 'club_chelsea', label: 'Chelsea', type: 'club', clubName: 'Chelsea' },
];

const MIN_APPS_LEAGUE = 40;
const MIN_APPS_CLUB = 20;

async function getClubId(supabase, clubName) {
  const { data } = await supabase
    .from('clubs')
    .select('club_id')
    .eq('club_name', clubName)
    .single();
  return data ? data.club_id : null;
}

async function getEplCompId(supabase) {
  const { data } = await supabase
    .from('competitions')
    .select('competition_id')
    .eq('competition_name', 'Premier League')
    .single();
  return data ? data.competition_id : null;
}

/**
 * Compute the Best XI (same logic as xi_start.js).
 * Returns flat array of { slotIdx, playerId, ... }
 */
async function computeBestXI(supabase, scope, formation, objective) {
  const formationDef = FORMATIONS[formation];
  if (!formationDef) throw new Error(`Unknown formation: ${formation}`);

  const competitionId = await getEplCompId(supabase);
  if (!competitionId) throw new Error('EPL not found');

  // Count per bucket
  const bucketCounts = {};
  for (const slot of formationDef.slots) {
    bucketCounts[slot.bucket] = (bucketCounts[slot.bucket] || 0) + 1;
  }

  const bestByBucket = {};

  if (objective === 'performance') {
    for (const [bucket, count] of Object.entries(bucketCounts)) {
      let query = supabase
        .from('player_performance_scores')
        .select('player_uid, player_name, nationality, appearances, goals, assists, minutes, performance_score')
        .eq('position_bucket', bucket)
        .eq('scope_type', scope.type);

      if (scope.type === 'club' && scope.clubId) {
        query = query.eq('scope_id', scope.clubId);
      } else {
        query = query.is('scope_id', null);
      }

      query = query
        .order('performance_score', { ascending: false })
        .order('appearances', { ascending: false })
        .order('minutes', { ascending: false })
        .order('player_name', { ascending: true })
        .limit(count);

      const { data } = await query;
      bestByBucket[bucket] = (data || []).map(row => ({
        playerId: row.player_uid,
        name: fixMojibake(row.player_name),
        nationality: row.nationality,
        appearances: row.appearances,
        goals: row.goals,
        assists: row.assists,
        minutes: row.minutes,
        score: parseFloat(row.performance_score) || 0,
      }));
    }
  } else {
    const metric = objective === 'goals' ? 'goals' : 'appearances';

    for (const [bucket, count] of Object.entries(bucketCounts)) {
      const buildBucketQuery = () => {
        let q = supabase
          .from('player_season_stats')
          .select('player_uid, appearances, goals, assists, minutes')
          .eq('competition_id', competitionId)
          .eq('position_bucket', bucket)
          .gt('appearances', 0);
        if (scope.type === 'club' && scope.clubId) {
          q = q.eq('club_id', scope.clubId);
        }
        return q;
      };

      let stats;
      try {
        stats = await fetchAll(buildBucketQuery);
      } catch (err) {
        console.error(`[computeBestXI] fetchAll error for ${bucket}:`, err);
        bestByBucket[bucket] = []; continue;
      }
      if (!stats) { bestByBucket[bucket] = []; continue; }

      // Aggregate
      const aggMap = new Map();
      for (const row of stats) {
        const e = aggMap.get(row.player_uid);
        if (e) {
          e.appearances += row.appearances || 0;
          e.goals += row.goals || 0;
          e.assists += row.assists || 0;
          e.minutes += row.minutes || 0;
        } else {
          aggMap.set(row.player_uid, {
            player_uid: row.player_uid,
            appearances: row.appearances || 0,
            goals: row.goals || 0,
            assists: row.assists || 0,
            minutes: row.minutes || 0,
          });
        }
      }

      const minApps = scope.type === 'club' ? MIN_APPS_CLUB : MIN_APPS_LEAGUE;
      let eligible = Array.from(aggMap.values()).filter(p => p.appearances >= minApps);

      eligible.sort((a, b) => {
        const d = (b[metric] || 0) - (a[metric] || 0);
        if (d !== 0) return d;
        const ad = b.appearances - a.appearances;
        if (ad !== 0) return ad;
        return b.minutes - a.minutes;
      });

      const topN = eligible.slice(0, count);
      const uids = topN.map(p => p.player_uid);

      const nameMap = new Map();
      if (uids.length > 0) {
        const { data: players } = await supabase
          .from('players')
          .select('player_uid, player_name, nationality_norm')
          .in('player_uid', uids);
        if (players) {
          for (const p of players) nameMap.set(p.player_uid, p);
        }
      }

      // Final alphabetical tiebreak for same score
      topN.forEach(agg => {
        const p = nameMap.get(agg.player_uid);
        agg.name = p ? fixMojibake(p.player_name) : 'Unknown';
      });
      // Re-sort with name tiebreak
      topN.sort((a, b) => {
        const d = (b[metric] || 0) - (a[metric] || 0);
        if (d !== 0) return d;
        const ad = b.appearances - a.appearances;
        if (ad !== 0) return ad;
        const md = b.minutes - a.minutes;
        if (md !== 0) return md;
        return (a.name || '').localeCompare(b.name || '');
      });

      bestByBucket[bucket] = topN.map(agg => {
        const p = nameMap.get(agg.player_uid);
        return {
          playerId: agg.player_uid,
          name: agg.name,
          nationality: p ? (p.nationality_norm || '').toUpperCase() : '',
          appearances: agg.appearances,
          goals: agg.goals,
          assists: agg.assists,
          minutes: agg.minutes,
          score: agg[metric] || 0,
        };
      });
    }
  }

  // Map into formation slots
  const result = [];
  const usedByBucket = {};

  for (const slot of formationDef.slots) {
    if (!usedByBucket[slot.bucket]) usedByBucket[slot.bucket] = 0;
    const idx = usedByBucket[slot.bucket];
    const bucket = bestByBucket[slot.bucket] || [];
    const player = bucket[idx] || null;

    result.push({
      slotIdx: slot.idx,
      bucket: slot.bucket,
      player,
    });

    usedByBucket[slot.bucket]++;
  }

  return result;
}

// ============================================================
// MAIN HANDLER
// ============================================================

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'POST only' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { scopeId, formation, objective, picks, reveal = false } = body;

    console.log('[xi_score] Request:', { scopeId, formation, objective, reveal, picks: picks?.length });

    if (!scopeId || !formation || !objective || !picks) {
      return respond(400, { error: 'Missing scopeId, formation, objective, or picks' });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return respond(500, { error: 'Missing Supabase config' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const scopeDef = SCOPES.find(s => s.id === scopeId);
    if (!scopeDef) return respond(400, { error: `Unknown scope: ${scopeId}` });

    const scope = { ...scopeDef };
    if (scope.type === 'club' && scope.clubName) {
      scope.clubId = await getClubId(supabase, scope.clubName);
    }

    // Compute the answer key
    const bestXI = await computeBestXI(supabase, scope, formation, objective);

    // Compare user picks to best XI
    // The best XI is position-ordered: within each bucket, the best player fills the first slot of that bucket.
    // A user's pick is "correct" if the player_uid appears in ANY slot of the same bucket in the best XI.
    // This avoids penalizing e.g. putting the #1 CB in slot 3 vs slot 2.

    const bestByBucket = {};
    for (const slot of bestXI) {
      if (!bestByBucket[slot.bucket]) bestByBucket[slot.bucket] = new Set();
      if (slot.player) bestByBucket[slot.bucket].add(String(slot.player.playerId));
    }

    // Compute full rankings per bucket for context on wrong picks
    const competitionId = await getEplCompId(supabase);
    const formationDef = FORMATIONS[formation];
    const uniqueBuckets = [...new Set(formationDef.slots.map(s => s.bucket))];
    const bucketRankings = {};

    if (objective === 'performance') {
      for (const bucket of uniqueBuckets) {
        const buildPerfQuery = () => {
          let q = supabase
            .from('player_performance_scores')
            .select('player_uid, player_name, nationality, performance_score, appearances, goals, assists, minutes, clean_sheets, tackles_interceptions, tackles_won, interceptions, saves')
            .eq('position_bucket', bucket)
            .eq('scope_type', scope.type);
          if (scope.type === 'club' && scope.clubId) {
            q = q.eq('scope_id', scope.clubId);
          } else {
            q = q.is('scope_id', null);
          }
          q = q.order('performance_score', { ascending: false });
          return q;
        };
        try {
          const data = await fetchAll(buildPerfQuery);
          if (data) {
            bucketRankings[bucket] = data.map((r, i) => ({
              playerId: String(r.player_uid),
              name: fixMojibake(r.player_name),
              nationality: r.nationality,
              rank: i + 1,
              score: parseFloat(r.performance_score) || 0,
              appearances: r.appearances,
              goals: r.goals,
              assists: r.assists,
              minutes: r.minutes,
              cleanSheets: r.clean_sheets,
              tacklesInterceptions: r.tackles_interceptions || ((r.tackles_won || 0) + (r.interceptions || 0)),
              saves: r.saves,
            }));
          }
        } catch (err) {
          console.error(`[xi_score] rankings fetchAll error for ${bucket}:`, err);
        }
      }
    } else {
      const metric = objective === 'goals' ? 'goals' : 'appearances';
      for (const bucket of uniqueBuckets) {
        const buildRankQuery = () => {
          let q = supabase
            .from('player_season_stats')
            .select('player_uid, appearances, goals, minutes')
            .eq('competition_id', competitionId)
            .eq('position_bucket', bucket)
            .gt('appearances', 0);
          if (scope.type === 'club' && scope.clubId) {
            q = q.eq('club_id', scope.clubId);
          }
          return q;
        };
        let stats;
        try {
          stats = await fetchAll(buildRankQuery);
        } catch (err) {
          console.error(`[xi_score] rankings fetchAll error for ${bucket}:`, err);
          continue;
        }
        if (!stats) continue;

        const aggMap = new Map();
        for (const row of stats) {
          const e = aggMap.get(row.player_uid);
          if (e) {
            e.appearances += row.appearances || 0;
            e.goals += row.goals || 0;
            e.minutes += row.minutes || 0;
          } else {
            aggMap.set(row.player_uid, {
              player_uid: row.player_uid,
              appearances: row.appearances || 0,
              goals: row.goals || 0,
              minutes: row.minutes || 0,
            });
          }
        }

        const minApps = scope.type === 'club' ? MIN_APPS_CLUB : MIN_APPS_LEAGUE;
        let eligible = Array.from(aggMap.values()).filter(p => p.appearances >= minApps);
        eligible.sort((a, b) => {
          const d = (b[metric] || 0) - (a[metric] || 0);
          if (d !== 0) return d;
          return b.appearances - a.appearances;
        });
        bucketRankings[bucket] = eligible.map((p, i) => ({
          playerId: String(p.player_uid),
          rank: i + 1,
          appearances: p.appearances,
          goals: p.goals,
          minutes: p.minutes,
        }));
      }
    }

    const results = [];
    let correct = 0;

    for (const pick of picks) {
      const bestSlot = bestXI.find(s => s.slotIdx === pick.slotIdx);
      if (!bestSlot) {
        results.push({ slotIdx: pick.slotIdx, correct: false, userPick: pick.playerId });
        continue;
      }

      const bucket = bestSlot.bucket;
      const pickId = pick.playerId != null ? String(pick.playerId) : null;
      const isCorrect = pickId && bestByBucket[bucket] && bestByBucket[bucket].has(pickId);

      if (isCorrect) correct++;

      // Find rank and stats of user's pick in that bucket
      // Also check adjacent bucket (MID↔FWD) since search allows cross-position picks
      let userRank = null;
      let userStatValue = null;
      let userRankBucket = null;
      if (pickId) {
        const bucketsToCheck = [bucket];
        if (bucket === 'FWD') bucketsToCheck.push('MID');
        else if (bucket === 'MID') bucketsToCheck.push('FWD');

        for (const checkBucket of bucketsToCheck) {
          if (!bucketRankings[checkBucket]) continue;
          const found = bucketRankings[checkBucket].find(r => String(r.playerId) === pickId);
          if (found) {
            userRank = found.rank;
            userRankBucket = checkBucket;
            userStatValue = found.appearances != null ? {
              appearances: found.appearances,
              goals: found.goals,
              score: found.score,
            } : null;
            break;
          }
        }
      }

      // Count how many eligible players in that bucket
      const bucketTotal = bucketRankings[bucket] ? bucketRankings[bucket].length : null;

      results.push({
        slotIdx: pick.slotIdx,
        correct: !!isCorrect,
        userPick: pick.playerId,
        userRank,
        userRankBucket: userRankBucket || bucket,
        userStatValue,
        bucketTotal,
        // Only reveal if requested (after 3 attempts or explicit reveal)
        answer: reveal ? (bestSlot.player ? {
          playerId: bestSlot.player.playerId,
          name: bestSlot.player.name,
          nationality: bestSlot.player.nationality,
          score: bestSlot.player.score,
          appearances: bestSlot.player.appearances,
          goals: bestSlot.player.goals,
          assists: bestSlot.player.assists,
          minutes: bestSlot.player.minutes,
        } : null) : undefined,
      });
    }

    const total = bestXI.length;

    // Build top-10 rankings per bucket for performance objective (always include after scoring)
    let topByBucket = undefined;
    if (objective === 'performance') {
      topByBucket = {};
      for (const bucket of uniqueBuckets) {
        const rankings = bucketRankings[bucket] || [];
        topByBucket[bucket] = rankings.slice(0, 10).map(r => ({
          rank: r.rank,
          name: r.name || 'Unknown',
          nationality: r.nationality || '',
          score: r.score,
          appearances: r.appearances,
          goals: r.goals,
          assists: r.assists,
          cleanSheets: r.cleanSheets,
          tacklesInterceptions: r.tacklesInterceptions,
          saves: r.saves,
        }));
      }
    }

    return respond(200, {
      correct,
      total,
      results,
      complete: correct === total,
      topByBucket,
    });

  } catch (err) {
    console.error('[xi_score] Error:', err);
    return respond(500, { error: err.message });
  }
};
