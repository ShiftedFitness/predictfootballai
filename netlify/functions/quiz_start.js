/**
 * quiz_start.js — Pop Quiz football trivia game
 *
 * Endpoints (via `action` field in POST body):
 *   generate_quiz  → Returns 5 multiple-choice questions for a given scope,
 *                     increasing in difficulty (2 easy, 2 medium, 1 hard).
 *
 * Questions are generated dynamically from the Supabase database
 * using real Premier League statistics.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

// ============================================================
// HELPERS
// ============================================================

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

/**
 * Fix mojibake: re-decode UTF-8 bytes stored as Latin-1
 */
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

/**
 * Shuffle an array in place (Fisher-Yates).
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick n random items from an array without replacement.
 */
function pickRandom(arr, n) {
  const copy = [...arr];
  shuffle(copy);
  return copy.slice(0, n);
}

/**
 * Generate plausible wrong numeric options around the correct answer.
 * Ensures all options are positive integers and distinct.
 */
function generateNumericOptions(correct, count = 3) {
  const options = new Set();
  // Generate offsets that scale with the magnitude of the answer
  const magnitude = Math.max(1, Math.floor(correct * 0.15));
  let attempts = 0;
  while (options.size < count && attempts < 100) {
    // Mix of small and larger offsets for plausibility
    const offsetRange = Math.max(3, magnitude);
    const offset = Math.floor(Math.random() * offsetRange * 2) - offsetRange;
    const candidate = correct + offset;
    if (candidate > 0 && candidate !== correct && !options.has(candidate)) {
      options.add(candidate);
    }
    attempts++;
  }
  // Fallback: fill remaining with sequential offsets
  let fallback = 1;
  while (options.size < count) {
    const candidate = correct + fallback;
    if (candidate > 0 && !options.has(candidate)) options.add(candidate);
    fallback = fallback > 0 ? -fallback : -fallback + 1;
  }
  return Array.from(options);
}

/**
 * Generate range-based answer options for numeric questions.
 * Instead of exact numbers, produces ranges like "Below 200", "200–220", "220–240", "Above 240".
 * Returns { correctRange, wrongRanges, allRanges } with the correct range label.
 */
function generateRangeOptions(correct) {
  // Determine a sensible step size based on the magnitude of the answer
  // For numbers <20, step=3; <50 step=5; <100 step=10; <300 step=20; else step based on magnitude
  let step;
  if (correct < 15) step = 2;
  else if (correct < 30) step = 3;
  else if (correct < 60) step = 5;
  else if (correct < 150) step = 10;
  else if (correct < 400) step = 20;
  else if (correct < 1000) step = 50;
  else step = Math.round(correct * 0.05 / 10) * 10 || 50;

  // Find the range that contains the correct answer
  // Build ranges: the correct answer falls in one range, then we have 3 others
  const rangeStart = Math.floor(correct / step) * step;
  const rangeEnd = rangeStart + step;

  // Build 4 contiguous ranges centered around the correct one
  // Randomly offset so the correct one isn't always in the same position
  const offsets = [-1, 0, 1, 2]; // these create 4 ranges
  // Randomly shift the window so correct range position varies
  const shift = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
  const ranges = offsets.map(o => {
    const s = rangeStart + (o + shift) * step;
    const e = s + step;
    return { start: s, end: e };
  });

  // Ensure no negative ranges
  const filteredRanges = ranges.filter(r => r.end > 0);
  if (filteredRanges.length < 4) {
    // Fallback: build ranges starting from a low point
    const baseStart = Math.max(0, rangeStart - step);
    filteredRanges.length = 0;
    for (let i = 0; i < 4; i++) {
      filteredRanges.push({ start: baseStart + i * step, end: baseStart + (i + 1) * step });
    }
  }

  // Format range labels
  const labels = filteredRanges.map((r, i) => {
    if (i === 0 && r.start <= 0) return `Below ${r.end}`;
    if (i === filteredRanges.length - 1) return `${r.start}+`;
    return `${r.start} – ${r.end - 1}`;
  });

  // Find which label contains the correct answer
  let correctIdx = filteredRanges.findIndex(r => correct >= r.start && correct < r.end);
  if (correctIdx === -1) correctIdx = 0; // safety fallback

  const correctLabel = labels[correctIdx];
  const wrongLabels = labels.filter((_, i) => i !== correctIdx);

  return { correctLabel, wrongLabels };
}

