# Football 501 - Database Schema & Category Mapping

## Overview

This document describes how the Football 501 game app connects to the Supabase database and maps category definitions to SQL queries.

## Database Tables (Actual Schema)

### Core Tables

| Table | Columns |
|-------|---------|
| `players` | `player_uid` (PK), `player_name`, `nationality_raw`, `nationality_norm`, `birth_year`, `created_at` |
| `clubs` | `club_id` (PK), `club_name`, `country`, `created_at` |
| `competitions` | (exists) |
| `player_season_stats` | (fact table) |

### Rollup Tables

| Table | Key Columns |
|-------|-------------|
| `player_competition_totals` | `player_uid`, `competition`, `appearances`, `goals`, `minutes` |
| `player_club_totals` | `player_uid`, `club`, `competition`, `appearances`, `goals`, `minutes` |
| `player_club_competition_totals` | (exists) |
| `player_club_total_competition` | (exists) |
| `player_totals` | (exists) |

### View
- `v_game_player_club_comp`

### Staging
- `season_stats_staging`

## IMPORTANT: Column Names

The database uses these column names:
- **`player_uid`** (NOT `player_id`) - Primary key for players
- **`player_name`** (NOT `name`) - Display name
- **`nationality_norm`** - Normalized 3-letter code (e.g., "ENG", "FRA")
- **`nationality_raw`** - Raw nationality string
- **`appearances`** (NOT `apps_total`) - Total appearances
- **`goals`** (NOT `goals_total`) - Total goals
- **`minutes`** (NOT `mins_total`) - Total minutes
- **NO `starts` column** in rollup tables

## Competition Names

The database stores full competition names:

| Competition | DB Value |
|-------------|----------|
| Premier League | `Premier League` |
| Champions League | `Champions League` |
| La Liga | `La Liga` |
| Serie A | `Serie A` |
| Bundesliga | `Bundesliga` |
| Ligue 1 | `Ligue 1` |

## Architecture: Separate Queries (No Embedded Joins)

The database does NOT have foreign key relationships between tables. Therefore:
- PostgREST embedded joins (`table!inner(...)`) will fail
- The backend uses **separate queries** and joins data in JavaScript

### Query Pattern

```javascript
// Step 1: Query rollup table
const { data: totals } = await supabase
  .from('player_competition_totals')
  .select('player_uid, appearances, goals, minutes')
  .eq('competition', 'Premier League')
  .gt('appearances', 0);

// Step 2: Get player info separately
const playerUids = totals.map(r => r.player_uid);
const { data: players } = await supabase
  .from('players')
  .select('player_uid, player_name, nationality_norm')
  .in('player_uid', playerUids);

// Step 3: Join in JavaScript
const playerMap = new Map(players.map(p => [p.player_uid, p]));
const result = totals.map(row => {
  const player = playerMap.get(row.player_uid);
  return {
    playerId: row.player_uid,
    name: player.player_name,
    nationality: player.nationality_norm.toUpperCase(),
    subtractValue: row.appearances,
    overlay: { apps: row.appearances, goals: row.goals, mins: row.minutes }
  };
});
```

## Category IDs

### EPL Categories
- `country_{CODE}` - e.g., `country_ENG`, `country_FRA`
- `continent_{REGION}` - e.g., `continent_AFRICA`, `continent_CONCACAF`
- `club_{ClubName}` - e.g., `club_Arsenal`, `club_ManUtd`
- `goals_{ClubName}` - e.g., `goals_Liverpool`, `goals_overall`

### UCL Categories
- `ucl_country_{CODE}` - e.g., `ucl_country_ALL`, `ucl_country_ENG`
- `ucl_club_{ClubName}` - e.g., `ucl_club_RealMadrid`

### Other Leagues
- `laliga_club_{ClubName}`, `laliga_goals_{ClubName}`
- `seriea_club_{ClubName}`, `seriea_goals_{ClubName}`
- `bundesliga_club_{ClubName}`, `bundesliga_goals_{ClubName}`

### Special
- `big5_british_apps` - British players in Big 5 (ex EPL)
- `big5_british_goals`
- `chat_builder` - Custom game via natural language
- `custom` - Custom game with explicit filters
- `get_top_clubs` - Fetch top clubs for a competition

## Chat Builder

### Request
```json
{
  "categoryId": "chat_builder",
  "text": "English players who played for Sunderland, Man Utd, Liverpool and Spurs by appearances",
  "mode": "preview"
}
```

### Response
```json
{
  "meta": { ... },
  "proposal": {
    "competition": "Premier League",
    "metric": "Apps",
    "nationalities": ["ENG"],
    "clubs": ["Sunderland", "Manchester United", "Liverpool", "Tottenham Hotspur"]
  },
  "player_count": 42,
  "difficulty": "hard",
  "parsed": { ... }
}
```

### Feasibility Thresholds
- `>= 40 players` → OK (easy-medium)
- `20-39 players` → Warning (hard mode)
- `< 20 players` → Not feasible (force user to broaden)

## Caching

### Frontend
- localStorage keyed by `f501_{categoryId}` and `f501_chat_{hash}`
- TTL: 90 minutes for category data, 24 hours for chat feasibility

### Backend
- In-memory cache (if needed) keyed by category + params
- TTL: 30-60 minutes

## Files

- `netlify/functions/match_start.js` - Backend API
- `public/football_501.html` - Frontend single-page app
- `netlify/functions/db-introspect.js` - Schema introspection utility

## Troubleshooting

### "column players_1.player_id does not exist"
The database uses `player_uid`, not `player_id`. Update all queries.

### "player_competition_totals.starts does not exist"
The rollup tables do NOT have a `starts` column. Remove from select statements.

### "Could not find relationship between tables"
No FK relationships exist. Use separate queries and join in JavaScript.
