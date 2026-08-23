/**
 * week-results.js
 *
 * The Monday-morning email: how the matchweek went.
 *
 * Sends a personalised summary to every active player an hour after a week
 * is scored — who won it, who blanked, how you did against Picks AI, and
 * how many players you finished ahead of.
 *
 * WHEN IT FIRES
 * There is no reliable "week was scored" event to hook: a week can be
 * scored from the admin button, from auto-score, or by hand in SQL. So this
 * DETECTS the condition instead — all matches have results and every
 * prediction has been scored — stamps predict_match_weeks.scored_at the
 * first time it sees that, and sends an hour later. Detection runs on the
 * same 30-minute cron as the reminder, so "an hour" is accurate to within
 * half of one.
 *
 * Sent exactly once: results_email_sent_at is stamped after sending and the
 * week is skipped thereafter, so redeploys and extra ticks are harmless.
 *
 * Like the other long-running jobs this does the work in a background
 * function (24 sequential sends is well past the 30s scheduled ceiling) —
 * see week-results-background.js.
 *
 * Env: GMAIL_USER, GMAIL_APP_PASSWORD (shared with picks-reminder).
 */

const nodemailer = require('nodemailer');
const { sb, respond, currentSeason } = require('./_supabase.js');

const DELAY_HOURS = Number(process.env.RESULTS_EMAIL_DELAY_HOURS || 1);

function stripFC(name) {
  return (name || '').replace(/\s*(FC|AFC)$/i, '').trim();
}

function pickLabel(pick, match) {
  if (pick === 'HOME') return stripFC(match.home_team);
  if (pick === 'AWAY') return stripFC(match.away_team);
  if (pick === 'DRAW') return 'Draw';
  return 'no pick';
}