/**
 * Build a question object with shuffled options.
 * correctAnswer is the correct string, wrongAnswers is an array of 3 strings.
 */
function buildQuestion(questionText, correctAnswer, wrongAnswers, difficulty) {
  const correctStr = String(correctAnswer);
  const allOptions = [correctStr, ...wrongAnswers.map(String)];
  shuffle(allOptions);
  const answerIndex = allOptions.indexOf(correctStr);
  return {
    q: questionText,
    options: allOptions,
    answer: answerIndex,
    difficulty,
  };
}

// ============================================================
// SCOPE DEFINITIONS
// ============================================================

const SCOPES = [
  { id: 'epl_alltime', label: 'Premier League (All-time)', type: 'league', clubName: null },
  { id: 'club_sunderland', label: 'Sunderland', type: 'club', clubName: 'Sunderland' },
  { id: 'club_manutd', label: 'Manchester United', type: 'club', clubName: 'Manchester United' },
  { id: 'club_arsenal', label: 'Arsenal', type: 'club', clubName: 'Arsenal' },
  { id: 'club_liverpool', label: 'Liverpool', type: 'club', clubName: 'Liverpool' },
  { id: 'club_chelsea', label: 'Chelsea', type: 'club', clubName: 'Chelsea' },
];

const CLUB_NAME_ALIASES = {
  'Manchester United': ['Manchester Utd', 'Man United', 'Man Utd'],
  'Manchester City': ['Manchester City', 'Man City'],
  'Newcastle United': ['Newcastle Utd'],
  'Tottenham Hotspur': ['Tottenham', 'Spurs'],
  'West Ham United': ['West Ham'],
  'West Bromwich Albion': ['West Brom'],
  'Sheffield United': ['Sheffield Utd'],
  'Wolverhampton Wanderers': ['Wolves'],
  'Brighton & Hove Albion': ['Brighton'],
  'AFC Bournemouth': ['Bournemouth'],
};

// ============================================================
// DB LOOKUPS
// ============================================================

async function getClubId(supabase, clubName) {
  let { data } = await supabase
    .from('clubs')
    .select('club_id')
    .eq('club_name', clubName)
    .single();
  if (data) return data.club_id;

  ({ data } = await supabase
    .from('clubs')
    .select('club_id')
    .ilike('club_name', clubName)
    .limit(1));
  if (data && data.length > 0) return data[0].club_id;

  const aliases = CLUB_NAME_ALIASES[clubName] || [];
  for (const alias of aliases) {
    ({ data } = await supabase
      .from('clubs')
      .select('club_id')
      .ilike('club_name', alias)
      .limit(1));
    if (data && data.length > 0) return data[0].club_id;
  }

  ({ data } = await supabase
    .from('clubs')
    .select('club_id, club_name')
    .ilike('club_name', `%${clubName}%`)
    .limit(1));
  if (data && data.length > 0) return data[0].club_id;

  return null;
}

async function getEplCompId(supabase) {
  const { data, error } = await supabase
    .from('competitions')
    .select('competition_id')
    .eq('competition_name', 'Premier League')
    .single();
  if (error || !data) return null;
  return data.competition_id;
}

// ============================================================
// DATA FETCHING FOR QUIZ
// ============================================================

/**
 * Fetch all player_season_stats rows for the scope, with player names joined.
 * Returns raw rows; callers aggregate as needed.
 */
async function fetchScopedStats(supabase, competitionId, scope) {
  const buildQuery = () => {
    let q = supabase
      .from('player_season_stats')
      .select('player_uid, season_start_year, appearances, goals, assists, minutes, position_bucket, club_id')
      .eq('competition_id', competitionId)
      .gt('appearances', 0);
    if (scope.type === 'club' && scope.clubId) {
      q = q.eq('club_id', scope.clubId);
    }
    return q;
  };
  return fetchAll(buildQuery);
}

/**
 * Fetch player names for a set of player_uids.
 * Returns a Map of player_uid -> { player_name, nationality_norm }.
 */
