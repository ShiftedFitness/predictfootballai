# Multi-Club Player Merge Summary

Generated: 2026-02-06T11:10:19.223Z

## Overview

| Category | Count | Description |
|----------|-------|-------------|
| **Merge Ready** | 310 player-seasons (590 rows) | Apps match within ±1 |
| **Mismatched** | 33 player-seasons | Apps differ by > 1 |
| **Unresolved** | 197 player-seasons | Could not resolve via SportMonks |

## Merge-Ready Details

- **Total rows**: 590
- **Unique player-seasons**: 310
- **Ready for Supabase import**: YES

These rows have been validated:
- Per-club appearances sum matches original total (±1 tolerance)
- All clubs have appearances > 0
- Confidence scores >= 0.5

## Mismatched Cases (33)

These player-seasons resolved but have appearance discrepancies > 1:

| Player | Season | Original | Resolved | Diff | Clubs |
|--------|--------|----------|----------|------|-------|
| Dwight Yorke | 2004/05 | 17 | 11 | 6 | Blackburn Rovers(4), Birmingham City(7) |
| Mark Pembridge | 2003/04 | 16 | 11 | 5 | Fulham(7), Everton(4) |
| Michael Brown | 2005/06 | 16 | 14 | 2 | Tottenham Hotspur(8), Fulham(6) |
| Michael Bridges | 2003/04 | 16 | 6 | 10 | Newcastle United(6) |
| Steve Howey | 2003/04 | 16 | 14 | 2 | Bolton Wanderers(2), Leicester City(12) |
| David Unsworth | 2006/07 | 15 | 12 | 3 | Wigan Athletic(7), Sheffield United(5) |
| Celestine Babayaro | 2004/05 | 11 | 4 | 7 | Chelsea(4) |
| Eric Djemba-Djemba | 2004/05 | 11 | 5 | 6 | Manchester United(5) |
| Noé Pamarot | 2005/06 | 10 | 6 | 4 | Portsmouth(4), Tottenham Hotspur(2) |
| Matt Jansen | 2005/06 | 10 | 7 | 3 | Blackburn Rovers(4), Bolton Wanderers(3) |
| Mikael Forssell | 2004/05 | 5 | 3 | 2 | Birmingham City(2), Chelsea(1) |
| Louis Saha | 2003/04 | 33 | 10 | 23 | Fulham(10) |
| Paul Konchesky | 2003/04 | 33 | 15 | 18 | Charlton Athletic(15) |
| Ashley Young | 2006/07 | 33 | 31 | 2 | Aston Villa(11), Watford(20) |
| Nigel Quashie | 2004/05 | 32 | 19 | 13 | Portsmouth(6), Southampton(13) |
| Scott Parker | 2003/04 | 31 | 19 | 12 | Charlton Athletic(8), Chelsea(11) |
| Lomana LuaLua | 2003/04 | 29 | 11 | 18 | Portsmouth(8), Newcastle United(3) |
| Amdy Faye | 2004/05 | 29 | 25 | 4 | Portsmouth(20), Newcastle United(5) |
| John Curtis | 2003/04 | 27 | 21 | 6 | Portsmouth(6), Leicester City(15) |
| Robbie Savage | 2004/05 | 27 | 18 | 9 | Blackburn Rovers(9), Birmingham City(9) |
| Paul Jones | 2003/04 | 26 | 13 | 13 | Liverpool(2), Wolverhampton Wanderers(3), Southampton(8) |
| Kevin Campbell | 2004/05 | 22 | 12 | 10 | West Bromwich Albion(7), Everton(5) |
| Jermaine Pennant | 2004/05 | 19 | 10 | 9 | Birmingham City(6), Arsenal(4) |
| Steven Caldwell | 2003/04 | 18 | 5 | 13 | Newcastle United(5) |
| Wayne Bridge | 2010/11 | 18 | 16 | 2 | West Ham United(15), Manchester City(1) |
| Johan Djourou | 2007/08 | 15 | 13 | 2 | Birmingham City(12), Arsenal(1) |
| Demba Ba | 2012/13 | 34 | 28 | 6 | Chelsea(8), Newcastle United(20) |
| Danny Graham | 2012/13 | 31 | 29 | 2 | Sunderland(13), Swansea City(16) |
| Louis Saha | 2011/12 | 28 | 23 | 5 | Tottenham Hotspur(5), Everton(18) |
| Gary O'Neil | 2007/08 | 28 | 3 | 25 | Portsmouth(2), Middlesbrough(1) |
| Michael Brown | 2009/10 | 26 | 24 | 2 | Portsmouth(22), Wigan Athletic(2) |
| Wayne Bridge | 2008/09 | 22 | 18 | 4 | Manchester City(12), Chelsea(6) |
| Shay Given | 2008/09 | 37 | 25 | 12 | Manchester City(3), Newcastle United(22) |

**Recommendation**: Review these manually before including in merge.

## Unresolved by Reason (197 total)

| Reason | Count | Action Required |
|--------|-------|-----------------|
| Season not found in SportMonks | 136 | Review case-by-case |
| No player matches found | 34 | Review case-by-case |
| No per-team stats available for this season | 19 | Review case-by-case |
| Best match score 0.36 below threshold 0.5 | 2 | Review case-by-case |
| Best match score 0.40 below threshold 0.5 | 1 | Review case-by-case |
| Best match score 0.44 below threshold 0.5 | 1 | Review case-by-case |
| Best match score 0.39 below threshold 0.5 | 1 | Review case-by-case |
| Best match score 0.46 below threshold 0.5 | 1 | Review case-by-case |
| Best match score 0.23 below threshold 0.5 | 1 | Review case-by-case |
| Best match score 0.49 below threshold 0.5 | 1 | Review case-by-case |

## Import Instructions

### To replace "2 Teams/3 Teams" rows in Supabase:

1. **Delete** existing rows where `club_raw` matches "N Teams" pattern for player_uids in merge-ready set
2. **Insert** all rows from `resolved_multiclub_rows_merge_ready.csv`
3. **Leave unchanged** any rows in mismatched or unresolved sets

### Key columns for import:
- `player_uid` - matches original player identifier
- `season` - e.g., "2017/18"
- `club` - resolved club name (e.g., "Liverpool", "Arsenal")
- `appearances`, `goals`, `minutes`, `starts`, `sub_appearances`
- `sportmonks_player_id`, `sportmonks_team_id` - for data lineage

## Data Quality Notes

- All merge-ready rows have confidence scores >= 0.5
- Minutes, starts, and sub_appearances may be NULL where SportMonks lacks data
- Goals are included where available
- Original player_uid is preserved for referential integrity
