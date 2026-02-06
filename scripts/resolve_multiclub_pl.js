#!/usr/bin/env node

/**
 * Multi-Club Player Resolution Script
 *
 * Resolves Premier League players who played for multiple clubs in the same season.
 * Uses SportMonks Football API v3 to fetch per-club stats.
 *
 * Usage:
 *   node scripts/resolve_multiclub_pl.js --input data/multi_club_players.csv
 *   node scripts/resolve_multiclub_pl.js --input data/multi_club_players.csv --limit 5
 *   node scripts/resolve_multiclub_pl.js --input data/multi_club_players.csv --dry-run
 */

const fs = require('fs');
const path = require('path');

// Configuration
const API_TOKEN = process.env.SPORTMONKS_API_TOKEN;
const API_BASE_URL = 'https://api.sportmonks.com/v3/football';
const RATE_LIMIT_MS = 1100; // Stay under 60 requests/minute
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

// Premier League ID in SportMonks
const PREMIER_LEAGUE_ID = 8;

// Cache file paths
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
const PLAYER_CACHE_FILE = path.join(CACHE_DIR, 'player_search_cache.json');
const SEASON_CACHE_FILE = path.join(CACHE_DIR, 'season_cache.json');
const TEAM_CACHE_FILE = path.join(CACHE_DIR, 'team_cache.json');

// Output paths
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'outputs');

// Caches
let playerCache = {};
let seasonCache = {};
let teamCache = {};

// Stats tracking
let stats = {
  totalProcessed: 0,
  resolved: 0,
  unresolved: 0,
  multiClubSplit: 0,       // Count of multi_club_split resolutions
  singleClubAppsOnly: 0,   // Count of single_club_apps_only resolutions
  zeroAppEntries: 0,       // Track 0-appearance team entries
  apiCalls: 0,
  cacheHits: 0,
  errors: [],
  unresolvedReasons: {},
  zeroAppDetails: []       // Details of 0-app entries for audit
};

// Fix mojibake: attempt to repair latin1->utf8 encoding issues
function fixMojibake(str) {
  if (!str) return str;

  // Common mojibake patterns (UTF-8 decoded as Latin-1, then re-encoded)
  // Look for Ã followed by another character, or Â (common mojibake markers)
  const hasMojibake = /Ã[\x80-\xBF]|Â[\x80-\xBF]|Ã©|Ã¨|Ã |Ã¡|Ã¯|Ã´|Ã¶|Ã¼/.test(str);

  if (hasMojibake) {
    try {
      // Convert string to Latin-1 bytes, then decode as UTF-8
      const bytes = Buffer.from(str, 'latin1');
      const fixed = bytes.toString('utf8');
      // Verify it looks better (has fewer replacement chars and is valid)
      if (!fixed.includes('\uFFFD') && fixed.length <= str.length) {
        return fixed;
      }
    } catch (e) {
      // If conversion fails, return original
    }
  }
  return str;
}

