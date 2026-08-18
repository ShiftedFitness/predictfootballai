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

## Diagnostic result #1 (user, 2026-08-18)
Query 3 errored: `column "week_number" does not exist`.
→ **CONFIRMED: `predict_matches.week_number` is absent from the live DB.**
The schema drifted from migration 004. `PredictData.seedWeek()` only ever
wrote `match_week_id`, so the column was never created (or was later dropped).

Consequence: these seven functions filter on `predict_matches.week_number`
and have therefore been returning **nothing** — they are dead code, and the
frontend `PredictData` path is the only live one:
  get-week.js, weekly-table.js, summary.js, history.js, weeks.js,
  leaderboard.js, submit-picks.js

Fix applied (not "remove the references" — repair the column, which revives
those functions too):
- `sql/006_season_support.sql` §3 now does
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS week_number INTEGER` on BOTH
  predict_matches and predict_predictions, before anything reads or writes it,
  plus indexes. The existing backfill + triggers then keep it correct.
- `sql/PRESEASON_DIAGNOSTIC.sql` query 3 rewritten to use information_schema
  so it can no longer fail on a missing column; 3b (the null/mismatch counts)
  is commented out until 006 has run.

STILL NEEDED from the user: diagnostic queries 1, 2 and 4.

## Budget revised (user, 2026-08-18)
User raised the cap: 5 searches/week, $5/season acceptable.
- `MAX_SEARCHES` default 3 → 5, system prompt updated (5 searches ~= one per
  fixture, so spend them on the least certain matches).
- Revised estimate on Haiku 4.5: 5 searches (5c) + ~30K in / 2K out (4c)
  = ~9c/week = **~$3.40/season**, comfortably inside $5 with re-run headroom.
- Sonnet 5 at the same shape would be ~$5.60-6.50/season — slightly over cap,
  so staying on Haiku. `PICKS_AI_MODEL` env var switches it if wanted.

## Built this session
- `netlify/functions/picks-ai.js` — NEW. Researches via Claude + web search,
  submits picks through a strict `submit_picks` tool, validates every pick
  against the week's match_ids, upserts with source='ai' + rationale, logs
  spend to predict_ai_runs. Handles pause_turn and refusal. Guarded by a
  one-run-per-week check so retries cannot double-spend.
- `netlify.toml` — picks-ai scheduled `0 9,18 * * *`.
- `picks-reminder.js` — now excludes `is_bot` and inactive players.
- `predict-data.js` — `getVersusAI()` + `getVersusAISeason()`, on the anon
  key so RLS does the reveal-gating.
- `league.html` — third tab "You v AI": scoreline, verdict, per-match pick
  comparison, AI rationale, season W/D/L. Opens on the newest LOCKED week.
- `package.json` — added @anthropic-ai/sdk ^0.117.1.

## Verified
- All JS syntax-checked (node --check), incl. league.html inline block.
- You v AI tab driven in a browser against stubbed data: correct default week,
  score 3-4, verdict text, 5 fixtures, 5 rationales, 7 right / 3 wrong markers,
  agreement notes, winner/loser colouring, theme variables resolving, no
  horizontal overflow at 375px.
- NOT verified: the live Claude API call (no local ANTHROPIC_API_KEY). Must be
  smoke-tested on Netlify with {dryRun:true} before Saturday.

## Picks AI made strategic (user request)
User: "it shouldn't predict in isolation — factor in league position, patterns
from previous weeks, and the right amount of risk to chase the 5-point bonus."

IMPORTANT MATHS CORRECTION encoded in the prompt: for independent matches,
picking the argmax outcome in every match maximises BOTH expected correct
count AND P(all five correct) simultaneously. There is NO safe-vs-bonus
trade-off, and deliberately picking an upset you don't believe in strictly
lowers the full-house chance. So "take more risk to chase the bonus" is
counterproductive as stated.

The real strategic lever is competitive: whether to CORRELATE with the field
or DIFFERENTIATE from it.
  - leading / near top  → play the percentages, lead survives
  - mid-table, time left→ play the percentages, let accuracy compound
  - well behind, few wks→ differentiate on near-coin-toss matches only
  - never deviate on a match it is confident about
This is what the prompt now instructs, and it delivers what the user wanted
(position-aware, pattern-aware, risk-calibrated) for the correct reason.

Implemented:
- `gatherStrategicContext()` — league position, points, gap to leader and to
  the players immediately above/below, weeks played/remaining, its own last 6
  weekly scores (incl. full houses and blanks), and crowd tendencies mined
  from ALREADY-LOCKED past weeks (majority-pick accuracy, field pick split vs
  actual result split, e.g. "the field under-picks draws by N points").
- `renderStrategicContext()` turns that into a readable brief.
- `submit_picks` tool gained a required `strategy` string; stored on
  predict_ai_runs.strategy.
- Fairness preserved: it never reads the CURRENT week's picks from anyone.
  Only its own data and locked historical data.

Surfacing the strategy note without leaking it early:
- predict_ai_runs stays RLS deny-all (keeps spend private).
- New view `predict_ai_week_notes` exposes ONLY (season, week_number,
  strategy) and bakes the lockout check into its WHERE clause. Deliberately a
  non-security_invoker view so it reads past the deny-all RLS; Supabase's
  linter will flag "security definer view" — that is intended and no cost or
  token data is reachable through it.
- `PredictData.getAIWeekNote()` reads the view; degrades to '' if it does not
  exist (un-migrated DB) rather than breaking the tab.
- Rendered in the You v AI tab as "Its approach this week: ..." (escaped).

## Gap found in my own migration (fixed)
predict_user_seasons was created but NOTHING wrote to it, so the current
season would have shown zeros all year in the season toggle.
- `_supabase.js` gained `currentSeason()` + `syncSeasonStandings()`.
- `admin-score-week.js` and `auto-score.js` now mirror every scored total into
  predict_user_seasons. syncSeasonStandings never throws — a mirror failure
  must not abort an already-scored week.

## Diagnostic result #2 (user)
Query 6 (orphan check): orphan_by_user 0, orphan_by_match 0,
orphan_match_week 0 — referential integrity is clean.
STILL OUTSTANDING: query 1 (what weeks exist) — needed before running 006,
because 006 labels EVERY existing week '2025/26'.

## Diagnostic result #3 — weeks (user)
38 weeks, 5 matches each, first_lockout 2025-08-15 → last 2026-05-24.
Exactly ONE season. The '2025/26' archive label in 006 is correct. GREEN LIGHT
on the migration (after a Supabase snapshot).

BUT the output exposed something important: weeks 1-26 are status 'closed',
weeks 27-38 are still 'open' despite lockouts months in the past. Confirmed by
grep: **nothing in the codebase ever writes predict_match_weeks.status.**
It is set to 'open' at seed time and only ever changed by hand. The status
column is decorative.

That, combined with restarting week numbers at 1, would have broken FOUR
things once the new season started. All now fixed:

1. auto-score.js picked "the latest week with unscored matches" by week_number
   across the whole table → last season's week 38 outranks the new season's
   week 1, so the new season would NEVER have been scored.
   → now filtered to the current season.

2. admin-score-week.js resolved a week with
   .eq('week_number', n).maybeSingle() → once week 1 exists in two seasons
   that throws "multiple rows returned".
   → now filtered to the current season.

3. predict-data.js ensureWeekLookup() built numToId[week_number] = id across
   ALL weeks → "week 1" would resolve to whichever season's row was processed
   last, i.e. the frontend could silently serve last season's fixtures.
   → idToNum still covers every season (historical matches must still resolve
     their number), but numToId is now built from the CURRENT season only.
     getWeeks() filters to current-season week ids. seedWeek()'s existence
     check is season-scoped and it now stamps season explicitly on insert.

4. picks-ai.js and picks-reminder.js both target status='open' weeks → the 12
   stale open weeks from last season were permanent candidates.
   → both now filtered to the current season. picks-ai also stopped counting
     weeksPlayed via status==='scored' (always 0, since nothing sets it) and
     counts weeks with actual results instead.

_supabase.js gained currentSeason() (cached per invocation); predict-data.js
gained its own client-side equivalent. Both degrade to null on a pre-006
database so every code path behaves exactly as before until 006 is applied.

STILL UNKNOWN: whether weeks 27-38 actually have results in. If they do not,
last season's archived final table will be incomplete (recoverable — the raw
predictions are all intact and can be re-scored, then the archive updated).

## Diagnostic result #4 — results (user)
Weeks 27-38 all show results_in = 5. Every one of last season's 190 matches
has a correct_result. The stale 'open' status is cosmetic only.

Remaining question before the archive is frozen: results being IN is not the
same as the week being SCORED (correct_result on the match vs points_awarded
on each prediction + totals on predict_users). Wrote
sql/FINAL_CHECK_BEFORE_006.sql to reconcile stored points against
SUM(points_awarded) + 5*full_houses per player. It doubles as the roster
query, which is still outstanding.
PASS condition: unscored_picks = 0 and discrepancy = 0 on every row.

## Diagnostic result #5 — reconciliation PASSED (user)
All 24 players: discrepancy 0, unscored_picks 0. Last season is fully and
correctly scored; predict_users totals are safe to freeze as the 2025/26
final table. (Roster details deliberately not copied into this log — it is
committed to git and the query returns personal email addresses. Re-run
sql/FINAL_CHECK_BEFORE_006.sql when the list is needed.)

2025/26 champion: craigtee, 95 pts (90 correct + 1 full house).
Runner-up: Chappers, 92 pts (82 correct + 2 full houses).
Squad size 24 → 25 once Picks AI joins, before the leaver/joiners.

**GREEN LIGHT GIVEN** on BACKUP_BEFORE_006.sql then 006_season_support.sql.

## Remaining before Saturday
- [ ] User runs backup + 006, then deploys
- [ ] Roster changes: name of the departing player (soft-delete via
      is_active=false — NEVER DELETE, predict_predictions cascades and would
      destroy the archive we just verified), plus joiners' usernames + emails
- [ ] Smoke test picks-ai on Netlify with {dryRun:true, force:true} —
      the only thing never executed against the live Claude API
- [ ] Seed 2026/27 week 1 via admin, confirm it lands with season='2026/27'
- [ ] Verify the MW1 prediction prior problem (standings empty at MW1 makes
      api-football-fixtures' suggestions meaningless) — NOT YET BUILT

## 006 attempt #1 FAILED — more schema drift (fixed)
ERROR 42703: record "new" has no field "updated_at", from
predict_set_updated_at(). Transaction rolled back, DB untouched; the bak_
tables from BACKUP_BEFORE_006.sql survived (separate transaction).

Cause: same drift class as the missing week_number. Migration 004 declared
updated_at on predict_match_weeks / predict_matches / predict_predictions and
attached the trigger, but the live tables lack the column while still
carrying the trigger. The first UPDATE in 006 (section 2, on
predict_match_weeks) tripped it.

Fix — new SECTION 0, placed before any UPDATE runs:
  (a) ADD COLUMN IF NOT EXISTS created_at/updated_at on all three tables,
      restoring 004's intent
  (b) harden predict_set_updated_at() to skip the assignment when the row has
      no updated_at field. plpgsql resolves record fields at runtime, so the
      guarded branch is never compiled for a table lacking it. Uses
      jsonb_exists() rather than the `?` operator, which some SQL clients
      mistake for a bind-parameter placeholder.
(b) means this class of failure cannot take the migration down again, on any
predict_* table, including ones we have not inspected.

Safe to re-run 006 as-is — every statement is IF NOT EXISTS / idempotent and
attempt #1 left nothing behind.

## 006 attempt #2 FAILED — same error, but the line number is the clue
Identical message, including "line 3 at assignment".

That line number rules something out. plpgsql numbers from the start of the
function body:
  ORIGINAL (004):  1 blank, 2 BEGIN, 3 NEW.updated_at = NOW()   ← line 3
  HARDENED (006):  1 blank, 2 BEGIN, 3 IF jsonb_exists…, 4 assignment
So the failure came from the ORIGINAL function body. Either the copy of 006
that was run predated section 0, or the trigger resolves to a different
function object than the one section 0 replaces.

Stopped guessing. Wrote sql/DIAGNOSE_TRIGGER.sql (read-only, 3 queries):
  1. pg_get_functiondef of predict_set_updated_at — is the hardened body live?
  2. every trigger calling it + whether that table actually has updated_at
  3. created_at/updated_at presence across all predict_* tables
Awaiting output before touching 006 again.

Also extended section 0 to cover predict_users (section 6d updates it).

## Note on FINAL_CHECK_BEFORE_006.sql
User says they have not run it — but the 24-row output they sent has exactly
its column list (stored_points / expected_points / discrepancy /
unscored_picks). They ran the inline one-liner version pasted in chat, which
is the same query. The reconciliation IS done and it passed.

## 006 attempt #3 — got much further, failed at section 8
ERROR 42P16: cannot change name of view column "id" to "season".
Section 0 worked (different error = different section), so the schema repair
landed and the migration reached the league table view.

Cause: CREATE OR REPLACE VIEW can only APPEND columns — never reorder or
rename. 004's predict_league_table starts with `id`; the new one starts with
`season`.
Fix: DROP VIEW IF EXISTS before CREATE VIEW. No CASCADE — nothing in the app
reads that view (frontend and leaderboard.js both read predict_users
directly), so a dependency error there would be real news, not something to
steamroll.

## De-risked: bot user creation moved out of 006 → new sql/007
Checked register-user.js and auth.js for how a predict_users row is normally
created — there is no insert path in the app at all (users predate it or came
from the Adalo migration), so predict_users' NOT NULL requirements are
unverified. Rather than risk a fourth failure on the critical migration, the
Picks AI INSERT moved to sql/007_roster_and_picks_ai.sql.

Rationale: the season rollover is the critical path and is not retryable
piecemeal; roster changes are trivially retryable in isolation.

sql/007 contains:
  1. READ-ONLY column/NOT NULL inventory of predict_users (the query 4 that
     was never run) — check before inserting
  2. Picks AI user insert (no auth_id — that is what keeps its picks private;
     real-looking email so a NOT NULL email cannot break it)
  3. departing player SOFT DELETE template, with a prominent warning that
     DELETE cascades to predict_predictions and would destroy the archive
  4. joiners template
  5. final roster verification showing 2026/27 and 2025/26 side by side

## ✅ 006 + 007 (steps 1-2) APPLIED SUCCESSFULLY — 2026-08-18
Verification output confirms:
- Picks AI created as user id 25, is_bot=true, is_active=true,
  joined_season='2026/27', points_2026_27=0, points_2025_26=NULL (correct —
  it did not play last season).
- All 24 humans: is_active=true, joined_season='2025/26', points_2026_27=0,
  points_2025_26 = their true final total (craigtee 95, Chappers 92,
  Callum/Nick 87 ... Hawkesy 65).
=> The 2025/26 archive is intact and 2026/27 has started from zero for
   everyone. The season rollover is COMPLETE.

Squad is currently 25 (24 humans + Picks AI), before the leaver and joiners.

## Remaining before Saturday 22 Aug
- [ ] 007 steps 3-4: departing player soft-delete + joiners  ← BLOCKED on names
- [ ] Deploy the code (season-aware scoring/lookup fixes, picks-ai, You v AI)
- [ ] Smoke test: POST /picks-ai {dryRun:true, force:true} — never yet run
      against the live Claude API
- [ ] Seed 2026/27 week 1 via admin; confirm it lands with season='2026/27'
- [ ] MW1 prediction prior — NOT BUILT. At MW1 the football-data.org
      standings table is empty, so api-football-fixtures.js gives every team
      position 10 and every fixture comes out ~45/28/27. Makes the admin
      fixture suggestions useless for the first weeks and degrades the form
      strings Picks AI reads.
- [ ] Drop the bak_* tables once week 1 is scored

## BUG: app served LAST SEASON's week 1 (fixed) — 2026-08-18
User reported seeing 2025/26 week 1 data on the picks page and in admin,
after the migration.

Root cause was MY fallback in predict-data.js, not just an undeployed build:

  resolveWeekId(weekNum) returned `weekNum` itself when the lookup missed.
  Harmless while week numbers were globally unique. With two seasons and
  2026/27 not yet seeded, the chain was:
    getWeeks()            → [] (correctly scoped to current season)
    index.html            → recommendedPickWeek || latest || 1  → 1
    resolveWeekId(1)      → miss → falls back to 1
    .eq('match_week_id',1)→ LAST SEASON's week 1 row
  i.e. it silently served last year's fixtures and picks as if live.

Fixes:
- resolveWeekId() now returns NULL when the current season has no such week.
  The old passthrough is kept ONLY for pre-006 databases (lookup.season null),
  where there is no season to disambiguate against.
- getWeekMatches() returns [] on a null id — never issues an unfiltered query.
- scoreWeek()/getMissingPredictions() throw a clear error instead.
- index.html no longer defaults to week 1; shows "The new season hasn't
  started yet" when the season has no weeks.
- league.html Matchweek tab likewise shows "No matchweeks yet this season".
- admin.html:1432 and getHistory's `|| 1` left as-is — both are now harmless
  because resolveWeekId is the single choke point, and defaulting the admin
  week field to 1 is what you want when seeding a new season.

Expected state after deploy, BEFORE week 1 is seeded:
  picks page   → "The new season hasn't started yet"
  league Overall → 25 players, all zero
  Matchweek/You v AI → "no matchweeks yet"
  admin        → week field 1, no fixtures listed, ready to seed

## "Can't seed week 1" — mostly a UI trap, now fixed
"No matches found for this week" comes from loadMatches() in the RESULTS &
SCORING panel (admin.html:321), which lists EXISTING matches. Week 1 of
2026/27 does not exist yet, so that message is correct, not a failure.
Seeding lives in the separate "Seed Next Week" panel further down the page.

But there WAS a real trap for a fresh season:
- loadMatches() ended with `$('nextWeek').value = String(week + 1)`. On a new
  season, loading week 1 (empty) set the seed field to 2 — so the obvious
  next click would have created week 2 and skipped week 1 entirely.
  → now advances only if the loaded week actually had matches; otherwise it
    points at that same week, which is the one still to be seeded.
- Nothing pre-filled the seed week on an empty season.
  → admin init now detects "no weeks this season", sets nextWeek = 1, and
    shows an explicit status line saying the Results panel being empty is
    expected.

NOTE for MW1 seeding: the "suggested 5" ranking and the enrichment
percentages will be meaningless this week — football-data.org's standings
table is empty until results exist, so every team resolves to position 10 and
every fixture lands ~45/28/27. Choose the five fixtures manually. This is the
MW1 prior issue, still unbuilt.
