# Multi-Club Player Data Repair Pipeline

This document describes the data repair pipeline for resolving Premier League players who played for multiple clubs in the same season.

## Problem Statement

The source data contains rows where players appear with `club_raw` values like "2 Teams" or "3 Teams" instead of specific club names. These aggregated rows break downstream rollups and analytics because:

1. We cannot attribute stats to specific clubs
2. We cannot join with club-level data
3. Transfer analysis is impossible without per-club splits

## Solution Overview

The `resolve_multiclub_pl.js` script:

1. Reads problematic multi-club player rows from a CSV file
2. Uses the SportMonks Football API v3 to identify the actual clubs
3. Retrieves per-club statistics for each player-season combination
4. Outputs clean, split rows (one per player-club-season)

## How It Works

### Player Matching

The script uses a multi-factor confidence scoring system to match input rows to SportMonks player records:

| Factor | Weight | Method |
|--------|--------|--------|
| Name Similarity | 40% | Levenshtein distance-based string similarity |
| Nationality | 30% | ISO country code matching |
| Birth Year | 30% | Derived from season + age_in_season (±1 year tolerance) |

Players with confidence scores below **0.5** are sent to the unresolved file.

### Season Resolution

The script:
1. Parses season strings (e.g., "2017/18")
2. Queries SportMonks for English Premier League seasons
3. Caches season IDs to minimize API calls

### Stats Extraction

For each matched player-season:
1. Query player statistics filtered by season ID
2. Attempt to get per-team breakdown from statistics endpoint
3. If unavailable, query player's team associations for the season
4. Extract per-team stats where available

## Installation

The script uses Node.js built-in modules only. No additional dependencies required.

Ensure you have Node.js v18+ installed (for native `fetch` support).

## Configuration

### Environment Variable

Set your SportMonks API token:

```bash
export SPORTMONKS_API_TOKEN=your_api_token_here
```

### Rate Limiting

The script respects SportMonks rate limits:
- 1100ms delay between requests (under 60/minute limit)
- Exponential backoff on 429 responses
- Maximum 3 retries per request

## Usage

### Basic Usage

```bash
node scripts/resolve_multiclub_pl.js --input data/multi_club_players.csv
```

### Test with Limited Rows

```bash
node scripts/resolve_multiclub_pl.js --input data/multi_club_players.csv --limit 5
```

### Dry Run (No Output Files)

```bash
node scripts/resolve_multiclub_pl.js --input data/multi_club_players.csv --dry-run
```

### All Options

```
--input <path>    Path to input CSV file (default: data/multi_club_players.csv)
--limit <N>       Process only first N rows (for testing)
--dry-run         Run without writing output files
```

## Input File Format

Expected columns in the input CSV:

| Column | Description | Example |
|--------|-------------|---------|
| player_name | Display name | "Alex Oxlade-Chamberlain" |
| normalized_player_name | Lowercase normalized | "alex oxlade-chamberlain" |
| nationality | Country codes | "eng ENG" |
| season | Season string | "2017/18" |
| competition | Always "Premier League" | "Premier League" |
| club_raw | Original value | "2 Teams" |
| appearances | Total appearances | 35 |
| goals | Total goals | 3 |
| minutes | Total minutes | 1734 |
| age_in_season | Player age | 23 |
| position | Position(s) | "MF" |
| player_uid | Unique identifier | "alex-oxlade...\|eng\|1994" |
| multi_club_key | Season key | "alex-oxlade...\|2017/18" |

## Output Files

### resolved_multiclub_rows.csv

Each row represents one player-club-season combination.

| Column | Description |
|--------|-------------|
| player_uid | Original player UID |
| player_name | Player display name |
| nationality | Normalized country code |
| season | Season string |
| competition | "Premier League" |
| club | **Actual club name** (resolved) |
| appearances | Club-specific appearances |
| goals | Club-specific goals |
| minutes | Club-specific minutes |
| starts | Club-specific starts |
| sub_appearances | Club-specific substitute appearances |
| sportmonks_player_id | SportMonks player ID |
| sportmonks_season_id | SportMonks season ID |
| sportmonks_team_id | SportMonks team ID |
| confidence_score | Match confidence (0.0-1.0) |
| resolution_source | "sportmonks" |