async function fetchPlayerNames(supabase, uids) {
  const nameMap = new Map();
  const batchSize = 500;
  for (let i = 0; i < uids.length; i += batchSize) {
    const batch = uids.slice(i, i + batchSize);
    const { data: players } = await supabase
      .from('players')
      .select('player_uid, player_name, nationality_norm')
      .in('player_uid', batch);
    if (players) {
      for (const p of players) {
        nameMap.set(p.player_uid, {
          player_name: fixMojibake(p.player_name),
          nationality_norm: p.nationality_norm || '',
        });
      }
    }
  }
  return nameMap;
}

// ============================================================
// QUESTION GENERATORS
// ============================================================

// Each generator is an async function that receives (stats, nameMap, scopeLabel, scope)
// and returns a question object, or null if insufficient data.

// ------ EASY ------

async function qCountSeasons(stats, nameMap, scopeLabel, scope) {
  const seasons = new Set(stats.map(r => r.season_start_year));
  const correct = seasons.size;
  if (correct < 2) return null;

  const { correctLabel, wrongLabels } = generateRangeOptions(correct);
  const subject = scope.type === 'club' ? scopeLabel : 'the Premier League';
  return buildQuestion(
    `How many Premier League seasons has ${subject} had?`,
    correctLabel,
    wrongLabels,
    'easy'
  );
}

async function qTopScorer(stats, nameMap, scopeLabel, scope) {
  // Aggregate goals per player
  const goalMap = new Map();
  for (const r of stats) {
    goalMap.set(r.player_uid, (goalMap.get(r.player_uid) || 0) + (r.goals || 0));
  }
  // Sort descending
  const sorted = Array.from(goalMap.entries())
    .map(([uid, goals]) => ({ uid, goals }))
    .sort((a, b) => b.goals - a.goals);

  if (sorted.length < 4) return null;

  const topPlayer = nameMap.get(sorted[0].uid);
  if (!topPlayer) return null;
  const correctName = topPlayer.player_name;

  // Pick 3 other high-scoring players as wrong answers
  const wrongCandidates = sorted.slice(1, 15);
  const wrongPicks = pickRandom(wrongCandidates, 3);
  const wrongNames = wrongPicks.map(p => {
    const info = nameMap.get(p.uid);
    return info ? info.player_name : 'Unknown';
  }).filter(n => n !== 'Unknown' && n !== correctName);

  // If we don't have 3 distinct wrong answers, fill from further down the list
  let idx = 15;
  while (wrongNames.length < 3 && idx < sorted.length) {
    const info = nameMap.get(sorted[idx].uid);
    if (info && info.player_name !== correctName && !wrongNames.includes(info.player_name)) {
      wrongNames.push(info.player_name);
    }
    idx++;
  }
  if (wrongNames.length < 3) return null;

  const subject = scope.type === 'club'
    ? `${scopeLabel}'s all-time top Premier League goalscorer`
    : 'the all-time top Premier League goalscorer';
  return buildQuestion(
    `Who is ${subject}?`,
    correctName,
    wrongNames.slice(0, 3),
    'easy'
  );
}

async function qCountPlayers(stats, nameMap, scopeLabel, scope) {
  const players = new Set(stats.map(r => r.player_uid));
  const correct = players.size;
  if (correct < 10) return null;

  const { correctLabel, wrongLabels } = generateRangeOptions(correct);
  const subject = scope.type === 'club'
    ? `have represented ${scopeLabel}`
    : 'have played';
  return buildQuestion(
    `Roughly how many players ${subject} in the Premier League?`,
    correctLabel,
    wrongLabels,
    'easy'
  );
}

// ------ MEDIUM ------

