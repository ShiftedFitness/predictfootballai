#!/usr/bin/env node

/**
 * ingest_current_season.js
 *
 * Scrapes FBref for current-season (2025/26) player stats across 6 leagues
 * and upserts into Supabase `current_season_player_stats` table.
 *
 * Usage:
 *   node scripts/ingest_current_season.js [--league <league>] [--dry-run] [--local]
 *
 * Options:
 *   --league <name>   Only ingest one league (epl|laliga|seriea|bundesliga|ligue1|ucl)
 *   --dry-run         Parse and log but don't write to Supabase
 *   --verbose         Extra logging
 *   --local           Read HTML from data/fbref/ instead of fetching from FBref
 *                     (use this if FBref/Cloudflare blocks automated requests)
 *
 * Local mode workflow:
 *   1. Run with --local and it will tell you which pages to save
 *   2. Save each FBref page as HTML from your browser to data/fbref/
 *   3. Run again with --local to process the saved files
 *
 * Prerequisites:
 *   npm install cheerio node-fetch@2
 *   Environment variables: Supabase_Project_URL, Supabase_Service_Role
 *
 * FBref rate limit: ~3s between requests to be polite.
 */

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// ─── Configuration ───────────────────────────────────────────────────────────

const SEASON_LABEL = '2025/26';
const SEASON_START_YEAR = 2025;

// FBref competition IDs and our Supabase competition_id mapping
const LEAGUES = {
  epl:        { fbref: 9,  compId: 7,  name: 'Premier League',   slug: 'Premier-League-Stats' },
  laliga:     { fbref: 12, compId: 1,  name: 'La Liga',          slug: 'La-Liga-Stats' },
  seriea:     { fbref: 11, compId: 3,  name: 'Serie A',          slug: 'Serie-A-Stats' },
  bundesliga: { fbref: 20, compId: 9,  name: 'Bundesliga',       slug: 'Bundesliga-Stats' },
  ligue1:     { fbref: 13, compId: 6,  name: 'Ligue 1',          slug: 'Ligue-1-Stats' },
  ucl:        { fbref: 8,  compId: 2,  name: 'Champions League',  slug: 'Champions-League-Stats' },
};

// FBref page types we scrape
const PAGE_TYPES = {
  stats:   { path: 'stats',   tableId: 'stats_standard' },
  keepers: { path: 'keepers', tableId: 'stats_keeper' },
  defense: { path: 'defense', tableId: 'stats_defense' },
};

const FBREF_BASE = 'https://fbref.com/en/comps';
const REQUEST_DELAY_MS = 4000; // Be polite to FBref

// Position bucket mapping (same logic as historical data)
const POSITION_BUCKET_MAP = {
  'GK': 'GK',
  'DF': 'DEF', 'DF,MF': 'DEF', 'DF,FW': 'DEF',
  'MF': 'MID', 'MF,DF': 'MID', 'MF,FW': 'MID',
  'FW': 'FWD', 'FW,MF': 'FWD', 'FW,DF': 'FWD',
};

// ─── Supabase client ─────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_KEY = process.env.Supabase_Service_Role;

async function supabaseRPC(method, path, body = null) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path}: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Club name → club_id cache ───────────────────────────────────────────────

let clubCache = {};   // { 'Arsenal': 94, 'Chelsea': 75, ... }
let playerCache = {}; // { 'player_uid': true }

async function loadClubCache() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/clubs?select=club_id,club_name`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  const clubs = await res.json();
  for (const c of clubs) {
    clubCache[c.club_name] = c.club_id;
    // Also store lowercase for fuzzy matching
    clubCache[c.club_name.toLowerCase()] = c.club_id;
  }
  console.log(`  Loaded ${clubs.length} clubs into cache`);
}

async function loadPlayerCache() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/players?select=player_uid`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  const players = await res.json();
  for (const p of players) {
    playerCache[p.player_uid] = true;
  }
  console.log(`  Loaded ${players.length} players into cache`);
}

