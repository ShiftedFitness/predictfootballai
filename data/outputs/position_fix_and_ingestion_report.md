# PredictFootballAI — Position Fix & Current Season Ingestion Report

**Date:** 2026-02-14
**Author:** Claude (automated)
**Database:** Supabase (cifnegfabbcywcxhtpfn)

---

## Part 1: EPL Position Stabilization

### Problem
305 EPL players had inconsistent `position_bucket` values across seasons due to FBref listing positions in varying order (e.g., `FW,MF` in one season, `MF,FW` in another). The existing bucketing logic took the first listed position, causing the same player to be classified as FWD in some seasons and MID in others. Additionally, 1 player had an `UNK` bucket.

### Resolution Algorithm
- **Majority-by-appearances**: Assigned each player the bucket they had in the majority of their appearances
- **Tiebreak**: Most recent season, then season count
- **Confidence**: 247 high (>1.5x margin), 58 medium (>1x margin), 0 low

### Changes Applied

#### Bulk multi-bucket fix (305 players)
All 305 players with inconsistent buckets were standardized to a single canonical bucket using the majority algorithm.

#### Manual overrides (user-specified)
| Player | From | To | Reason |
|--------|------|----|--------|
| David Silva | FWD | MID | User override |
| Andros Townsend | FWD | MID | User override |
| Cesc Fabregas | FWD | MID | User override (mojibake name variant) |

#### Fabregas-like FWD→MID fixes (7 clear-cut midfielders)
| Player | Apps | Seasons |
|--------|------|---------|
| Ryan Giggs | 632 | 22 |
| Paul Merson | 280 | 10 |
| Morten Gamst Pedersen | 260 | 8 |
| Freddie Ljungberg | 241 | 10 |
| Tim Cahill | 226 | 8 |
| Clint Dempsey | 218 | 8 |
| Robert Pires | 198 | 7 |

#### Additional user overrides (FWD→MID)
| Player | Apps | Seasons |
|--------|------|---------|
| Nick Barmby | 343 | 15 |
| Shaun Wright-Phillips | 316 | 14 |
| David Ginola | 195 | 8 |

#### DEF→MID fixes (user-specified)
| Player | Apps | Seasons |
|--------|------|---------|
| James Milner | 602 | 26 |
| Nicky Butt | 411 | 17 |
| Kieran Richardson | 265 | 15 |
| Kevin Kilbane | 325 | 13 |

#### UNK fix
| Player | Club | Season | Resolution |
|--------|------|--------|------------|
| Paul Shepherd | Leeds United | 1996/97 | UNK → FWD (1 appearance, position_raw was NULL) |

### Backup
All original values preserved in `_backup_position_bucket_20260214` table for rollback.

### Final EPL Position Distribution
| Bucket | Rows | Distinct Players |
|--------|------|-----------------|
| DEF | 6,721 | 1,757 |
| FWD | 4,453 | 1,323 |
| GK | 1,472 | 375 |
| MID | 5,560 | 1,567 |
| **Total** | **18,206** | **5,022** |

- **UNK rows**: 0
- **Multi-bucket players**: 0

### Rollup Rebuild
`compute_performance_scores()` was re-executed. New count: 2,844 rows (was 2,921).

---

## Part 2: Current Season Ingestion Infrastructure

### New Database Objects

#### Table: `current_season_player_stats`
- Mirrors `player_season_stats` schema with added `updated_at` column
- Unique constraint on `(player_uid, competition_id, club_id, season_label)` for upsert
- Indexes on `competition_id+season_label`, `player_uid`, `club_id`
- Auto-update trigger on `updated_at`

#### View: `v_all_player_season_stats`
- UNION ALL of `player_season_stats` (source='historical') and `current_season_player_stats` (source='current')
- Drop-in replacement for queries that need combined data

### New Scripts

