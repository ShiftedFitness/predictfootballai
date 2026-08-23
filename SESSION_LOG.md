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

## Roster settled (user, 2026-08-18)
- Departing: **WombleDan** (id 14, 80 pts in 2025/26, 190 picks). Written into
  sql/007 step 3 as a SOFT DELETE (is_active=false, left_season='2025/26')
  plus removal of their 2026/27 standings row. Their picks and archived
  finish stay intact.
- Joiners: **none**. Step 4 marked as nothing to run, with a template kept
  in comments for a mid-season addition.
=> 2026/27 squad = 23 humans + Picks AI = 24.

## MW1 predictions — where the numbers actually come from
User asked whether the API supplies a predicted outcome we could piggyback on.
VERIFIED via https://docs.football-data.org/general/v4/index.html:
football-data.org exposes Area / Competition / Match / Team / Person / Trend
and **provides no predictions, probabilities or odds of any kind.**
The prediction_home/draw/away percentages are computed by OUR OWN code in
api-football-fixtures.js:120 (sigmoid over league-position gap + form + H2H),
which is exactly why they flatten to ~45/28/27 at MW1 — the input table is
empty.

Alternatives investigated:
- API-Football (api-sports.io): free plan is 100 req/day and all endpoints
  including /predictions are available on it. Would need a new signup + key.
  UNVERIFIED RISK: the free plan has historically restricted which SEASONS
  are accessible; pricing page returned HTTP 403 to WebFetch so this was not
  confirmed. Must be checked before relying on it for 2026/27.
