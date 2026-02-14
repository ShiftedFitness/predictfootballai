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

// All scopes — must match xi_start.js
const SCOPES = [
  { id: 'epl_alltime',      label: 'Premier League (All-time)', type: 'league', clubName: null },
  // Wonders
  { id: 'wonder_onematch',  label: 'One Match Wonders', type: 'wonder', wonderType: 'match' },
  { id: 'wonder_onegoal',   label: 'One Goal Wonders',  type: 'wonder', wonderType: 'goal' },
  // Nationality XIs
  { id: 'nat_english',  label: 'English XI',  type: 'nationality', nationalityCode: 'ENG' },
  { id: 'nat_spanish',  label: 'Spanish XI',  type: 'nationality', nationalityCode: 'ESP' },
  { id: 'nat_french',   label: 'French XI',   type: 'nationality', nationalityCode: 'FRA' },
  { id: 'nat_scottish', label: 'Scottish XI', type: 'nationality', nationalityCode: 'SCO' },
  { id: 'nat_irish',    label: 'Irish XI',    type: 'nationality', nationalityCode: 'IRL' },
  { id: 'nat_welsh',    label: 'Welsh XI',    type: 'nationality', nationalityCode: 'WAL' },
  { id: 'nat_nirish',   label: 'N. Irish XI', type: 'nationality', nationalityCode: 'NIR' },
  { id: 'club_arsenal',     label: 'Arsenal',          type: 'club', clubName: 'Arsenal',              clubId: 94  },
  { id: 'club_astonvilla',  label: 'Aston Villa',      type: 'club', clubName: 'Aston Villa',          clubId: 295 },
  { id: 'club_blackburn',   label: 'Blackburn',        type: 'club', clubName: 'Blackburn Rovers',     clubId: 24  },
  { id: 'club_bolton',      label: 'Bolton',           type: 'club', clubName: 'Bolton Wanderers',     clubId: 158 },
  { id: 'club_bournemouth', label: 'Bournemouth',      type: 'club', clubName: 'Bournemouth',          clubId: 117 },
  { id: 'club_brentford',   label: 'Brentford',        type: 'club', clubName: 'Brentford',            clubId: 336 },
  { id: 'club_brighton',    label: 'Brighton',         type: 'club', clubName: 'Brighton',              clubId: 483 },
  { id: 'club_burnley',     label: 'Burnley',          type: 'club', clubName: 'Burnley',              clubId: 535 },
  { id: 'club_charlton',    label: 'Charlton',         type: 'club', clubName: 'Charlton Athletic',    clubId: 407 },
  { id: 'club_chelsea',     label: 'Chelsea',          type: 'club', clubName: 'Chelsea',              clubId: 75  },
  { id: 'club_coventry',    label: 'Coventry',         type: 'club', clubName: 'Coventry City',        clubId: 501 },
  { id: 'club_crystalpalace', label: 'Crystal Palace', type: 'club', clubName: 'Crystal Palace',       clubId: 57  },
  { id: 'club_derby',       label: 'Derby',            type: 'club', clubName: 'Derby County',         clubId: 218 },
  { id: 'club_everton',     label: 'Everton',          type: 'club', clubName: 'Everton',              clubId: 22  },
  { id: 'club_fulham',      label: 'Fulham',           type: 'club', clubName: 'Fulham',               clubId: 356 },
  { id: 'club_ipswich',     label: 'Ipswich',          type: 'club', clubName: 'Ipswich Town',         clubId: 348 },
  { id: 'club_leeds',       label: 'Leeds',            type: 'club', clubName: 'Leeds United',         clubId: 559 },
  { id: 'club_leicester',   label: 'Leicester',        type: 'club', clubName: 'Leicester City',       clubId: 68  },
  { id: 'club_liverpool',   label: 'Liverpool',        type: 'club', clubName: 'Liverpool',            clubId: 28  },
  { id: 'club_mancity',     label: 'Man City',         type: 'club', clubName: 'Manchester City',      clubId: 278 },
  { id: 'club_manutd',      label: 'Man Utd',          type: 'club', clubName: 'Manchester Utd',       clubId: 592 },
  { id: 'club_middlesbrough', label: 'Middlesbrough',  type: 'club', clubName: 'Middlesbrough',        clubId: 534 },
  { id: 'club_newcastle',   label: 'Newcastle',        type: 'club', clubName: 'Newcastle United',     clubId: 520 },
  { id: 'club_norwich',     label: 'Norwich',          type: 'club', clubName: 'Norwich City',         clubId: 137 },
  { id: 'club_nottmforest', label: 'Nottm Forest',     type: 'club', clubName: 'Nottingham Forest',    clubId: 213 },
  { id: 'club_portsmouth',  label: 'Portsmouth',       type: 'club', clubName: 'Portsmouth',           clubId: 493 },
  { id: 'club_qpr',         label: 'QPR',              type: 'club', clubName: 'Queens Park Rangers',  clubId: 543 },
  { id: 'club_reading',     label: 'Reading',          type: 'club', clubName: 'Reading',              clubId: 344 },
  { id: 'club_sheffutd',    label: 'Sheff Utd',        type: 'club', clubName: 'Sheffield United',     clubId: 371 },
  { id: 'club_sheffwed',    label: 'Sheff Wed',        type: 'club', clubName: 'Sheffield Weds',       clubId: 496 },
  { id: 'club_southampton', label: 'Southampton',      type: 'club', clubName: 'Southampton',          clubId: 208 },
  { id: 'club_stoke',       label: 'Stoke',            type: 'club', clubName: 'Stoke City',           clubId: 121 },
  { id: 'club_sunderland',  label: 'Sunderland',       type: 'club', clubName: 'Sunderland',           clubId: 12  },
  { id: 'club_swansea',     label: 'Swansea',          type: 'club', clubName: 'Swansea City',         clubId: 548 },
  { id: 'club_tottenham',   label: 'Spurs',            type: 'club', clubName: 'Tottenham Hotspur',    clubId: 239 },
  { id: 'club_watford',     label: 'Watford',          type: 'club', clubName: 'Watford',              clubId: 71  },
  { id: 'club_westbrom',    label: 'West Brom',        type: 'club', clubName: 'West Bromwich Albion', clubId: 9   },
  { id: 'club_westham',     label: 'West Ham',         type: 'club', clubName: 'West Ham United',      clubId: 153 },
  { id: 'club_wigan',       label: 'Wigan',            type: 'club', clubName: 'Wigan Athletic',       clubId: 564 },
  { id: 'club_wimbledon',   label: 'Wimbledon',        type: 'club', clubName: 'Wimbledon',            clubId: 140 },
  { id: 'club_wolves',      label: 'Wolves',           type: 'club', clubName: 'Wolves',               clubId: 577 },
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
      let scopeType = scope.type;
      let scopeId = null;
      if (scope.type === 'nationality' || scope.type === 'wonder') {
        scopeType = 'league'; scopeId = null;
      } else if (scope.type === 'club') {
        scopeId = scope.clubId;
      }

      const fetchLimit = (scope.type === 'nationality' || scope.type === 'wonder') ? 500 : count;

      let query = supabase
        .from('player_performance_scores')
        .select('player_uid, player_name, nationality, appearances, goals, assists, minutes, performance_score')
        .eq('position_bucket', bucket)
        .eq('scope_type', scopeType);

      if (scopeId) { query = query.eq('scope_id', scopeId); }
      else { query = query.is('scope_id', null); }

      if (scope.type === 'nationality' && scope.nationalityCode) {
        query = query.eq('nationality', scope.nationalityCode.toUpperCase());
      }
      if (scope.type === 'wonder') {
        if (scope.wonderType === 'match') query = query.eq('appearances', 1);
        else if (scope.wonderType === 'goal') query = query.eq('goals', 1);
      }

      query = query
        .order('performance_score', { ascending: false })
        .order('appearances', { ascending: false })
        .order('minutes', { ascending: false })
        .order('player_name', { ascending: true })
        .limit(fetchLimit);

      const { data } = await query;
      bestByBucket[bucket] = (data || []).slice(0, count).map(row => ({
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

      const minApps = scope.type === 'wonder' ? 0 : (scope.type === 'club' ? MIN_APPS_CLUB : MIN_APPS_LEAGUE);
      let eligible = Array.from(aggMap.values()).filter(p => p.appearances >= minApps);

      // Apply wonder filters
      if (scope.type === 'wonder') {
        if (scope.wonderType === 'match') eligible = eligible.filter(p => p.appearances === 1);
        else if (scope.wonderType === 'goal') eligible = eligible.filter(p => p.goals === 1);
      }

      // For nationality scopes, we need player info before filtering
      const allUids = eligible.map(p => p.player_uid);
      const nameMap = new Map();
      if (allUids.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < allUids.length; i += batchSize) {
          const batch = allUids.slice(i, i + batchSize);
          const { data: players } = await supabase
            .from('players')
            .select('player_uid, player_name, nationality_norm')
            .in('player_uid', batch);
          if (players) {
            for (const p of players) nameMap.set(p.player_uid, p);
          }
        }
      }

      // Apply nationality filter
      if (scope.type === 'nationality' && scope.nationalityCode) {
        const natCode = scope.nationalityCode.toUpperCase();
        eligible = eligible.filter(p => {
          const player = nameMap.get(p.player_uid);
          return player && (player.nationality_norm || '').toUpperCase() === natCode;
        });
      }

      eligible.sort((a, b) => {
        const d = (b[metric] || 0) - (a[metric] || 0);
        if (d !== 0) return d;
        const ad = b.appearances - a.appearances;
        if (ad !== 0) return ad;
        return b.minutes - a.minutes;
      });

      const topN = eligible.slice(0, count);
      const uids = topN.map(p => p.player_uid);

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
    if (scope.type === 'club') {
      if (!scope.clubId && scope.clubName) {
        scope.clubId = await getClubId(supabase, scope.clubName);
      }
      if (!scope.clubId) {
        return respond(400, { error: `Club not found: ${scope.clubName}` });
      }
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
