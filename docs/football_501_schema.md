# Football 501 - Database Schema & Category Mapping

## Overview

This document describes how the Football 501 game app connects to the Supabase database and maps category definitions to SQL queries.

## Database Tables

### Core Tables

| Table | Description |
|-------|-------------|
| `players` | Master player table with demographics |
| `clubs` | Club/team reference table |
| `competitions` | Competition reference (EPL, UCL, La Liga, etc.) |
| `player_season_stats` | Per-season player statistics (fact table) |

### Rollup Tables (Materialized Views)

| Table | Description |
|-------|-------------|
| `player_competition_totals` | Aggregated stats per player per competition |
| `player_club_totals` | Aggregated stats per player per club per competition |

### Key Columns

#### `players` table
- `player_id` (PK) - Unique player identifier
- `name` - Display name
- `normalized_name` - Lowercase, accent-stripped name for matching
- `nationality` - 3-letter country code (e.g., 'ENG', 'FRA')
- `position` - Position bucket (GK, DF, MF, FW)

#### `player_competition_totals` table
- `player_id` (FK) - References players
- `competition` - Competition code (e.g., 'EPL', 'UCL', 'La Liga')
- `apps_total` - Total appearances
- `goals_total` - Total goals
- `mins_total` - Total minutes
- `starts_total` - Total starts

#### `player_club_totals` table
- `player_id` (FK) - References players
- `club` - Club name
- `competition` - Competition code
- `apps_total`, `goals_total`, `mins_total`, `starts_total` - Aggregated stats

## Competition Identifiers

| Competition | Code | Description |
|-------------|------|-------------|
| Premier League | `EPL` | English Premier League |
| Champions League | `UCL` | UEFA Champions League |
| La Liga | `La Liga` | Spanish top flight |
| Serie A | `Serie A` | Italian top flight |
| Bundesliga | `Bundesliga` | German top flight |
| Ligue 1 | `Ligue 1` | French top flight |

## Category to Query Mapping

### EPL Country Categories

Format: `country_{CODE}` or `epl_country_{CODE}`

Example query for French players in EPL:
```sql
SELECT pct.*, p.name, p.nationality
FROM player_competition_totals pct
JOIN players p ON pct.player_id = p.player_id
WHERE pct.competition = 'EPL'
  AND p.nationality = 'FRA'
  AND pct.apps_total > 0
ORDER BY pct.apps_total DESC;
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
SELECT pct.*, p.name, p.nationality
FROM player_club_totals pct
JOIN players p ON pct.player_id = p.player_id
WHERE pct.competition = 'EPL'
  AND pct.club = 'Arsenal'
  AND pct.apps_total > 0
ORDER BY pct.apps_total DESC;
```

### EPL Goals Categories

Format: `goals_{ClubName}` or `goals_overall`

Uses `goals_total` instead of `apps_total` for the subtract value.

### EPL Position Categories

Format: `epl_position_{POSITION}`

Positions: GK, DF, MF, FW

Requires `position` column in players table.

### UCL Categories

#### UCL Country: `ucl_country_{CODE}`
- `ucl_country_ALL` - All nationalities

#### UCL Goals: `ucl_goals_{CODE}`
- Uses `goals_total` as subtract value

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
- `metric`: 'apps_total' or 'goals_total'
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
    "competition": "EPL",
    "metric": "apps_total",
    "metricLabel": "Apps",
    "eligibleCount": 215
  },
  "eligiblePlayers": [
    {
      "playerId": "abc123",
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
      "clubs": ["Arsenal", "Monaco"],
      "clubCount": 2,
      "seasonsCount": 8
    }
  ]
}
```

## Caching

- Frontend caches category data in localStorage with 90-minute TTL
- Cache key format: `f501_{categoryId}`
- Cache includes `eligiblePlayers` array and `meta` object

## Adding New Categories

1. Add category definition to `CATEGORIES` object in `football_501.html`
2. Add handler in `match_start.js` (backend)
3. Add HTML section if new competition
4. Update `buildCategorySections()` to include new section

## Files Modified

- `public/football_501.html` - Single-page app UI
- `netlify/functions/match_start.js` - Backend API for match generation
- `netlify/functions/db-introspect.js` - Schema introspection utility