- Polymarket (user's suggestion — they have a working repo elsewhere):
  conceptually the best source, since market prices are calibrated
  probabilities and have no cold-start problem at MW1.
  Probed the public Gamma API directly: /markets ordered by volume returned
  no football; /events ignores slug_contains and caps at 100 per page, and a
  100-event scan for all 20 PL club names found ZERO EPL markets. Coverage of
  individual PL fixtures is therefore UNCONFIRMED — stopped rather than keep
  guessing at an API the user already has working code for.
  → ASKED the user to point at their Polymarket repo.

## Polymarket as the prediction source — BUILT & VERIFIED against live API
User's idea, and it is strictly better than the last-season prior I was about
to build: market prices are calibrated probabilities AND have no cold-start
problem, which was the entire MW1 issue.

Verified live (no auth needed — public read):
  GET https://gamma-api.polymarket.com/events?tag_slug=epl&closed=false
  - 15 clean three-way match-result markets currently open, INCLUDING every
    fixture for Sat 22 Aug
  - overround 1.000-1.015 → prices are near-pure probabilities
  - team naming matches football-data.org exactly ("Crystal Palace FC")
  - kickoff date is in the SLUG (epl-eve-cry-2026-08-22), NOT startDate
    (startDate is when the market opened — a trap)
  - real examples: Everton v Palace 45/28/27, Hull v Man Utd 10/19/71,
    Arsenal v Coventry 83/11/6
  - liquidity $180k-$560k per fixture

NOTE: the user does NOT need the Relayer API key they were about to create.
Relayer is for submitting wallet transactions (trading). We only read public
market data. Told them so — no trading credential should go near this app.

New netlify/functions/_polymarket.js:
  - fetchEplMatchMarkets(): one unauthenticated call for the whole matchweek
  - parseGameEvent(): rejects derivative markets (halftime / second half /
    first team to score) — the real match-result market is the ONLY one
    containing a draw leg, which is the discriminator used
  - findMarketForFixture(): normalised team matching (strips FC/AFC, maps
    united→utd, token-overlap fallback) + slug-date matching within 2 days
  - MIN_LIQUIDITY 5000 — a thin book at a silly price is worse than no price
  - percentages derive the third from the other two so they sum to EXACTLY
    100 (independent rounding gave 101 and would have biased the
    Poisson-binomial)
  - returns [] on ANY failure → caller falls back to the model. Never fatal.

api-football-fixtures.js:
  - new resolvePrediction(): market first, in-house model as fallback
  - used in BOTH listFixtures and enrichSingleFixture
  - exposes predictionSource ('market'|'model'), marketSlug, marketLiquidity
  - form + H2H still come from football-data.org and are still displayed —
    they just no longer drive the percentages (as the user asked)
  - advice text now states which source produced the number
admin.html: enrich payload now sends homeTeam/awayTeam/date, which the
  server needs for the market lookup (it previously sent only IDs, so the
  lookup would have silently fallen back to the model every time).

KNOCK-ON, exactly as the user wanted: picks-widget.js calculateProbabilities()
already runs an exact Poisson-binomial over prediction_home/draw/away, so the
"chance of getting 1, 2, 3... correct" numbers become market-backed with NO
change to that code.

## Decision changed: Picks AI now sees the market odds
Originally hidden, because they were the admin's own model and reading them
would not have been "independent research". That reasoning died with the
source change: the numbers are now market prices that every human player sees
on the picks page before choosing. Hiding them would HANDICAP Picks AI, not
keep it honest.
So it now gets market parity, plus prompt guidance to treat the price as a
starting point and move off it only for concrete late news or when its league
position calls for differentiation. Flagged to the user as a reversible call.

## refresh-odds.js — NEW, keeps market percentages current
seedWeek() snapshots prediction_home/draw/away once at seed time; markets
move between seeding and kickoff, so players (and Picks AI, which reads the
same columns) could be looking at days-old prices.

netlify/functions/refresh-odds.js, scheduled "0 4,16 * * *" (every 12h):
- current season's weeks only
- ONLY fixtures not locked and whose lockout is still in the future. Locked
  fixtures are deliberately never rewritten — the stored percentage is the
  historical record of what players saw when they picked, and changing it
  would make the You-v-AI rationale and the probability summary
  retrospectively dishonest.
- if Polymarket returns nothing, leaves existing values alone rather than
  blanking them
- {dryRun:true} reports what would change without writing
Timing is deliberate: 04:00/16:00 sits a few hours before picks-ai at
09:00/18:00, so the AI always reasons over the freshest visible prices.

No API key: Polymarket Gamma is public, read-only, unauthenticated.
Confirmed to the user that the Relayer API key they were offered is for
submitting wallet transactions and must NOT be created for this.

## Full cron schedule now
  auto-score      0 7,22 * * *
  picks-reminder  */30 * * * *
  picks-ai        0 9,18 * * *
  refresh-odds    0 4,16 * * *

## BUG: WombleDan still on the league table (fixed) + season toggle BUILT
Soft-delete worked, but nothing filtered the leaderboard — I added is_active
to the schema and to picks-reminder but never to the read paths.

Fixed:
- PredictData.getLeaderboard() now .eq('is_active', true) for the current
  season, and gained a `season` argument.
- netlify/functions/leaderboard.js same filter.
- getHistory()'s compare dropdown also filtered (a departed player has no
  current-season picks, so listing them was pure confusion).

While in there, built the SEASON TOGGLE — the outstanding item from the
user's original brief ("keep last season's data ... available as a toggle"):
- PredictData.getSeasons() reads the predict_seasons registry.
- getLeaderboard(season): current season → predict_users (live mirror,
  active only); PAST season → the predict_league_table view, deliberately
  INCLUDING players who have left, because they played that season and
  belong in its final table. So WombleDan now lives in 2025/26 rather than
  vanishing entirely.
- league.html Overall tab gained a season <select>, a note naming the
  season's winner, and an "AI" tag on the bot row. If predict_seasons is
  empty or absent the control hides itself and behaviour is unchanged.

Verified in a browser against stubbed data:
- current season → 3 rows, no note, AI tag present on Picks AI
- switch to 2025/26 → note reads "Final table for 2025/26 — won by craigtee
  on 95 points. Includes players who have since left.", WombleDan present at
  position 8, footer switches to "A completed season."
Temp harness config removed from .claude/launch.json (verified clean).

## Picks AI timing changed — now ~12h before each week's ACTUAL deadline
User asked for a deadline-relative trigger rather than a fixed clock time,
since deadlines move (Sat lunchtime / Sun afternoon / Mon night).