### unresolved_multiclub_rows.csv

Rows that could not be confidently resolved.

Includes all original columns plus:

| Column | Description |
|--------|-------------|
| reason_unresolved | Why resolution failed |
| candidate_players | JSON array of top SportMonks candidates |

### audit_report.md

Human-readable summary including:
- Total rows processed
- Resolution success rate
- Breakdown of failure reasons
- Per-player stats validation (sum check)

## Caching

The script caches API responses in `data/cache/`:

- `player_search_cache.json` - Player search results
- `season_cache.json` - Season ID lookups
- `team_cache.json` - Team information

Caches persist across runs to minimize API calls.

## Inspecting Unresolved Cases

1. Open `data/outputs/unresolved_multiclub_rows.csv`
2. Check `reason_unresolved` column for failure reason
3. Check `candidate_players` for alternative matches
4. Common reasons:
   - **no_player_match**: Player name not found in SportMonks
   - **low_confidence**: Match score below threshold
   - **no_team_split**: SportMonks has aggregate stats only
   - **insufficient_teams**: Only found 1 team instead of 2+

## Manual Resolution

For unresolved rows:

1. Search SportMonks manually for the player
2. Verify correct player ID matches name + nationality + birth year
3. Query their statistics endpoint directly
4. Add manually verified rows to the resolved CSV

## Assumptions

1. **Premier League Only**: This script only handles English Premier League data.

2. **SportMonks Data Completeness**: We assume SportMonks has per-team stats for most players. Some historical seasons may have limited data.

3. **Name Matching**: We use fuzzy matching. Players with very common names or non-ASCII characters may need manual verification.

4. **Birth Year Derivation**: We calculate birth year from season + age. This has ±1 year tolerance to account for birthday timing.

5. **Stat Types**: We look for standard stat types (appearances, goals, minutes, starts). Some stats may be unavailable for certain players/seasons.

## Intended Merge Process

After running this script:

1. **Review** `audit_report.md` for coverage statistics
2. **Inspect** `unresolved_multiclub_rows.csv` for manual fixes
3. **Validate** that per-club appearances sum to original total
4. **Merge** `resolved_multiclub_rows.csv` into your master dataset:
   - Remove original "2 Teams" rows
   - Insert resolved per-club rows
   - Maintain referential integrity via `player_uid`

## Troubleshooting

### "SPORTMONKS_API_TOKEN not set"

```bash
export SPORTMONKS_API_TOKEN=your_token
```

### Rate Limit Errors

The script handles 429 errors with exponential backoff. If you hit persistent rate limits:
- Increase `RATE_LIMIT_MS` in the script
- Run during off-peak hours
- Use `--limit` to process in smaller batches

### Low Resolution Rate

Check if:
- Player names have encoding issues (special characters)
- Seasons are outside SportMonks data coverage
- Players are too obscure for SportMonks database

### Missing Statistics

SportMonks may not have per-team splits for all players. These appear in `unresolved_multiclub_rows.csv` with reason `no_team_split`.

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/seasons?filters[league_id]=8` | Get Premier League season IDs |
| `/players/search/{name}` | Search players by name |
| `/players/{id}?include=statistics.details` | Get player stats |
| `/statistics/seasons/players/{id}` | Get season stats with team splits |
| `/teams/{id}` | Get team information |

## Future Improvements

1. **Alternative Data Sources**: Add fallback to other APIs (e.g., Football-Data.org)
2. **Interactive Mode**: CLI for manual disambiguation
3. **Batch Processing**: Resume interrupted runs
4. **Stats Validation**: Automated sum-checking against original totals
