# TeleStats — Growth Implementation Plan

Written 5 September 2026, against the Product/Membership/SEO brief.
This maps that brief onto what actually exists in the repo and the database,
says what I'd build in what order, and says what I'd cut.

It does not restate the brief. Where a requirement is already met, it says so
and moves on.

---

## 0. The number that should shape every decision

Before anything else, the measured baseline as of today:

| | |
|---|---|
| Registered rows in `ts_users` | **839** — but 813 are `anonymous`, 23 `free`, **3 `paid`** |
| Game sessions ever recorded | **207**, from **23 distinct players** |
| Sessions in the last 30 days | **3** |
| Sessions in the last 90 days | **14** |
| Rows in `ts_payments` | **0** |
| Community games created | **2** |

Sessions by game, all time: `higher_lower` 138 · `starting_xi` 28 ·
`bullseye` 26 · `who_am_i` 12 · `pop_quiz` 2 · `player_alphabet` 1.

**This is a pre-traffic product.** That is not a criticism — it is precisely
why the brief exists. But it has three hard consequences that run through
everything below:

1. **There is no funnel to optimise.** Gate 0 asks to test and document the
   conversion funnel and measure results. With three sessions in thirty days
   there is no data to measure. The *instrumentation* is still worth building —
   you need it in place before traffic arrives, not after — but "verify the
   funnel and document conversion rates" has to become "instrument it, prove
   each event fires once by hand, then wait."

2. **Paywall optimisation has nothing to optimise.** Three paying users. Phase
   2's real value is not tuning a wall; it is (a) making free generous, which
   is a config change, and (b) making entitlements flexible enough that Team
   Packs are possible later. That is roughly a day of work, not a phase.

3. **The bottleneck is that nobody plays, not that players do not pay.** Every
   hour should go to the top of the funnel until that number moves.

The brief's own instinct — *"we need usage, habit, sharing and return visits
more urgently than aggressive first-session monetisation"* — is exactly right.
The plan below just takes it further than the brief does.

---

## 1. On the "weekend sprint"

The brief frames Phases 1–3 as one weekend.

Phases 1–3 contain: a new team object model, ~557 team pages, a matchup system,
proficiency and leaderboard scoring, daily challenges, streaks, challenge links,
a natural-language query layer over the database with its own security boundary,
an entitlement refactor, a static rendering strategy, a sitemap architecture and
a full technical SEO audit.

That is a few months of work, not a weekend. Said once, plainly, so the
sequencing below makes sense — and so nothing gets half-built and abandoned,
which is the actual risk.

What *is* achievable in a focused weekend is **section 4's Slice 1**: team pages
for the clubs that deserve them, wired to existing games, with correct metadata
and internal links. That is the single highest-leverage thing in the entire
brief, and it is now possible in a way it was not a week ago.

---

## 2. What already exists (do not rebuild)

Audited before proposing anything.

| Brief asks for | Already exists | Notes |
|---|---|---|
| GA4 helper, `/fives` + `/predict` excluded | `public/js/ts-analytics.js` | `EXCLUDED_PREFIXES` already correct. Scalar-only params, hash stripped, Stripe `session_id` stripped. **Do not touch except to add events.** |
| `game_start`, `game_complete`, `game_replay`, `result_share` | Yes | `game_complete` central in `TSData.logGameSession`, `result_share` in `TSData.shareResult` |
| Auth, anonymous play | `public/js/ts-auth.js` (`window.TSAuth`), `ensure-anon-user.js` | Anonymous users already first-class |
| Session logging + XP | `TSData.logGameSession`, `ts_game_sessions`, `ts_xp_levels`, `ts_achievements` | XP/level system already built (10 levels, 17 achievements) |
| Payments | `create-checkout.js`, `stripe-webhook.js`, `ts_payments` | Stripe wired; `ts_payments` empty |
| Entitlements | `ts_users.tier` (`anonymous`/`free`/`paid`), `can_user_play` RPC | **Single string column.** This is the thing to refactor for Team Packs |
| Promo / referral | `redeem-promo.js`, `redeem-referral.js`, `ts_promo_codes`, `ts_referrals` | Built, essentially unused |
| Community games | `community-builder.js`, `ts_community_games`, `/community/` | Filters by competition, club (any/all), nationality, measure. **Already has the filter vocabulary team tagging needs** |
| Leaderboards | `leaderboard.js`, `ts_leaderboard_global`, `ts_leaderboard_by_game` | Activity-based. Proficiency is genuinely new |
| Player lookup | `/tools/player-lookup.html` | Prototype for a stats page template |
| Data scope disclosure | `/tools/data.html` + `data-summary.js` | **Built this week.** Already the skeleton of "About TeleStats Data" |