Was: cron "0 9,18 * * *" with a 2-60h window. For a Sat 11:30 lockout that
fired THURSDAY EVENING, ~41h out — before Friday press conferences, i.e.
researching before the useful information existed.

Now: cron "0 */2 * * *", acts only when the first lockout is 10-14h away.
- 12h before a Sat 11:30 lockout = late Friday evening, after Friday pressers
  and confirmed team news.
- 4-hour window vs 2-hourly cron → always hit at least once.
- Every other run is a no-op costing two DB queries and an early return; the
  already-picked guard prevents any double spend.
- LAST_CHANCE_HOURS = 2.5: if the week is seeded INSIDE the ideal window that
  window never opens, so anything from 2.5h up to 14h still picks (logged as
  the late/catch-up path). Under 2.5h it declines rather than picking on
  stale research minutes before kickoff.

Simulated: normal week fires Fri 22:00 UTC = 13.5h out (ideal window);
week seeded only 6h before lockout still fires at 6.0h out (catch-up path).

Also: picks-ai now refreshes its own week's odds from Polymarket immediately
before researching. refresh-odds has its own 12-hourly schedule but the two
crons are independent, and this guarantees the AI reasons over the same
prices a player would see at that moment. Non-fatal on failure; reports
oddsRefreshed in the response.

## scripts/picks-ai-preview.js — local dry run, no key, no cost
User asked to run the process against the live fixtures. Built a preview
harness that uses the REAL code, not a copy: picks-ai.js now exports
_internal { SYSTEM_PROMPT, SUBMIT_PICKS_TOOL, buildFixtureBrief,
renderStrategicContext, validatePicks, estimateCost, MODEL, MAX_SEARCHES,
window constants } purely for this. The deployed handler does not use it.

  node scripts/picks-ai-preview.js            # 5 closest fixtures
  node scripts/picks-ai-preview.js --all      # every priced fixture
  node scripts/picks-ai-preview.js --prompt   # full system prompt + brief
  node scripts/picks-ai-preview.js --pos 12 --gap 15   # simulate mid-season

It pulls live Polymarket prices, ranks by Shannon entropy (same measure the
admin "suggested 5" uses), builds the exact prompt, and estimates cost.
Makes NO Anthropic call and NO database write.

Live run against the real opening weekend:
  10 fixtures priced. Closest five: Ipswich v Sunderland 35/30/35,
  Forest v Leeds 41/28/31, Brentford v Spurs 39/26/35,
  Brighton v Villa 43/26/31, Everton v Palace 45/28/27.
  Cost: ~$0.081/week → ~$3.07 per 38-week season (searches $0.05 of it).
  Confirms the earlier ~$3.40 estimate and sits inside the $5 budget.

Also verified the strategic context renders correctly for a mid-season state
(12th of 24, 15 behind, 26 weeks left, and the field under-picking draws by
14 points of share — which is the signal that should push it to contrarian
draws when trailing).

## Provisional vs final picks (user request) — sql/008 + picks-ai change
User wants to run Picks AI EARLY this week (they are away Friday) and have
the scheduled Friday run replace those picks with fresher research.

As built that would NOT have worked: the one-run-per-week guard checked for
existing predictions, so an early run would have silently blocked the real
one — the opposite of what they wanted.

Fix:
- sql/008_provisional_picks.sql adds predict_ai_runs.is_final (default true,
  so any pre-existing row counts as final).
- picks-ai.js: isFinalRun = hoursUntil <= IDEAL_MAX_HOURS (14). The guard
  now looks for a prior run with is_final = true rather than for existing
  predictions. Provisional picks are simply overwritten by the upsert.
- Response now reports isFinal, replacedProvisional and a plain-English note.
- Fixed a variable shadow while doing it: my `runErr` collided with the
  audit-insert's `runErr` further down (caught by node --check).

Simulated the full week — behaves exactly as intended:
  Tue 21:00  86.5h  WRITE provisional
  Fri 22:00  13.5h  WRITE final          <- replaces the provisional picks
  Sat 00:00  11.5h  SKIP (final exists)
  Sat 02:00   9.5h  SKIP
  ... every later tick SKIPs
