# Football 501 - Database Schema & Backend Wiring

> Last updated: 2026-02-08

## Supabase Tables

### Core Tables

| Table | PK | Columns | Notes |
|-------|-----|---------|-------|
| `players` | `player_uid` (text) | `player_name`, `nationality_raw`, `nationality_norm`, `birth_year`, `normalized_player_name`, `created_at` | |
| `clubs` | `club_id` (int) | `club_name`, `country`, `created_at` | |
| `competitions` | `competition_id` (int) | `competition_name`, `competition_group`, `created_at` | |

### Rollup/Aggregate Tables

| Table | PK | Key Columns | Status |
|-------|-----|-------------|--------|
| `player_club_total_competition` | composite | `player_uid`, `club_id`, `competition_id`, `appearances`, `goals`, `assists`, `minutes`, `seasons`, `first_season_start_year`, `last_season_start_year` | **HAS DATA** - used by view |
| `player_club_totals` | composite | `player_uid`, `club_id`, `appearances`, `starts`, `sub_appearances`, `minutes`, `goals`, `assists`, `seasons` | Has data |
| `player_totals` | `player_uid` | `appearances`, `starts`, `sub_appearances`, `minutes`, `goals`, `assists`, `seasons` | Has data |
| `player_competition_totals` | composite | `player_uid`, `competition_id`, `appearances`, `goals`, `assists`, `minutes`, `seasons_count` | **EMPTY (0 rows)** |
| `player_club_competition_totals` | composite | `player_uid`, `club_id`, `competition_id`, `appearances`, `goals`, `assists`, `minutes`, `seasons_count` | **EMPTY (0 rows)** |

### Fact Table

| Table | PK | Key Columns |
|-------|-----|-------------|
| `player_season_stats` | `id` (bigint) | `player_uid`, `competition_id`, `club_id`, `season_label`, `season_start_year`, `position_raw`, `position_bucket`, `age`, `appearances`, `starts`, `sub_appearances`, `minutes`, `goals`, `assists`, `pens_scored`, `pens_attempted`, `goals_against`, `clean_sheets`, `shots_on_target_against`, `saves`, `wins`, `draws`, `losses`, `tackles_won`, `interceptions`, `tackles_interceptions`, `is_u19`, `is_u21`, `is_35plus` |

### View

**`v_game_player_club_comp`** - The primary data source for Football 501:

```sql
SELECT t.player_uid, p.player_name, p.nationality_norm,
       t.competition_id, c.competition_name,
       t.club_id, cl.club_name,
       t.appearances, t.goals, t.assists, t.minutes,
       t.seasons, t.first_season_start_year, t.last_season_start_year
FROM player_club_total_competition t
  JOIN players p USING (player_uid)
  JOIN competitions c ON (c.competition_id = t.competition_id)
  JOIN clubs cl ON (cl.club_id = t.club_id)
```

### Staging

- `season_stats_staging` - Raw import staging table

## Foreign Keys

| Table | Column | References |
|-------|--------|------------|
| `player_club_competition_totals` | `club_id` | `clubs.club_id` |
| `player_club_competition_totals` | `competition_id` | `competitions.competition_id` |
| `player_club_competition_totals` | `player_uid` | `players.player_uid` |
| `player_club_total_competition` | `club_id` | `clubs.club_id` |
| `player_club_total_competition` | `competition_id` | `competitions.competition_id` |
| `player_club_totals` | `club_id` | `clubs.club_id` |
| `player_competition_totals` | `competition_id` | `competitions.competition_id` |
| `player_competition_totals` | `player_uid` | `players.player_uid` |
| `player_season_stats` | `club_id` | `clubs.club_id` |
| `player_season_stats` | `competition_id` | `competitions.competition_id` |
| `player_season_stats` | `player_uid` | `players.player_uid` |

## Critical: Column Names

- **`player_uid`** (NOT `player_id`) — text PK
- **`player_name`** (NOT `name`)
- **`nationality_norm`** — 3-letter ISO code (e.g. `ENG`, `FRA`)
- **`appearances`** (NOT `apps_total`)
- **`goals`** (NOT `goals_total`)
- **`position_bucket`** — values: `GK`, `DEF`, `MID`, `FWD` (only in `player_season_stats`)
- **No `starts` column** in `player_competition_totals` or `player_club_competition_totals`

## Competition Names (exact DB values)

| Competition | DB `competition_name` |
|-------------|----------------------|
| Premier League | `Premier League` |
| Champions League | `Champions League` |
| La Liga | `La Liga` |
| Serie A | `Serie A` |
| Bundesliga | `Bundesliga` |
| Ligue 1 | `Ligue 1` |

## EPL Club Names (exact DB values)

Clubs with multiple DB entries (data split across names):

| Display Name | Primary DB `club_name` | Also appears as |
|-------------|----------------------|----------------|
| Bournemouth | `Bournemouth` (92 players) | `AFC Bournemouth` (7 players) |
| Brighton | `Brighton & Hove Albion` | `Brighton` |
| Man Utd | `Manchester United` | `Manchester Utd` |
| Wolves | `Wolverhampton Wanderers` | `Wolves` |
| Sheff Wed | `Sheffield Weds` | — |

## Backend Architecture

### Query Strategy

ALL queries go through `v_game_player_club_comp` view (NOT the empty `player_competition_totals` table).

Exception: Position and Age categories use `player_season_stats` with a two-step lookup to `players` for names.

### Category Handlers

| Category Pattern | Handler | Data Source |
|-----------------|---------|-------------|
| `country_{CODE}` | `fetchFromView(PL, null, code)` | view |
| `continent_{REGION}` | `fetchFromView(PL, null, codes[])` | view |
| `club_{Name}` | `fetchFromView(PL, clubName)` | view |
| `goals_{Name}` | `fetchFromView(PL, clubName, null, 'goals')` | view |
| `epl_position_{POS}` | `fetchByPosition(PL, bucket)` | `player_season_stats` |
| `epl_age_{bucket}` | `fetchByAgeBucket(PL, field)` | `player_season_stats` |
| `ucl_country_{CODE}` | `fetchFromView(CL, null, code)` | view |
| `ucl_goals_{CODE}` | `fetchFromView(CL, null, code, 'goals')` | view |
| `ucl_club_{Name}` | `fetchFromView(CL, clubName)` | view |
| `{league}_{club\|goals}_{Name}` | `fetchFromView(league, clubName)` | view |
| `big5_british_apps` | `fetchFromViewMultiComp(non-EPL, BRIT)` | view |
| `chat_builder` | `parseChatQuery()` → `fetchFromView()` | view |
| `custom` | explicit filters → `fetchFromView()` | view |
| `get_top_clubs` | `getTopClubs(competition)` | view |

## Files

- `netlify/functions/match_start.js` — Backend API (Netlify Function)
- `public/football_501.html` — Frontend single-page app (monolithic HTML+CSS+JS)
- `netlify/functions/db-introspect.js` — Schema introspection utility

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `column players_1.player_id does not exist` | Using `player_id` instead of `player_uid` | Fix column name |
| `player_competition_totals.starts does not exist` | No `starts` column in that table | Remove from select |
| `Could not find relationship` | PostgREST embedded join on table without FK | Use view or two-step query |
| Country categories return 0 players | Querying empty `player_competition_totals` | Use `v_game_player_club_comp` view |
| Club returns 0 players | Club name doesn't match DB exactly | Check aliases, use `.in()` for multi-name clubs |
