# TeleStats — Current Season Stats Update Guide

**Purpose:** Instructions for updating current-season player stats across all 6 leagues in the TeleStats database. Give this document to Claude when you want the stats refreshed.

**Last updated:** 15 Feb 2026

---

## What This Does

Scrapes current-season (2025/26) player stats from FBref.com and upserts them into the `current_season_player_stats` table in Supabase. The games (XI, Bullseye, Who Am I, Pop Quiz, Higher or Lower, Player Alphabet) query via the `v_all_player_season_stats` view which combines historical + current season data automatically.

## Quick Start — Copy-Paste Prompt

> **"Update the current season stats for TeleStats. Follow the instructions in `docs/CURRENT_SEASON_UPDATE_GUIDE.md` in my project folder."**

---

## Prerequisites

- Chrome browser open with the Claude in Chrome extension
- The FBref website must be accessible (loads through Cloudflare in real browser)
- Supabase project: `https://cifnegfabbcywcxhtpfn.supabase.co`
- Supabase Service Role Key: stored in Netlify environment variables (or provide directly)

## Architecture Overview

| Component | Location |
|-----------|----------|
| Current season table | `current_season_player_stats` in Supabase |
| Historical table | `player_season_stats` (~170K+ rows) |
| Combined view | `v_all_player_season_stats` (UNION ALL of historical + current) |
| Players table | `players` (36K+ players, keyed by `player_uid`) |
| Clubs table | `clubs` (540+ clubs) |
| Metadata table | `ingestion_meta` (tracks last update timestamp) |
| Frontend display | `index.html` footer shows "Current season stats updated: [date]" |
| Player Lookup Tool | `public/tools/player-lookup.html` (for spot-checking data) |
| Migration SQL | `sql/002_current_season_table.sql` |
| Node.js ingestion script | `scripts/ingest_current_season.js` (backup approach — blocked by Cloudflare) |

## ⚠️ Known Data Issues & Lessons Learned

These issues were discovered during the first ingestion (Feb 2026) and fixes were applied. The `genUid()` function now handles all of these automatically — future runs should work cleanly.

### 1. Nationality Format Mismatch (BIGGEST ISSUE)
**Problem:** FBref gives nationality as two codes (e.g., `eng eng`, `fr fra`, `br bra`, `us usa`). Historical data uses just ONE code (e.g., `eng`, `fra`, `bra`, `usa`). This caused ~80% of current season UIDs to NOT match any historical player.
**Example:** FBref UID `bukayo saka|eng eng|2001` vs historical `bukayo saka|eng|2001`
**Fix:** The `genUid()` function now extracts only the LAST nationality code: `nat.split(' ').pop()`.

### 2. Birth Year Discrepancy
**Problem:** Historical data calculated birth years from player age (e.g., `2025 - age`), which can be off by 1 year. FBref uses actual birth years.
**Example:** Saka historical = `bukayo saka|eng|2001`, but some historical rows had `|2002`
**Fix:** `genUid()` tries ±1 birth year when exact match fails.

### 3. Mojibake Encoding in Historical Data
**Problem:** Historical data has corrupted Unicode (e.g., `ferna¡ndez` instead of `fernández`). FBref has proper Unicode.
**Fix:** `genUid()` falls back to normalized ASCII-only matching when exact/year matching fails.

### 4. Unmatched Clubs
**Problem:** Some clubs in FBref don't exist in the clubs table (e.g., newly promoted teams, minor UCL clubs like Pafos FC, Bodø/Glimt).
**Fix:** The ingestion function auto-inserts missing clubs rather than skipping those players.

---

## Step-by-Step Update Process

### Step 1: Open FBref in the Browser

Navigate to any FBref stats page to establish the session (this bypasses Cloudflare):

```
https://fbref.com/en/comps/9/stats/Premier-League-Stats
```