Cost of the extra run: one additional ~$0.08, i.e. ~$0.16 for this week.

## curl failed for the user — replaced with a script
User got repeated "curl: (3) URL rejected: Malformed input to a URL
function" plus "Bad hostname". Cause is copying a long single-line curl out
of rendered text: smart quotes or injected line breaks make curl treat
fragments as extra URLs. Not worth debugging their clipboard.

Added:
- scripts/picks-ai-run.sh
    bash scripts/picks-ai-run.sh            # dry run, writes nothing
    bash scripts/picks-ai-run.sh live       # writes picks
    bash scripts/picks-ai-run.sh live 3     # specific week
  Reads ADMIN_SECRET from env or prompts with hidden input (never lands in
  shell history). Builds the JSON body with printf so nothing can be mangled.
  SITE_URL overridable. 300s timeout — a real run with 5 web searches is slow.
- scripts/_format_picks_ai.py
  Pretty-prints the response. Deliberately a SEPARATE FILE: the first version
  inlined it in the bash heredoc, which needed '"'"' escaping that is easy to
  get subtly wrong and impossible to test in isolation. My own test harness
  tripped over it, which was the hint to split it out.

Both verified: bash -n clean, python parses, and the formatter renders a
realistic dry-run response correctly (picks + rationales, strategy note,
cost, token usage, provisional/final note).

## 403 on the manual run — Netlify blocks HTTP calls to SCHEDULED functions
User's dry run returned 403 Forbidden, text/plain, 367ms. That is Netlify's
edge, not our auth (ours returns JSON via respond()).

CONFIRMED (Netlify support forums): "Attempting to invoke a scheduled
function using a URL will result in 403 Forbidden. This is by design." A
function with a `schedule` in netlify.toml cannot be reached over HTTP in
production at all — only via the cron, or locally under `netlify dev`.

Consequence beyond picks-ai: the manual/admin trigger code inside
auto-score.js and picks-reminder.js has NEVER been usable in production
either. picks-reminder's force/test_email mode in particular looks like it
was written to be used and cannot be. FLAGGED to user, not yet fixed.

Fix for picks-ai — split scheduled from HTTP:
- picks-ai.js: handler body extracted into `async function run({requestedWeek,
  dryRun, force})`, exported. `exports.handler = async () => run()` is the
  scheduled entry point and takes no options.
- NEW netlify/functions/picks-ai-trigger.js: no schedule, so reachable over
  HTTP. Does requireAdmin, parses the body, calls run(). Cannot drift from
  the scheduled path because it is literally the same function.
- scripts/picks-ai-run.sh now posts to picks-ai-trigger.

Slip while doing it: my first refactor replaced `try {` with `{`, orphaning
the catch. node --check caught it immediately; fixed.

## Gateway timeout on the manual run — Netlify function time limits
User's run died with an "Inactivity Timeout" gateway page.

VERIFIED limits (Netlify docs + support):
  scheduled functions    30 seconds
  background functions   15 minutes, reply 202 immediately, empty body
A real Picks AI run is five SERVER-SIDE web searches plus a model turn —
comfortably more than 30s. So this was not just a manual-trigger problem:
**the scheduled run would have timed out too**, and Picks AI would never
have picked at all. Caught before Saturday only because the user tried the
manual run.

Restructured into three functions sharing one implementation:
  picks-ai.js             scheduled (cron). Does NO work — fires the
                          background function via fetch to process.env.URL
                          with ADMIN_SECRET, returns 202. Exports run().
  picks-ai-background.js  background=true (netlify.toml). Requires
                          x-admin-secret (it is a public endpoint and would
                          otherwise let anyone spend API budget). Calls run().
  picks-ai-trigger.js     no schedule, so HTTP-reachable. POST hands off to
                          background; GET reads back recent runs.

Because a background function returns 202 with an empty body, results cannot
come back on the request. So run() now logs DRY RUNS to predict_ai_runs too
(picks_written 0, is_final false, proposedPicks in detail) — the run log is
the only channel. GET picks-ai-trigger reads it.

