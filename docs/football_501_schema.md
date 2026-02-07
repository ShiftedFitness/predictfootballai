# Football 501 - Database Schema & Category Mapping

## Overview

This document describes how the Football 501 game app connects to the Supabase database and maps category definitions to SQL queries.

## Database Tables

### Core Tables

| Table | Description |
|-------|-------------|
| `players` | Master player table with demographics |
| `clubs` | Club/team reference table |
| `competitions` | Competition reference |
| `player_season_stats` | Per-season player statistics (fact table) |

### Rollup Tables (Materialized Views)

| Table | Description |
|-------|-------------|
| `player_competition_totals` | Aggregated stats per player per competition |
| `player_club_totals` | Aggregated stats per player per club per competition |

### Key Columns

#### `players` table
- `player_uid` (PK) - Unique player identifier (format: "name|nationality|birth_year")
- `player_name` - Display name
- `normalized_player_name` - Lowercase, accent-stripped name for matching
- `nationality` - Format: "eng ENG" (lowercase then uppercase 3-letter code)
- `position` - Position bucket (GK, DF, MF, FW)

#### `player_competition_totals` table
- `player_uid` (FK) - References players
- `competition` - Full competition name (e.g., 'Premier League', 'Champions League')
- `appearances` - Total appearances
- `goals` - Total goals
- `minutes` - Total minutes
- `starts` - Total starts

#### `player_club_totals` table
- `player_uid` (FK) - References players
- `club` - Club name
- `competition` - Full competition name
- `appearances`, `goals`, `minutes`, `starts` - Aggregated stats

## Competition Identifiers

**IMPORTANT:** The database stores full competition names, NOT codes.

| Competition | DB Value | Display Code |
|-------------|----------|--------------|
| Premier League | `Premier League` | EPL |
| Champions League | `Champions League` | UCL |
| La Liga | `La Liga` | LALIGA |
| Serie A | `Serie A` | SERIEA |
| Bundesliga | `Bundesliga` | BUNDESLIGA |
| Ligue 1 | `Ligue 1` | LIGUE1 |

## Nationality Format

The `nationality` column uses a mixed format like "eng ENG" where:
- First part is lowercase (e.g., "eng")
- Second part is the 3-letter code in uppercase (e.g., "ENG")

The backend parses this to extract the uppercase code for filtering.

## Category to Query Mapping

### EPL Country Categories

Format: `country_{CODE}` or `epl_country_{CODE}`

Example query for French players in EPL:
```sql
-- Step 1: Get totals
SELECT player_uid, appearances, goals, minutes, starts
FROM player_competition_totals
WHERE competition = 'Premier League'
  AND appearances > 0;

-- Step 2: Get player info (separate query)
SELECT player_uid, player_name, normalized_player_name, nationality, position
FROM players
WHERE player_uid IN (...);

-- Step 3: Join in JavaScript and filter by nationality
```

### EPL Continent Categories

Format: `continent_{REGION}` or `epl_continent_{REGION}`

Regions map to nationality code arrays:
- `AFRICA`: NGA, GHA, CIV, SEN, CMR, MAR, ALG, TUN, EGY, RSA, COD, MLI, ZIM, ZAM
- `ASIA_OCEANIA`: AUS, NZL, JPN, KOR, CHN, IRN, SAU, UAE, QAT, IND, THA, MAS, ISR
- `CONCACAF`: USA, CAN, MEX, CRC, JAM, TRI, HON, PAN, GUA, SLV, HAI, CUB
- `SOUTH_AMERICA`: URU, CHI, COL, PER, ECU, PAR, VEN, BOL (excludes BRA, ARG)

### EPL Club Categories

Format: `club_{ClubName}`

Example query for Arsenal players:
```sql
SELECT player_uid, club, appearances, goals, minutes, starts
FROM player_club_totals
WHERE competition = 'Premier League'
  AND club = 'Arsenal'
  AND appearances > 0;
```

### EPL Goals Categories