**Important:** All subsequent fetches use same-origin `fetch('/en/comps/...')` from this tab. Do NOT navigate away from fbref.com or the JS context will be lost.

### Step 2: Load Supabase Caches

Run this JavaScript in the FBref tab to load club and player lookup caches from Supabase:

```javascript
(async () => {
  const SB_URL = 'https://cifnegfabbcywcxhtpfn.supabase.co';
  const SB_KEY = '<SERVICE_ROLE_KEY>'; // Ask user or check Netlify env vars
  window.__SB_URL = SB_URL;
  window.__SB_KEY = SB_KEY;

  // Load clubs
  const clubRes = await fetch(`${SB_URL}/rest/v1/clubs?select=club_id,club_name`, {
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
  });
  const clubs = await clubRes.json();
  window.__clubCache = {};
  for (const c of clubs) {
    window.__clubCache[c.club_name] = c.club_id;
    window.__clubCache[c.club_name.toLowerCase()] = c.club_id;
  }

  // Load all players (paginated, 1000 per request)
  // We need full player data (uid + birth_year) for UID matching
  window.__playerCache = {};
  window.__playersByNorm = {}; // normalized lookup for fuzzy matching
  let loaded = 0;
  for (let start = 0; start < 50000; start += 1000) {
    const res = await fetch(`${SB_URL}/rest/v1/players?select=player_uid,birth_year&order=player_uid&offset=${start}&limit=1000`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    });
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    for (const p of batch) {
      window.__playerCache[p.player_uid] = p.birth_year;
      // Build normalized lookup: strip all non-ASCII to handle mojibake
      const parts = p.player_uid.split('|');
      if (parts.length === 3) {
        const normName = parts[0].replace(/[^\x00-\x7F]/g, '').replace(/\s+/g,' ').trim();
        const normNat = parts[1].replace(/[^\x00-\x7F]/g, '').replace(/\s+/g,' ').trim();
        const normKey = `${normName}|${normNat}`;
        if (!window.__playersByNorm[normKey]) window.__playersByNorm[normKey] = [];
        window.__playersByNorm[normKey].push(p.player_uid);
      }
    }
    loaded += batch.length;
    if (batch.length < 1000) break;
  }

  return `Loaded ${clubs.length} clubs, ${loaded} players`;
})()
```

### Step 3: Set Up Helper Functions

