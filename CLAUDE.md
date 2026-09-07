# CLAUDE.md — PredictFootballAI (TeleStats)

## Project Overview
TeleStats (telestats.net) is a Premier League football quiz and game hub featuring multiple game types plus a prediction game called Fives. Building towards user profiles, leaderboards, community features, and a paid Pro tier. Covers 30+ seasons of Premier League data with 36K+ players.

## Tech Stack
- **Frontend:** Vanilla HTML / JS / CSS — no framework, no build step
- **Backend:** Netlify (hosting + 51 serverless functions in `netlify/functions/`)
- **Database:** Supabase (PostgreSQL) with ~15 tables, RLS enabled
- **Payments:** Stripe (Pro tier £4.99 one-time + day pass option)
- **Data Source:** FBref Premier League stats cached in Supabase
- **External API:** football-data.org v4 (`FOOTBALL_DATA_KEY`) for fixtures, standings, H2H and results — free tier, 10 req/min. NOTE: the function is still *named* `api-football-fixtures.js` for legacy reasons but it does NOT call API-Football.
- **PWA:** Service worker + manifest for offline support
- **Key deps:** `@supabase/supabase-js`, `stripe`, `cheerio`, `node-fetch`

## Architecture

```
predictfootballai/
├── public/                    # Frontend (static, deployed as-is)
│   ├── index.html             # Landing page (hero, game grid, leaderboard widget)
│   ├── games/                 # 6 main game types
│   │   ├── bullseye.html      # 501 darts-style stat game
│   │   ├── xi.html            # Starting XI team builder
│   │   ├── whoami.html        # Mystery player guessing
│   │   ├── quiz.html          # AI-generated trivia
│   │   ├── hol.html           # Higher or Lower stats
│   │   └── alpha.html         # Player Alphabet A-Z
│   ├── goals/                 # Goal Recreator retro mini-game
│   │   ├── index.html         # Canvas-based Sensible Soccer clone
│   │   ├── game.js            # Game engine (physics, rendering)
│   │   └── levels.js          # Iconic goal recreations
│   ├── teams/                 # 313 STATIC team pages, generated — do not hand-edit
│   │   ├── index.html         #   hub, grouped by competition
│   │   └── <slug>/index.html  #   e.g. /teams/plymouth-argyle/
│   ├── daily/index.html       # The TeleStats Daily (challenge + streak)
│   ├── ask/index.html         # Ask TeleStats
│   ├── fives/index.html       # Fives landing page (marketing)
│   ├── predict/               # Fives prediction game
│   │   ├── index.html         # Main picks interface
│   │   ├── login.html         # Auth gateway
│   │   ├── history.html       # Past picks review
│   │   ├── league.html        # Season leaderboard
│   │   ├── admin.html         # Admin: manage weeks/results
│   │   ├── admin_predictions.html  # Admin: view all picks
│   │   ├── auth.js            # Fives auth (window.PFAuth)
│   │   ├── predict-data.js    # Fives data layer (window.PredictData)
│   │   └── picks-widget.js    # Picks UI component
│   ├── js/                    # Core shared modules
│   │   ├── ts-analytics.js    # Analytics layer (window.TSAnalytics) — GA4 loader + trackEvent
│   │   ├── ts-auth.js         # Auth layer (window.TSAuth) — Supabase client, sessions, anon users
│   │   ├── ts-data.js         # Data layer (window.TSData) — game sessions, XP, leaderboards
│   │   ├── ts-nav.js          # Nav component — persistent bar, user badge, level display
│   │   ├── ts-scope.js        # ?scope= / &play=1 handling, shared by all games
│   │   ├── ts-streak.js       # Daily streaks (localStorage) + spoiler-safe share grid
│   │   └── team-page.js       # Team page behaviour (chips, player of the day, extras)
│   ├── community/             # Community game browser/builder
│   ├── leaderboard/           # Global XP rankings
│   ├── profile/               # User profile (XP, stats, achievements)
│   ├── tools/                 # Player lookup (36K+ players)
│   ├── upgrade/               # Pro tier Stripe checkout
│   ├── account/               # Password reset
│   ├── telestats-theme.css    # Global theme (dark, teletext-inspired)
│   ├── sw.js                  # Service worker
│   └── manifest.json          # PWA manifest
├── netlify/functions/         # 51 serverless functions (see below)
│   ├── _supabase.js           # Shared: client factory, admin auth, response helper
│   ├── _teams.js              # THE team list: slugs, names, scopes. One source of truth
│   ├── _competitions.js       # Scope -> competition ids. One place, every game
│   ├── _daily.js              # Which challenge is today's (pure, date-seeded)
│   ├── _ask_entities.js       # Ask: text spans -> validated club/competition ids
│   ├── _ask_parse.js          # Ask: question -> query plan (patterns, model fallback)
│   ├── _ask_intents.js        # Ask: THE security boundary — the only queries it can run
│   ├── ask.js                 # Ask TeleStats endpoint
│   ├── daily.js               # Today's challenge (thin wrapper over _daily.js)
│   ├── team-extras.js         # Team leaderboard + community games for one club
│   ├── bullseye_start.js      # Game starters (one per game type)
│   ├── xi_start.js / xi_score.js
│   ├── quiz_start.js / score-round.js
│   ├── whoami_start.js
│   ├── alpha_start.js / hol_start.js
│   ├── submit-picks.js        # Fives: record predictions
│   ├── admin-score-week.js    # Fives: score all picks (admin)
│   ├── auto-score.js          # Scheduled: daily 7am & 10pm UTC
│   ├── create-checkout.js     # Stripe checkout session
│   ├── stripe-webhook.js      # Stripe payment handler
│   ├── register-user.js       # First-time login handler
│   ├── ensure-anon-user.js    # Anonymous user creation
│   ├── community-builder.js   # User quiz creation
│   ├── leaderboard.js         # Global/game leaderboards
│   └── _deprecated/           # 13 deprecated functions
├── data/teams/
│   ├── slugs.json             # 313 teams. A URL CONTRACT — generated once, never recomputed
│   └── legacy_scopes.json     # 1,476 old scope ids -> team slug, for play history
├── data/daily/pool.json       # 399 scopes good enough to be a daily challenge
├── sql/                       # 5 migration files
├── supabase/                  # RLS policies, payment table
├── scripts/
│   ├── fbref/                 # ETL: collect, load, bridge, smoke, club-name gate
│   ├── teams/                 # slugs, colours, legacy_scopes, render, build
│   ├── daily/                 # pool (generate), verify (play N days for real)
│   ├── analytics/verify.js    # Proves the GA4 guards hold
│   ├── seo/sitemap.js         # Sitemap index + core
│   └── dev/server.js          # Local: static files AND functions, no Netlify login
├── data/                      # Caches, FBref scrapes, legacy Adalo exports
├── docs/                      # Game specs, schema docs, update guides
├── package.json
└── netlify.toml
```

