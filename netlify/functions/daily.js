/**
 * daily.js — today's challenge.
 *
 * A thin wrapper over _daily.js, which is where the reasoning lives. Nothing
 * is stored and nothing is scheduled: the challenge is a function of the date,
 * so this is a pure read and any day's is equally answerable.
 *
 *   GET /daily                    today
 *   GET /daily?date=2026-09-06    that day
 *   GET /daily?days=7             today plus the next six, for a calendar
 *
 * Streaks are NOT here. They live in the browser until there is an account
 * worth attaching them to — see public/js/ts-streak.js.
 */

const { respond, handleOptions } = require('./_supabase.js');
const daily = require('./_daily');

const MAX_DAYS = 14;

exports.handler = async (event) => {
  const pre = handleOptions(event);
  if (pre) return pre;

  const q = event.queryStringParameters || {};
  const date = daily.isDate(q.date) ? q.date : daily.today();
  const days = Math.max(1, Math.min(MAX_DAYS, Number(q.days) || 1));

  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.parse(`${date}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    out.push(daily.challengeFor(d));
  }

  return respond(200, {
    today: daily.today(),
    challenge: out[0],
    // Only present when asked for, so the common case stays one small object.
    upcoming: days > 1 ? out : undefined,
    pool: daily.poolSize,
  });
};