```javascript
// Club name mapping (FBref name → Supabase name)
window.__CLUB_NAME_MAP = {
  'Manchester Utd': 'Manchester United', "Nott'ham Forest": 'Nottingham Forest',
  'Newcastle Utd': 'Newcastle United', 'Tottenham': 'Tottenham Hotspur',
  'West Ham': 'West Ham United', 'Wolves': 'Wolverhampton Wanderers',
  'Atlético Madrid': 'Atletico Madrid', 'Athletic Club': 'Athletic Bilbao',
  'Betis': 'Real Betis', 'Celta Vigo': 'Celta de Vigo',
  'Internazionale': 'Inter Milan', 'Inter': 'Inter Milan',
  'Eint Frankfurt': 'Eintracht Frankfurt', 'Leverkusen': 'Bayer Leverkusen',
  "M'Gladbach": 'Borussia Monchengladbach', 'Mainz 05': 'Mainz',
  'Dortmund': 'Borussia Dortmund', 'Paris S-G': 'Paris Saint-Germain',
  'Marseille': 'Olympique Marseille', 'Lyon': 'Olympique Lyonnais',
  'Saint-Étienne': 'Saint-Etienne',
};

window.__POS_MAP = {
  'GK':'GK','DF':'DEF','DF,MF':'DEF','DF,FW':'DEF',
  'MF':'MID','MF,DF':'MID','MF,FW':'MID',
  'FW':'FWD','FW,MF':'FWD','FW,DF':'FWD',
};

window.resolveClub = function(name) {
  const cc = window.__clubCache;
  if (cc[name]) return cc[name];
  const mapped = window.__CLUB_NAME_MAP[name];
  if (mapped && cc[mapped]) return cc[mapped];
  if (cc[name.toLowerCase()]) return cc[name.toLowerCase()];
  for (const [n, id] of Object.entries(cc)) {
    if (typeof id === 'number' && n.toLowerCase().includes(name.toLowerCase())) return id;
  }
  return null;
};

window.posBucket = function(raw) {
  if (!raw) return 'UNK';
  if (window.__POS_MAP[raw]) return window.__POS_MAP[raw];
  const f = raw.split(',')[0].trim();
  return f==='GK'?'GK':f==='DF'?'DEF':f==='MF'?'MID':f==='FW'?'FWD':'UNK';
};

/**
 * Generate player UID — with smart matching against existing historical UIDs.
 *
 * CRITICAL: FBref nationality format is "xx yyy" (e.g., "eng eng", "fr fra", "br bra")
 * but historical data uses just the LAST code (e.g., "eng", "fra", "bra").
 * We MUST extract only the last code to match historical UIDs.
 *
 * Strategy:
 * 1. Convert FBref nationality to single code (last word)
 * 2. Try exact match with that nat code + FBref birth year
 * 3. Try ±1 birth year (historical data often has off-by-one from age calculation)
 * 4. Try normalized (ASCII-only) match to handle mojibake in historical data
 * 5. If no match found, generate a new UID using single nat code
 */
window.genUid = function(name, nat, year) {
  const lowerName = name.toLowerCase().normalize('NFD').trim();
  const baseName = lowerName.replace(/[\u0300-\u036f]/g, '').trim();
  // IMPORTANT: FBref gives "eng eng", "fr fra" etc — use LAST code only
  const natParts = (nat||'').toLowerCase().trim().split(/\s+/);
  const baseNat = natParts[natParts.length - 1] || '';
  const baseYear = parseInt(year) || '';

  // 1. Exact match with single nat code
  const exact = `${lowerName}|${baseNat}|${baseYear}`;
  if (window.__playerCache[exact] !== undefined) return exact;

  // 2. Try ±1 birth year
  if (baseYear) {
    for (const tryYear of [baseYear - 1, baseYear + 1]) {
      const tryUid = `${lowerName}|${baseNat}|${tryYear}`;
      if (window.__playerCache[tryUid] !== undefined) return tryUid;
    }
  }

  // 3. Normalized ASCII-only match (handles mojibake in historical names)
  const normName = baseName.replace(/[^\x00-\x7F]/g, '').replace(/\s+/g,' ').trim();
  const normNat = baseNat.replace(/[^\x00-\x7F]/g, '').replace(/\s+/g,' ').trim();
  const normKey = `${normName}|${normNat}`;
  const candidates = window.__playersByNorm[normKey];
  if (candidates && candidates.length > 0) {
    // If multiple candidates, try to match by birth year (±1)
    if (baseYear) {
      for (const cUid of candidates) {
        const cYear = window.__playerCache[cUid];
        if (cYear && Math.abs(cYear - baseYear) <= 1) return cUid;
      }
    }
    // If only one candidate, use it
    if (candidates.length === 1) return candidates[0];
  }

  // 4. No historical match — generate new UID using single nat code
  return exact;
};
```

### Step 4: Define the Ingestion Function

This function fetches all 3 FBref pages (stats, keepers, defense) for a league via same-origin fetch, parses them, and upserts to Supabase:

```javascript
window.ingestLeague = async function(fbrefCompId, supabaseCompId, slug, leagueName) {
  const SB = window.__SB_URL;
  const KEY = window.__SB_KEY;
  const headers = { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' };

  const parseTable = (doc, tableId, extractor) => {
    let table = doc.getElementById(tableId);
    if (!table) {
      // FBref hides some tables in HTML comments — search for them
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
      while (walker.nextNode()) {
        if (walker.currentNode.data.includes(tableId)) {
          const div = document.createElement('div');
          div.innerHTML = walker.currentNode.data;
          table = div.querySelector(`#${tableId}`);
          break;
        }
      }
    }
    if (!table) return null;
    const results = [];
    table.querySelectorAll('tbody tr:not(.thead)').forEach(row => {
      const r = extractor(row); if (r) results.push(r);
    });
    return results;
  };

  const fetchDoc = async (path) => {
    const html = await (await fetch(`/en/comps/${fbrefCompId}/${path}/${slug}`)).text();
    return new DOMParser().parseFromString(html, 'text/html');
  };

  console.log(`[${leagueName}] Fetching stats page...`);
  const statsDoc = await fetchDoc('stats');
  console.log(`[${leagueName}] Fetching keepers page...`);
  const keepersDoc = await fetchDoc('keepers');
  console.log(`[${leagueName}] Fetching defense page...`);
  const defenseDoc = await fetchDoc('defense');

  // Parse standard stats
  const standard = parseTable(statsDoc, 'stats_standard', row => {
    const pLink = row.querySelector('td[data-stat="player"] a');
    if (!pLink) return null;
    return {
      name: pLink.textContent.trim(),
      nat: row.querySelector('td[data-stat="nationality"]')?.textContent?.trim()||'',
      pos: row.querySelector('td[data-stat="position"]')?.textContent?.trim()||'',
      team: row.querySelector('td[data-stat="team"] a')?.textContent?.trim()||'',
      ageStr: row.querySelector('td[data-stat="age"]')?.textContent?.trim()||'',
      born: row.querySelector('td[data-stat="birth_year"]')?.textContent?.trim()||'',
      mp: parseInt(row.querySelector('td[data-stat="games"]')?.textContent?.trim())||0,
      starts: parseInt(row.querySelector('td[data-stat="games_starts"]')?.textContent?.trim())||0,
      min: parseInt(row.querySelector('td[data-stat="minutes"]')?.textContent?.replace(/,/g,'').trim())||0,
      goals: parseInt(row.querySelector('td[data-stat="goals"]')?.textContent?.trim())||0,
      assists: parseInt(row.querySelector('td[data-stat="assists"]')?.textContent?.trim())||0,
      pks: parseInt(row.querySelector('td[data-stat="pens_made"]')?.textContent?.trim())||0,
      pkatt: parseInt(row.querySelector('td[data-stat="pens_att"]')?.textContent?.trim())||0,
    };
  });
  if (!standard) return { error: 'stats_standard not found' };
  console.log(`[${leagueName}] Parsed ${standard.length} players from stats`);

  // Parse keepers
  const keepersMap = {};
  parseTable(keepersDoc, 'stats_keeper', row => {
    const n = row.querySelector('td[data-stat="player"]')?.textContent?.trim();
    if (!n) return null;
    const t = row.querySelector('td[data-stat="team"] a')?.textContent?.trim()||'';
    keepersMap[`${n}|${t}`] = {
      goals_against: parseInt(row.querySelector('td[data-stat="gk_goals_against"]')?.textContent?.trim())||0,
      clean_sheets: parseInt(row.querySelector('td[data-stat="gk_clean_sheets"]')?.textContent?.trim())||0,
      shots_on_target_against: parseInt(row.querySelector('td[data-stat="gk_shots_on_target_against"]')?.textContent?.trim())||0,
      saves: parseInt(row.querySelector('td[data-stat="gk_saves"]')?.textContent?.trim())||0,
      wins: parseInt(row.querySelector('td[data-stat="gk_wins"]')?.textContent?.trim())||0,
      draws: parseInt(row.querySelector('td[data-stat="gk_ties"]')?.textContent?.trim())||0,
      losses: parseInt(row.querySelector('td[data-stat="gk_losses"]')?.textContent?.trim())||0,
    };
    return true;
  });

  // Parse defense
  const defenseMap = {};
  parseTable(defenseDoc, 'stats_defense', row => {
    const n = row.querySelector('td[data-stat="player"]')?.textContent?.trim();
    if (!n) return null;
    const t = row.querySelector('td[data-stat="team"] a')?.textContent?.trim()||'';
    defenseMap[`${n}|${t}`] = {
      tackles_won: parseInt(row.querySelector('td[data-stat="tackles_won"]')?.textContent?.trim())||0,
      interceptions: parseInt(row.querySelector('td[data-stat="interceptions"]')?.textContent?.trim())||0,
      tackles_interceptions: parseInt(row.querySelector('td[data-stat="tackles_interceptions"]')?.textContent?.trim())||0,
    };
    return true;
  });

  // Merge and build records
  // AUTO-INSERT missing clubs so no players are skipped
  const newPlayers = []; const records = []; const newClubs = new Set();
  let matchedExisting = 0, matchedByYear = 0, matchedByNorm = 0, brandNew = 0;

  for (const p of standard) {
    let clubId = window.resolveClub(p.team);
    if (!clubId) {
      // Auto-create the club in Supabase
      const insertRes = await fetch(`${SB}/rest/v1/clubs`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify({ club_name: p.team })
      });
      if (insertRes.ok) {
        const inserted = await insertRes.json();
        clubId = inserted[0]?.club_id;
        if (clubId) {
          window.__clubCache[p.team] = clubId;
          window.__clubCache[p.team.toLowerCase()] = clubId;
          newClubs.add(p.team);
        }
      }
      if (!clubId) continue; // only skip if insert also failed
    }

    const uid = window.genUid(p.name, p.nat, p.born);

    // Track how the UID was matched for diagnostics
    const natLast = (p.nat||'').toLowerCase().trim().split(/\s+/).pop()||'';
    const exactUid = `${p.name.toLowerCase().normalize('NFD').trim()}|${natLast}|${p.born}`;
    if (uid === exactUid && window.__playerCache[uid] !== undefined) matchedExisting++;
    else if (uid !== exactUid && window.__playerCache[uid] !== undefined) {
      if (uid.split('|')[2] !== p.born) matchedByYear++;
      else matchedByNorm++;
    } else brandNew++;

    const age = p.ageStr.includes('-') ? parseInt(p.ageStr.split('-')[0]) : (parseInt(p.ageStr)||null);
    const kKey = `${p.name}|${p.team}`;
    const gk = keepersMap[kKey]||{}; const def = defenseMap[kKey]||{};

    if (window.__playerCache[uid] === undefined) {
      newPlayers.push({ player_uid:uid, player_name:p.name,
        nationality_raw: p.nat.split(' ').pop()||'',
        nationality_norm: (p.nat.split(' ').pop()||'').toUpperCase(),
        birth_year: parseInt(p.born)||null });
      window.__playerCache[uid] = parseInt(p.born)||null;
    }

    records.push({
      player_uid:uid, competition_id:supabaseCompId, club_id:clubId,
      season_label:'2025/26', season_start_year:2025,
      position_raw:p.pos, position_bucket:window.posBucket(p.pos),
      age, appearances:p.mp, starts:p.starts, sub_appearances:p.mp-p.starts,
      minutes:p.min, goals:p.goals, assists:p.assists,
      pens_scored:p.pks, pens_attempted:p.pkatt,
      goals_against:gk.goals_against??null, clean_sheets:gk.clean_sheets??null,
      shots_on_target_against:gk.shots_on_target_against??null,
      saves:gk.saves??null, wins:gk.wins??null, draws:gk.draws??null, losses:gk.losses??null,
      tackles_won:def.tackles_won??null, interceptions:def.interceptions??null,
      tackles_interceptions:def.tackles_interceptions??null,
      is_u19:age!==null&&age<19, is_u21:age!==null&&age<21, is_35plus:age!==null&&age>=35,
    });
  }

  // Insert new players (batches of 100)
  let pInserted = 0;
  for (let i = 0; i < newPlayers.length; i += 100) {
    const batch = newPlayers.slice(i,i+100);
    const res = await fetch(`${SB}/rest/v1/players?on_conflict=player_uid`, { method:'POST', headers, body:JSON.stringify(batch) });
    if (!res.ok) return { error: `Player insert: ${res.status} ${await res.text()}` };
    pInserted += batch.length;
  }

  // Upsert stats (batches of 50)
  let sUpserted = 0;
  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i,i+50);
    const res = await fetch(`${SB}/rest/v1/current_season_player_stats?on_conflict=player_uid,competition_id,club_id,season_label`, { method:'POST', headers, body:JSON.stringify(batch) });
    if (!res.ok) return { error: `Stats upsert: ${res.status} ${await res.text()}` };
    sUpserted += batch.length;
  }

  return {
    league: leagueName,
    parsed: standard.length,
    statsUpserted: sUpserted,
    newPlayers: pInserted,
    newClubs: [...newClubs],
    matching: { exactMatch: matchedExisting, birthYearFix: matchedByYear, mojibakeFix: matchedByNorm, brandNew }
  };
};
```

### Step 5: Run All Leagues

Run each league. For smaller leagues this can be done as a single call. For UCL (800+ players), break it into separate fetch/parse/upsert steps to avoid timeouts.

```javascript
// League configs: (fbrefCompId, supabaseCompId, slug, name)
// EPL:        (9,  7,  'Premier-League-Stats',    'Premier League')
// La Liga:    (12, 1,  'La-Liga-Stats',           'La Liga')
// Serie A:    (11, 3,  'Serie-A-Stats',            'Serie A')
// Bundesliga: (20, 9,  'Bundesliga-Stats',         'Bundesliga')
// Ligue 1:    (13, 6,  'Ligue-1-Stats',            'Ligue 1')
// UCL:        (8,  2,  'Champions-League-Stats',   'Champions League')

