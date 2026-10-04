/**
 * TeleStats — weekly analytics configuration.
 *
 * The engine in scripts/analytics/*.mjs is shared with the other
 * Shifted.Labs sites (copied from the Tagsy repo); this file is the only
 * TeleStats-specific part. The owner's three questions, in order:
 *   1. Are people playing the games?
 *   2. Are people signing up for accounts?
 *   3. Are they converting to paid?
 *
 * Event names come from public/js/ts-analytics.js. Keep them stable: the
 * report keys on them.
 */

const users28 = (ga4) => ga4.decision.current.overview.activeUsers ?? 0;

/** game_type values (as sent to GA4 and written to ts_game_sessions) → names people use. */
const GAME_NAMES = {
  higher_lower: 'Higher or Lower',
  bullseye: 'Bullseye (501)',
  starting_xi: 'Starting XI',
  who_am_i: 'Who Am I?',
  player_alphabet: 'Player Alphabet',
  pop_quiz: 'Pop Quiz',
};

export default {
  name: 'TeleStats',

  // Per-event GA4 tracking went in on 19 Aug 2026; the commercial events
  // (signup/paywall/checkout) on 7 Sep 2026.
  dataStart: '2026-08-19',

  notes: [
    '**Commercial events started 7 Sep 2026.** Sign-up and Pro funnel comparisons against windows before that date are not meaningful.',
    '**Fives is not tracked in GA4** (`/fives`, `/predict` are excluded by design), so Fives play does not appear here.',
    '**There is no `purchase` event, on purpose.** Money is Stripe → `stripe-webhook.js` → `ts_payments`: read the database table below for real payments; `checkout_return` is only “came back from Stripe”.',
  ],

  hosts: [{ label: 'telestats.net', match: /(^|\.)telestats\.net$/ }],

  gscExclude: ['/predict/admin', '/account'],

  wins: [
    {
      title: 'Are people playing?',
      description: 'Game starts and completions are counted per round (a replay is a new round). Shares are a strong sign someone enjoyed it.',
      rows: [
        { event: 'game_start', label: 'Games started', metric: 'count', primary: true },
        { event: 'game_complete', label: 'Games completed', metric: 'count', primary: true },
        { event: 'game_start', label: 'People who started a game' },
        { event: 'game_replay', label: 'Replays', metric: 'count' },
        { event: 'daily_complete', label: 'Daily challenges completed', metric: 'count' },
        { event: 'ask_query', label: 'Ask TeleStats questions', metric: 'count' },
        { event: 'result_share', label: 'Results shared', metric: 'count' },
        { event: 'daily_share', label: 'Daily results shared', metric: 'count' },
        { event: 'team_potd_reveal', label: 'Player-of-the-day reveals', metric: 'count' },
      ],
      warnings: [
        ({ g28, ev }) => {
          const s = ev(g28, 'game_start', 'count');
          const c = ev(g28, 'game_complete', 'count');
          return s >= 20 && c / s < 0.3
            ? `Only ${Math.round((c / s) * 100)}% of games started were completed in 28 days. Check the by-game table: one game dragging the rate down is a design problem, all of them is a tracking problem.`
            : null;
        },
      ],
    },
    {
      title: 'Are people signing up?',
      description: 'People, in funnel order. Database counts of accounts actually created are in the first-party table below.',
      funnel: true,
      rows: [
        { event: 'signup_view', label: 'Saw sign-up' },
        { event: 'signup_submit', label: 'Submitted sign-up' },
        { event: 'signup_complete', label: 'Completed sign-up', primary: true },
      ],
    },
    {
      title: 'Are people going Pro?',
      description: 'People, in funnel order. `checkout_return` means someone came back from Stripe, not that they paid: the database table below has real payments.',
      funnel: true,
      rows: [
        { event: 'paywall_view', label: 'Hit a paywall' },
        { event: 'upgrade_view', label: 'Viewed upgrade' },
        { event: 'checkout_start', label: 'Started checkout' },
        { event: 'checkout_return', label: 'Returned from Stripe', primary: true },
      ],
      warnings: [
        ({ g28, ev }) => {
          const e = ev(g28, 'checkout_error', 'count');
          return e > 0 ? `${e} checkout error(s) in 28 days (\`checkout_error\`). Each one is someone who tried to pay and couldn’t.` : null;
        },
      ],
    },
    {
      title: 'Coming back',
      rows: [{ event: 'login_success', label: 'Logins', metric: 'count' }],
    },
  ],

  breakdowns: [
    {
      title: 'Plays by game',
      label: 'Game',
      dimension: 'customEvent:game_type',
      events: ['game_start', 'game_complete', 'game_replay'],
      eventLabels: { game_start: 'Started', game_complete: 'Completed', game_replay: 'Replays' },
      valueLabels: GAME_NAMES,
    },
  ],

  // Counts from TeleStats' own database (netlify/functions/analytics-stats.js). No cookies or ad blockers involved.
  firstParty: {
    title: 'What people actually did (TeleStats database)',
    description: 'From Supabase. Accounts = sign-ups in Supabase Auth (an anonymous player who signs up keeps their old row, so ts_users dates can’t be used). Payments = Stripe webhook rows in ts_payments.',
    rows: [
      { key: 'newAccounts', label: 'Accounts created (incl. Fives sign-ups)', primary: true },
      { key: 'newAnonPlayers', label: 'New anonymous players' },
      { key: 'savedSessions', label: 'Game sessions saved' },
      { key: 'activePlayers', label: 'Players with a saved session' },
      { key: 'dailyPlays', label: 'Daily plays recorded' },
      { key: 'payments', label: 'Pro payments', primary: true },
      { key: 'lifetimePayments', label: '… lifetime Pro' },
      { key: 'dayPassPayments', label: '… day passes' },
      { key: 'revenuePence', label: 'Revenue', format: 'pence', primary: true },
    ],
    breakdowns: [
      {
        key: 'byGame',
        title: 'Games played (database)',
        label: 'Game',
        valueLabels: GAME_NAMES,
        metrics: [
          { key: 'sessions', label: 'Sessions' },
          { key: 'players', label: 'Players' },
        ],
        note: 'Only plays saved to `ts_game_sessions`. As of Oct 2026 most plays are not being saved (about 220 sessions since February against hundreds of new players a month), so treat this as a sample of who plays what, not a count. GA4’s “Plays by game” is the volume.',
      },
    ],
    snapshot: [
      { key: 'totalAccounts', label: 'Accounts (all time, incl. Fives players: same Supabase Auth)' },
      { key: 'proUsers', label: 'Pro users now (incl. promo/referral unlocks)' },
      { key: 'activeDayPasses', label: 'Day passes active now' },
    ],
  },

  subject: ({ stamp, ga4, extra }) => {
    const g = ga4.decision.current.events;
    const plays = g.game_complete?.count ?? 0;
    const accounts = extra?.decision?.current?.newAccounts ?? g.signup_complete?.users ?? 0;
    const pay = extra?.decision?.current?.payments ?? 0;
    return `TeleStats weekly — ${stamp} · ${users28(ga4)} users, ${plays} games completed, ${accounts} sign-ups, ${pay} Pro (28d)`;
  },
};