## Key Tables (Supabase)
- `ts_users` — Profiles (email, username, level, XP, streak, tier)
- `ts_game_sessions` — Game completions (game_type, score, time_taken)
- `ts_daily_plays` — Streak tracking
- `ts_community_games` — User-created quizzes
- `ts_payments` — Stripe payment records
- `predict_users` — Fives player profiles (separate from ts_users)
- `predict_match_weeks` — Week groupings (status: open/closed/scored)
- `predict_matches` — Fixtures with lockout times and results
- `predict_predictions` — User picks (HOME/AWAY/DRAW, unique per user-match)

## Development Workflow

```bash
npm install
npm run dev          # Local: static files AND functions on :8888, no Netlify login
netlify dev          # The real thing (or: npm start)

npm run check        # THE GATE. analytics · club names · smoke · 30 dailies
```
- No build step for the games — static files served directly from `public/`
- Functions auto-served at `/.netlify/functions/`
- Auto-score scheduled function runs daily at 7am & 10pm UTC

### There IS a generation step, for three things
Team pages, the daily pool and the legacy scope map are generated and
committed. Regenerate after a data refresh — never hand-edit the output.

```bash
npm run build:teams            # 313 team pages + sitemaps
npm run build:daily-pool       # which scopes are good enough for a daily
npm run build:legacy-scopes    # old scope ids -> team slugs, for play history
```