#### `scripts/ingest_current_season.js`
- Scrapes FBref standard stats, keeper stats, and defensive stats for 6 leagues
- Generates player_uid in same format as historical data
- Maps FBref club names to Supabase club_ids
- Creates new player records as needed
- Upserts into `current_season_player_stats` (idempotent)
- Supports `--dry-run`, `--league <name>`, `--verbose` flags
- Polite 4s delay between FBref requests

**Target leagues:**
| League | FBref Comp ID | Supabase Comp ID |
|--------|--------------|-----------------|
| Premier League | 9 | 7 |
| La Liga | 12 | 1 |
| Serie A | 11 | 3 |
| Bundesliga | 20 | 9 |
| Ligue 1 | 13 | 6 |
| Champions League | 8 | 2 |

#### `scripts/weekly_update.sh`
- Wrapper script for weekly execution
- Installs dependencies if missing
- Logs to `data/logs/`
- Optional auto-rebuild of performance scores (commented out)

### SQL Migration
`sql/002_current_season_table.sql` — full migration file for the table, view, and trigger.

---

## How to Run the Ingestion

```bash
# 1. Set environment variables
export Supabase_Project_URL='https://cifnegfabbcywcxhtpfn.supabase.co'
export Supabase_Service_Role='<your-service-role-key>'

# 2. Install dependencies (if not already)
cd /path/to/predictfootballai
npm install cheerio node-fetch@2

# 3. Dry run first (parse FBref but don't write to Supabase)
node scripts/ingest_current_season.js --dry-run --verbose

# 4. Run for real (all 6 leagues)
node scripts/ingest_current_season.js

# 5. Or run for a single league
node scripts/ingest_current_season.js --league epl

# 6. Weekly updates
./scripts/weekly_update.sh
```

---

## Files Changed (Local Only — Not Committed)

| File | Action | Description |
|------|--------|-------------|
| `sql/002_current_season_table.sql` | **NEW** | Migration for current_season_player_stats table + view |
| `scripts/ingest_current_season.js` | **NEW** | FBref scraper + Supabase upserter |
| `scripts/weekly_update.sh` | **NEW** | Weekly wrapper script |
| `package.json` | **MODIFIED** | Added cheerio dependency |

## Supabase Changes (Live)

| Object | Action | Description |
|--------|--------|-------------|
| `player_season_stats` | **MODIFIED** | Position buckets fixed for ~320 EPL players |
| `_backup_position_bucket_20260214` | **NEW** | Backup table with original values |
| `current_season_player_stats` | **NEW** | Empty table ready for ingestion |
| `v_all_player_season_stats` | **NEW** | Combined view (historical + current) |
| `update_csps_updated_at()` | **NEW** | Trigger function |
| `player_performance_scores` | **REBUILT** | Re-computed after position changes (2,844 rows) |

---

## Borderline Players Left as-is (For Future Review)

These FWD-bucketed players have `FW,MF` in position_raw but were left as FWD. The user may want to revisit:

Damien Duff, Dwight Yorke, Gabriel Agbonlahor, Luis Boa Morte, Graham Stuart, Alan Smith, Harry Kewell, Jason Euell, El Hadji Diouf, Stuart Ripley, Keith Gillespie, Eidur Gudjohnsen, Marcus Gayle, Carlos Tevez, Darren Huckerby, Kevin Gallacher, Cristiano Ronaldo

These DEF-bucketed players have `DF,MF` in position_raw but were left as DEF:

Jamie Carragher, Phil Neville, John O'Shea, Steve Watson, Matthew Taylor, Martin Keown, John Arne Riise, Paul Telfer, Antonio Valencia, Phil Jagielka, Dominic Matteo, Chris Brunt, Ledley King, Pablo Zabaleta, Seamus Coleman, Ricardo Gardner, Brett Emerton, Jlloyd Samuel, Dean Whitehead, Michael Gray, Olof Mellberg, Kyle Walker, Paul Scharner