**The database is now the asset the brief assumes.** As of this week:
221,865 player-seasons, 37,000 players, 557 clubs with rows behind them,
11 competitions, 1988–2026, including all four English tiers.

---

## 3. The one dependency the brief assumes and does not have

> *"the database will remain automatically updated"*

**Not yet true.** The collector is built and proven on 323 season-pages, but
the `launchd` job on the Mac mini is not wired up, and neither is the staleness
alert. Until that happens the data is current but not *self*-current.

It is roughly a day's work and it should happen before the sprint, not after —
everything in the brief rests on it, and a growth push onto data that silently
goes stale again is worse than no growth push.

One known constraint for whoever wires it: `rebuild_aggregates()` exceeds the
statement timeout when called through PostgREST. It must run as SQL over a
direct connection.

---

## 4. Proposed sequence

Ordered by leverage, not by the brief's numbering.

### Slice 1 — Team pages *(the weekend)*

The highest-leverage item in the brief, and it passes its own core design test
most convincingly. Now buildable because the data finally supports it.

- Canonical team slugs from `clubs.club_id` + `club_name`. **One slug per club,
  generated once and stored** — not derived at request time in two places, which
  is how duplicate-slug bugs start.
- `/teams/<slug>/` rendering: header, the games that support that club, team
  stats from `agg_player_club` (already built, already indexed), local progress
  from `localStorage`.
- Indexability rule driven by real data, not a guess: a team is indexable when
  it has enough players and enough playable games. `agg_club_season` gives the
  numbers to decide. Everything else is `noindex,follow` until it earns it.
- Internal links: team → games → stats → matchup.

**Why first:** it is the SEO surface, the identity hook and the internal-linking
spine simultaneously. Nothing else in the brief works as well without it.

### Slice 2 — Habit *(daily + streaks)*

- Deterministic daily challenge, same for everyone, seeded from the date.
- Streaks in `localStorage` first. Prompt for an account only once there is
  something worth saving — the brief is right about this and it matters.
- Share grid, spoiler-safe.

**Why second:** cheapest route to return visits, works anonymously, and it is
the thing that makes the 3-sessions-per-month number move.

### Slice 3 — Analytics (Gate 0, rescoped)

Add the commercial events. Prove each fires once by hand. **Do not** promise
funnel analysis until there is traffic.

Non-negotiable guards, already in place, to be preserved and tested:
`/fives` and `/predict` excluded; no free text, player names, emails or tokens
into GA4.

### Slice 4 — Ask TeleStats

**Surface it on team pages too**, not only at `/ask/`. A Plymouth page with
"Ask about Plymouth Argyle" and two or three pre-filled example questions is a
far better entry point than a bare search box on a page of its own — the user
already has a subject in mind, and the examples teach the feature. The page
template leaves room for it under the stats tables.


Genuinely differentiated, and the rebuilt data is what makes it credible.

The brief's architecture is right and should be followed exactly:
**question → intent/entity parse → validated query plan → whitelisted read-only
functions → results → language generated only from those results.** No
model-generated SQL, ever.

Start with two intents, not ten: *players who played for both X and Y*, and
*top N by appearances for X*. Both are single indexed reads against
`agg_player_club`. Ship those, see what people actually ask, expand from real
questions.