Format: `goals_{ClubName}` or `goals_overall`

Uses `goals` instead of `appearances` for the subtract value.

### EPL Position Categories

Format: `epl_position_{POSITION}`

Positions: GK, DF, MF, FW

Filters players by `position` column in players table.

### UCL Categories

#### UCL Country: `ucl_country_{CODE}`
- `ucl_country_ALL` - All nationalities

#### UCL Goals: `ucl_goals_{CODE}`
- Uses `goals` as subtract value

#### UCL Club: `ucl_club_{ClubName}`

### Other League Categories

#### La Liga: `laliga_club_{ClubName}`, `laliga_goals_{ClubName}`
#### Serie A: `seriea_club_{ClubName}`, `seriea_goals_{ClubName}`
#### Bundesliga: `bundesliga_club_{ClubName}`, `bundesliga_goals_{ClubName}`

These categories are dynamically loaded using `get_top_clubs` query.

### Big 5 British

Format: `big5_british_apps`, `big5_british_goals`

Queries players with British nationalities (ENG, SCO, WAL, NIR) across:
- La Liga
- Serie A
- Bundesliga
- Ligue 1

(Excludes EPL)

### Custom Game

Format: `custom`

Accepts parameters:
- `metric`: 'appearances' or 'goals'
- `nationalities`: array of nationality codes (optional)
- `clubs`: array of club names (optional)
- `competition`: competition code (default: 'EPL')

### Chat Builder

Format: `chat_builder`

Accepts:
- `text`: Natural language query

Parses:
- Metric (appearances/goals)
- Competition
- Nationalities (from text)
- Clubs (from text)

## Architecture Notes

### No Foreign Key Relationships
The Supabase database does NOT have foreign key constraints between tables. This means:
- PostgREST embedded joins (`table!inner(...)`) will fail
- The backend uses **separate queries** and joins data in JavaScript
- Each fetch is done independently, then merged by `player_uid`

### Caching

**Backend (In-Memory):**
- 45-minute TTL cache for preview requests
- Cache key format: `preview_{categoryId}_{bodyHash}`

**Frontend (localStorage):**
- 90-minute TTL cache for category data
- Cache key format: `f501_{categoryId}`
- Cache includes `eligiblePlayers` array and `meta` object

## Frontend-Backend Communication

### Request Format

```json
{
  "categoryId": "club_Arsenal",
  "previewOnly": false
}
```

### Response Format

```json
{
  "meta": {
    "categoryId": "club_Arsenal",
    "categoryName": "Arsenal",
    "categoryFlag": "...",
    "competition": "Premier League",
    "metric": "appearances",
    "metricLabel": "Apps",
    "eligibleCount": 215
  },
  "eligiblePlayers": [
    {
      "playerId": "thierry henry|fra fra|1977",
      "name": "Thierry Henry",
      "normalized": "thierry henry",
      "nationality": "FRA",
      "subtractValue": 258,
      "overlay": {
        "apps": 258,
        "goals": 175,
        "mins": 20000,
        "starts": 220
      },
      "clubs": ["Arsenal"],
      "clubCount": 1,
      "seasonsCount": null
    }
  ]
}
```

## Adding New Categories

1. Add category definition to `CATEGORIES` object in `football_501.html`
2. Add handler in `match_start.js` (backend)
3. Add HTML section if new competition
4. Update `buildCategorySections()` to include new section

## Files Modified

- `public/football_501.html` - Single-page app UI
- `netlify/functions/match_start.js` - Backend API for match generation
- `netlify/functions/db-introspect.js` - Schema introspection utility

## Troubleshooting

### "column players_1.player_id does not exist"
The database uses `player_uid`, not `player_id`. Update all queries accordingly.

### "Could not find a relationship between tables"
PostgREST embedded joins require FK constraints. Use separate queries instead:
1. Query the totals table for `player_uid` and stats
2. Query the `players` table for player info
3. Join the results in JavaScript
