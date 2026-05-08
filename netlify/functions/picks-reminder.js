/**
 * picks-reminder.js
 *
 * Sends a reminder email to all predict_users 2 hours before the first
 * match lockout of any open matchweek.
 *
 * - Users who have submitted all 5 picks: email shows their picks
 * - Users who haven't submitted: email warns them to get picks in
 *
 * Deduplication: the cron runs every 30 minutes, and the trigger window
 * is 28 minutes wide (1h46m – 2h14m before first lockout), so only one
 * cron run per week will ever fire the emails.
 *
 * Schedule: every 30 minutes (see netlify.toml)
 * Also callable manually: POST /.netlify/functions/picks-reminder with x-admin-secret
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — DB access
 *   GMAIL_USER                               — sending address
 *   GMAIL_APP_PASSWORD                       — Gmail app password
 */

const nodemailer = require('nodemailer');
const { sb, respond, requireAdmin, handleOptions } = require('./_supabase.js');

// ── Helpers ────────────────────────────────────────────────────────────────

function stripFC(name) {
  return (name || '').replace(/\s*FC$/i, '').trim();
}

function pickEmoji(pick) {
  if (pick === 'HOME') return '🏠';
  if (pick === 'AWAY') return '✈️';
  if (pick === 'DRAW') return '🤝';
  return '❓';
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/London'
  }) + ' (UK)';
}

function formatDeadline(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/London'
  }) + ' (UK)';
}

// ── Email builder ──────────────────────────────────────────────────────────

function buildEmail({ user, weekNumber, matches, picks, deadline }) {
  const hasPicks = picks.length === matches.length;
  const displayName = user.username || user.full_name || 'there';

  const accentColour = hasPicks ? '#00ff88' : '#ffcc00';
  const statusBanner = hasPicks
    ? `✅ You're all set — your picks are in!`
    : `⚠️ We haven't received your picks yet!`;

  // Build match rows
  const matchRows = matches.map(match => {
    const pick = picks.find(p => p.match_id === match.id);
    const home = stripFC(match.home_team);
    const away = stripFC(match.away_team);
    const kickoff = formatTime(match.lockout_time);

    if (pick) {
      const isHome = pick.pick === 'HOME';
      const isAway = pick.pick === 'AWAY';
      const isDraw = pick.pick === 'DRAW';
      return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #2a2a2a;">
            <span style="color:${isHome ? accentColour : '#aaa'};font-weight:${isHome ? 'bold' : 'normal'}">${home}</span>
            <span style="color:#555;padding:0 6px;">vs</span>
            <span style="color:${isAway ? accentColour : '#aaa'};font-weight:${isAway ? 'bold' : 'normal'}">${away}</span>
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #2a2a2a;color:#888;font-size:12px;white-space:nowrap">${kickoff}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #2a2a2a;text-align:right;white-space:nowrap">
            <span style="background:${accentColour};color:#000;font-weight:bold;padding:3px 10px;border-radius:4px;font-size:13px;">
              ${pickEmoji(pick.pick)} ${isDraw ? 'DRAW' : pick.pick}
            </span>
          </td>
        </tr>`;
    } else {
      return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #2a2a2a;color:#aaa;">
            ${home} vs ${away}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #2a2a2a;color:#888;font-size:12px;white-space:nowrap">${kickoff}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #2a2a2a;text-align:right">
            <span style="color:#555;font-style:italic;">no pick</span>
          </td>
        </tr>`;
    }
  }).join('');

  const ctaButton = hasPicks ? '' : `
    <div style="text-align:center;margin:24px 0;">
      <a href="https://telestats.net/predict/"
         style="background:#ffcc00;color:#000;font-weight:bold;padding:14px 32px;border-radius:6px;text-decoration:none;font-size:16px;display:inline-block;">
        Submit Your Picks →
      </a>
    </div>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Courier New',monospace;color:#e0e0e0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#111;border-top:3px solid ${accentColour};padding:24px 28px;">
            <div style="font-size:22px;font-weight:bold;letter-spacing:2px;color:#fff;">
              Tele<span style="color:${accentColour}">Stats</span> ⚽
            </div>
            <div style="color:#888;font-size:12px;margin-top:4px;letter-spacing:1px;">
              FIVES — WEEK ${weekNumber} REMINDER
            </div>
          </td>
        </tr>

        <!-- Status banner -->
        <tr>
          <td style="background:${hasPicks ? '#0d2a1a' : '#2a2000'};padding:14px 28px;font-size:14px;color:${accentColour};">
            ${statusBanner}
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#111;padding:24px 28px;">
            <p style="margin:0 0 16px;font-size:15px;">
              Hey <strong style="color:#fff">${displayName}</strong>,
            </p>
            <p style="margin:0 0 20px;color:#aaa;font-size:14px;line-height:1.6;">
              ${hasPicks
                ? `The first match of Week ${weekNumber} locks in <strong style="color:#fff">~2 hours</strong> — here's what you've got down:`
                : `The first match of Week ${weekNumber} locks in <strong style="color:${accentColour}">~2 hours</strong> and we haven't received your picks yet. Get them in before the deadline!`
              }
            </p>

            <!-- Matches table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:8px;color:#555;font-size:11px;letter-spacing:1px;border-bottom:1px solid #2a2a2a;">FIXTURE</th>
                  <th style="text-align:left;padding:8px;color:#555;font-size:11px;letter-spacing:1px;border-bottom:1px solid #2a2a2a;">KICKOFF</th>
                  <th style="text-align:right;padding:8px;color:#555;font-size:11px;letter-spacing:1px;border-bottom:1px solid #2a2a2a;">YOUR PICK</th>
                </tr>
              </thead>
              <tbody>${matchRows}</tbody>
            </table>

            <p style="color:#555;font-size:12px;margin:0 0 4px;">
              ⏰ Deadline: <span style="color:#aaa">${deadline}</span>
            </p>

            ${ctaButton}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0a0a0a;padding:16px 28px;border-top:1px solid #1a1a1a;">
            <p style="margin:0;color:#444;font-size:11px;line-height:1.6;">
              You're receiving this because you're part of TeleStats Fives.<br>
              <a href="https://telestats.net/predict/" style="color:#555;">telestats.net/predict</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = hasPicks
    ? `Hey ${displayName}, your Week ${weekNumber} picks are in! Deadline: ${deadline}. Good luck!`
    : `Hey ${displayName}, we haven't received your Week ${weekNumber} picks yet! Deadline: ${deadline}. Submit at https://telestats.net/predict/`;

  const subject = hasPicks
    ? `⏰ Week ${weekNumber} picks confirmed — deadline in ~2hrs`
    : `⚠️ Week ${weekNumber}: we haven't got your picks yet!`;

  return { subject, html, text };
}

