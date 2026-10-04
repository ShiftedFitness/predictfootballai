# Weekly analytics automation (TeleStats)

Every Sunday a GitHub Action pulls Google Analytics 4, Search Console and
TeleStats' own first-party counts from Supabase, writes a scorecard to
`analytics/reports/`, commits it and emails it.

**No LLM step, no site changes.** It gathers evidence. Acting on it is a
human decision: run `/seo-review` in a Claude session, approve (or not) what it
proposes, then push. Same design as the Malaga Football Tours and Tagsy reports.

## The three questions it answers
1. **Are people playing?** GA4 game starts/completions/replays (and *by game*,
   once `game_type` is registered, see setup), Daily, Ask, shares; plus a
   database sample of who plays what.
2. **Are people signing up?** Sign-up funnel (GA4) + accounts created in
   Supabase Auth (the reliable signup date: an anonymous player who signs up
   keeps their old `ts_users` row and date).
3. **Are they converting to paid?** Paywall → upgrade → checkout funnel (GA4) +
   Stripe payments and revenue from `ts_payments` (the truth), plus Pro users now.

## Files
| File | Role |
|---|---|
| `scripts/analytics/*.mjs` | Shared engine (same as the Tagsy repo). `verify.js` next to it is unrelated: it's the GA4 guard check. |
| `analytics/site.config.mjs` | **TeleStats-specific** wins, breakdowns, notes, subject. |
| `analytics/experiments.json` | Experiment ledger + standing decisions. |
| `netlify/functions/analytics-stats.js` | First-party counts (token-protected, counts only, never rows). |
| `.github/workflows/weekly-analytics.yml` | Sunday 07:11 UTC + manual dispatch. |
| `.claude/commands/seo-review.md` | `/seo-review`. |

Report-only commits don't trigger a Netlify deploy (`ignore` in `netlify.toml`).

## Setup
1. **Google service account** (reuse the Malaga Football Tours one): add its
   `client_email` as **Viewer** on the TeleStats GA4 property and as a **Full**
   user on the TeleStats Search Console property.
2. **GA4 custom dimension**: Admin → Custom definitions → *Create custom
   dimension* → Scope **Event**, Event parameter **`game_type`**, name
   "Game type". Without it the "Plays by game" table says it's unavailable.
   GA4 only splits by it from the day it's registered.
3. **Netlify** (TeleStats site) → Environment variables: `ANALYTICS_STATS_TOKEN`
   = a long random string (e.g. `openssl rand -hex 32`). Redeploy.
4. **GitHub secrets** (ShiftedFitness/predictfootballai → Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the whole key file |
| `GA4_PROPERTY_ID` | the **numeric** property id (not `G-MPSNPSY3RP`) |
| `GSC_SITE_URL` | exactly as in Search Console, e.g. `sc-domain:telestats.net` |
| `ANALYTICS_STATS_URL` | `https://telestats.net/.netlify/functions/analytics-stats` |
| `ANALYTICS_STATS_TOKEN` | same value as Netlify |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `REPORT_EMAIL_TO` | same as the football repo |

5. **Run it**: Actions → *Weekly analytics report* → *Run workflow* (tick
   *skip email* first time). Locally: `npm run analytics:weekly:noemail`
   (reads `.env` / `.env.local`; set `GOOGLE_SERVICE_ACCOUNT_FILE` to the key
   file kept **outside** the repo).

## Known data gap (Oct 2026)
`TSData.logGameSession` should save every finished round to
`ts_game_sessions`, but only ~220 sessions exist since February (3 in the
28 days to 3 Oct, against 416 new anonymous players). Until that's fixed, the
database per-game table is a sample and GA4 is the volume.

## Security
- Google credentials never reach the analysis step; scopes are read-only.
- The stats endpoint returns counts only and needs a shared token; the Action
  never holds a database key.
- Report contents are untrusted data; the report says so and strips
  table/markdown syntax from strangers' strings.