// Strip diacritics for search (e.g., "Adlène" -> "Adlene")
function stripDiacritics(str) {
  if (!str) return str;
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Clean and normalize name for search
function normalizeNameForSearch(rawName) {
  let name = fixMojibake(rawName);
  name = name.trim().replace(/\s+/g, ' ');  // Collapse whitespace
  return name;
}

// Build search key (ASCII-safe version for API search)
function buildSearchKey(name) {
  let key = stripDiacritics(name);
  key = key.replace(/[''`]/g, "'");  // Normalize apostrophes
  key = key.trim().replace(/\s+/g, ' ');
  return key;
}

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    input: 'data/multi_club_players.csv',
    limit: null,
    dryRun: false
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      options.input = args[++i];
    } else if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

// Sleep helper for rate limiting
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Load caches from disk
function loadCaches() {
  try {
    if (fs.existsSync(PLAYER_CACHE_FILE)) {
      playerCache = JSON.parse(fs.readFileSync(PLAYER_CACHE_FILE, 'utf8'));
      console.log(`Loaded ${Object.keys(playerCache).length} cached player searches`);
    }
    if (fs.existsSync(SEASON_CACHE_FILE)) {
      seasonCache = JSON.parse(fs.readFileSync(SEASON_CACHE_FILE, 'utf8'));
      console.log(`Loaded ${Object.keys(seasonCache).length} cached seasons`);
    }
    if (fs.existsSync(TEAM_CACHE_FILE)) {
      teamCache = JSON.parse(fs.readFileSync(TEAM_CACHE_FILE, 'utf8'));
      console.log(`Loaded ${Object.keys(teamCache).length} cached teams`);
    }
  } catch (err) {
    console.warn('Warning: Could not load caches:', err.message);
  }
}

// Save caches to disk
function saveCaches() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(PLAYER_CACHE_FILE, JSON.stringify(playerCache, null, 2));
    fs.writeFileSync(SEASON_CACHE_FILE, JSON.stringify(seasonCache, null, 2));
    fs.writeFileSync(TEAM_CACHE_FILE, JSON.stringify(teamCache, null, 2));
    console.log('Caches saved');
  } catch (err) {
    console.warn('Warning: Could not save caches:', err.message);
  }
}

// Make API request with retry logic
async function apiRequest(endpoint, params = {}) {
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  url.searchParams.set('api_token', API_TOKEN);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await sleep(RATE_LIMIT_MS);
      stats.apiCalls++;

      const response = await fetch(url.toString());

      if (response.status === 429) {
        // Rate limited - wait longer
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`  Rate limited, waiting ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw err;
      }
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.log(`  Request failed (attempt ${attempt}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
}

// Parse CSV
function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

// Parse a single CSV line, handling quoted values
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"' && (i === 0 || line[i-1] !== '\\')) {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());

  return values;
}

// Convert season string (e.g., "2017/18") to SportMonks format
function parseSeasonString(seasonStr) {
  const match = seasonStr.match(/(\d{4})\/(\d{2})/);
  if (!match) return null;

  const startYear = parseInt(match[1], 10);
  const endYear = 2000 + parseInt(match[2], 10);

  return { startYear, endYear };
}

// Get Premier League season ID from SportMonks
async function getPremierLeagueSeasonId(seasonStr) {
  const cacheKey = seasonStr;

  if (seasonCache[cacheKey]) {
    stats.cacheHits++;
    return seasonCache[cacheKey];
  }

  const parsed = parseSeasonString(seasonStr);
  if (!parsed) return null;

  // Build expected season name format (e.g., "2017/2018")
  const expectedName = `${parsed.startYear}/${parsed.endYear}`;

  try {
    // Paginate through all seasons to find Premier League ones
    let page = 1;
    const maxPages = 30; // Safety limit

    while (page <= maxPages) {
      const response = await apiRequest('/seasons', {
        'per_page': 50,
        'page': page
      });

      if (!response.data || response.data.length === 0) break;

      // Find matching Premier League season
      for (const season of response.data) {
        if (season.league_id !== PREMIER_LEAGUE_ID) continue;

        const seasonName = season.name || '';
        // Match "2017/2018" format
        if (seasonName === expectedName || seasonName.startsWith(parsed.startYear.toString() + '/')) {
          seasonCache[cacheKey] = {
            id: season.id,
            name: season.name,
            startYear: parsed.startYear,
            endYear: parsed.endYear
          };
          return seasonCache[cacheKey];
        }
      }

      // Check if more pages
      if (!response.pagination || !response.pagination.has_more) break;
      page++;
    }

    return null;
  } catch (err) {
    console.error(`  Error fetching season: ${err.message}`);
    return null;
  }
}

// Search for player by name
async function searchPlayer(playerName) {
  const cacheKey = playerName.toLowerCase().trim();

  if (playerCache[cacheKey]) {
    stats.cacheHits++;
    return playerCache[cacheKey];
  }

  try {
    const response = await apiRequest('/players/search/' + encodeURIComponent(playerName), {
      include: 'nationality'
    });

    const candidates = response.data || [];
    playerCache[cacheKey] = candidates;

    return candidates;
  } catch (err) {
    console.error(`  Error searching player "${playerName}": ${err.message}`);
    return [];
  }
}

// Get player's season statistics with team breakdown
async function getPlayerSeasonStats(playerId, seasonId) {
  try {
    // Get player with all statistics - we'll filter by season locally
    const response = await apiRequest(`/players/${playerId}`, {
      include: 'statistics.details'
    });

    if (!response.data) return null;

    // Filter statistics for the target season
    const playerData = response.data;
    if (playerData.statistics) {
      playerData.filteredStats = playerData.statistics.filter(s => s.season_id === seasonId);
    } else {
      playerData.filteredStats = [];
    }

    return playerData;
  } catch (err) {
    console.error(`  Error fetching player stats: ${err.message}`);
    return null;
  }
}

// Get player statistics by season with team splits
async function getPlayerStatsBySeasonWithTeams(playerId, seasonId) {
  try {
    // Try the statistics endpoint which may have per-team breakdown
    const response = await apiRequest(`/statistics/seasons/players/${playerId}`, {
      'filters[season_id]': seasonId
    });

    return response.data || [];
  } catch (err) {
    console.error(`  Error fetching season stats: ${err.message}`);
    return [];
  }
}

// Alternative: Get player's teams for a season
async function getPlayerTeamsBySeason(playerId, seasonId) {
  try {
    const response = await apiRequest(`/players/${playerId}`, {
      include: 'teams',
      'filters[season_id]': seasonId
    });

    if (response.data && response.data.teams) {
      return response.data.teams;
    }
    return [];
  } catch (err) {
    console.error(`  Error fetching player teams: ${err.message}`);
    return [];
  }
}

// Get detailed statistics for player-team-season combination
async function getDetailedPlayerStats(playerId, seasonId, teamId) {
  try {
    // Try to get statistics filtered by team
    const response = await apiRequest(`/players/${playerId}`, {
      include: 'statistics.details',
      'filters[season_id]': seasonId,
      'filters[team_id]': teamId
    });

    return response.data;
  } catch (err) {
    return null;
  }
}

// Get team info
async function getTeam(teamId) {
  const cacheKey = teamId.toString();

  if (teamCache[cacheKey]) {
    stats.cacheHits++;
    return teamCache[cacheKey];
  }

  try {
    const response = await apiRequest(`/teams/${teamId}`);

    if (response.data) {
      teamCache[cacheKey] = response.data;
      return response.data;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Normalize nationality code
function normalizeNationality(natStr) {
  if (!natStr) return null;

  // Extract 3-letter country code (e.g., "eng ENG" -> "ENG", "fr FRA" -> "FRA")
  const match = natStr.match(/([A-Z]{3})/);
  return match ? match[1] : null;
}

// Calculate birth year from season and age
function calculateBirthYear(seasonStr, ageInSeason) {
  const parsed = parseSeasonString(seasonStr);
  if (!parsed || !ageInSeason) return null;

  // During a season (e.g., 2017/18), the player's age changes
  // So birth year could be startYear - age or startYear - age - 1
  const age = parseInt(ageInSeason, 10);
  return parsed.startYear - age;
}

// Calculate string similarity (Levenshtein-based)
function stringSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1.0;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

// Match player candidate to input row
function scorePlayerMatch(candidate, inputRow) {
  let score = 0.0;
  let factors = [];

  // Name similarity (max 0.4)
  const fullName = candidate.display_name || candidate.common_name || candidate.name || '';
  const nameSim = stringSimilarity(fullName, inputRow.player_name);
  score += nameSim * 0.4;
  factors.push(`name:${nameSim.toFixed(2)}`);

  // Nationality match (max 0.3)
  const inputNat = normalizeNationality(inputRow.nationality);
  const candidateNat = candidate.nationality?.iso2?.toUpperCase() ||
                       candidate.country?.code?.toUpperCase() ||
                       candidate.nationality_id?.toString();

  if (inputNat && candidateNat) {
    // Try to match
    if (candidateNat.includes(inputNat) || inputNat.includes(candidateNat)) {
      score += 0.3;
      factors.push('nat:match');
    }
  }

  // Birth year match (max 0.3)
  const expectedBirthYear = calculateBirthYear(inputRow.season, inputRow.age_in_season);
  const candidateBirthYear = candidate.date_of_birth ?
    parseInt(candidate.date_of_birth.substring(0, 4), 10) : null;

  if (expectedBirthYear && candidateBirthYear) {
    const yearDiff = Math.abs(expectedBirthYear - candidateBirthYear);
    if (yearDiff === 0) {
      score += 0.3;
      factors.push('birth:exact');
    } else if (yearDiff === 1) {
      score += 0.2;
      factors.push('birth:±1');
    } else if (yearDiff === 2) {
      score += 0.1;
      factors.push('birth:±2');
    }
  }

  return { score, factors };
}

// Extract stats from SportMonks statistics object
function extractStats(statsObj) {
  if (!statsObj) return null;

  const details = statsObj.details || [];

  // Extract numeric value from stat - handles nested {total: X} structure
  const findStat = (typeId) => {
    const stat = details.find(d => d.type_id === typeId);
    if (!stat) return null;
    const val = stat.value;
    if (val === null || val === undefined) return null;
    // Handle nested object like {total: 32, goals: 30, penalties: 2}
    if (typeof val === 'object' && val.total !== undefined) {
      return val.total;
    }
    return val;
  };

  // SportMonks stat type IDs:
  // 52 = Goals, 79 = Assists, 119 = Minutes, 321 = Appearances, 322 = Starts
  return {
    appearances: findStat(321), // Appearances
    goals: findStat(52),        // Goals
    assists: findStat(79),      // Assists
    minutes: findStat(119),     // Minutes
    starts: findStat(322),      // Starts/Lineups
    sub_appearances: null       // Calculated: appearances - starts
  };
}

// Process a single multi-club row
async function processRow(row, index, total) {
  // Fix encoding issues in player name
  const playerNameRaw = row.player_name;
  const playerNameFixed = normalizeNameForSearch(playerNameRaw);
  const playerSearchKey = buildSearchKey(playerNameFixed);

  console.log(`\n[${index + 1}/${total}] Processing: ${playerNameRaw} (${row.season})`);
  if (playerNameFixed !== playerNameRaw) {
    console.log(`  Name fixed: "${playerNameRaw}" -> "${playerNameFixed}"`);
  }
  if (playerSearchKey !== playerNameFixed) {
    console.log(`  Search key: "${playerSearchKey}"`);
  }

  const results = {
    resolved: [],
    zeroAppEntries: [],  // Track 0-app entries separately
    unresolved: null,
    playerNameRaw,
    playerNameFixed,
    playerSearchKey
  };

  // Step 1: Get Premier League season ID
  const season = await getPremierLeagueSeasonId(row.season);
  if (!season) {
    results.unresolved = {
      ...row,
      player_name_raw: playerNameRaw,
      player_name_used_for_search: playerSearchKey,
      reason_unresolved: 'Season not found in SportMonks',
      candidate_players: '[]'
    };
    stats.unresolvedReasons['season_not_found'] = (stats.unresolvedReasons['season_not_found'] || 0) + 1;
    return results;
  }
  console.log(`  Season: ${season.name} (ID: ${season.id})`);

  // Step 2: Search for player (try fixed name first, then search key)
  let candidates = await searchPlayer(playerNameFixed);
  if ((!candidates || candidates.length === 0) && playerSearchKey !== playerNameFixed) {
    console.log(`  Retrying search with ASCII key: "${playerSearchKey}"`);
    candidates = await searchPlayer(playerSearchKey);
  }
  if (!candidates || candidates.length === 0) {
    results.unresolved = {
      ...row,
      player_name_raw: playerNameRaw,
      player_name_used_for_search: playerSearchKey,
      reason_unresolved: 'No player matches found',
      candidate_players: '[]'
    };
    stats.unresolvedReasons['no_player_match'] = (stats.unresolvedReasons['no_player_match'] || 0) + 1;
    return results;
  }
  console.log(`  Found ${candidates.length} candidate(s)`);

  // Step 3: Score and rank candidates
  const scoredCandidates = candidates.map(c => ({
    ...c,
    matchScore: scorePlayerMatch(c, row)
  })).sort((a, b) => b.matchScore.score - a.matchScore.score);

  // Log top candidates
  scoredCandidates.slice(0, 3).forEach((c, i) => {
    console.log(`  Candidate ${i + 1}: ${c.display_name || c.common_name} ` +
      `(ID: ${c.id}, Score: ${c.matchScore.score.toFixed(2)}, ` +
      `Factors: ${c.matchScore.factors.join(', ')})`);
  });

  const bestCandidate = scoredCandidates[0];

  // Confidence threshold
  const CONFIDENCE_THRESHOLD = 0.5;

  if (bestCandidate.matchScore.score < CONFIDENCE_THRESHOLD) {
    results.unresolved = {
      ...row,
      reason_unresolved: `Best match score ${bestCandidate.matchScore.score.toFixed(2)} below threshold ${CONFIDENCE_THRESHOLD}`,
      candidate_players: JSON.stringify(scoredCandidates.slice(0, 5).map(c => ({
        id: c.id,
        name: c.display_name || c.common_name,
        score: c.matchScore.score.toFixed(2)
      })))
    };
    stats.unresolvedReasons['low_confidence'] = (stats.unresolvedReasons['low_confidence'] || 0) + 1;
    return results;
  }

  const playerId = bestCandidate.id;
  console.log(`  Selected player ID: ${playerId} (confidence: ${bestCandidate.matchScore.score.toFixed(2)})`);

  // Step 4: Get player's statistics for this season
  const playerData = await getPlayerSeasonStats(playerId, season.id);

  if (!playerData) {
    results.unresolved = {
      ...row,
      player_name_raw: playerNameRaw,
      player_name_used_for_search: playerSearchKey,
      reason_unresolved: 'Could not fetch player data from SportMonks',
      candidate_players: JSON.stringify([{ id: playerId, name: bestCandidate.display_name }])
    };
    stats.unresolvedReasons['api_error'] = (stats.unresolvedReasons['api_error'] || 0) + 1;
    return results;
  }

  // Use filteredStats (already filtered by season_id in getPlayerSeasonStats)
  let teamStats = playerData.filteredStats || [];
  console.log(`  Found ${teamStats.length} stat entries for season ${season.id}`);

  if (teamStats.length === 0) {
    results.unresolved = {
      ...row,
      player_name_raw: playerNameRaw,
      player_name_used_for_search: playerSearchKey,
      reason_unresolved: 'No per-team stats available for this season',
      candidate_players: JSON.stringify([{
        id: playerId,
        name: bestCandidate.display_name,
        score: bestCandidate.matchScore.score.toFixed(2)
      }])
    };
    stats.unresolvedReasons['no_team_split'] = (stats.unresolvedReasons['no_team_split'] || 0) + 1;
    return results;
  }

  // Step 5: Build resolved rows for each team
  const processedTeams = new Set();
  const allTeamEntries = [];  // All entries including 0-app

  for (const teamStat of teamStats) {
    const teamId = teamStat.team_id || teamStat.participant_id;
    if (!teamId || processedTeams.has(teamId)) continue;
    processedTeams.add(teamId);

    const team = await getTeam(teamId);
    const teamName = team?.name || `Team ${teamId}`;

    const extracted = extractStats(teamStat);

    // Treat null/undefined appearances as 0
    const apps = extracted?.appearances ?? 0;

    // Calculate sub_appearances
    if (extracted && apps > 0 && extracted.starts !== null) {
      extracted.sub_appearances = apps - extracted.starts;
    }

    const rowData = {
      player_uid: row.player_uid,
      player_name_raw: playerNameRaw,
      player_name_used_for_search: playerSearchKey,
      player_name: playerNameFixed,
      nationality: normalizeNationality(row.nationality) || row.nationality,
      season: row.season,
      competition: 'Premier League',
      club: teamName,
      appearances: apps,
      goals: extracted?.goals,
      minutes: extracted?.minutes,
      starts: extracted?.starts,
      sub_appearances: extracted?.sub_appearances,
      sportmonks_player_id: playerId,
      sportmonks_season_id: season.id,
      sportmonks_team_id: teamId,
      confidence_score: bestCandidate.matchScore.score.toFixed(2),
      resolution_source: 'sportmonks'
    };

    allTeamEntries.push(rowData);

    // Only include in resolved if appearances > 0
    if (apps > 0) {
      results.resolved.push(rowData);
      console.log(`  Added: ${teamName} - Apps: ${apps}, Goals: ${extracted?.goals}`);
    } else {
      results.zeroAppEntries.push(rowData);
      console.log(`  Skipped (0 apps): ${teamName}`);
    }
  }

  // Determine resolved_type based on number of clubs with apps > 0
  const clubsWithApps = results.resolved.length;
  const resolvedType = clubsWithApps >= 2 ? 'multi_club_split' : 'single_club_apps_only';

  // Add resolved_type to all resolved rows
  for (const resolvedRow of results.resolved) {
    resolvedRow.resolved_type = resolvedType;
  }

  // Validate: Need at least one club with appearances > 0
  if (results.resolved.length === 0) {
    results.unresolved = {
      ...row,
      player_name_raw: playerNameRaw,
      player_name_used_for_search: playerSearchKey,
      reason_unresolved: `No clubs with appearances > 0 found`,
      candidate_players: JSON.stringify([{
        id: playerId,
        name: bestCandidate.display_name,
        teams_found: allTeamEntries.map(r => `${r.club}(${r.appearances})`)
      }])
    };
    stats.unresolvedReasons['no_apps_found'] = (stats.unresolvedReasons['no_apps_found'] || 0) + 1;
    return results;
  }

  // Validate: Sum of resolved apps should approximately match original
  const originalApps = parseInt(row.appearances) || 0;
  const resolvedApps = results.resolved.reduce((sum, r) => sum + (r.appearances || 0), 0);
  const appsTolerance = Math.max(2, originalApps * 0.1);  // 10% or at least 2

  if (originalApps > 0 && Math.abs(resolvedApps - originalApps) > appsTolerance) {
    console.log(`  Warning: Apps mismatch - original: ${originalApps}, resolved: ${resolvedApps}`);
  }

  // Track resolved type
  results.resolvedType = resolvedType;
  console.log(`  Resolved as: ${resolvedType} (${clubsWithApps} club(s) with apps)`);

  return results;
}

// Convert array to CSV
function toCSV(rows, columns) {
  if (rows.length === 0) return '';

  const headers = columns || Object.keys(rows[0]);
  const csvLines = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Quote if contains comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    csvLines.push(values.join(','));
  }

  return csvLines.join('\n');
}

// Generate audit report
function generateAuditReport(resolvedRows, unresolvedRows) {
  const totalRows = stats.totalProcessed;
  const resolvedCount = stats.resolved;
  const unresolvedCount = stats.unresolved;
  const resolutionRate = totalRows > 0 ? (resolvedCount / totalRows * 100).toFixed(1) : 0;

  let report = `# Multi-Club Player Resolution Audit Report

Generated: ${new Date().toISOString()}

## Summary

| Metric | Value |
|--------|-------|
| Total Rows Processed | ${totalRows} |
| Successfully Resolved | ${resolvedCount} |
| Unresolved | ${unresolvedCount} |
| Resolution Rate | ${resolutionRate}% |
| API Calls Made | ${stats.apiCalls} |
| Cache Hits | ${stats.cacheHits} |

## Resolution Types

| Type | Count | Description |
|------|-------|-------------|
| multi_club_split | ${stats.multiClubSplit} | 2+ clubs with appearances > 0 |
| single_club_apps_only | ${stats.singleClubAppsOnly} | Only 1 club with apps > 0 (other clubs had 0) |
| Zero-Appearance Entries Excluded | ${stats.zeroAppEntries} | Team entries with 0 apps, not in output |

## Unresolved Reasons

| Reason | Count |
|--------|-------|
`;

  for (const [reason, count] of Object.entries(stats.unresolvedReasons)) {
    report += `| ${reason} | ${count} |\n`;
  }

  report += `
## Resolved Rows by Original Player

`;

  // Group resolved rows by player_uid
  const byPlayer = {};
  for (const row of resolvedRows) {
    if (!byPlayer[row.player_uid]) {
      byPlayer[row.player_uid] = [];
    }
    byPlayer[row.player_uid].push(row);
  }

  for (const [playerUid, rows] of Object.entries(byPlayer)) {
    const totalApps = rows.reduce((sum, r) => sum + (parseInt(r.appearances) || 0), 0);
    const totalGoals = rows.reduce((sum, r) => sum + (parseInt(r.goals) || 0), 0);

    report += `### ${rows[0].player_name} (${rows[0].season})

| Club | Apps | Goals | Minutes | Confidence |
|------|------|-------|---------|------------|
`;

    for (const row of rows) {
      report += `| ${row.club} | ${row.appearances || '-'} | ${row.goals || '-'} | ${row.minutes || '-'} | ${row.confidence_score} |\n`;
    }

    report += `| **Total** | **${totalApps}** | **${totalGoals}** | | |\n\n`;
  }

  // Add zero-appearance entries section if any
  if (stats.zeroAppDetails.length > 0) {
    report += `
## Zero-Appearance Entries (Excluded from Output)

These team entries had 0 appearances and were excluded from resolved_multiclub_rows.csv:

| Player | Season | Club | SportMonks Player ID |
|--------|--------|------|---------------------|
`;
    for (const entry of stats.zeroAppDetails) {
      report += `| ${entry.player_name} | ${entry.season} | ${entry.club} | ${entry.sportmonks_player_id} |\n`;
    }
  }

  report += `
## Notes

- Confidence scores range from 0.0 to 1.0
- Confidence is based on: name similarity (40%), nationality match (30%), birth year match (30%)
- Rows with confidence below 0.5 are marked as unresolved
- Per-club stats should sum approximately to the original season totals
- NULL values indicate the stat was not available from SportMonks
- Zero-appearance team entries are excluded from output but logged in audit

## Edge Cases

- Players with non-ASCII characters in names may have lower match confidence
- Some historical seasons may have limited data in SportMonks
- Loan spells may or may not be tracked separately depending on the data source
`;

  return report;
}

// Main function
async function main() {
  console.log('='.repeat(60));
  console.log('Multi-Club Player Resolution Script');
  console.log('='.repeat(60));

  // Check API token
  if (!API_TOKEN) {
    console.error('ERROR: SPORTMONKS_API_TOKEN environment variable not set');
    process.exit(1);
  }

  // Parse arguments
  const options = parseArgs();
  console.log(`\nOptions:`);
  console.log(`  Input: ${options.input}`);
  console.log(`  Limit: ${options.limit || 'none'}`);
  console.log(`  Dry run: ${options.dryRun}`);

  // Resolve input path
  const inputPath = path.isAbsolute(options.input) ?
    options.input :
    path.join(__dirname, '..', options.input);

  // Read input file
  if (!fs.existsSync(inputPath)) {
    console.error(`ERROR: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const inputContent = fs.readFileSync(inputPath, 'utf8');
  let rows = parseCSV(inputContent);
  console.log(`\nLoaded ${rows.length} rows from input file`);

  // Apply limit
  if (options.limit) {
    rows = rows.slice(0, options.limit);
    console.log(`Limited to ${rows.length} rows`);
  }

  // Load caches
  loadCaches();

  // Process rows
  const resolvedRows = [];
  const unresolvedRows = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    stats.totalProcessed++;

    try {
      const result = await processRow(row, i, rows.length);

      if (result.resolved.length > 0) {
        resolvedRows.push(...result.resolved);
        stats.resolved++;

        // Track resolved type
        if (result.resolvedType === 'multi_club_split') {
          stats.multiClubSplit++;
        } else if (result.resolvedType === 'single_club_apps_only') {
          stats.singleClubAppsOnly++;
        }
      }

      // Track zero-app entries
      if (result.zeroAppEntries && result.zeroAppEntries.length > 0) {
        stats.zeroAppEntries += result.zeroAppEntries.length;
        stats.zeroAppDetails.push(...result.zeroAppEntries);
      }

      if (result.unresolved) {
        unresolvedRows.push(result.unresolved);
        stats.unresolved++;
      }
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      stats.errors.push({ row: i, error: err.message });
      unresolvedRows.push({
        ...row,
        player_name_raw: row.player_name,
        player_name_used_for_search: row.player_name,
        reason_unresolved: `Processing error: ${err.message}`,
        candidate_players: '[]'
      });
      stats.unresolved++;
    }

    // Save caches periodically
    if ((i + 1) % 10 === 0) {
      saveCaches();
    }
  }

  // Final cache save
  saveCaches();

  // Generate outputs
  console.log('\n' + '='.repeat(60));
  console.log('Generating Output Files');
  console.log('='.repeat(60));

  if (!options.dryRun) {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Write resolved rows
    const resolvedColumns = [
      'player_uid', 'player_name_raw', 'player_name_used_for_search', 'player_name',
      'nationality', 'season', 'competition', 'club',
      'appearances', 'goals', 'minutes', 'starts', 'sub_appearances',
      'sportmonks_player_id', 'sportmonks_season_id', 'sportmonks_team_id',
      'confidence_score', 'resolution_source', 'resolved_type'
    ];
    const resolvedCSV = toCSV(resolvedRows, resolvedColumns);
    const resolvedPath = path.join(OUTPUT_DIR, 'resolved_multiclub_rows.csv');
    fs.writeFileSync(resolvedPath, resolvedCSV);
    console.log(`Written: ${resolvedPath} (${resolvedRows.length} rows)`);

    // Write unresolved rows
    if (unresolvedRows.length > 0) {
      const unresolvedCSV = toCSV(unresolvedRows);
      const unresolvedPath = path.join(OUTPUT_DIR, 'unresolved_multiclub_rows.csv');
      fs.writeFileSync(unresolvedPath, unresolvedCSV);
      console.log(`Written: ${unresolvedPath} (${unresolvedRows.length} rows)`);
    }

    // Write audit report
    const auditReport = generateAuditReport(resolvedRows, unresolvedRows);
    const auditPath = path.join(OUTPUT_DIR, 'audit_report.md');
    fs.writeFileSync(auditPath, auditReport);
    console.log(`Written: ${auditPath}`);
  } else {
    console.log('DRY RUN - No files written');
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total processed: ${stats.totalProcessed}`);
  console.log(`Resolved: ${stats.resolved}`);
  console.log(`  - multi_club_split: ${stats.multiClubSplit}`);
  console.log(`  - single_club_apps_only: ${stats.singleClubAppsOnly}`);
  console.log(`Unresolved: ${stats.unresolved}`);
  console.log(`Zero-app entries excluded: ${stats.zeroAppEntries}`);
  console.log(`Resolution rate: ${(stats.resolved / stats.totalProcessed * 100).toFixed(1)}%`);
  console.log(`API calls: ${stats.apiCalls}`);
  console.log(`Cache hits: ${stats.cacheHits}`);

  if (Object.keys(stats.unresolvedReasons).length > 0) {
    console.log('\nUnresolved reasons:');
    for (const [reason, count] of Object.entries(stats.unresolvedReasons)) {
      console.log(`  ${reason}: ${count}`);
    }
  }
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
