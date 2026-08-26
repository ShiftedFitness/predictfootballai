/**
 * picks-reminder.js
 *
 * Sends a reminder email to all predict_users 2 hours before the first
 * match lockout of any open matchweek.
 *
 * - Users who have submitted all 5 picks: email shows their picks
 * - Users who haven't submitted: email warns them to get picks in
 *
 * Deduplication: predict_match_weeks.reminder_sent_at is stamped once the
 * emails go out, and the week is skipped thereafter. This replaced a scheme
 * that relied on the trigger window (28 min) being narrower than the cron
 * interval (30 min) — which meant an awkwardly-timed lockout could fall
 * between two ticks and NOBODY got a reminder. The window is now 90-180
 * minutes and dedupe is explicit.
 *
 * Schedule: every 30 minutes (see netlify.toml).
 * Manual/test sends go through picks-reminder-trigger.js — this function
 * carries a schedule, and Netlify rejects HTTP calls to scheduled functions
 * with a 403 before they ever run.
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — DB access
 *   GMAIL_USER                               — sending address
 *   GMAIL_APP_PASSWORD                       — Gmail app password
 */

const nodemailer = require('nodemailer');
const { sb, respond, requireAdmin, handleOptions, currentSeason } = require('./_supabase.js');

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

/**
 * The work, callable from the cron handler below or from
 * picks-reminder-trigger.js (a separate unscheduled function, because
 * Netlify rejects HTTP calls to scheduled functions with a 403).
 *
 * @param force      bypass the timing window
 * @param testEmail  send only to this address (use with force to test)
 */
async function run({ force = false, testEmail = null } = {}) {
  const forceMode = !!force;
  {
  try {
    const client = sb();
    const now = new Date();

    // 1. Find open matchweeks, sorted soonest first
    // Scope to the current season. predict_match_weeks.status is never
    // advanced by the app, so last season left weeks stuck on 'open' with
    // lockouts long past — without this they are scanned every 30 minutes.
    const season = await currentSeason(client);

    let openWeekQuery = client
      .from('predict_match_weeks')
      .select('id, week_number, status, reminder_sent_at')
      .eq('status', 'open')
      .order('week_number', { ascending: true });
    if (season) openWeekQuery = openWeekQuery.eq('season', season);

    const { data: openWeeks, error: weeksErr } = await openWeekQuery;

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

      // The window used to be 106-134 minutes — 28 minutes wide against a
      // 30-minute cron, so a lockout landing awkwardly (e.g. 11:15) could
      // slip between two ticks and NOBODY got a reminder. Dedupe is now
      // done properly, with a stamp on the week, so the window can be
      // comfortably wider than the cron interval.
      const inWindow = minutesUntil >= 90 && minutesUntil <= 180;

      // Already sent for this week? (the stamp survives redeploys, unlike
      // any in-memory guard)
      if (!forceMode && week.reminder_sent_at) {
        skippedReason = `Week ${week.week_number}: reminders already sent at ${week.reminder_sent_at}`;
        continue;
      }

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
        // Skip bots (Picks AI has no inbox) and players who have left.
        client.from('predict_users')
          .select('id, username, full_name, email')
          .eq('is_bot', false)
          .eq('is_active', true)
          .order('id'),
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

      // 5. Send all emails in parallel
      const emailJobs = users
        .filter(u => u.email)
        .map(async user => {
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
            return { user: user.username || user.email, status: 'sent', hasPicks: userPicks.length > 0 };
          } catch (mailErr) {
            console.error(`Email failed for ${user.email}:`, mailErr.message);
            return { user: user.username || user.email, status: 'failed', error: mailErr.message };
          }
        });

      const results = await Promise.all(emailJobs);
      emailsSent = results.filter(r => r.status === 'sent').length;

      console.log(`picks-reminder: Week ${week.week_number} — sent ${emailsSent} emails`);

      // Stamp the week so later cron ticks inside the (now wider) window do
      // not send twice. Not stamped for a test send — that would silently
      // suppress the real reminder for everyone.
      let stamped = false;
      if (!testEmail && emailsSent > 0) {
        const { error: stampErr } = await client
          .from('predict_match_weeks')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', week.id);
        if (stampErr) console.error(`picks-reminder: stamp failed: ${stampErr.message}`);
        else stamped = true;
      }

      return respond(200, {
        ok: true,
        week: week.week_number,
        emailsSent,
        stamped,
        testMode: !!testEmail,
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
  }
}

exports.run = run;

/** Scheduled entry point — the every-30-minutes cron. */
exports.handler = async () => run();
