# SESSION LOG — 2026-08-18

## Goal
Get TeleStats **Fives** ready for the 2026/27 Premier League season (starts Sat 22 Aug 2026).

## User's asks
1. Remove one player (name TBC — user to confirm)
2. Add new players
3. Archive last season's data + make it viewable via a toggle
4. Add a new competitor: **Picks AI** — auto-picks each week from its own research
5. Recommend other improvements
6. Confirm the API data still pulls through cleanly

## Tasks
- [x] Audit Fives schema (sql/004_predict_tables.sql) — season handling
- [x] Audit netlify functions (weeks, get-week, submit-picks, leaderboard, summary, admin-*, auto-score)
- [x] Audit external API integration (football-data.org v4)
- [ ] Audit frontend (predict-data.js, league.html, history.html, admin.html, picks-widget.js)
- [ ] Audit picks-reminder.js
- [ ] Produce readiness plan + recommendations

## Findings so far
- **No season concept anywhere in the Fives schema.** `predict_match_weeks.week_number` is
  globally UNIQUE; all-time totals live denormalised on `predict_users` (points,
  correct_results, incorrect_results, full_houses, blanks, current_week).
  → Season rollover is the single biggest blocker.
- API is **football-data.org v4** (`FOOTBALL_DATA_KEY`), NOT API-Football as CLAUDE.md claims.
- Prediction model is position-in-table driven → will be meaningless in MW1 (blank table).

## Full audit findings (complete)

### BLOCKER 1 — No season concept
`predict_match_weeks.week_number` is globally UNIQUE. Season totals (points,
correct_results, incorrect_results, full_houses, blanks, current_week) live
denormalised on `predict_users`. Nothing is scoped to a season.
→ Need `season` on weeks + a `predict_user_seasons` table before MW1.

### BLOCKER 2 — Deleting a player destroys the archive
`predict_predictions.user_id` → `predict_users(id) ON DELETE CASCADE`.
Deleting the departing player wipes every pick they ever made, breaking
last season's archive and the weekly-table history.
→ Soft delete via `is_active = false`, never DELETE.

### BLOCKER 3 — Prediction model is blind at MW1
`api-football-fixtures.js` weights league position ~65% and form ~15%.
At MW1 the football-data.org standings table is empty/all-zero and `form` is ''.
Every fixture will come out ~45/28/27. Needs a preseason prior
(last season's final table + promoted-club baseline), decayed as the table fills.

### RISK 4 — Two divergent code paths
Frontend uses `window.PredictData` (direct Supabase, keys off `match_week_id`).
Netlify functions `get-week / weekly-table / summary / history / submit-picks /
weeks / leaderboard` key off `predict_matches.week_number` and
`predict_predictions.week_number`, which `PredictData.seedWeek()` and
`PredictData.submitPicks()` never write.
→ Verify whether week_number is populated (trigger?) or those functions are dead.

### RISK 5 — auto-score may exceed the function timeout
5 sequential football-data.org calls × 6.5s delay = ~33s. Check Netlify logs.

### Misc
- CLAUDE.md said "API-Football" — corrected to football-data.org v4. [done]
- `admin-seed-week.js` writes `week_number` but not `match_week_id`;
  `PredictData.seedWeek()` writes `match_week_id` but not `week_number`.
  Both columns are NOT NULL in 004 — one path must be failing or the
  constraints have drifted.
- picks-reminder.js iterates all `predict_users` — a bot row with a null
  email will need excluding.

## Awaiting from user
- Name of departing player; names/emails of joiners
- Season label + week-numbering decision (continue vs restart at 1)
- Whether ANTHROPIC_API_KEY can be added to Netlify (for Picks AI)

## Decisions (user, mid-session)
- Week numbering: **restart at 1 + season column** → `sql/006_season_support.sql` written
- Picks AI: **Claude API with web search** (genuinely independent research)
- Saturday scope: season rollover + roster + Picks AI from Week 1

## Picks AI cost model — target < $2/season (38 weeks = $0.053/week)
Anthropic pricing (verified via claude-api skill, cached 2026-06-24):
- Haiku 4.5      $1 / $5   per MTok (in/out), 200K context
- Sonnet 5       $3 / $15  per MTok ($2/$10 intro to 2026-08-31)
- Opus 5         $5 / $25  per MTok
- **Web search   $10 per 1,000 searches = $0.01 each  ← dominant cost**

Web search dominates: 5 searches/wk alone = $0.05/wk = $1.90/season, leaving
nothing for tokens. Chosen configuration:
- Model `claude-haiku-4-5` (uses basic `web_search_20250305` — the
  `_20260209` dynamic-filtering variant needs Sonnet 4.6+/Opus 4.6+)
- `max_uses: 3` on the search tool  → $0.03/wk
- ~25K in / 1.5K out on Haiku       → $0.025 + $0.0075 = $0.033/wk
- **≈ $0.055/wk → ≈ $2.10/season (~£1.65)**
Prompt caching is useless here (weekly cadence >> 5-min TTL; Haiku 4.5 also
has a 4096-token cache minimum). Guard rails: hard `max_uses`, hard
`max_tokens`, one run per week enforced by a DB check, and log per-run
`usage` so spend is auditable.

## "You v AI" tab — reveal only after lockout
GOOD NEWS: already enforced in Postgres, not just UI. RLS policy
`pp_select_locked` (004) exposes a prediction only when
`m.locked = true OR m.lockout_time <= NOW()`. Picks AI has no `auth_id`, so
`pp_select_own` never matches it → its picks and rationale are unreadable
via the anon key until the week locks. Requirements:
- Rationale stored on `predict_predictions.rationale` → inherits that RLS
- The new tab MUST read via `PredictData` (anon key + RLS), never via a
  service-role Netlify function
- PRE-EXISTING LEAK: `summary.js` (service role) returns per-match pick
  distribution with NO lock check. Not AI-specific, but it means the crowd
  split is visible pre-lockout. Flag to user.