// Run each one:
await window.ingestLeague(9, 7, 'Premier-League-Stats', 'Premier League');
await window.ingestLeague(12, 1, 'La-Liga-Stats', 'La Liga');
await window.ingestLeague(11, 3, 'Serie-A-Stats', 'Serie A');
await window.ingestLeague(20, 9, 'Bundesliga-Stats', 'Bundesliga');
await window.ingestLeague(13, 6, 'Ligue-1-Stats', 'Ligue 1');
await window.ingestLeague(8, 2, 'Champions-League-Stats', 'Champions League');
```

**Note on UCL:** If the ingestLeague call times out (>30s), break it into separate steps:
1. Fetch & parse stats, keepers, defense separately
2. Merge and build records
3. Upsert in a separate call

### Step 6: Update Metadata

After all leagues complete:

```javascript
await fetch(`${window.__SB_URL}/rest/v1/ingestion_meta?on_conflict=key`, {
  method: 'POST',
  headers: { 'apikey': window.__SB_KEY, 'Authorization': `Bearer ${window.__SB_KEY}`,
    'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify([{
    key: 'current_season_last_updated',
    value: '<DATE> — Updated all 6 leagues from FBref',
    updated_at: new Date().toISOString()
  }])
});
```

### Step 7: Verify

Check the data was written correctly:

```javascript
// Count by league
const h = { 'apikey': window.__SB_KEY, 'Authorization': `Bearer ${window.__SB_KEY}`, 'Prefer': 'count=exact' };
for (const [name, compId] of [['EPL',7],['La Liga',1],['Serie A',3],['Bundesliga',9],['Ligue 1',6],['UCL',2]]) {
  const r = await fetch(`${window.__SB_URL}/rest/v1/current_season_player_stats?competition_id=eq.${compId}&select=id&limit=1`, { headers: h });
  console.log(`${name}: ${r.headers.get('content-range')}`);
}
```

**Spot-check with Player Lookup Tool:**
After deployment, visit `/tools/player-lookup.html` and search for key players to verify:
- Their current season stats appear (green "CURRENT" section)
- Historical data still shows (expandable club blocks)
- Stats make sense (e.g., Haaland should have 20+ PL goals, Saka should show Arsenal across seasons)

Good players to spot-check across leagues:
- **PL:** Bukayo Saka, Erling Haaland, Cole Palmer
- **La Liga:** Kylian Mbappé, Robert Lewandowski
- **Serie A:** Lautaro Martínez
- **Bundesliga:** Florian Wirtz, Harry Kane
- **Ligue 1:** Bradley Barcola
- **UCL:** Players who appear in domestic + UCL (Saka, Haaland, etc.)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| FBref returns 403 | Must use real browser (Chrome). Open any FBref page first to pass Cloudflare. |
| JS context lost | Do NOT navigate away from FBref. All fetches use same-origin `fetch('/en/comps/...')`. |
| Supabase only returns 1000 rows | Player cache loading uses pagination (1000 per request in a loop). Verify the loaded count matches expectations (~36K+). |
| New clubs auto-inserted | The script auto-creates missing clubs (e.g. Pisa, Paris FC, Pafos FC). Check `newClubs` in the output. |
| Timeout on UCL | Break into separate fetch/parse/upsert steps (UCL has 800+ players across 3 pages). |
| Player UID mismatch | The updated `genUid()` tries: exact match → ±1 birth year → normalized ASCII match → new UID. Check the `matching` diagnostics in the output. |
| Stats not showing in games | Ensure games query `v_all_player_season_stats` (not `player_season_stats` directly). All 7 game backends were confirmed pointing to the view as of Feb 2026. |
| `await` not valid error | Wrap code in `(async () => { ... })()` — top-level await may not work in the browser console. |
| Duplicate player entries | If a player shows up twice in games (once with historical data, once with current), their UIDs don't match. Use the Player Lookup tool to check both UIDs and fix the mismatch. |

## Club Name Mapping

FBref uses abbreviated club names. The `__CLUB_NAME_MAP` handles known mismatches. If new clubs appear in future seasons or FBref changes its naming, add them to the map. Check `newClubs` in the ingestion output — if a club was auto-inserted that should have matched an existing one, add a mapping.

**Common patterns:**
- `Manchester Utd` → `Manchester United`
- `Nott'ham Forest` → `Nottingham Forest`
- `Paris S-G` → `Paris Saint-Germain`
- `M'Gladbach` → `Borussia Monchengladbach`