async function qMostAppearances(stats, nameMap, scopeLabel, scope) {
  const appMap = new Map();
  for (const r of stats) {
    appMap.set(r.player_uid, (appMap.get(r.player_uid) || 0) + (r.appearances || 0));
  }
  const sorted = Array.from(appMap.entries())
    .map(([uid, apps]) => ({ uid, apps }))
    .sort((a, b) => b.apps - a.apps);

  if (sorted.length < 4) return null;

  const topPlayer = nameMap.get(sorted[0].uid);
  if (!topPlayer) return null;
  const correctName = topPlayer.player_name;

  const wrongCandidates = sorted.slice(1, 15);
  const wrongPicks = pickRandom(wrongCandidates, 3);
  const wrongNames = wrongPicks
    .map(p => { const info = nameMap.get(p.uid); return info ? info.player_name : null; })
    .filter(n => n && n !== correctName);

  let idx = 15;
  while (wrongNames.length < 3 && idx < sorted.length) {
    const info = nameMap.get(sorted[idx].uid);
    if (info && info.player_name !== correctName && !wrongNames.includes(info.player_name)) {
      wrongNames.push(info.player_name);
    }
    idx++;
  }
  if (wrongNames.length < 3) return null;

  const subject = scope.type === 'club'
    ? `the most Premier League appearances for ${scopeLabel}`
    : 'the most Premier League appearances';
  return buildQuestion(
    `Who has ${subject}?`,
    correctName,
    wrongNames.slice(0, 3),
    'medium'
  );
}

async function qMostCommonPosition(stats, nameMap, scopeLabel, scope) {
  // Count distinct players per position_bucket
  const posPlayers = new Map(); // bucket -> Set of player_uids
  for (const r of stats) {
    if (!r.position_bucket) continue;
    if (!posPlayers.has(r.position_bucket)) posPlayers.set(r.position_bucket, new Set());
    posPlayers.get(r.position_bucket).add(r.player_uid);
  }

  const sorted = Array.from(posPlayers.entries())
    .map(([bucket, players]) => ({ bucket, count: players.size }))
    .sort((a, b) => b.count - a.count);

  if (sorted.length < 3) return null;

  const BUCKET_LABELS = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };
  const correct = BUCKET_LABELS[sorted[0].bucket] || sorted[0].bucket;
  const wrongs = sorted.slice(1)
    .map(s => BUCKET_LABELS[s.bucket] || s.bucket)
    .filter(l => l !== correct);

  // Ensure we have exactly 3 wrong options
  const allLabels = Object.values(BUCKET_LABELS);
  for (const label of allLabels) {
    if (wrongs.length >= 3) break;
    if (label !== correct && !wrongs.includes(label)) {
      wrongs.push(label);
    }
  }
  if (wrongs.length < 3) return null;

  const subject = scope.type === 'club'
    ? scopeLabel
    : 'the Premier League';
  return buildQuestion(
    `Which position has had the most players at ${subject}?`,
    correct,
    wrongs.slice(0, 3),
    'medium'
  );
}

async function qLongestCareer(stats, nameMap, scopeLabel, scope) {
  // Count distinct seasons per player
  const playerSeasons = new Map(); // uid -> Set of seasons
  for (const r of stats) {
    if (!playerSeasons.has(r.player_uid)) playerSeasons.set(r.player_uid, new Set());
    playerSeasons.get(r.player_uid).add(r.season_start_year);
  }

  const sorted = Array.from(playerSeasons.entries())
    .map(([uid, seasons]) => ({ uid, seasons: seasons.size }))
    .sort((a, b) => b.seasons - a.seasons);

  if (sorted.length < 4) return null;

  const topPlayer = nameMap.get(sorted[0].uid);
  if (!topPlayer) return null;
  const correctName = topPlayer.player_name;

  const wrongCandidates = sorted.slice(1, 15);
  const wrongPicks = pickRandom(wrongCandidates, 3);
  const wrongNames = wrongPicks
    .map(p => { const info = nameMap.get(p.uid); return info ? info.player_name : null; })
    .filter(n => n && n !== correctName);

  let idx = 15;
  while (wrongNames.length < 3 && idx < sorted.length) {
    const info = nameMap.get(sorted[idx].uid);
    if (info && info.player_name !== correctName && !wrongNames.includes(info.player_name)) {
      wrongNames.push(info.player_name);
    }
    idx++;
  }
  if (wrongNames.length < 3) return null;

  const subject = scope.type === 'club'
    ? `the longest EPL career at ${scopeLabel} in seasons`
    : 'the longest EPL career in seasons';
  return buildQuestion(
    `Which player had ${subject}?`,
    correctName,
    wrongNames.slice(0, 3),
    'medium'
  );
}

// ------ HARD ------