scripts/picks-ai-run.sh rewritten: counts existing runs, POSTs, then polls
GET every 5s for up to 5 minutes and prints the new run.
  bash scripts/picks-ai-run.sh          # dry run
  bash scripts/picks-ai-run.sh live     # write picks
  bash scripts/picks-ai-run.sh status   # just read recent runs
_format_picks_ai.py extended to render the runs list.

User confirmed: not fixing the manual-trigger gap in auto-score /
picks-reminder, since their scheduled paths work by design.

## ✅ Picks AI dry run SUCCEEDED on Netlify — 2026-08-19
User confirms the manual dry run worked end to end. That closes the last
unverified path: the live Claude API call, the strict submit_picks tool
schema, the Haiku 4.5 web-search variant, the background-function handoff,
the run logging and the polling script.

Everything in the build has now been exercised against real infrastructure
except one thing: the SCHEDULED cron firing on its own (first chance is the
next 2-hourly tick; the real one is Friday ~22:00 UTC at 13.5h before
lockout).

## Remaining
- [ ] LIVE provisional run: bash scripts/picks-ai-run.sh live
      → expect isFinal false, 5 picks written
- [ ] Confirm Friday's cron replaces them (is_final true) — nothing to do,
      but worth checking Saturday morning
- [ ] Drop bak_predict_* tables once week 1 is scored
- [ ] Optional/later: manual-trigger split for picks-reminder so a test
      email can be sent (user has deprioritised; crons work by design)

## ✅ LIVE provisional run succeeded — week 1 picks are in
  2026-08-19 09:54  week 1 [PROVISIONAL]  5 picks written
  5 searches | $0.0935 | 37,252 in / 1,242 out | 75.1h before lockout
Friday's cron will replace these with fresher research.

Research quality looks genuine — rationales cite "Sage's tactical debut with
the Eagles", De Zerbi at Spurs, per-squad injury tolls. That is current team
news from the web searches, not model recall.

### COST: re-baselined against reality (my estimate was low)
  live run  $0.0935  (37,252 in / 1,242 out, 5 searches)
  dry run   $0.1249  (65,478 in / 1,875 out, 5 searches)
vs my pre-flight estimate of $0.081. Search results carry more tokens than I
assumed and the total varies a lot with how much the model reads.
=> ~$0.09-0.12/week → ~$3.60-4.75 per 38-week season. Inside the $5 budget
   but with less headroom than I told the user.
=> A provisional+final week costs BOTH (~$0.20). Fine occasionally; doing it
   every week would breach the budget. Header comment updated to say so.
Audit query: SELECT season, SUM(estimated_cost_usd) FROM predict_ai_runs
GROUP BY season;

### BUG FOUND IN THE OUTPUT AND FIXED: phantom lead at 0-0
The live run's strategy note read "Leading with 37 weeks to play... no need
to get clever with a lead." At week 1 every player is on 0, so sorting by
points made the bot "1st of 24" and gatherStrategicContext reported it as
LEADING. It reached the right conclusion for the wrong reason, and the same
flaw would misreport any multi-way tie later in the season.
Fix: a position is only emitted once somebody has actually scored
(anyonePlayed check). At 0-0 it now says the season has not started, there
is no lead to protect and nobody to chase. Needs deploying before Friday's
cron run for the note to read correctly — though the picks would be the same
either way.

---

# SESSION LOG — 2026-08-19

## Goal
Add Google Analytics 4 (`G-MPSNPSY3RP`) across TeleStats, with **zero tracking**
on any `/fives*` route, plus baseline gameplay events.

## Tasks
- [x] Inspect architecture (framework, build, routing, existing analytics, consent)
- [x] Create central analytics helper `public/js/ts-analytics.js`
- [x] Load it on every tracked page (20 HTML files); load it on **no** Fives page
- [x] Central `game_complete` via `TSData.logGameSession()`
- [x] Central `result_share` via `TSData.shareResult()`
- [x] Per-game `game_start` / `game_replay` for the 6 main games
- [x] Service worker: precache the helper, keep GA hosts out of the SW fetch path
- [x] QA: exclusion, page views, gameplay events, PII, dev-mode behaviour
- [ ] Goal Recreator gameplay events — HELD BACK at user's request (not in
      circulation). Instrumentation was written and verified, then reverted;
      a TODO block at the top of `public/goals/game.js` records exactly what
      to add if it ever goes live. The page still emits page views.