// FBref club name → Supabase club name mapping (handles discrepancies)
const CLUB_NAME_MAP = {
  // EPL
  'Manchester Utd': 'Manchester United',
  'Manchester City': 'Manchester City',
  'Nott\'ham Forest': 'Nottingham Forest',
  'Nottingham Forest': 'Nottingham Forest',
  'Newcastle Utd': 'Newcastle United',
  'Tottenham': 'Tottenham Hotspur',
  'West Ham': 'West Ham United',
  'Wolves': 'Wolverhampton Wanderers',
  'Leicester City': 'Leicester City',
  // La Liga
  'Atlético Madrid': 'Atletico Madrid',
  'Athletic Club': 'Athletic Bilbao',
  'Betis': 'Real Betis',
  'Celta Vigo': 'Celta de Vigo',
  // Serie A
  'Internazionale': 'Inter Milan',
  'Inter': 'Inter Milan',
  // Bundesliga
  'Eint Frankfurt': 'Eintracht Frankfurt',
  'Leverkusen': 'Bayer Leverkusen',
  'Bayer 04 Leverkusen': 'Bayer Leverkusen',
  'M\'Gladbach': 'Borussia Monchengladbach',
  'Mainz 05': 'Mainz',
  'Bayern Munich': 'Bayern Munich',
  'Dortmund': 'Borussia Dortmund',
  // Ligue 1
  'Paris S-G': 'Paris Saint-Germain',
  'Marseille': 'Olympique Marseille',
  'Lyon': 'Olympique Lyonnais',
  'Saint-Étienne': 'Saint-Etienne',
};

function resolveClubId(fbrefClubName) {
  // Try direct match first
  if (clubCache[fbrefClubName]) return { id: clubCache[fbrefClubName], name: fbrefClubName };

  // Try mapped name
  const mapped = CLUB_NAME_MAP[fbrefClubName];
  if (mapped && clubCache[mapped]) return { id: clubCache[mapped], name: mapped };

  // Try lowercase
  const lower = fbrefClubName.toLowerCase();
  if (clubCache[lower]) return { id: clubCache[lower], name: fbrefClubName };

  // Try partial match
  for (const [name, id] of Object.entries(clubCache)) {
    if (typeof id === 'number' && name.toLowerCase().includes(lower)) {
      return { id, name };
    }
  }

  return null;
}

// ─── Player UID generation ───────────────────────────────────────────────────

function generatePlayerUid(name, nationality, birthYear) {
  // Format: "lowercase name|country_codes|birth_year"
  // nationality from FBref: "eng ENG" or "us USA"
  const cleanName = name.toLowerCase()
    .normalize('NFD')  // decompose accented chars
    // Keep the composed chars as-is to match existing data (which has mojibake issues)
    // We'll try both normalized and raw forms
    .toLowerCase()
    .trim();

  const natParts = (nationality || '').toLowerCase().trim();
  const year = birthYear || '';

  return `${cleanName}|${natParts}|${year}`;
}

// ─── HTML Fetching ───────────────────────────────────────────────────────────

// Local file directory for --local mode
const LOCAL_DIR = path.join(__dirname, '..', 'data', 'fbref');

function getLocalFilename(leagueKey, pageType) {
  return path.join(LOCAL_DIR, `${leagueKey}_${pageType}.html`);
}