async function qCountNationalities(stats, nameMap, scopeLabel, scope) {
  // Use nationality_norm from nameMap (more reliable than nationality_code)
  const nationalities = new Set();
  for (const r of stats) {
    const info = nameMap.get(r.player_uid);
    if (info && info.nationality_norm) {
      nationalities.add(info.nationality_norm.toUpperCase());
    }
  }
  const correct = nationalities.size;
  if (correct < 5) return null;

  const { correctLabel, wrongLabels } = generateRangeOptions(correct);
  const subject = scope.type === 'club'
    ? `have played for ${scopeLabel}`
    : 'have played';
  return buildQuestion(
    `Roughly how many different nationalities ${subject} in the Premier League?`,
    correctLabel,
    wrongLabels,
    'hard'
  );
}

async function qMostCommonNonEnglish(stats, nameMap, scopeLabel, scope) {
  // Count distinct players per nationality, excluding English
  const natPlayers = new Map(); // nationality -> Set of player_uids
  for (const r of stats) {
    const info = nameMap.get(r.player_uid);
    if (!info || !info.nationality_norm) continue;
    const nat = info.nationality_norm.toUpperCase();
    if (nat === 'ENG' || nat === 'ENGLAND' || nat === 'ENGLISH') continue;
    if (!natPlayers.has(nat)) natPlayers.set(nat, new Set());
    natPlayers.get(nat).add(r.player_uid);
  }

  const sorted = Array.from(natPlayers.entries())
    .map(([nat, players]) => ({ nat, count: players.size }))
    .sort((a, b) => b.count - a.count);

  if (sorted.length < 4) return null;

  const correct = sorted[0].nat;
  const wrongPicks = pickRandom(sorted.slice(1, 10), 3);
  const wrongs = wrongPicks.map(p => p.nat).filter(n => n !== correct);

  let idx = 10;
  while (wrongs.length < 3 && idx < sorted.length) {
    if (sorted[idx].nat !== correct && !wrongs.includes(sorted[idx].nat)) {
      wrongs.push(sorted[idx].nat);
    }
    idx++;
  }
  if (wrongs.length < 3) return null;

  const subject = scope.type === 'club'
    ? `${scopeLabel} players`
    : 'Premier League players';
  return buildQuestion(
    `What is the most common nationality (after English) for ${subject}?`,
    correct,
    wrongs.slice(0, 3),
    'hard'
  );
}

async function qTopScorerSingleSeason(stats, nameMap, scopeLabel, scope) {
  // Find the player with most goals in a single season
  const seasonGoals = stats
    .filter(r => (r.goals || 0) > 0)
    .map(r => ({
      uid: r.player_uid,
      goals: r.goals || 0,
      season: r.season_start_year,
    }))
    .sort((a, b) => b.goals - a.goals);

  if (seasonGoals.length < 4) return null;

  const topEntry = seasonGoals[0];
  const topPlayer = nameMap.get(topEntry.uid);
  if (!topPlayer) return null;
  const correctName = topPlayer.player_name;

  // Pick wrong answers from other top single-season scorers (different players)
  const seen = new Set([topEntry.uid]);
  const wrongNames = [];
  for (const entry of seasonGoals.slice(1)) {
    if (seen.has(entry.uid)) continue;
    seen.add(entry.uid);
    const info = nameMap.get(entry.uid);
    if (info && info.player_name !== correctName && !wrongNames.includes(info.player_name)) {
      wrongNames.push(info.player_name);
    }
    if (wrongNames.length >= 3) break;
  }
  if (wrongNames.length < 3) return null;

  const subject = scope.type === 'club'
    ? `for ${scopeLabel}`
    : 'in the Premier League';
  return buildQuestion(
    `Which player scored the most goals in a single season ${subject}?`,
    correctName,
    wrongNames.slice(0, 3),
    'hard'
  );
}

// ============================================================
// QUIZ GENERATION
// ============================================================

const EASY_GENERATORS = [qCountSeasons, qTopScorer, qCountPlayers];
const MEDIUM_GENERATORS = [qMostAppearances, qMostCommonPosition, qLongestCareer];
const HARD_GENERATORS = [qCountNationalities, qMostCommonNonEnglish, qTopScorerSingleSeason];

/**
 * Try generators from a pool until we get the required number of questions.
 * Randomizes the order so each quiz feels different.
 */