### Slice 5 — Matchups

Deterministic ordering rule (alphabetical by slug) so `arsenal-chelsea` and
`chelsea-arsenal` cannot both exist. Only generate pairings with a real reason —
overlapping players, a fixture, or demand. Not every pair.

### Slice 6 — Entitlements

Refactor `ts_users.tier` into something that can express Free / Pro / Team Pack
/ All Access. Keep it additive so the "Team Pack credited against Pro" mechanic
stays possible.

**Deliberately late.** Three paying users. This unlocks nothing until people
play.

### Later — Phase 4

Design the hooks now (UTM handling, challenge URLs, campaign tracking); build
the social engine after the product is live and there is something to point
people at.

---

## 5. What I would cut or defer

Said plainly, because a plan that accepts everything is not a plan.

- **Proficiency scoring and leaderboards.** With 23 players who have ever
  finished a game, a "Top Plymouth Experts" board would have zero or one entry.
  Build the *data model* so history is not lost, show nothing publicly until
  there is a real sample. The brief's own minimum-sample rule already implies
  this.
- **Team Packs.** Architect the entitlements so they are possible. Do not build
  the product.
- **Mass stats pages.** The brief already says not to mass-generate; agreed.
  Build the template, ship three or four, let Search Console decide.
- **Static/prerendered rendering.** Real issue, but it is an optimisation of
  pages that do not exist yet. Build team pages first, measure whether Google
  indexes them as-is, then decide.
- **Renaming Bullseye.** Route and metadata so a rename is cheap. Do not rename
  now.

---

## 6. Risks specific to this codebase

Learned the hard way during the data rebuild this week, and they apply directly:

- **Club names are load-bearing in five functions and four game pages.** They
  are matched as exact strings against hardcoded lists — `match_start.js` alone
  carries 144. Team slugs must be generated from `club_id`, never from a name,
  or the same class of silent breakage returns. `scripts/fbref/check_club_names.js`
  exists as a gate; run it in CI.
- **Club ids are hardcoded in `xi_start.js` and `xi_score.js`** (41 each). Any
  new team system must not add a third source of truth.
- **Database state the repo cannot see.** A stored procedure body and a foreign
  key constraint both broke the cutover this week because neither is greppable.
  Before any schema change, introspect `pg_constraint` and the routine
  definitions, not just the repo.
- **The games pull whole divisions into memory.** Four English tiers is 74,858
  rows, 75 round-trips, **9.9s** — Netlify kills a function at 10s. Any team
  page or matchup page that reuses the existing query pattern will time out.
  They must read `agg_player_club_comp` / `agg_player_club`, where the same
  question is 200 rows and 90ms.

---

## 7. Suggested definition of done for the first slice

Not the brief's full sprint. The first genuinely shippable increment:

- [ ] Canonical team slug generated from `club_id`, stored, tested for collisions
- [ ] `/teams/<slug>/` for every club meeting the indexability bar
- [ ] Each team page links to every game that supports that club, preconfigured
- [ ] Team stats from `agg_player_club`, with data scope stated
- [ ] Anonymous local progress
- [ ] Metadata, canonical tag, breadcrumbs, sitemap entry
- [ ] Thin teams reachable but `noindex,follow`
- [ ] `check_club_names.js` and `sweep.js` green
- [ ] `/fives` and `/predict` still excluded from GA4 — asserted by a test

---

## 8. Open questions

1. **Is the Mac mini automation happening before the sprint?** Recommended.
   Everything here assumes the data stays current.
2. **How many teams should get pages initially?** 557 clubs have data, but the
   long tail is FA Cup non-league sides with a handful of players. Suggest
   starting with the four English tiers plus the big five European leagues,
   which is roughly 200 clubs with genuine depth.
3. **Which game gets the daily challenge first?** `higher_lower` has 138 of the
   207 sessions ever played — by a distance the most-used thing on the site.
   That is where the habit loop should start.