async function fetchPage(url, opts = {}) {
  if (opts.localFile) {
    if (!fs.existsSync(opts.localFile)) {
      throw new Error(`Local file not found: ${opts.localFile}\n    Save the page from your browser: ${url}\n    Save as: ${opts.localFile}`);
    }
    console.log(`  Reading local: ${opts.localFile}`);
    return fs.readFileSync(opts.localFile, 'utf-8');
  }

  console.log(`  Fetching: ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Connection': 'keep-alive',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseStandardStats(html) {
  const $ = cheerio.load(html);
  const table = $(`#stats_standard`);
  if (!table.length) {
    // FBref sometimes wraps in comments; extract from comment
    const comments = [];
    $('*').contents().each(function() {
      if (this.type === 'comment') comments.push(this.data);
    });
    for (const c of comments) {
      if (c.includes('stats_standard')) {
        const $c = cheerio.load(c);
        return parseStandardStatsFromTable($c, $c('#stats_standard'));
      }
    }
    console.warn('  WARNING: stats_standard table not found');
    return [];
  }
  return parseStandardStatsFromTable($, table);
}

function parseStandardStatsFromTable($, table) {
  const rows = [];
  table.find('tbody tr:not(.thead)').each((i, tr) => {
    const $tr = $(tr);
    if ($tr.find('th[data-stat="ranker"]').text().trim() === '') return; // separator row

    const player = $tr.find('td[data-stat="player"]').text().trim();
    if (!player) return;

    rows.push({
      player_name: player,
      player_href: $tr.find('td[data-stat="player"] a').attr('href') || '',
      nationality: $tr.find('td[data-stat="nationality"]').text().trim(),
      position_raw: $tr.find('td[data-stat="position"]').text().trim(),
      team: $tr.find('td[data-stat="team"]').text().trim(),
      age: $tr.find('td[data-stat="age"]').text().trim(),
      birth_year: $tr.find('td[data-stat="birth_year"]').text().trim(),
      appearances: parseInt($tr.find('td[data-stat="games"]').text().trim()) || 0,
      starts: parseInt($tr.find('td[data-stat="games_starts"]').text().trim()) || 0,
      minutes: parseInt($tr.find('td[data-stat="minutes"]').text().replace(/,/g, '').trim()) || 0,
      goals: parseInt($tr.find('td[data-stat="goals"]').text().trim()) || 0,
      assists: parseInt($tr.find('td[data-stat="assists"]').text().trim()) || 0,
      pens_scored: parseInt($tr.find('td[data-stat="pens_made"]').text().trim()) || 0,
      pens_attempted: parseInt($tr.find('td[data-stat="pens_att"]').text().trim()) || 0,
    });
  });
  return rows;
}

function parseKeeperStats(html) {
  const $ = cheerio.load(html);
  let table = $(`#stats_keeper`);

  if (!table.length) {
    // Check comments
    $('*').contents().each(function() {
      if (this.type === 'comment' && this.data.includes('stats_keeper')) {
        const $c = cheerio.load(this.data);
        table = $c('#stats_keeper');
      }
    });
  }

  if (!table.length) {
    console.warn('  WARNING: stats_keeper table not found');
    return {};
  }

  const keepers = {};
  table.find('tbody tr:not(.thead)').each((i, tr) => {
    const $tr = $(tr);
    const player = $tr.find('td[data-stat="player"]').text().trim();
    if (!player) return;

    const team = $tr.find('td[data-stat="team"]').text().trim();
    const key = `${player}|${team}`;

    keepers[key] = {
      goals_against: parseInt($tr.find('td[data-stat="gk_goals_against"]').text().trim()) || 0,
      clean_sheets: parseInt($tr.find('td[data-stat="gk_clean_sheets"]').text().trim()) || 0,
      shots_on_target_against: parseInt($tr.find('td[data-stat="gk_shots_on_target_against"]').text().trim()) || 0,
      saves: parseInt($tr.find('td[data-stat="gk_saves"]').text().trim()) || 0,
      wins: parseInt($tr.find('td[data-stat="gk_wins"]').text().trim()) || 0,
      draws: parseInt($tr.find('td[data-stat="gk_ties"]').text().trim()) || 0,
      losses: parseInt($tr.find('td[data-stat="gk_losses"]').text().trim()) || 0,
    };
  });
  return keepers;
}

function parseDefenseStats(html) {
  const $ = cheerio.load(html);
  let table = $(`#stats_defense`);

  if (!table.length) {
    $('*').contents().each(function() {
      if (this.type === 'comment' && this.data.includes('stats_defense')) {
        const $c = cheerio.load(this.data);
        table = $c('#stats_defense');
      }
    });
  }

  if (!table.length) {
    console.warn('  WARNING: stats_defense table not found');
    return {};
  }

  const defense = {};
  table.find('tbody tr:not(.thead)').each((i, tr) => {
    const $tr = $(tr);
    const player = $tr.find('td[data-stat="player"]').text().trim();
    if (!player) return;

    const team = $tr.find('td[data-stat="team"]').text().trim();
    const key = `${player}|${team}`;

    defense[key] = {
      tackles_won: parseInt($tr.find('td[data-stat="tackles_won"]').text().trim()) || 0,
      interceptions: parseInt($tr.find('td[data-stat="interceptions"]').text().trim()) || 0,
      tackles_interceptions: parseInt($tr.find('td[data-stat="tackles_interceptions"]').text().trim()) || 0,
    };
  });
  return defense;
}

// ─── Position bucket logic ───────────────────────────────────────────────────

function getPositionBucket(posRaw) {
  if (!posRaw) return 'UNK';
  const bucket = POSITION_BUCKET_MAP[posRaw];
  if (bucket) return bucket;

  // Fallback: take first position
  const first = posRaw.split(',')[0].trim();
  if (first === 'GK') return 'GK';
  if (first === 'DF') return 'DEF';
  if (first === 'MF') return 'MID';
  if (first === 'FW') return 'FWD';
  return 'UNK';
}

// ─── Age flags ───────────────────────────────────────────────────────────────

function computeAgeFlags(ageStr, birthYear) {
  let age = null;
  if (ageStr && ageStr.includes('-')) {
    age = parseInt(ageStr.split('-')[0]);
  } else if (ageStr) {
    age = parseInt(ageStr);
  }

  return {
    age,
    is_u19: age !== null && age < 19,
    is_u21: age !== null && age < 21,
    is_35plus: age !== null && age >= 35,
  };
}

// ─── Main ingestion per league ───────────────────────────────────────────────

async function ingestLeague(leagueKey, opts = {}) {
  const league = LEAGUES[leagueKey];
  if (!league) throw new Error(`Unknown league: ${leagueKey}`);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Ingesting: ${league.name} (FBref comp ${league.fbref} → Supabase comp ${league.compId})`);
  console.log(`${'='.repeat(60)}`);

  const useLocal = opts.useLocal || false;

  // 1. Fetch standard stats
  const statsUrl = `${FBREF_BASE}/${league.fbref}/${PAGE_TYPES.stats.path}/${league.slug}`;
  const statsHtml = await fetchPage(statsUrl, useLocal ? { localFile: getLocalFilename(leagueKey, 'stats') } : {});
  const players = parseStandardStats(statsHtml);
  console.log(`  Parsed ${players.length} players from standard stats`);

  if (!useLocal) await sleep(REQUEST_DELAY_MS);

  // 2. Fetch keeper stats
  const keepersUrl = `${FBREF_BASE}/${league.fbref}/${PAGE_TYPES.keepers.path}/${league.slug}`;
  const keepersHtml = await fetchPage(keepersUrl, useLocal ? { localFile: getLocalFilename(leagueKey, 'keepers') } : {});
  const keepers = parseKeeperStats(keepersHtml);
  console.log(`  Parsed ${Object.keys(keepers).length} keepers`);

  if (!useLocal) await sleep(REQUEST_DELAY_MS);

  // 3. Fetch defense stats
  const defenseUrl = `${FBREF_BASE}/${league.fbref}/${PAGE_TYPES.defense.path}/${league.slug}`;
  const defenseHtml = await fetchPage(defenseUrl, useLocal ? { localFile: getLocalFilename(leagueKey, 'defense') } : {});
  const defense = parseDefenseStats(defenseHtml);
  console.log(`  Parsed ${Object.keys(defense).length} players with defense stats`);

  // 4. Merge data and build rows
  const unmatchedClubs = new Set();
  const newPlayers = [];
  const rows = [];

  for (const p of players) {
    // Resolve club
    const club = resolveClubId(p.team);
    if (!club) {
      unmatchedClubs.add(p.team);
      continue;
    }

    // Generate player_uid
    const playerUid = generatePlayerUid(p.player_name, p.nationality, p.birth_year);

    // Position
    const positionBucket = getPositionBucket(p.position_raw);

    // Age
    const { age, is_u19, is_u21, is_35plus } = computeAgeFlags(p.age, p.birth_year);

    // Merge keeper stats
    const keeperKey = `${p.player_name}|${p.team}`;
    const gk = keepers[keeperKey] || {};

    // Merge defense stats
    const def = defense[keeperKey] || {};

    // Sub appearances
    const subApps = Math.max(0, p.appearances - p.starts);

    const row = {
      player_uid: playerUid,
      competition_id: league.compId,
      club_id: club.id,
      season_label: SEASON_LABEL,
      season_start_year: SEASON_START_YEAR,
      position_raw: p.position_raw || null,
      position_bucket: positionBucket,
      age: age,
      appearances: p.appearances,
      starts: p.starts,
      sub_appearances: subApps,
      minutes: p.minutes,
      goals: p.goals,
      assists: p.assists,
      pens_scored: p.pens_scored,
      pens_attempted: p.pens_attempted,
      goals_against: gk.goals_against || null,
      clean_sheets: gk.clean_sheets || null,
      shots_on_target_against: gk.shots_on_target_against || null,
      saves: gk.saves || null,
      wins: gk.wins || null,
      draws: gk.draws || null,
      losses: gk.losses || null,
      tackles_won: def.tackles_won || null,
      interceptions: def.interceptions || null,
      tackles_interceptions: def.tackles_interceptions || null,
      is_u19: is_u19,
      is_u21: is_u21,
      is_35plus: is_35plus,
    };

    // Track if player needs to be created
    if (!playerCache[playerUid]) {
      newPlayers.push({
        player_uid: playerUid,
        player_name: p.player_name,
        nationality_raw: p.nationality || null,
        birth_year: p.birth_year ? parseInt(p.birth_year) : null,
      });
      playerCache[playerUid] = true; // prevent dupes
    }

    rows.push(row);
  }

  // Log unmatched clubs
  if (unmatchedClubs.size > 0) {
    console.warn(`\n  ⚠ Unmatched clubs (${unmatchedClubs.size}):`);
    for (const c of unmatchedClubs) {
      console.warn(`    - "${c}"`);
    }
  }

  console.log(`\n  Ready to upsert: ${rows.length} player-season rows`);
  console.log(`  New players to create: ${newPlayers.length}`);

  if (opts.dryRun) {
    console.log('  [DRY RUN] Skipping Supabase writes');
    if (opts.verbose) {
      console.log('  Sample rows:', JSON.stringify(rows.slice(0, 3), null, 2));
    }
    return { players: rows.length, newPlayers: newPlayers.length, unmatched: Array.from(unmatchedClubs) };
  }

  // 5. Create new players in batches
  if (newPlayers.length > 0) {
    console.log(`  Creating ${newPlayers.length} new players...`);
    const BATCH = 100;
    for (let i = 0; i < newPlayers.length; i += BATCH) {
      const batch = newPlayers.slice(i, i + BATCH);
      try {
        await supabaseRPC('POST', 'players', batch);
      } catch (err) {
        // Some may already exist; try one by one
        for (const pl of batch) {
          try {
            await supabaseRPC('POST', 'players', [pl]);
          } catch (e2) {
            if (opts.verbose) console.warn(`    Could not create player ${pl.player_uid}: ${e2.message}`);
          }
        }
      }
    }
  }

  // 6. Create any new clubs that were unmatched
  // (We skip this - unmatched clubs are logged for manual review)

  // 7. Upsert player season stats in batches
  console.log(`  Upserting ${rows.length} rows into current_season_player_stats...`);
  const BATCH = 50;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      await supabaseRPC('POST',
        'current_season_player_stats?on_conflict=player_uid,competition_id,club_id,season_label',
        batch
      );
      upserted += batch.length;
    } catch (err) {
      console.error(`  ERROR upserting batch ${i}: ${err.message}`);
      // Try one by one
      for (const row of batch) {
        try {
          await supabaseRPC('POST',
            'current_season_player_stats?on_conflict=player_uid,competition_id,club_id,season_label',
            [row]
          );
          upserted++;
        } catch (e2) {
          console.error(`    Failed: ${row.player_uid} - ${e2.message}`);
        }
      }
    }
  }

  console.log(`  ✓ Upserted ${upserted}/${rows.length} rows for ${league.name}`);
  return { players: rows.length, upserted, newPlayers: newPlayers.length, unmatched: Array.from(unmatchedClubs) };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const useLocal = args.includes('--local');
  const leagueIdx = args.indexOf('--league');
  const specificLeague = leagueIdx >= 0 ? args[leagueIdx + 1] : null;

  const mode = dryRun ? 'DRY RUN' : useLocal ? 'LOCAL FILES' : 'LIVE (fetch)';

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  FBref → Supabase Current Season Ingestion                  ║');
  console.log(`║  Season: ${SEASON_LABEL}                                           ║`);
  console.log(`║  Mode: ${mode.padEnd(49)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // In local mode, check/create directory and list needed files
  if (useLocal) {
    if (!fs.existsSync(LOCAL_DIR)) {
      fs.mkdirSync(LOCAL_DIR, { recursive: true });
      console.log(`\n  Created directory: ${LOCAL_DIR}`);
    }

    const leagueKeys = specificLeague ? [specificLeague] : Object.keys(LEAGUES);
    const missingFiles = [];
    const pageTypes = ['stats', 'keepers', 'defense'];

    console.log('\n  Checking for local HTML files...');
    for (const lk of leagueKeys) {
      const league = LEAGUES[lk];
      for (const pt of pageTypes) {
        const filePath = getLocalFilename(lk, pt);
        const url = `${FBREF_BASE}/${league.fbref}/${PAGE_TYPES[pt].path}/${league.slug}`;
        if (!fs.existsSync(filePath)) {
          missingFiles.push({ file: filePath, url, league: league.name, type: pt });
        }
      }
    }

    if (missingFiles.length > 0) {
      console.log(`\n  ⚠ ${missingFiles.length} file(s) missing. Save these pages from your browser:\n`);
      for (const mf of missingFiles) {
        console.log(`  ${mf.league} (${mf.type}):`);
        console.log(`    URL:  ${mf.url}`);
        console.log(`    Save: ${mf.file}\n`);
      }
      console.log('  Tip: In Chrome, use Ctrl+S / Cmd+S → "Webpage, Complete" and rename to the filename above.');
      console.log('  Then re-run this command.\n');
      process.exit(0);
    }

    console.log('  ✓ All local files found. Proceeding...\n');
  }

  if (!dryRun) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.error('ERROR: Set Supabase_Project_URL and Supabase_Service_Role env vars');
      process.exit(1);
    }
  }

  // Load caches
  if (!dryRun) {
    console.log('\nLoading caches...');
    await loadClubCache();
    await loadPlayerCache();
  }

  // Determine which leagues to ingest
  const leagueKeys = specificLeague ? [specificLeague] : Object.keys(LEAGUES);
  const results = {};

  for (const key of leagueKeys) {
    try {
      results[key] = await ingestLeague(key, { dryRun, verbose, useLocal });
    } catch (err) {
      console.error(`\nERROR processing ${key}: ${err.message}`);
      if (verbose) console.error(err.stack);
      results[key] = { error: err.message };
    }

    // Delay between leagues
    if (leagueKeys.indexOf(key) < leagueKeys.length - 1) {
      console.log(`\n  Waiting ${REQUEST_DELAY_MS / 1000}s before next league...`);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  // ── Summary & Verdict ──────────────────────────────────────────────────────
  const totalLeagues = Object.keys(results).length;
  const successLeagues = Object.values(results).filter(r => !r.error).length;
  const failedLeagues = Object.values(results).filter(r => r.error).length;
  const totalUpserted = Object.values(results).reduce((sum, r) => sum + (r.upserted || 0), 0);
  const totalNewPlayers = Object.values(results).reduce((sum, r) => sum + (r.newPlayers || 0), 0);
  const allUnmatched = Object.values(results).flatMap(r => r.unmatched || []);

  console.log('\n' + '═'.repeat(60));
  console.log('INGESTION SUMMARY');
  console.log('═'.repeat(60));
  for (const [key, res] of Object.entries(results)) {
    const league = LEAGUES[key];
    if (res.error) {
      console.log(`  ✗ ${league.name}: ERROR - ${res.error}`);
    } else {
      console.log(`  ✓ ${league.name}: ${res.upserted || res.players} rows, ${res.newPlayers} new players`);
      if (res.unmatched?.length > 0) {
        console.log(`    ⚠ Unmatched clubs: ${res.unmatched.join(', ')}`);
      }
    }
  }
  console.log('─'.repeat(60));
  console.log(`  Leagues: ${successLeagues}/${totalLeagues} succeeded`);
  console.log(`  Total rows upserted: ${totalUpserted}`);
  console.log(`  New players created: ${totalNewPlayers}`);
  if (allUnmatched.length > 0) {
    console.log(`  ⚠ Total unmatched clubs: ${allUnmatched.length} (${allUnmatched.join(', ')})`);
  }
  console.log('═'.repeat(60));

  // ── Final Verdict ─────────────────────────────────────────────────────────
  if (failedLeagues === 0 && totalUpserted > 0) {
    console.log('\n✅ SUCCESS — All leagues ingested. Safe to proceed.');

    // Update ingestion_meta timestamp
    if (!dryRun) {
      try {
        await supabaseRPC('POST',
          'ingestion_meta?on_conflict=key',
          [{ key: 'current_season_last_updated', value: `${successLeagues} leagues, ${totalUpserted} rows`, updated_at: new Date().toISOString() }]
        );
        console.log('  📝 Updated ingestion_meta timestamp');
      } catch (metaErr) {
        console.warn(`  ⚠ Could not update ingestion_meta: ${metaErr.message}`);
      }
    }
  } else if (failedLeagues > 0 && successLeagues > 0) {
    console.log(`\n⚠️  PARTIAL SUCCESS — ${failedLeagues} league(s) failed. Check errors above.`);
    console.log('  The successful leagues were still saved. Re-run with --league <name> to retry failed ones.');

    if (!dryRun) {
      try {
        await supabaseRPC('POST',
          'ingestion_meta?on_conflict=key',
          [{ key: 'current_season_last_updated', value: `${successLeagues}/${totalLeagues} leagues (partial), ${totalUpserted} rows`, updated_at: new Date().toISOString() }]
        );
      } catch (metaErr) { /* silent */ }
    }
  } else if (totalUpserted === 0 && !dryRun) {
    console.log('\n❌ FAILED — No data was ingested. Do NOT proceed.');
    console.log('  Common causes:');
    console.log('  - FBref may be rate-limiting or blocking requests');
    console.log('  - FBref HTML structure may have changed');
    console.log('  - Network/DNS issue');
    console.log('  Try again later, or run with --verbose for more details.');
    process.exit(1);
  } else if (dryRun) {
    console.log('\n🏃 DRY RUN complete — no data written. Run without --dry-run to go live.');
  }
}

main().catch(err => {
  console.error('\n❌ FATAL ERROR:', err.message);
  console.error('  The ingestion crashed unexpectedly. No data was modified.');
  console.error('  Run with --verbose for full stack trace.');
  process.exit(1);
});