`data/teams/slugs.json` is the exception: it is a **URL contract**, generated
once and keyed on `club_id`. Regenerating it would change live URLs. Only
`npm run build:slugs` (deliberately) touches it, and new clubs are appended.

## Environment Variables (Netlify)
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
ADMIN_SECRET          # Legacy admin key
```

## Scope ids — how a game is told what to be about

Every game takes a `scopeId`. Three vocabularies exist and all three work:

```
epl_alltime                                  legacy: a whole competition
epl_club_arsenal / club_arsenal              legacy: one club, from a game's own list
team_plymouth-argyle_league-one              one club, one competition
team_sunderland_premier-league+championship  one club, a chosen SUBSET
team_sunderland_all                          one club, every competition it played
```

`team_*` ids are resolved by `_teams.js`; subset ids are parsed rather than
enumerated (a four-division club has eleven of them). Legacy ids are resolved
by each game's own hardcoded array — `SCOPES.find(...) || teams.resolve(...)`
is the pattern in every handler. **Nothing is removed until every caller has
moved over.**

`_competitions.js` turns any scope into a LIST of competition ids, so every
query filters with `.in('competition_id', ids)` and never branches. "All
competitions" is the literal list of every competition, which is exactly
equivalent to no filter and avoids a second code path that only runs sometimes.

Links from team pages and the daily carry `&play=1`, and `ts-scope.js` clicks
the game's own start button — not its start function, because each game does
different work in that handler.

## Never state a football fact the scope does not support

The quiz and Who Am I? both used to hardcode "Premier League" into every
question and clue, because every scope they shipped with was a top-flight club.
Plymouth Argyle have never played in the Premier League, and the page was
asking how many goals they had scored in it.

Both now derive the wording from the scope (`compPhrases` / `compWords`): "in
League One", "in the Premier League and the Championship", or no qualifier at
all when the scope covers everything. **Any new question, clue or heading must
do the same.** This is the same rule as Ask TeleStats never inventing a fact,
applied to the copy around the data rather than the data itself.

## Key Conventions
- Each game is a self-contained HTML file with inline JS (no build/import system)
- Shared modules exposed as globals: `window.TSAuth`, `window.TSData`, `window.PFAuth`, `window.PredictData`
- Game sessions logged via `TSData.logGameSession()`, XP awarded automatically
- Supabase URL and anon key are exposed in frontend code (intentional — limited by RLS)
- Design system: Dark theme, teletext-inspired, CSS variables, Space Mono + Inter fonts
- Anonymous users supported: play all games without signup, no leaderboard/streak
- Admin functions require `x-admin-secret` header

## Analytics (GA4)
- Measurement ID `G-MPSNPSY3RP`, loaded **only** via `public/js/ts-analytics.js`
  (`window.TSAnalytics`). Never paste the gtag snippet into a page.
- Add analytics to a new page with one line in `<head>`:
  `<script src="/js/ts-analytics.js"></script>` — nothing else is needed.
- **Fives is excluded.** `EXCLUDED_PREFIXES` in `ts-analytics.js` lists `/fives`
  and `/predict` (the Fives product lives under `/predict/*`). On those routes
  gtag.js is never injected and every `trackEvent()` is a no-op. Fives pages
  also carry no script tag at all. Do not add one.
- `TSAnalytics.trackEvent(name, params)` drops objects/arrays and anything
  non-scalar, so game answers and player names cannot be sent. `page_location`
  is rebuilt without the URL hash (Supabase auth tokens) and without sensitive
  query params (Stripe `session_id`).
- Events: `game_start`, `game_replay` (per game page), `game_complete`
  (central, in `TSData.logGameSession`), `result_share` (central, in
  `TSData.shareResult`). Deliberately no `game_abandon`.
- **Commercial events** (named methods, not bare `trackEvent` calls):
  `paywall_view`, `paywall_action`, `signup_view`, `signup_submit`,
  `signup_complete`, `login_success`, `upgrade_view`, `checkout_start`,
  `checkout_error`, `checkout_return`. Plus `daily_complete`, `daily_share`,
  `team_potd_reveal`, `ask_query`.
- **There is no `purchase` event, on purpose.** A browser can only observe
  somebody arriving back from Stripe — a URL anybody can load and a paying
  customer may never load. Revenue is `stripe-webhook.js` writing
  `ts_payments`. `checkout_return` is what actually happened.
- `source`, `plan`, `tier` and `action` are checked against **closed
  vocabularies** in `ts-analytics.js`. An unrecognised value becomes `'other'`
  rather than being sent, so a new button cannot introduce a new dimension.
- Once-only events fire once per page load however many times they are called.
- **Call every method with optional invocation** — `TSAnalytics.upgradeView?.(…)`.
  A browser holding a cached `ts-analytics.js` would otherwise throw and stop
  the page wiring its own buttons. `netlify.toml` sends `/js/*` with
  `must-revalidate` for the same reason.
- `npm run check:analytics` proves all of the above: 29 assertions against a
  recorder standing in for gtag, so each one is about what would be **sent**.
- On localhost the library is not fetched and events log to the console as
  `[TSAnalytics]`; add `?ts_debug=1` to mirror events to the console anywhere.

## Pricing Model
- **Free (no account):** Limited game access
- **Free account:** More games, leaderboard, streaks
- **Pro (£4.99 one-time):** Full access, all features
- **Day pass:** 24-hour trial before purchase
- XP/leveling system with football-themed progression tiers

## Known Gotchas
- Fives auth (`predict_users`) is separate from main TeleStats auth (`ts_users`) — two different user tables
- Admin functions use `ADMIN_SECRET` header, not Supabase auth
- Each game HTML file can be very large (bullseye.html is 148KB) — all logic inline
- Auto-score cron runs at 7am & 10pm UTC to cover evening + afternoon matches
- FBref data requires periodic refresh via `scripts/weekly_update.sh`
- Supabase AbortError bug: auth module retries with fresh client
- Data repair scripts exist for multi-club player resolution
- Legacy Adalo data in `data/predict_transfer/` (migrated to Supabase)
- `rebuild_aggregates()` exceeds the statement timeout via PostgREST — run it
  as SQL over a direct connection
- `ts_game_sessions.game_category` holds the scope id, in whatever vocabulary
  the game used at the time. `_teams.playCategories()` / `teamForCategory()`
  map all of them to a slug, from a generated file — do not regex club names
- `ts_community_games` has **no club tag**. `team-extras.js` derives the club
  from the title and description with the Ask entity resolver; a game naming no
  club is simply not tagged
- Ask's rate limit is in-memory, so per Lambda instance. It needs shared
  storage before Ask leaves beta
- `whoami.html`'s frontend `SCOPES` array is still a sixth copy of the club
  list — it takes linked scope ids on trust and lets the server validate them
- Team page colours: 187 clubs have researched colours, 126 derive one from a
  hash of the slug. Nothing on a page calls the shield a crest, because a real
  badge is somebody's trademark

## Rules for Claude
- Do NOT commit or push to git — ever
- Do NOT delete files without explicit instruction
- When making changes, update this CLAUDE.md if you discover something fundamentally new about the project architecture or workflows
- Always create a session log (SESSION_LOG.md) at the start of each session listing planned tasks, and update it as you progress
- Run `npm run check` before saying anything works. It has caught a broken
  player search that looked like a bad test case, and three variables that were
  declared in a handler and read inside a helper
- Never hand-edit `public/teams/**` or `data/**/*.json` — regenerate them
- Never state a football fact the scope does not support (see above)
