# Football Starting XI — Game Mode

> Last updated: 2026-02-08

## Overview

**Starting XI** is a new game mode where users pick a Starting XI for a given scope, formation, and objective. The app evaluates whether their picks match the algorithmically-computed optimal XI.

**URL:** `/football_xi.html`

---

## How It Works

### Step 1 — Setup
Users choose three things:
1. **Scope** — Premier League (All-time) or one of 5 clubs (Sunderland, Man Utd, Arsenal, Liverpool, Chelsea)
2. **Formation** — 4-4-2, 4-3-3, 4-2-3-1, 3-5-2, or 3-4-3
3. **Objective** — Appearances, Goals, or Performance

### Step 2 — Pick XI
- A football pitch is rendered with 11 slots positioned by the chosen formation
- Each slot is labeled with a role (GK, LB, CB, RB, CM, ST, etc.)
- Tapping a slot opens a search modal with player suggestions
- Players are filtered by position bucket (GK/DEF/MID/FWD) and scope
- Minimum appearance thresholds are enforced (40 for league, 20 for club)
- Once all 11 slots are filled, the "GO" button activates

### Step 3 — Evaluate
- The server computes the optimal XI and compares with user picks
- Correct picks are locked (green, cannot change)
- Wrong picks are highlighted (red) and can be swapped
- Users get up to 5 attempts
- After 3+ attempts, a "Reveal All Answers" option appears
- Scoring is bucket-based: a player is correct if they appear in ANY slot of the same position bucket in the best XI

---

## Architecture

### Files

| File | Purpose |
|------|---------|
| `public/football_xi.html` | Frontend — single-page app with pitch UI |
| `netlify/functions/xi_start.js` | Backend — setup data, player search, best XI computation |
| `netlify/functions/xi_score.js` | Backend — evaluate user picks against best XI |
| `sql/001_player_performance_scores.sql` | SQL migration — performance scoring table + computation function |
| `docs/FOOTBALL_XI.md` | This file |

### API Endpoints

All endpoints are POST to `/.netlify/functions/xi_start` or `/.netlify/functions/xi_score`.

#### xi_start

| Action | Body | Returns |
|--------|------|---------|
| `get_scopes` | `{ action: 'get_scopes' }` | Scopes, formations, objectives |
| `search_players` | `{ action: 'search_players', query, positionBucket, scopeId }` | Up to 10 matching players |
| `get_best_xi` | `{ action: 'get_best_xi', scopeId, formation, objective }` | The optimal XI |

#### xi_score

| Body | Returns |
|------|---------|
| `{ scopeId, formation, objective, picks: [{slotIdx, playerId}], reveal: bool }` | Per-slot correct/incorrect, score, answers (if reveal=true) |

### Database Tables Used

| Table | Usage |
|-------|-------|
| `player_season_stats` | Position-filtered aggregation for apps/goals objectives |
| `players` | Player names and nationalities |
| `clubs` | Club ID lookup |
| `competitions` | Competition ID lookup |
| `player_performance_scores` | **NEW** — Pre-computed performance scores |

### Position Bucket Mapping

| Formation Slot | `position_bucket` |
|---------------|-------------------|
| GK | `GK` |
| LB, CB, RB | `DEF` |
| LM, CM, RM, CDM, CAM, LWB, RWB, LAM, RAM | `MID` |
| ST, LW, RW | `FWD` |

---

## Performance Scoring

### Formula

Scores are computed per-player, per-scope (league or club), per-position-bucket.

**FWD + MID (Attacking Score):**
```
raw = ((goals × 4) + (assists × 3) + ((goals + assists) × 1)) / max(nineties, 1) × √appearances
```

**DEF (Defensive Score):**
```
raw = ((tackles_interceptions × 0.08) + (assists × 2) + (goals × 2)) / max(nineties, 1) × √appearances
```

**GK (Goalkeeper Score):**
```
cs_rate = clean_sheets / appearances
save_rate = saves / shots_on_target_against (capped 0–1)
ga_per90 = goals_against / max(nineties, 1)
raw = (cs_rate × 5) + (save_rate × 4) - (ga_per90 × 2) × √appearances
```

**Normalization:** Z-score within each (scope_type, scope_id, position_bucket) group.

### Running the Computation

Execute the SQL migration in Supabase SQL editor:
```sql
-- Run in Supabase SQL Editor
\i sql/001_player_performance_scores.sql
```

Or paste the contents of `sql/001_player_performance_scores.sql` directly into the editor.

The migration will:
1. Create the `player_performance_scores` table
2. Create the `compute_performance_scores()` function
3. Execute the computation

To recompute scores (e.g., after data updates):
```sql
SELECT compute_performance_scores();
```

---

## Minimum Appearance Thresholds

| Scope | Min Appearances |
|-------|----------------|
| League (EPL All-time) | 40 |
| Club | 20 |

These apply to all objectives (apps, goals, performance) to avoid obscure picks.

---

## Tie-Break Rules

When players have the same score for an objective:
1. Higher `appearances` wins
2. Then higher `minutes`
3. Then alphabetical `player_name`

This ensures deterministic results.

---

## Scoring Logic

A user's pick for a slot is **correct** if the player appears in **any slot of the same position bucket** in the best XI. This avoids penalizing users for placing the best CB in slot 2 vs slot 3.

Example: If the best DEF are Ashley Cole, John Terry, Rio Ferdinand, Gary Neville (in a 4-defender formation), a user who picks those 4 in any order across the 4 DEF slots gets all 4 correct.

---

## Testing Checklist

- [ ] Can load EPL league scope
- [ ] Can load each club scope (Sunderland, Man Utd, Arsenal, Liverpool, Chelsea)
- [ ] Can pick formation and see correct 11 slots
- [ ] Player search suggestions work for each slot
- [ ] Only position-appropriate players appear in search
- [ ] GO evaluates: locks correct picks, highlights incorrect
- [ ] Allows retry with wrong picks cleared
- [ ] Best XI is consistent (deterministic tie-breaks)
- [ ] Performance scoring respects min appearance thresholds
- [ ] Reveal shows all answers after 3 attempts
- [ ] "Start New Challenge" resets everything
- [ ] No changes break football_501.html
- [ ] Mobile responsive (tested at 360px width)

---

## Future Enhancements

- Add more clubs / leagues as data becomes available
- Add share results / screenshot feature
- Add leaderboard / fastest time
- Add hints (e.g., show nationality flag for a slot)
- Add difficulty levels (adjust min appearance thresholds)
- Add "Custom Formation" builder