// ── Handler ────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const corsResponse = handleOptions(event);
  if (corsResponse) return corsResponse;

  // Allow manual trigger via POST with admin secret
  const isManual = event.httpMethod === 'POST';
  if (isManual) {
    const adminErr = await requireAdmin(event);
    if (adminErr) return adminErr;
  }

  const body = isManual ? JSON.parse(event.body || '{}') : {};
  // force=true bypasses the time window and sends to test_email only (or all if omitted)
  const forceMode = !!body.force;
  const testEmail = body.test_email || null; // e.g. "babacvafaey@gmail.com"

  try {
    const client = sb();
    const now = new Date();

    // 1. Find open matchweeks, sorted soonest first
    const { data: openWeeks, error: weeksErr } = await client
      .from('predict_match_weeks')
      .select('id, week_number, status')
      .eq('status', 'open')
      .order('week_number', { ascending: true });

    if (weeksErr) throw new Error(`Failed to fetch weeks: ${weeksErr.message}`);
    if (!openWeeks || openWeeks.length === 0) {
      return respond(200, { ok: true, message: 'No open matchweeks found.' });
    }

    let weekFired = null;
    let emailsSent = 0;
    let skippedReason = null;

    for (const week of openWeeks) {
      // 2. Get matches for this week, ordered by lockout_time
      const { data: matches, error: matchErr } = await client
        .from('predict_matches')
        .select('id, home_team, away_team, lockout_time')
        .eq('match_week_id', week.id)
        .order('lockout_time', { ascending: true });

      if (matchErr || !matches || matches.length === 0) continue;

      const firstLockout = new Date(matches[0].lockout_time);
      const minutesUntil = (firstLockout - now) / (1000 * 60);

      // 28-minute window: 106min to 134min before first lockout
      // Cron fires every 30min so this window is hit exactly once
      const inWindow = minutesUntil >= 106 && minutesUntil <= 134;

      if (!forceMode && !inWindow) {
        skippedReason = `Week ${week.week_number}: ${minutesUntil.toFixed(0)} mins until lockout (window is 106–134 mins)`;
        continue;
      }

      // In force mode, pick the soonest upcoming week (positive minutesUntil)
      if (forceMode && minutesUntil < 0) continue;

      weekFired = week.week_number;

      // 3. Get users + all picks for these matches
      const matchIds = matches.map(m => m.id);

      const [{ data: allUsers, error: usersErr }, { data: allPicks, error: picksErr }] = await Promise.all([
        client.from('predict_users').select('id, username, full_name, email').order('id'),
        client.from('predict_predictions').select('user_id, match_id, pick').in('match_id', matchIds)
      ]);

      if (usersErr) throw new Error(`Failed to fetch users: ${usersErr.message}`);
      if (picksErr) throw new Error(`Failed to fetch picks: ${picksErr.message}`);

      // In force/test mode, restrict to test_email only
      const users = forceMode && testEmail
        ? (allUsers || []).filter(u => u.email === testEmail)
        : (allUsers || []);

      // 4. Set up Gmail transporter
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        }
      });

      const deadline = formatDeadline(matches[0].lockout_time);

      // 5. Send one email per user
      const results = [];
      for (const user of users) {
        if (!user.email) continue;

        const userPicks = (allPicks || []).filter(p => p.user_id === user.id);
        const { subject, html, text } = buildEmail({
          user,
          weekNumber: week.week_number,
          matches,
          picks: userPicks,
          deadline
        });

        try {
          await transporter.sendMail({
            from: `TeleStats Fives <${process.env.GMAIL_USER}>`,
            to: user.email,
            subject,
            text,
            html
          });
          results.push({ user: user.username || user.email, status: 'sent', hasPicks: userPicks.length > 0 });
          emailsSent++;
        } catch (mailErr) {
          console.error(`Email failed for ${user.email}:`, mailErr.message);
          results.push({ user: user.username || user.email, status: 'failed', error: mailErr.message });
        }
      }

      console.log(`picks-reminder: Week ${week.week_number} — sent ${emailsSent} emails`);

      return respond(200, {
        ok: true,
        week: week.week_number,
        emailsSent,
        minutesUntilLockout: Math.round(minutesUntil),
        results
      });
    }

    // No week was in the trigger window
    return respond(200, {
      ok: true,
      message: 'No matchweek in reminder window.',
      skippedReason,
      checkedWeeks: openWeeks.map(w => w.week_number)
    });

  } catch (e) {
    console.error('picks-reminder error:', e);
    return respond(500, e.message || 'Unknown error');
  }
};