async function generateFromPool(pool, needed, stats, nameMap, scopeLabel, scope) {
  const shuffled = shuffle([...pool]);
  const questions = [];
  for (const gen of shuffled) {
    if (questions.length >= needed) break;
    try {
      const q = await gen(stats, nameMap, scopeLabel, scope);
      if (q) questions.push(q);
    } catch (err) {
      console.error(`[quiz] Generator ${gen.name} error:`, err.message);
    }
  }
  return questions;
}

/**
 * Generate 5 quiz questions: 2 easy, 2 medium, 1 hard.
 */
async function generateQuiz(supabase, scopeId) {
  const scopeDef = SCOPES.find(s => s.id === scopeId);
  if (!scopeDef) throw new Error(`Unknown scope: ${scopeId}`);

  const competitionId = await getEplCompId(supabase);
  if (!competitionId) throw new Error('Premier League competition not found');

  // Resolve club_id if needed
  const scope = { ...scopeDef };
  if (scope.type === 'club' && scope.clubName) {
    scope.clubId = await getClubId(supabase, scope.clubName);
    if (!scope.clubId) throw new Error(`Club not found: ${scope.clubName}`);
  }

  const scopeLabel = scope.type === 'club' ? scope.clubName : 'the Premier League';

  // Fetch all stats for this scope
  const stats = await fetchScopedStats(supabase, competitionId, scope);
  if (!stats || stats.length === 0) {
    throw new Error('No stats data available for this scope');
  }

  // Fetch player names for all unique player_uids in the stats
  const uniqueUids = [...new Set(stats.map(r => r.player_uid))];
  const nameMap = await fetchPlayerNames(supabase, uniqueUids);

  // Generate questions by difficulty
  const easyQs = await generateFromPool(EASY_GENERATORS, 2, stats, nameMap, scopeLabel, scope);
  const mediumQs = await generateFromPool(MEDIUM_GENERATORS, 2, stats, nameMap, scopeLabel, scope);
  const hardQs = await generateFromPool(HARD_GENERATORS, 1, stats, nameMap, scopeLabel, scope);

  // If we didn't get enough in a tier, try to fill from adjacent tiers
  const allQuestions = [...easyQs, ...mediumQs, ...hardQs];

  // If we have fewer than 5, try remaining generators from any pool
  if (allQuestions.length < 5) {
    const usedGenerators = new Set();
    for (const q of allQuestions) usedGenerators.add(q); // questions themselves aren't generators, but we track by count
    const allGenerators = [...EASY_GENERATORS, ...MEDIUM_GENERATORS, ...HARD_GENERATORS];
    const remainingGenerators = shuffle(allGenerators.filter(gen => {
      // Try generators that haven't already produced a question
      // (simple heuristic: try all of them, duplicates will be filtered by content)
      return true;
    }));

    for (const gen of remainingGenerators) {
      if (allQuestions.length >= 5) break;
      try {
        const q = await gen(stats, nameMap, scopeLabel, scope);
        if (q) {
          // Avoid duplicate question text
          const isDup = allQuestions.some(existing => existing.q === q.q);
          if (!isDup) allQuestions.push(q);
        }
      } catch (_) { /* skip */ }
    }
  }

  // Sort by difficulty order: easy first, then medium, then hard
  const diffOrder = { easy: 0, medium: 1, hard: 2 };
  allQuestions.sort((a, b) => (diffOrder[a.difficulty] || 0) - (diffOrder[b.difficulty] || 0));

  return {
    scope: { id: scope.id, label: scope.label, type: scope.type },
    questions: allQuestions.slice(0, 5),
    totalQuestions: Math.min(allQuestions.length, 5),
  };
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
    const { action } = body;

    console.log('[quiz_start] Action:', action);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return respond(500, { error: 'Missing Supabase config' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ============================================================
    // GENERATE QUIZ
    // ============================================================
    if (action === 'generate_quiz') {
      const { scopeId } = body;

      if (!scopeId) {
        return respond(400, { error: 'Missing scopeId' });
      }

      const result = await generateQuiz(supabase, scopeId);
      return respond(200, result);
    }

    return respond(400, { error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('[quiz_start] Error:', err);
    return respond(500, { error: err.message });
  }
};
