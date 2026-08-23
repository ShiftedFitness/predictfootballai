/**
 * week-open.js
 *
 * "Week N is live" — the email that tells players a new matchweek is open,
 * lists the fixtures and states the deadline.
 *
 * NOT scheduled, deliberately. A week gets seeded and the admin may still
 * want to swap a fixture or fix a lockout time before telling 23 people
 * about it. So this goes out when the admin presses the button in the admin
 * panel, and open_email_sent_at stops it going twice.
 *
 * Work happens in week-open-background.js (23 sequential sends is well past
 * the 30s ceiling on non-background functions); week-open-trigger.js is the
 * HTTP entry point and pre-checks readiness synchronously so the admin never
 * gets a success message for an email that did not send.
 *
 * Env: GMAIL_USER, GMAIL_APP_PASSWORD.
 */

const nodemailer = require('nodemailer');
const { sb, respond, currentSeason } = require('./_supabase.js');

function stripFC(name) {
  return (name || '').replace(/\s*(FC|AFC)$/i, '').trim();
}

function ukTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'
  });
}

function ukTimeShort(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'
  });
}

// ── Readiness ───────────────────────────────────────────────────────────

/**
 * Can this week's "picks are open" email go out?
 * Answered synchronously by the trigger — see week-results-trigger.js for
 * why: a 202 handoff must not be reported to a human as success.
 */
async function checkReady(client, weekNumber) {
  const season = await currentSeason(client);

  let q = client
    .from('predict_match_weeks')
    .select('id, week_number, open_email_sent_at')
    .eq('week_number', Number(weekNumber));
  if (season) q = q.eq('season', season);

  const { data: weeks, error } = await q;
  if (error) return { ready: false, reason: `Week lookup failed: ${error.message}` };
  if (!weeks?.length) return { ready: false, reason: `No week ${weekNumber} this season.` };

  const week = weeks[0];

  const { data: matches } = await client
    .from('predict_matches')
    .select('id, home_team, away_team, lockout_time')
    .eq('match_week_id', week.id)
    .order('lockout_time', { ascending: true });

  if (!matches?.length) {
    return { ready: false, reason: `Week ${weekNumber} has no fixtures yet — seed it first.` };
  }
  if (matches.length !== 5) {
    return { ready: false, reason: `Week ${weekNumber} has ${matches.length} fixtures, expected 5.` };
  }

  const noLockout = matches.filter((m) => !m.lockout_time);
  if (noLockout.length) {
    return {
      ready: false,
      reason: `Week ${weekNumber} has ${noLockout.length} fixture(s) with no deadline set.`
    };
  }

  const first = new Date(matches[0].lockout_time).getTime();
  const hoursUntil = (first - Date.now()) / 3.6e6;
  if (hoursUntil <= 0) {
    return {
      ready: false,
      reason:
        `Week ${weekNumber}'s deadline has already passed (${ukTime(matches[0].lockout_time)}). ` +
        'There is nothing for players to submit.'
    };
  }

  return {
    ready: true,
    alreadySent: week.open_email_sent_at || null,
    fixtures: matches.length,
    deadline: matches[0].lockout_time,
    hoursUntil: Number(hoursUntil.toFixed(1))
  };
}

// ── Email ───────────────────────────────────────────────────────────────

