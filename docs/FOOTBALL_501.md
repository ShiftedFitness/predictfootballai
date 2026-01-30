# Football 501 - Supabase Migration

## Overview

Football 501 is a player-guessing game where users name Premier League players from specific categories (countries or clubs) to subtract their appearance count from 501.

## Testing the API

### Start a Match (get eligible players)

```bash
# Country category (French players)
curl -X POST https://your-netlify-site.netlify.app/.netlify/functions/match_start \
  -H "Content-Type: application/json" \
  -d '{"categoryId": "country_FRA"}'

# Club category (Arsenal players)
curl -X POST https://your-netlify-site.netlify.app/.netlify/functions/match_start \
  -H "Content-Type: application/json" \
  -d '{"categoryId": "club_Arsenal"}'
```

### Available Categories

**Countries:**
- `country_FRA` - France
- `country_ESP` - Spain
- `country_ARG` - Argentina
- `country_NED` - Netherlands
- `country_POR` - Portugal

**Clubs:**
- `club_Arsenal` - Arsenal
- `club_ManUtd` - Manchester United
- `club_Liverpool` - Liverpool
- `club_Leicester` - Leicester City
- `club_Sunderland` - Sunderland

### Response Format

```json
{
  "meta": {
    "categoryId": "country_FRA",
    "categoryName": "France",
    "categoryFlag": "🇫🇷",
    "competition": "EPL",
    "metric": "apps_total",
    "eligibleCount": 150,
    "datasetVersion": "epl_v1",
    "hintBlurb": "French players have been a staple...",
    "trivia": [
      {
        "q": "Which French player has the most Premier League appearances?",
        "options": ["Patrice Evra", "Thierry Henry", "Sylvain Distin", "N'Golo Kanté"],
        "answer": 2
      }
    ]
  },
  "eligiblePlayers": [
    {
      "playerId": 123,
      "name": "Thierry Henry",
      "normalized": "thierry henry",
      "nationality": "FRA",
      "subtractValue": 258,
      "overlay": {
        "apps": 258,
        "goals": 175,
        "mins": 21320,
        "starts": 240,
        "club": null
      }
    }
  ]
}
```

## Caching (Client-Side)

The frontend caches API responses in `localStorage` with a **90-minute TTL**.

### Cache Key Format
```
f501_cache_{categoryId}
```

Example: `f501_cache_country_FRA`

### Cache Structure
```json
{
  "data": { /* API response */ },
  "timestamp": 1706500000000
}
```

### Cache Behavior
- On page load, checks if cached data exists and is < 90 minutes old
- If valid cache exists, uses cached data (no API call)
- If no cache or expired, fetches fresh data from API
- Cache is category-specific (switching categories may trigger new API call)

## Adalo WebView URL

Paste this URL into your Adalo WebView component:

```
https://your-netlify-site.netlify.app/football_501.html
```

### URL Parameters (Optional)

You can pre-select a category by adding a query parameter:

```
https://your-netlify-site.netlify.app/football_501.html?category=country_FRA
https://your-netlify-site.netlify.app/football_501.html?category=club_Arsenal
```

## Data Source

The function queries two Supabase tables:

1. **player_competition_totals** - For country categories
   - Joined with `players` table
   - Filtered by `nationality` and `competition = 'EPL'`

2. **player_club_totals** - For club categories
   - Joined with `players` table
   - Filtered by `club` and `competition = 'EPL'`

## Environment Variables Required

Set these in Netlify:

- `Supabase_Project_URL` - Your Supabase project URL
- `Supabase_Service_Role` - Service role key (server-side only)

## Local Development

```bash
# Install dependencies
npm install

# Run locally (requires netlify CLI)
netlify dev

# Test locally
curl -X POST http://localhost:8888/.netlify/functions/match_start \
  -H "Content-Type: application/json" \
  -d '{"categoryId": "country_FRA"}'
```
