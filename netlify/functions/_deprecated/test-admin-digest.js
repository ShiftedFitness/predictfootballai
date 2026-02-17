// netlify/functions/test-admin-digest.js
export default async () => {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) return new Response(JSON.stringify({ error: "MAKE_WEBHOOK_URL missing" }), { status: 500 });

  const headers = { "Content-Type": "application/json" };
  if (process.env.MAKE_WEBHOOK_KEY) headers["x-make-apikey"] = process.env.MAKE_WEBHOOK_KEY;

  const payload = {
    // matches what your Make modules expect
    week: 12,
    lockout_iso: new Date(Date.now() + 2*60*60*1000).toISOString(),
    admins: (process.env.ADMIN_EMAILS || "").split(",").map(s=>s.trim()).filter(Boolean),
    pending: [
      { id: "101", name: "Alice", email: "alice@example.com", count: 2, link: "" },
      { id: "102", name: "Bob",   email: "bob@example.com",   count: 4, link: "" }
    ]
  };

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const text = await res.text();
  const ok = res.ok;
  return new Response(JSON.stringify({ ok, text }), { status: ok ? 200 : 500 });
};
