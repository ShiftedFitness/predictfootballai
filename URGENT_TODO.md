# TeleStats — urgent, for you (not things I can do)

Written 4 Oct 2026. Ordered by what unblocks the most.

---

## 1. Decide the entitlement model before any pricing goes live  ⚠️ BLOCKER

I stopped Phase 2 (monetisation) here deliberately. Three things need **your
decision**, not my guess:

- **Entitlements are not enforced server-side at all.** Not "weakly" — not at
  all. No game function checks `tier`. Play limits live in the browser
  (`ts-data.js`). This returns a full playable round with no auth:

  ```bash
  curl -s -X POST https://telestats.net/.netlify/functions/hol_start \
    -H 'content-type: application/json' \
    -d '{"action":"get_players","scopeId":"team_liverpool_all","statType":"appearances"}'
  ```

  Selling Day Pass / Team Forever / All Access on top of this sells something
  that is not currently withheld. Fix first: a `ts_entitlements` table and a
  shared `requireEntitlement()` used by every game function.

- **"Team Forever" has no data model.** `ts_users.tier` is one global flag plus
  `pro_expires_at`. Per-team access needs the new table either way.

- **Currency.** Live plans are **GBP** (£4.99 lifetime, £0.99 day pass). Your
  brief says **EUR** (€0.99 / €1.99 / €2.99). That is a pricing and tax
  decision, and £4.99 lifetime buyers would see €2.99 all-access the week
  after. How do you want existing Pro customers treated?

**Also unhandled:** refunds and chargebacks. The webhook only processes
`checkout.session.completed`, so a refunded customer keeps access forever.

---

## 2. Google Search Console — still the single highest-value hour

Nothing I change in the code substitutes for these. From the analytics review:
only 6 pages had any impressions in 28 days and no team pages were indexed.

- [ ] Submit `https://telestats.net/sitemap.xml` in Search Console
- [ ] Read **Pages → Why pages aren't indexed** and send me what it says
- [ ] Request indexing for `/teams/`, `/competitions/`, and 2–3 club pages
- [ ] Get **2–3 real backlinks**. The Segunda División podcast is the warmest
      lead you have — `/competitions/segunda-division/` exists and is ready to
      point them at.

---

## 3. GA4 — mark key events (5 minutes, user-only)

In GA4 → Admin → Events, mark as key events:

- [ ] `checkout_start`
- [ ] `signup_complete`
- [ ] `checkout_return`

- [ ] Register `game_type` as an **event-scoped custom dimension** — the weekly
      report's "Plays by game" table stays empty until you do.

---

## 4. Decide: does Daily leave the main nav?

The current brief asks me to fold Daily into Games and drop it from the header.
I will keep `/daily/` working and unredirected until you confirm, because
streaks are in browser storage and a careless move resets real people's runs.

- [ ] Confirm you want `/daily/` to become a canonical-to-Games route, or stay

---

## 5. Data refresh cadence

Data last updated **16 Sep 2026** — nearly three weeks. Not stale by itself
(the coverage page no longer scolds you for it), but the refresh is still
manual.

- [ ] Decide a cadence, then I can wire the cron. `npm run preflight` must run
      before every load — it exists because the database holds decisions FBref
      does not know about (club merges, restored names) and an ingest silently
      overwrites them.

---

## 6. Nothing is committed

Every change this session is in the working tree only, per your standing rule.
`npm run check` and `npm run check:spoilers` both pass.

- [ ] Review the diff and commit when you are happy


---

## 7. Decisions I need from you before Phase 2 can finish  (added 5 Oct)

The Build and Ask work is done. Three things in that brief are **blocked on a
decision**, not on code, because each changes what Pro is worth to people who
have already paid for it:

- [ ] **Free publishing.** The brief asks for free accounts to publish ~3
      challenges. Today publishing needs `tier === 'paid'`. Making it free
      removes the main thing £4.99 Pro currently buys. Do you want to:
      (a) do it anyway and give existing Pro something else, (b) keep
      publishing paid, or (c) wait until the new pricing lands?

- [ ] **Invited friends playing free.** Needs server-side entitlement checks
      to exist first — otherwise "one free play per invite" is enforced in the
      browser and is trivially bypassed. This depends on item 1 above.

- [ ] **Remix.** Cheap to build once publishing rules are settled; pointless
      to build before.

### Already fixed, no decision needed

Three contradictions between the upgrade page and the code (details in
SESSION_LOG). The notable one: **Day Pass holders could always create
community games** and the page told them they couldn't.