## Season Rollover Notes

When the season changes (e.g. 2026/27):
1. Update `season_label` from `'2025/26'` to `'2026/27'` in the ingestion function
2. Update `season_start_year` from `2025` to `2026`
3. The old current season data can be migrated to `player_season_stats` (historical) or left in place
4. FBref URLs stay the same (always show current season)
5. Consider truncating `current_season_player_stats` before the new season starts

## Expected Data Volumes (Feb 2026)

| League | Players | Total Apps | Total Goals |
|--------|---------|------------|-------------|
| Premier League | ~526 | ~7,873 | ~692 |
| La Liga | ~557 | ~7,320 | ~601 |
| Serie A | ~529 | ~7,216 | ~557 |
| Bundesliga | ~474 | ~6,093 | ~608 |
| Ligue 1 | ~490 | ~5,628 | ~506 |
| Champions League | ~753 | ~3,962 | ~431 |
| **Total** | **~3,329** | **~38,092** | **~3,395** |

## Competition IDs Reference

| League | Supabase `competition_id` | FBref comp ID |
|--------|--------------------------|---------------|
| La Liga | 1 | 12 |
| UCL | 2 | 8 |
| Serie A | 3 | 11 |
| Ligue 1 | 6 | 13 |
| Premier League | 7 | 9 |
| Bundesliga | 9 | 20 |