## Key findings
- Pure multi-page static site. **No SPA routing anywhere** — the only
  `history.replaceState()` calls strip Supabase auth hashes. So GA4's automatic
  page_view is exactly right: one per document load, nothing to de-duplicate.
- **No pre-existing analytics, no GTM, no cookie/consent layer.** Nothing to
  extend, nothing to bypass.
- `/fives/` is only the marketing shell. The Fives **product** is served from
  `/predict/*` (its pages are titled "TeleStats Fives – …"). Both prefixes are
  excluded, otherwise the exclusion would have missed the actual product.
- Every game funnels its genuine end-of-round through `TSData.logGameSession()`
  and every share through `TSData.shareResult()` → `game_complete` and
  `result_share` needed instrumenting in exactly one place each.
- Supabase puts `access_token`/`refresh_token` in the URL **hash** on any page,
  and Stripe returns to `/upgrade/` with `session_id`. `page_location` is
  therefore rebuilt from origin+pathname+filtered query, hash always dropped.
- Pre-existing (NOT introduced here, NOT fixed here): a perfect Starting XI
  never calls `logGameSession()`, so it awards no XP. Community XI likewise
  logs no session. Both now emit `game_complete` for analytics only.

## Week 1 issues raised by user (2026-08-24ish)
1. glyn_marshall's picks missing → sql/009_fix_week1.sql PART A inserts them
   (match ids resolved by team name; preview query first). Flagged that this
   is a post-lockout write only possible via service role.
2. Scoring looks broken — only one player has points → sql/009 PART B,
   four read-only queries. Prime suspect stated in the file: auto-score's
   guard aborts the WHOLE week if ANY user's current_week > weekNum, so a
   partially-completed scoring pass permanently blocks every retry, which
   looks exactly like "one player has points".
3. NO reminder emails went out → root cause found by inspection, see below.
4. Picks AI email confirmation → built.

### Reminder emails: real bug found, not just a config problem
The dedupe scheme relied on the trigger window (28 min: 106-134 before
lockout) being NARROWER than the cron interval (30 min). That guarantees at
most one send — but also means a lockout timed so the window falls between
two ticks gets NO send at all. e.g. lockout 11:15 → window 09:01-09:29 →
ticks at 09:00 and 09:30 both miss. I flagged this window in the very first
audit and did not fix it; week 1 is what that looked like in practice.

Fixed:
- sql/010_reminder_stamp.sql adds predict_match_weeks.reminder_sent_at
- window widened to 90-180 minutes (now much wider than the cron interval)
- dedupe is explicit: skip if reminder_sent_at is set; stamp after sending
- test sends (test_email) deliberately do NOT stamp, so a test cannot
  suppress the real reminder
- picks-reminder.js split into run() + scheduled handler, and NEW
  picks-reminder-trigger.js (unscheduled, so HTTP-reachable) exposes the
  force/test_email mode that has never been usable in production

### Picks AI confirmation email
notifyAdmin() in picks-ai.js, same Gmail transport as the reminder. Sends
fixtures, picks, confidence, rationale, the strategy note, cost and whether
the run was PROVISIONAL or FINAL. Never throws — a failed email must not
fail a run whose picks are already saved. Needs env PICKS_AI_NOTIFY_EMAIL
(set it to babacvafaey@gmail.com); silently skipped if unset.

