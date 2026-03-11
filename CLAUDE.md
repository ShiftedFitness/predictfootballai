# CLAUDE.md — PredictFootballAI (TeleStats)

## Project Overview
TeleStats (telestats.net) is a Premier League football quiz and game hub featuring multiple game types plus a prediction game called Fives. Building towards user profiles, leaderboards, community features, and a paid Pro tier. Covers 30+ seasons of Premier League data with 36K+ players.

## Tech Stack
- **Frontend:** Vanilla HTML / JS / CSS — no framework, no build step
- **Backend:** Netlify (hosting + 51 serverless functions in `netlify/functions/`)
- **Database:** Supabase (PostgreSQL) with ~15 tables, RLS enabled
- **Payments:** Stripe (Pro tier £4.99 one-time + day pass option)
- **Data Source:** FBref Premier League stats cached in Supabase
- **External API:** API-Football for live fixtures
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
│   │   ├── ts-auth.js         # Auth layer (window.TSAuth) — Supabase client, sessions, anon users
│   │   ├── ts-data.js         # Data layer (window.TSData) — game sessions, XP, leaderboards
│   │   └── ts-nav.js          # Nav component — persistent bar, user badge, level display
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
├── sql/                       # 5 migration files
├── supabase/                  # RLS policies, payment table
├── scripts/                   # ETL & data refresh scripts
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
netlify dev          # Local dev server (or: npm start)
```
- No build step — static files served directly from `public/`
- Functions auto-served at `/.netlify/functions/`
- Auto-score scheduled function runs daily at 7am & 10pm UTC

## Environment Variables (Netlify)
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
ADMIN_SECRET          # Legacy admin key
```

## Key Conventions
- Each game is a self-contained HTML file with inline JS (no build/import system)
- Shared modules exposed as globals: `window.TSAuth`, `window.TSData`, `window.PFAuth`, `window.PredictData`
- Game sessions logged via `TSData.logGameSession()`, XP awarded automatically
- Supabase URL and anon key are exposed in frontend code (intentional — limited by RLS)
- Design system: Dark theme, teletext-inspired, CSS variables, Space Mono + Inter fonts
- Anonymous users supported: play all games without signup, no leaderboard/streak
- Admin functions require `x-admin-secret` header

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

## Rules for Claude
- Do NOT commit or push to git — ever
- Do NOT delete files without explicit instruction
- When making changes, update this CLAUDE.md if you discover something fundamentally new about the project architecture or workflows
- Always create a session log (SESSION_LOG.md) at the start of each session listing planned tasks, and update it as you progress
