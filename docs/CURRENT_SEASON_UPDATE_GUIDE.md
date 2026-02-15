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
| Combined view | `v_all_player_season_stats` (UNION ALL of historical + current) |
| Metadata table | `ingestion_meta` (tracks last update timestamp) |
| Frontend display | `index.html` footer shows "Current season stats updated: [date]" |
| Migration SQL | `sql/002_current_season_table.sql` |
| Node.js ingestion script | `scripts/ingest_current_season.js` (backup approach) |

## Step-by-Step Update Process

### Step 1: Open FBref in the Browser

Navigate to any FBref stats page to establish the session (this bypasses Cloudflare):

```
https://fbref.com/en/comps/9/stats/Premier-League-Stats
```

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
  window.__playerCache = {};
  let loaded = 0;
  for (let start = 0; start < 50000; start += 1000) {
    const res = await fetch(`${SB_URL}/rest/v1/players?select=player_uid&order=player_uid&offset=${start}&limit=1000`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    });
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    for (const p of batch) window.__playerCache[p.player_uid] = true;
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

window.genUid = function(name, nat, year) {
  return `${name.toLowerCase().normalize('NFD').trim()}|${(nat||'').toLowerCase().trim()}|${year||''}`;
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

  const statsDoc = await fetchDoc('stats');
  const keepersDoc = await fetchDoc('keepers');
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
  // AUTO-INSERT missing clubs so no players are skipped (e.g. newly promoted teams, minor UCL clubs)
  const newPlayers = []; const records = []; const newClubs = new Set();
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
    const age = p.ageStr.includes('-') ? parseInt(p.ageStr.split('-')[0]) : (parseInt(p.ageStr)||null);
    const kKey = `${p.name}|${p.team}`;
    const gk = keepersMap[kKey]||{}; const def = defenseMap[kKey]||{};
    if (!window.__playerCache[uid]) {
      newPlayers.push({ player_uid:uid, player_name:p.name,
        nationality_raw: p.nat.split(' ').pop()||'',
        nationality_norm: (p.nat.split(' ').pop()||'').toUpperCase(),
        birth_year: parseInt(p.born)||null });
      window.__playerCache[uid] = true;
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

  return { league:leagueName, players:standard.length, newPlayers:pInserted, statsUpserted:sUpserted, newClubs:[...newClubs] };
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
await fetch(`${SB_URL}/rest/v1/ingestion_meta?on_conflict=key`, {
  method: 'POST', headers,
  body: JSON.stringify([{
    key: 'current_season_last_updated',
    value: '<summary of what was ingested>',
    updated_at: new Date().toISOString()
  }])
});
```

### Step 7: Verify

Check the data was written correctly:

```javascript
// Count by league
const h = { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Prefer': 'count=exact' };
for (const [name, compId] of [['EPL',7],['La Liga',1],['Serie A',3],['Bundesliga',9],['Ligue 1',6],['UCL',2]]) {
  const r = await fetch(`${SB}/rest/v1/current_season_player_stats?competition_id=eq.${compId}&select=id&limit=1`, { headers: h });
  console.log(`${name}: ${r.headers.get('content-range')}`);
}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| FBref returns 403 | Must use real browser (Chrome). Open any FBref page first to pass Cloudflare. |
| New clubs auto-inserted | The script auto-creates missing clubs (e.g. Pisa, Paris FC, Pafos FC) so no players are skipped. Check `newClubs` in the output to see what was added. |
| Timeout on UCL | Break into separate fetch/parse/upsert steps (UCL has 800+ players). |
| Player UID mismatch | UIDs use `name.normalize('NFD').toLowerCase()`. Historical data may have mojibake — this is expected. |
| Stats not showing in games | Ensure games query `v_all_player_season_stats` (not `player_season_stats` directly). |

## Season Rollover Notes

When the season changes (e.g. 2026/27):
1. Update `season_label` from `'2025/26'` to `'2026/27'`
2. Update `season_start_year` from `2025` to `2026`
3. The old current season data can be migrated to `player_season_stats` (historical) or left in place
4. FBref URLs stay the same (always show current season)

## Expected Data Volumes (Feb 2026)

| League | Players |
|--------|---------|
| Premier League | ~526 |
| La Liga | ~557 |
| Serie A | ~530 |
| Bundesliga | ~474 |
| Ligue 1 | ~490 |
| Champions League | ~750 |
| **Total** | **~3,300** |