## ROOT CAUSE of the week 1 scoring failure — auto-score hit the 30s ceiling
Diagnostics showed: 120 predictions (24 players x 5 — glyn's insert worked),
ALL with points_awarded set, but only 1 marked correct. All 23 humans on
current_week = 1, so my earlier "guard is blocking it" theory was WRONG.

Real cause: auto-score paces one fixture every 6.5s to respect
football-data.org's 10 req/min free tier. Five fixtures = ~33s. Netlify kills
SCHEDULED functions at 30s. So fixtures 341/342/343 resolved and 344/345
never got checked — exactly what the data shows. Scoring then ran against
three-fifths of the results and recorded nearly every pick as 0.

Same class of bug as picks-ai's timeout, in a function written long before
this session. Fixed the same way:
  auto-score.js             scheduled; hands off, does no work. Exports run().
  auto-score-background.js  background=true, 15 min. Admin-secret gated.
  auto-score-trigger.js     unscheduled, so manually callable.
  netlify.toml              background = true for auto-score-background

Also of note: my own diagnostic query was buggy — the per-player join
filtered week_number = 1 without the season, so it counted last season's
week 1 too and reported "10 picks" per player. The totals row (season-scoped)
was correct at 120. Told the user.

sql/011_rescore_week1.sql written to repair, gated on 344/345 having results:
  step 1 preview of what each player SHOULD have
  step 2 recompute points_awarded from actual results
  step 3 rebuild predict_users totals from scratch (idempotent)
  step 4 mirror into predict_user_seasons
  step 5 show the resulting table
Deliberately NOT using admin-score-week's force path: that recalculates from
points_awarded, which is precisely the corrupted field.

## NEW: weekly results email (user request)
"Who won the matchweek, call out blanks, and tell each player how they did
against Picks AI and against the field."

sql/012_week_results_email.sql adds two timestamps to predict_match_weeks:
  scored_at              first sighting of a fully-scored week
  results_email_sent_at  send-once guard

netlify/functions/week-results.js (+ -background, + -trigger), cron */30.

WHEN IT FIRES — no reliable "week scored" event exists (a week can be scored
from the admin button, auto-score, or by hand in SQL), so it DETECTS the
condition: all matches have a result AND no prediction is left unscored. On
first sighting it stamps scored_at and waits; an hour later it sends. That
makes it independent of how the week got scored.
Delay configurable via RESULTS_EMAIL_DELAY_HOURS (default 1).

CONTENT, per player:
  - headline: "You won Week N" / "You shared the Week N win" / "You got X/5"
  - who won, or "N players tied on X out of 5 — A, B and C"
  - blanks called out by name
  - vs Picks AI: beat / lost / drew, colour-coded, its own line
  - "You finished ahead of N players" — HUMANS ONLY. First cut counted the
    bot, which both double-mentioned it and inflated the number.
  - their five picks against the actual results, ticked/crossed
  - the full week table with them highlighted and the bot tagged AI
  - subject line differs for a winner

Guards: test_email sends to one address and deliberately does NOT stamp, so
a test cannot suppress the real send. Background function because ~24
sequential sends far exceeds the 30s scheduled ceiling.

Verified the copy locally for winner / mid-table / blank, including the
tie-list grammar ("A, B and C").

## Admin button for the results email (user request)
Rather than relying only on the auto-detect + 1h delay, added a "Results
Email" card to admin.html, sitting directly after the scoring card:
  [Send test to me]      prompts for an address, sends only there, and does
                         NOT stamp the week, so the real send still works
  [Send to all players]  confirm dialog first ("This cannot be unsent"),
                         then sends to everyone and stamps the week
Both post to week-results-trigger with force + the week from the existing
Week input, so it always matches whatever week the admin is working on.

Verified in a browser against a stubbed admin session:
  card present, heading "Results Email", both buttons wired
  positioned immediately after the scoring card
  empty week   → "Set a week number first." and no request
  send-to-all  → confirm dialog shown; declining leaves status untouched
  theme applied correctly (dark card, themed buttons)
Temp harness config removed from .claude/launch.json (verified clean).

The automatic path stays as a backstop — if the button is never pressed, the
scheduled job still sends an hour after the week is scored.

## ✅ Picks AI cron fired UNATTENDED — last unverified path now proven
  2026-08-22 00:01:48  week 1  [FINAL]  5 picks, 13h before lockout
Replaced the Tuesday provisional exactly as designed. Every path in the
system has now run for real: manual dry run, manual live run, scheduled
cron, background handoff, run logging, and the polling script.

Phantom-lead fix CONFIRMED working in production. Tuesday (pre-fix) said
"Leading with 37 weeks to play... no need to get clever with a lead";
Friday (post-fix) says "Season just starting at 0-0 with all players, so I'm
playing the percentages without need to differentiate." Correct reasoning
rather than the right answer by accident.

### Cost, now measured across three real runs
  dry run      $0.1249   65,478 in / 1,875 out
  provisional  $0.0935   37,252 in / 1,242 out
  final        $0.1006   40,448 in / 2,039 out
Normal week = ONE run ~= $0.10 → ~$3.80 per 38-week season. Week 1 cost
$0.32 because all three ran. Inside the $5 budget; thinner headroom than my
original $3.40 estimate. Lever if needed: PICKS_AI_MAX_SEARCHES 5 → 4 saves
roughly 20%.

## BUG: results email reported success but sent nothing
User pressed "Send test to me", got a success message, no email arrived.

Cause, mine: week-results-trigger returns 202 "Started" the instant it hands
off. The background function then found week 1 incomplete (Brighton v Villa
and Newcastle v Liverpool still have no result), hit
`if (!allResults) continue;` and stopped. force did NOT bypass that check, so
even the explicit admin action no-opped — and the admin saw "Started".

Fixes:
- week-results.js gains checkReady(client, week): validates the week exists,
  every fixture has a result (naming the ones that do not), and no pick is
  left unscored. Exported.
- week-results-trigger.js runs checkReady BEFORE handing off and returns 400
  with the actual reason, e.g. "Week 1 is not fully scored — 2 of 5 fixtures
  have no result yet: Brighton & Hove Albion FC v Aston Villa FC, Newcastle
  United FC v Liverpool FC. Set the results and score the week first."
  Also blocks a duplicate send unless test/force.
- force now bypasses the !allResults skip inside run() too, so the trigger
  and the worker cannot disagree about what force means.
- admin.html renders the reason as "Not sent. <reason>" in yellow rather
  than a red "Failed: unknown error".

Lesson worth keeping: a fire-and-forget 202 must not be reported to a human
as success. Either pre-check synchronously or report the real outcome.

## Correction: the week IS scored — my second guess was also wrong
User confirms all five results are set and the week is scored, so the
"incomplete week" theory does not explain the missing email either. I have
now guessed twice and been wrong twice; stopped theorising.

Built a preflight instead — GET on week-results-trigger checks, in one call,
everything that can silently stop an email:
  1. migration 012 applied (missing columns would make every query in run()
     error, invisibly, behind the 202)
  2. GMAIL_USER / GMAIL_APP_PASSWORD present — worth checking independently
     since the pre-deadline reminders ALSO never arrived, which points at the
     mail path rather than any one feature
  3. site URL + ADMIN_SECRET (needed to reach the background function)
  4. how many active players actually have an email address, and who does not
  5. whether the requested week is scored and sendable
plus scripts/email-preflight.sh to run and format it.

The readiness/pre-check work from the previous turn stands and is still
correct — it just was not the cause here.

## Preflight passed everything — narrowed to the send itself
User ran it: migration012 PASS, gmail PASS (configured as
babacvafaey@gmail.com), siteUrl PASS, adminSecret PASS, recipients PASS (23
with addresses), week PASS (5 fixtures, 120 picks scored).

So configuration is fine and all three of my theories are dead. What the
preflight could NOT see:
  a) whether Gmail ACCEPTS the app password (presence != validity — app
     passwords are revoked by a password change or a security review and sit
     in the env looking fine)
  b) whether the background function ran at all
Extended the preflight:
  - smtp check via nodemailer transporter.verify(), which authenticates
    against Gmail without sending
  - ?send_test=<addr> sends ONE email SYNCHRONOUSLY and returns the outcome
    on the same request, so the result cannot vanish into a background
    function's log — which is what has been hiding the cause all along
  - scripts/email-preflight.sh takes an optional second arg for that address
    (timeout raised to 60s)