/** "Jackson", "Jackson and Nav", "Jackson, Nav and Dave" */
function nameList(names) {
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

function plural(n, one, many) {
  return n === 1 ? one : (many || one + 's');
}

// ── Email ───────────────────────────────────────────────────────────────

function buildEmail({ me, week, matches, standings, bot, blanks, topScore, winners }) {
  // Count humans only. Picks AI gets its own line below, and counting it
  // here would both double-mention it and inflate "you beat N players".
  const humans = standings.filter((r) => !r.isBot);
  const beat = humans.filter((r) => r.correct < me.correct).length;
  const tied = humans.filter((r) => r.correct === me.correct && r.userId !== me.userId).length;

  // How they did against Picks AI — the line people will read first.
  let aiLine = '';
  let aiColour = '#888';
  if (bot && bot.userId !== me.userId) {
    if (me.correct > bot.correct) {
      aiLine = `You beat Picks AI ${me.correct}–${bot.correct} this week.`;
      aiColour = '#00ff88';
    } else if (me.correct < bot.correct) {
      aiLine = `Picks AI beat you ${bot.correct}–${me.correct} this week.`;
      aiColour = '#e05555';
    } else {
      aiLine = `You drew with Picks AI, ${me.correct} each.`;
      aiColour = '#ffcc00';
    }
  }

  const isWinner = winners.includes(me.name);
  const isBlank = me.correct === 0;

  const headline = isWinner
    ? (winners.length === 1
        ? `You won Week ${week}.`
        : `You shared the Week ${week} win.`)
    : `You got ${me.correct} out of 5.`;

  const winnerLine = winners.length === 1
    ? `<strong style="color:#fff">${winners[0]}</strong> won the week with ${topScore} out of 5.`
    : `${winners.length} players tied on ${topScore} out of 5 — <strong style="color:#fff">${nameList(winners)}</strong>.`;

  const blankLine = blanks.length
    ? `<p style="margin:0 0 8px;color:#e05555;font-size:14px">` +
      `${plural(blanks.length, 'A blank for', 'Blanks for')} <strong>${nameList(blanks)}</strong> — ` +
      `nothing at all this week.</p>`
    : '';

  const matchRows = matches.map((m) => {
    const mine = me.picks[String(m.id)];
    const right = mine && mine === m.correct_result;
    return `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #2a2a2a;color:#aaa;font-size:13px">
          ${stripFC(m.home_team)} v ${stripFC(m.away_team)}</td>
        <td style="padding:8px;border-bottom:1px solid #2a2a2a;color:#fff;font-size:13px;white-space:nowrap">
          ${pickLabel(m.correct_result, m)}</td>
        <td style="padding:8px;border-bottom:1px solid #2a2a2a;text-align:right;white-space:nowrap;
                   color:${right ? '#00ff88' : '#666'};font-size:13px">
          ${right ? '✓' : '✗'} ${mine ? pickLabel(mine, m) : 'no pick'}</td>
      </tr>`;
  }).join('');

  const tableRows = standings.map((r, i) => `
      <tr style="${r.userId === me.userId ? 'background:#16202a' : ''}">
        <td style="padding:6px 8px;color:#666;font-size:12px;width:30px">${i + 1}</td>
        <td style="padding:6px 8px;color:${r.userId === me.userId ? '#00E5FF' : '#ccc'};font-size:13px">
          ${r.name}${r.isBot ? ' <span style="color:#FF2E9F;font-size:10px">AI</span>' : ''}</td>
        <td style="padding:6px 8px;text-align:right;color:${r.correct === 0 ? '#e05555' : '#fff'};
                   font-weight:bold;font-size:13px">${r.correct}</td>
      </tr>`).join('');

  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Courier New',monospace;color:#e0e0e0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <tr><td style="background:#111;border-top:3px solid ${isWinner ? '#00ff88' : '#00E5FF'};padding:24px 28px">
    <div style="font-size:22px;font-weight:bold;letter-spacing:2px;color:#fff">
      Tele<span style="color:${isWinner ? '#00ff88' : '#00E5FF'}">Stats</span> ⚽</div>
    <div style="color:#888;font-size:12px;margin-top:4px;letter-spacing:1px">
      FIVES — WEEK ${week} RESULTS</div>
  </td></tr>

  <tr><td style="background:${isWinner ? '#0d2a1a' : (isBlank ? '#2a1010' : '#0d1a2a')};
                 padding:16px 28px;font-size:16px;font-weight:bold;
                 color:${isWinner ? '#00ff88' : (isBlank ? '#e05555' : '#00E5FF')}">
    ${headline}
  </td></tr>

  <tr><td style="background:#111;padding:22px 28px">
    <p style="margin:0 0 10px;font-size:14px;color:#aaa">${winnerLine}</p>
    ${blankLine}
    ${aiLine ? `<p style="margin:0 0 8px;font-size:15px;color:${aiColour};font-weight:bold">${aiLine}</p>` : ''}
    <p style="margin:0 0 18px;font-size:14px;color:#aaa">
      You finished ahead of ${beat} ${plural(beat, 'player')}${tied ? `, level with ${tied}` : ''}.
    </p>

    <div style="color:#555;font-size:11px;letter-spacing:1px;margin-bottom:6px">YOUR WEEK</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px">
      <tr>
        <th style="text-align:left;padding:6px 8px;color:#555;font-size:11px;border-bottom:1px solid #2a2a2a">FIXTURE</th>
        <th style="text-align:left;padding:6px 8px;color:#555;font-size:11px;border-bottom:1px solid #2a2a2a">RESULT</th>
        <th style="text-align:right;padding:6px 8px;color:#555;font-size:11px;border-bottom:1px solid #2a2a2a">YOUR PICK</th>
      </tr>
      ${matchRows}
    </table>

    <div style="color:#555;font-size:11px;letter-spacing:1px;margin-bottom:6px">THE WEEK</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${tableRows}</table>

    <div style="text-align:center;margin:24px 0 4px">
      <a href="https://telestats.net/predict/league.html"
         style="background:#00E5FF;color:#000;font-weight:bold;padding:12px 28px;
                border-radius:6px;text-decoration:none;font-size:14px;display:inline-block">
        See the league table →</a>
    </div>
  </td></tr>

  <tr><td style="background:#0a0a0a;padding:16px 28px;border-top:1px solid #1a1a1a">
    <p style="margin:0;color:#444;font-size:11px;line-height:1.6">
      You're receiving this because you're part of TeleStats Fives.</p>
  </td></tr>

</table></td></tr></table></body></html>`;

  const text = [
    `FIVES — WEEK ${week} RESULTS`,
    '',
    headline,
    winners.length === 1
      ? `${winners[0]} won the week with ${topScore}/5.`
      : `${winners.length} players tied on ${topScore}/5: ${nameList(winners)}.`,
    blanks.length ? `Blanks: ${nameList(blanks)}.` : '',
    aiLine,
    `You finished ahead of ${beat} ${plural(beat, 'player')}.`,
    '',
    'https://telestats.net/predict/league.html'
  ].filter(Boolean).join('\n');

  const subject = isWinner
    ? `You won Week ${week}! (${me.correct}/5)`
    : `Week ${week} results — you got ${me.correct}/5`;

  return { subject, html, text };
}

// ── Readiness ───────────────────────────────────────────────────────────

/**
 * Can this week's results email be sent yet?
 *
 * Split out so the trigger can answer synchronously. Without it the trigger
 * returns 202 "started", the background function quietly decides the week
 * is not ready, and the admin sees a success message for an email that was
 * never sent — which is exactly what happened the first time.
 */
async function checkReady(client, weekNumber) {
  const season = await currentSeason(client);

  let q = client
    .from('predict_match_weeks')
    .select('id, week_number, results_email_sent_at')
    .eq('week_number', Number(weekNumber));
  if (season) q = q.eq('season', season);

  const { data: weeks, error } = await q;
  if (error) return { ready: false, reason: `Week lookup failed: ${error.message}` };
  if (!weeks?.length) return { ready: false, reason: `No week ${weekNumber} this season.` };

  const week = weeks[0];

  const { data: matches } = await client
    .from('predict_matches')
    .select('id, home_team, away_team, correct_result')
    .eq('match_week_id', week.id);

  if (!matches?.length) return { ready: false, reason: `Week ${weekNumber} has no fixtures.` };

  const missing = matches.filter((m) =>
    !['HOME', 'AWAY', 'DRAW'].includes(String(m.correct_result || '').toUpperCase()));
  if (missing.length) {
    return {
      ready: false,
      reason:
        `Week ${weekNumber} is not fully scored — ${missing.length} of ${matches.length} ` +
        `${missing.length === 1 ? 'fixture has' : 'fixtures have'} no result yet: ` +
        missing.map((m) => `${m.home_team} v ${m.away_team}`).join(', ') +
        '. Set the results and score the week first.'
    };
  }

  const { data: preds } = await client
    .from('predict_predictions')
    .select('id, points_awarded')
    .in('match_id', matches.map((m) => m.id));

  const unscored = (preds || []).filter((p) => p.points_awarded == null).length;
  if (unscored) {
    return {
      ready: false,
      reason:
        `Week ${weekNumber} has all its results, but ${unscored} ` +
        `${unscored === 1 ? 'pick has' : 'picks have'} not been scored. ` +
        'Score the week first.'
    };
  }

  return {
    ready: true,
    alreadySent: week.results_email_sent_at || null,
    fixtures: matches.length,
    picks: (preds || []).length
  };
}

// ── Work ────────────────────────────────────────────────────────────────

async function run({ force = false, testEmail = null, week: requestedWeek = null } = {}) {
  try {
    const client = sb();
    const season = await currentSeason(client);

    let weekQuery = client
      .from('predict_match_weeks')
      .select('id, week_number, season, scored_at, results_email_sent_at')
      .order('week_number', { ascending: false });
    if (season) weekQuery = weekQuery.eq('season', season);
    if (requestedWeek) weekQuery = weekQuery.eq('week_number', Number(requestedWeek));

    const { data: weeks, error: weeksErr } = await weekQuery;
    if (weeksErr) throw new Error(`Week lookup failed: ${weeksErr.message}`);
    if (!weeks?.length) return respond(200, { ok: true, message: 'No weeks this season.' });

    const notes = [];

    for (const week of weeks) {
      if (week.results_email_sent_at && !force) {
        notes.push(`Week ${week.week_number}: already sent at ${week.results_email_sent_at}`);
        continue;
      }

      // Is it actually finished?
      const { data: matches, error: mErr } = await client
        .from('predict_matches')
        .select('id, home_team, away_team, correct_result')
        .eq('match_week_id', week.id)
        .order('id', { ascending: true });
      if (mErr || !matches?.length) continue;

      const allResults = matches.every((m) =>
        ['HOME', 'AWAY', 'DRAW'].includes(String(m.correct_result || '').toUpperCase()));
      if (!allResults && !force) {
        notes.push(`Week ${week.week_number}: not all results in yet`);
        continue;
      }

      const { data: preds, error: pErr } = await client
        .from('predict_predictions')
        .select('user_id, match_id, pick, points_awarded')
        .in('match_id', matches.map((m) => m.id));
      if (pErr) throw new Error(`Prediction lookup failed: ${pErr.message}`);

      const anyUnscored = (preds || []).some((p) => p.points_awarded == null);
      if (anyUnscored && !force) {
        notes.push(`Week ${week.week_number}: results in but picks not scored yet`);
        continue;
      }

      // First sighting of a finished week — start the clock.
      //
      // This gate used to skip unconditionally, INCLUDING when forced. So
      // the first press of "Send test to me" stamped scored_at, sent
      // nothing, and still reported success, because the trigger had
      // already returned 202. Pressing it a second time would have worked,
      // which made it look random. When an admin explicitly asks, stamp and
      // carry on rather than silently deferring an hour.
      if (!week.scored_at) {
        const now = new Date().toISOString();
        await client.from('predict_match_weeks')
          .update({ scored_at: now }).eq('id', week.id);
        week.scored_at = now;

        if (!force) {
          notes.push(`Week ${week.week_number}: marked scored, email in ~${DELAY_HOURS}h`);
          continue;
        }
      }

      const hoursSince = (Date.now() - new Date(week.scored_at).getTime()) / 3.6e6;
      if (hoursSince < DELAY_HOURS && !force) {
        notes.push(
          `Week ${week.week_number}: scored ${hoursSince.toFixed(1)}h ago, ` +
          `sending at ${DELAY_HOURS}h`);
        continue;
      }

      // ── Build the standings for the week ─────────────────────────────
      const { data: users, error: uErr } = await client
        .from('predict_users')
        .select('id, username, full_name, email, is_bot')
        .eq('is_active', true);
      if (uErr) throw new Error(`User lookup failed: ${uErr.message}`);

      const byUser = {};
      for (const p of (preds || [])) {
        const u = (byUser[p.user_id] = byUser[p.user_id] || { correct: 0, picks: {} });
        u.picks[String(p.match_id)] = String(p.pick || '').toUpperCase();
        u.correct += (p.points_awarded === 1 ? 1 : 0);
      }

      const standings = (users || [])
        .filter((u) => byUser[u.id])
        .map((u) => ({
          userId: u.id,
          name: u.username || u.full_name || `User ${u.id}`,
          email: u.email,
          isBot: !!u.is_bot,
          correct: byUser[u.id].correct,
          picks: byUser[u.id].picks
        }))
        .sort((a, b) => b.correct - a.correct || a.name.localeCompare(b.name));

      if (!standings.length) {
        notes.push(`Week ${week.week_number}: nobody played`);
        continue;
      }

      const topScore = standings[0].correct;
      const winners = standings.filter((r) => r.correct === topScore).map((r) => r.name);
      const blanks = standings.filter((r) => r.correct === 0).map((r) => r.name);
      const bot = standings.find((r) => r.isBot) || null;

      // ── Send ─────────────────────────────────────────────────────────
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
      });

      const recipients = standings.filter((r) => !r.isBot && r.email)
        .filter((r) => !testEmail || r.email === testEmail);

      let sent = 0;
      const results = [];
      for (const me of recipients) {
        try {
          const { subject, html, text } = buildEmail({
            me, week: week.week_number, matches, standings, bot, blanks, topScore, winners
          });
          await transporter.sendMail({
            from: `TeleStats Fives <${process.env.GMAIL_USER}>`,
            to: me.email, subject, html, text
          });
          sent++;
          results.push({ to: me.email, ok: true });
        } catch (e) {
          console.error(`week-results: send failed for ${me.email}: ${e.message}`);
          results.push({ to: me.email, ok: false, error: e.message });
        }
      }

      // Test sends must not stamp, or the real email never goes out.
      let stamped = false;
      if (!testEmail && sent > 0) {
        const { error: stampErr } = await client.from('predict_match_weeks')
          .update({ results_email_sent_at: new Date().toISOString() }).eq('id', week.id);
        if (!stampErr) stamped = true;
        else console.error(`week-results: stamp failed: ${stampErr.message}`);
      }

      console.log(`week-results: week ${week.week_number} — sent ${sent} emails`);
      return respond(200, {
        ok: true, week: week.week_number, sent, stamped,
        testMode: !!testEmail, topScore, winners, blanks,
        aiScore: bot ? bot.correct : null, results
      });
    }

    return respond(200, { ok: true, message: 'Nothing to send.', notes });
  } catch (e) {
    console.error('week-results error:', e);
    return respond(500, e.message || 'Unknown error');
  }
}

// Exposed for local testing of the copy (scripts/week-results-preview.js).
exports._internal = { buildEmail, nameList, plural };
exports.checkReady = checkReady;

exports.run = run;

/** Scheduled entry point — hands off, because 24 sequential sends exceeds 30s. */
exports.handler = async () => {
  const base = process.env.URL || process.env.DEPLOY_URL;
  const secret = process.env.ADMIN_SECRET;
  if (!base || !secret) return respond(500, 'URL or ADMIN_SECRET not configured');

  try {
    const res = await fetch(`${base}/.netlify/functions/week-results-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
      body: '{}'
    });
    return respond(202, { ok: true, handedOff: true, status: res.status });
  } catch (e) {
    console.error('week-results: handoff failed:', e.message);
    return respond(500, `Handoff failed: ${e.message}`);
  }
};
