// netlify/functions/notify-admin-digest.js
const { ADALO, listAll } = require('./_adalo.js');

export const config = { schedule: "0 */2 * * *" }; // every 2 hours

// Minimal internal poster to Make (uses your envs)
async function postToMake(route, payload){
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) throw new Error("MAKE_WEBHOOK_URL missing");
  const headers = { "Content-Type":"application/json" };
  if (process.env.MAKE_WEBHOOK_KEY) headers["x-make-apikey"] = process.env.MAKE_WEBHOOK_KEY;
  const res = await fetch(url, { method:"POST", headers, body: JSON.stringify({ route, ...payload }) });
  if (!res.ok){ const t = await res.text(); throw new Error(`Make webhook failed: ${res.status} ${t}`); }
}

export default async () => {
  try {
    // Pull everything we need using your helper
    const [matchesAll, predsAll, usersAll] = await Promise.all([
      listAll(ADALO.col.matches, 1000),
      listAll(ADALO.col.predictions, 20000),
      listAll(ADALO.col.users, 5000),
    ]);

    const now = Date.now();

    // Find the most recent OPEN week (earliest lockout still in the future, and not force-locked)
    const weeks = Array.from(new Set((matchesAll||[]).map(m => Number(m['Week'])))).sort((a,b)=>a-b);
    let targetWeek = null, lockTs = null, matches = [];
    for (let i = weeks.length - 1; i >= 0; i--){
      const w = weeks[i];
      const ms = (matchesAll||[]).filter(m => Number(m['Week']) === w);
      if (!ms.length) continue;
      const earliest = ms
        .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']).getTime() : null)
        .filter(Boolean).sort((a,b)=>a-b)[0];
      const forceLocked = ms.some(m => m['Locked'] === true);
      const open = !forceLocked && earliest && earliest > now;
      if (open){
        targetWeek = w; lockTs = earliest; matches = ms; break;
      }
    }
    if (!targetWeek) return ok({ msg: "no open week found" });

    // Compute per-user submission counts for that week
    const matchIds = new Set(matches.map(m => String(m.id)));
    const weekPreds = (predsAll||[]).filter(p => {
      const mid = String(Array.isArray(p['Match']) ? p['Match'][0] : p['Match']);
      return matchIds.has(mid);
    });

    const submittedCount = new Map(); // uid -> count of non-empty picks
    for (const p of weekPreds){
      const uid = String(Array.isArray(p['User']) ? p['User'][0] : p['User']);
      const pick = String(p['Pick'] || '').trim();
      if (!submittedCount.has(uid)) submittedCount.set(uid, 0);
      if (pick) submittedCount.set(uid, submittedCount.get(uid) + 1);
    }

    // Build pending list (<5/5), respecting optional "Allow Emails"
    const pending = (usersAll||[])
      .filter(u => {
        const email = u['Email'] || u['email']; if (!email) return false;
        const allow = (u['Allow Emails'] === undefined) ? true : !!u['Allow Emails'];
        if (!allow) return false;
        const c = submittedCount.get(String(u.id)) || 0;
        return c < 5;
      })
      .map(u => ({
        id: String(u.id),
        name: u['Username'] || u['Name'] || u['Full Name'] || `User ${u.id}`,
        email: u['Email'] || u['email'],
        count: submittedCount.get(String(u.id)) || 0,
        link: "" // we can fill later when/if you add SITE_BASE
      }))
      .sort((a,b)=> (a.name||'').localeCompare(b.name||''));

    const admins = (process.env.ADMIN_EMAILS || '')
      .split(',').map(s=>s.trim()).filter(Boolean);
    if (!admins.length) return err("ADMIN_EMAILS missing");

    // Send to Make (same webhook you’ll reuse for other routes)
    await postToMake("admin-digest", {
      week: targetWeek,
      lockout_iso: new Date(lockTs).toISOString(),
      admins,
      pending
    });

    return ok({ msg: "posted to Make", targetWeek, pending_count: pending.length });
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};

function ok(body){ return { statusCode: 200, body: JSON.stringify({ ok:true, ...body }) }; }
function err(msg){ return { statusCode: 500, body: JSON.stringify({ error: msg }) }; }