function buildEmail({ name, week, matches, deadline }) {
  const rows = matches.map((m) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #2a2a2a;color:#e0e0e0;font-size:14px">
          ${stripFC(m.home_team)} <span style="color:#555">v</span> ${stripFC(m.away_team)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #2a2a2a;color:#888;
                   font-size:12px;text-align:right;white-space:nowrap">
          ${ukTimeShort(m.lockout_time)}</td>
      </tr>`).join('');

  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Courier New',monospace;color:#e0e0e0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <tr><td style="background:#111;border-top:3px solid #FFD60A;padding:24px 28px">
    <div style="font-size:22px;font-weight:bold;letter-spacing:2px;color:#fff">
      Tele<span style="color:#FFD60A">Stats</span> ⚽</div>
    <div style="color:#888;font-size:12px;margin-top:4px;letter-spacing:1px">
      FIVES — WEEK ${week} IS OPEN</div>
  </td></tr>

  <tr><td style="background:#2a2000;padding:14px 28px;font-size:15px;color:#FFD60A;font-weight:bold">
    Five new fixtures. Get your picks in.
  </td></tr>

  <tr><td style="background:#111;padding:24px 28px">
    <p style="margin:0 0 18px;font-size:15px">Hey <strong style="color:#fff">${name}</strong>,</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px">
      <tr>
        <th style="text-align:left;padding:6px 8px;color:#555;font-size:11px;letter-spacing:1px;
                   border-bottom:1px solid #2a2a2a">FIXTURE</th>
        <th style="text-align:right;padding:6px 8px;color:#555;font-size:11px;letter-spacing:1px;
                   border-bottom:1px solid #2a2a2a">KICK-OFF</th>
      </tr>
      ${rows}
    </table>

    <div style="background:#1a1408;border-left:3px solid #FFD60A;padding:12px 14px;margin-bottom:20px">
      <div style="color:#888;font-size:11px;letter-spacing:1px;margin-bottom:2px">DEADLINE</div>
      <div style="color:#FFD60A;font-size:16px;font-weight:bold">${ukTime(deadline)}</div>
      <div style="color:#777;font-size:12px;margin-top:4px">
        Picks lock when the first match kicks off. No late entries.</div>
    </div>

    <div style="text-align:center;margin:8px 0 4px">
      <a href="https://telestats.net/predict/"
         style="background:#FFD60A;color:#000;font-weight:bold;padding:14px 32px;
                border-radius:6px;text-decoration:none;font-size:16px;display:inline-block">
        Make your picks →</a>
    </div>
  </td></tr>

  <tr><td style="background:#0a0a0a;padding:16px 28px;border-top:1px solid #1a1a1a">
    <p style="margin:0;color:#444;font-size:11px;line-height:1.6">
      You're receiving this because you're part of TeleStats Fives.</p>
  </td></tr>

</table></td></tr></table></body></html>`;

  const text = [
    `FIVES — WEEK ${week} IS OPEN`,
    '',
    `Hey ${name}, five new fixtures are up:`,
    '',
    ...matches.map((m) =>
      `  ${stripFC(m.home_team)} v ${stripFC(m.away_team)}  (${ukTimeShort(m.lockout_time)})`),
    '',
    `DEADLINE: ${ukTime(deadline)}`,
    'Picks lock when the first match kicks off.',
    '',
    'https://telestats.net/predict/'
  ].join('\n');

  return { subject: `Fives — Week ${week} is open`, html, text };
}

// ── Work ────────────────────────────────────────────────────────────────

async function run({ force = false, testEmail = null, week: requestedWeek = null } = {}) {
  try {
    const client = sb();
    const season = await currentSeason(client);

    if (!requestedWeek) {
      return respond(400, 'A week number is required.');
    }

    let q = client
      .from('predict_match_weeks')
      .select('id, week_number, open_email_sent_at')
      .eq('week_number', Number(requestedWeek));
    if (season) q = q.eq('season', season);

    const { data: weeks, error: wErr } = await q;
    if (wErr) throw new Error(`Week lookup failed: ${wErr.message}`);
    if (!weeks?.length) return respond(404, `No week ${requestedWeek} this season.`);

    const week = weeks[0];
    if (week.open_email_sent_at && !force) {
      return respond(200, {
        ok: true, sent: 0,
        message: `Week ${week.week_number} was already announced at ${week.open_email_sent_at}.`
      });
    }

    const { data: matches, error: mErr } = await client
      .from('predict_matches')
      .select('id, home_team, away_team, lockout_time')
      .eq('match_week_id', week.id)
      .order('lockout_time', { ascending: true });
    if (mErr) throw new Error(`Fixture lookup failed: ${mErr.message}`);
    if (!matches?.length) return respond(400, `Week ${week.week_number} has no fixtures.`);

    const deadline = matches[0].lockout_time;

    const { data: users, error: uErr } = await client
      .from('predict_users')
      .select('id, username, full_name, email, is_bot')
      .eq('is_active', true);
    if (uErr) throw new Error(`User lookup failed: ${uErr.message}`);

    const recipients = (users || [])
      .filter((u) => !u.is_bot && u.email)
      .filter((u) => !testEmail || u.email === testEmail);

    if (!recipients.length) {
      return respond(200, {
        ok: true, sent: 0,
        message: testEmail
          ? `No active player has the address ${testEmail}.`
          : 'No active players with an email address.'
      });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });

    let sent = 0;
    const results = [];
    for (const u of recipients) {
      const name = u.username || u.full_name || 'there';
      try {
        const { subject, html, text } = buildEmail({
          name, week: week.week_number, matches, deadline
        });
        await transporter.sendMail({
          from: `TeleStats Fives <${process.env.GMAIL_USER}>`,
          to: u.email, subject, html, text
        });
        sent++;
        results.push({ to: u.email, ok: true });
      } catch (e) {
        console.error(`week-open: send failed for ${u.email}: ${e.message}`);
        results.push({ to: u.email, ok: false, error: e.message });
      }
    }

    // A test send must never stamp — otherwise testing silently cancels the
    // real announcement. Same rule as the reminder and results emails.
    let stamped = false;
    if (!testEmail && sent > 0) {
      const { error: stampErr } = await client
        .from('predict_match_weeks')
        .update({ open_email_sent_at: new Date().toISOString() })
        .eq('id', week.id);
      if (!stampErr) stamped = true;
      else console.error(`week-open: stamp failed: ${stampErr.message}`);
    }

    console.log(`week-open: week ${week.week_number} — sent ${sent} emails`);
    return respond(200, {
      ok: true, week: week.week_number, sent, stamped,
      testMode: !!testEmail, deadline, fixtures: matches.length, results
    });
  } catch (e) {
    console.error('week-open error:', e);
    return respond(500, e.message || 'Unknown error');
  }
}

exports.run = run;
exports.checkReady = checkReady;
exports._internal = { buildEmail, stripFC, ukTime, ukTimeShort };
