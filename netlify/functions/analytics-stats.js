/**
 * analytics-stats.js — first-party counts for the weekly analytics report.
 *
 * POST {ranges: {momentum: {current, previous}, decision: {current, previous}}}
 *   each range {startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD'} (inclusive, UTC)
 * → the same shape with a {key: count} map per range, plus `snapshot` totals.
 *
 * Returns COUNTS ONLY: never rows, emails or names. Called by the GitHub
 * Action in .github/workflows/weekly-analytics.yml with the shared secret
 * ANALYTICS_STATS_TOKEN (header x-analytics-token), so the Action never
 * holds a database credential.
 */

const { timingSafeEqual } = require('crypto');
const { sb, respond } = require('./_supabase');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WINDOWS = [['momentum', 'current'], ['momentum', 'previous'], ['decision', 'current'], ['decision', 'previous']];

function tokenOk(given) {
  const expected = process.env.ANALYTICS_STATS_TOKEN;
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const nextDay = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/** Every real (non-anonymous) Supabase Auth account's creation time. */
async function authCreatedAt(client) {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth users: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) if (!u.is_anonymous) out.push(u.created_at);
    if (users.length < 1000) break;
  }
  return out;
}

async function countsFor(client, range, accounts) {
  const from = `${range.startDate}T00:00:00Z`;
  const to = `${nextDay(range.endDate)}T00:00:00Z`; // exclusive
  const count = async (table, column, filter = (q) => q) => {
    const { count: c, error } = await filter(client.from(table).select('*', { count: 'exact', head: true }).gte(column, from).lt(column, to));
    if (error) throw new Error(`${table}: ${error.message}`);
    return c || 0;
  };

  const [newAnonPlayers, sessionRows, payRows, dailyRows] = await Promise.all([
    count('ts_users', 'created_at', (q) => q.is('auth_id', null)),
    // user_id + game_type only: aggregated below, never returned as rows
    client.from('ts_game_sessions').select('user_id, game_type').gte('played_at', from).lt('played_at', to).limit(50000),
    client.from('ts_payments').select('amount_total, plan_type').eq('status', 'paid').gte('created_at', from).lt('created_at', to).limit(5000),
    client.from('ts_daily_plays').select('play_count').gte('play_date', range.startDate).lte('play_date', range.endDate).limit(20000),
  ]);
  if (sessionRows.error) throw new Error(`ts_game_sessions: ${sessionRows.error.message}`);
  if (payRows.error) throw new Error(`ts_payments: ${payRows.error.message}`);
  const sessions = sessionRows.data || [];
  const byGame = {};
  const playersByGame = {};
  for (const r of sessions) {
    const g = r.game_type || '(unknown)';
    byGame[g] = byGame[g] || { sessions: 0, players: 0 };
    byGame[g].sessions++;
    (playersByGame[g] = playersByGame[g] || new Set()).add(r.user_id);
  }
  for (const g of Object.keys(byGame)) byGame[g].players = playersByGame[g].size;
  if (dailyRows.error) throw new Error(`ts_daily_plays: ${dailyRows.error.message}`);

  const pays = payRows.data || [];
  return {
    newAccounts: accounts.filter((t) => t >= from && t < to).length,
    newAnonPlayers,
    savedSessions: sessions.length,
    activePlayers: new Set(sessions.map((r) => r.user_id)).size,
    byGame,
    dailyPlays: (dailyRows.data || []).reduce((s, r) => s + (r.play_count || 0), 0),
    payments: pays.length,
    lifetimePayments: pays.filter((p) => (p.plan_type || 'lifetime') !== 'day_pass').length,
    dayPassPayments: pays.filter((p) => p.plan_type === 'day_pass').length,
    revenuePence: pays.reduce((s, p) => s + (p.amount_total || 0), 0),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return respond(405, 'Method not allowed');
  if (!tokenOk(event.headers?.['x-analytics-token'])) return respond(403, 'Forbidden');

  let ranges;
  try {
    ranges = JSON.parse(event.body || '{}').ranges;
  } catch {
    return respond(400, 'Bad request');
  }
  for (const [w, c] of WINDOWS) {
    const r = ranges?.[w]?.[c];
    if (!r || !DATE.test(r.startDate) || !DATE.test(r.endDate) || r.startDate > r.endDate) return respond(400, 'Bad range');
  }

  try {
    const client = sb();
    const accounts = await authCreatedAt(client);
    const out = { momentum: {}, decision: {} };
    for (const [w, c] of WINDOWS) out[w][c] = await countsFor(client, ranges[w][c], accounts);

    const now = new Date().toISOString();
    const [pro, dayPass] = await Promise.all([
      client.from('ts_users').select('*', { count: 'exact', head: true }).eq('tier', 'paid'),
      client.from('ts_users').select('*', { count: 'exact', head: true }).eq('tier', 'paid').gt('pro_expires_at', now),
    ]);
    out.snapshot = { totalAccounts: accounts.length, proUsers: pro.count || 0, activeDayPasses: dayPass.count || 0 };
    return respond(200, out);
  } catch (e) {
    console.error('[analytics-stats] failed', e && e.message ? e.message : 'unknown');
    return respond(500, 'Failed');
  }
};
