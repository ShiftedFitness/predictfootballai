/**
 * email-report.mjs
 *
 * Emails the weekly scorecard.
 *
 * Sends over plain SMTP using an account we already have rather than adding
 * an email vendor — one npm dependency and a Gmail app password, no new
 * service to sign up for or pay for.
 *
 * The Markdown is rendered to simple HTML because the report is mostly
 * tables, and a table read as raw pipes in an inbox will not get read at
 * all. The Markdown goes in the plain-text part, so nothing is lost.
 *
 * Env:
 *   SMTP_HOST         e.g. smtp.gmail.com
 *   SMTP_PORT         465 (implicit TLS) or 587 (STARTTLS)
 *   SMTP_USER         the sending account
 *   SMTP_PASS         an app password, NOT the account password
 *   REPORT_EMAIL_TO   comma-separated recipients
 *   REPORT_EMAIL_FROM optional; defaults to SMTP_USER
 *   NODEMAILER_BASE   optional; directory nodemailer was installed into
 *                     when that is outside this project (CI does this)
 *
 * With any of the required vars missing this is a no-op that says so — a
 * missing email must never fail the job that produced the report.
 */

const REQUIRED = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'REPORT_EMAIL_TO'];

export const emailEnabled = () => REQUIRED.every((k) => Boolean(process.env[k]));

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Enough Markdown for what this report actually emits: headings, tables,
 * blockquotes, bold, italics, rules and paragraphs. Not a general renderer,
 * and deliberately not a dependency.
 */
export function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let inTable = false;

  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/(^|\s)_(.+?)_(?=\s|$|\.)/g, '$1<em>$2</em>');

  const closeTable = () => {
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Table separator rows carry no content.
    if (/^\|\s*-{2,}/.test(line.replace(/\s/g, '').replace(/\|/g, '|'))) continue;
    if (/^\|(\s*:?-+:?\s*\|)+$/.test(line.replace(/\s+/g, ''))) continue;

    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      const isHeader = !inTable;
      if (isHeader) {
        out.push('<table cellspacing="0" cellpadding="6"><thead><tr>');
        out.push(cells.map((c) => `<th align="left">${inline(c)}</th>`).join(''));
        out.push('</tr></thead><tbody>');
        inTable = true;
      } else {
        out.push('<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
      }
      continue;
    }
    closeTable();

    if (!line.trim()) continue;
    if (line.startsWith('### ')) out.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (line.startsWith('## ')) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith('# ')) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.startsWith('> ')) out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    else if (line.startsWith('---')) out.push('<hr>');
    else out.push(`<p>${inline(line)}</p>`);
  }
  closeTable();

  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#1a2230;max-width:820px;margin:0 auto;padding:16px">
<style>
  table{border-collapse:collapse;width:100%;margin:0 0 18px;font-size:13px}
  th{background:#f1f4f9;border-bottom:2px solid #d7dee9;font-weight:700}
  td,th{border-bottom:1px solid #e6eaf1;padding:6px 8px;text-align:left}
  h1{font-size:22px;margin:0 0 6px} h2{font-size:17px;margin:26px 0 8px;padding-top:14px;border-top:1px solid #e6eaf1}
  h3{font-size:14px;margin:18px 0 6px}
  blockquote{margin:0 0 16px;padding:10px 14px;background:#fff8e6;border-left:3px solid #e0b64a;color:#5c4813}
  code{background:#f1f4f9;padding:1px 4px;border-radius:3px;font-size:12px}
  hr{border:0;border-top:1px solid #e6eaf1;margin:24px 0}
</style>
${out.join('\n')}
</body></html>`;
}

/** Send it. Returns { ok, reason } and never throws. */
export async function emailReport({ subject, markdown }) {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) return { ok: false, reason: `not configured (missing ${missing.join(', ')})` };

  // NODEMAILER_BASE lets CI install it outside the repo. Resolve through
  // createRequire rather than guessing an entry-point path: it uses Node's
  // real package resolution, so it keeps working if nodemailer moves its
  // main file. An ESM dynamic import would need that exact path, and
  // NODE_PATH does not apply to ESM at all.
  let nodemailer;
  try {
    if (process.env.NODEMAILER_BASE) {
      const { createRequire } = await import('node:module');
      const req = createRequire(`${process.env.NODEMAILER_BASE.replace(/\/?$/, '/')}index.js`);
      nodemailer = req('nodemailer');
    } else {
      ({ default: nodemailer } = await import('nodemailer'));
    }
  } catch (err) {
    return { ok: false, reason: `nodemailer unavailable: ${err?.message ?? err}` };
  }

  const port = Number(process.env.SMTP_PORT || 465);
  const to = process.env.REPORT_EMAIL_TO.split(',').map((s) => s.trim()).filter(Boolean);

  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({
      from: process.env.REPORT_EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: markdown,
      html: markdownToHtml(markdown),
    });
    return { ok: true, recipients: to.length };
  } catch (err) {
    return { ok: false, reason: err?.message ?? String(err) };
  }
}
