#!/usr/bin/env node
/**
 * server.js — serve public/ and the Netlify functions locally.
 *
 * `netlify dev` is the real thing, but it wants a login and a linked site.
 * This is enough to click through a team page end to end: static files, plus
 * /.netlify/functions/<name> dispatched straight to the handler module, with
 * .env loaded the same way the build scripts load it.
 *
 *   node scripts/dev/server.js [port]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PUB = path.join(ROOT, 'public');
const FUNCS = path.join(ROOT, 'netlify', 'functions');
const PORT = Number(process.argv[2] || 8888);

for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 0) continue;
  if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const MIME = { html: 'text/html; charset=utf-8', js: 'application/javascript', css: 'text/css',
  json: 'application/json', xml: 'application/xml', txt: 'text/plain', png: 'image/png',
  jpg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon', webmanifest: 'application/manifest+json' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (u.pathname.startsWith('/.netlify/functions/')) {
    const name = u.pathname.replace('/.netlify/functions/', '').replace(/\/$/, '');
    const file = path.join(FUNCS, `${name}.js`);
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('No such function'); }

    let body = '';
    for await (const chunk of req) body += chunk;
    // Fresh each request so an edit shows up without a restart.
    for (const k of Object.keys(require.cache)) if (k.startsWith(FUNCS)) delete require.cache[k];

    try {
      const out = await require(file).handler({
        httpMethod: req.method,
        headers: req.headers,
        queryStringParameters: Object.fromEntries(u.searchParams),
        body: body || null,
      }, {});
      res.writeHead(out.statusCode || 200, out.headers || { 'Content-Type': 'application/json' });
      return res.end(out.body || '');
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  let p = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!p.startsWith(PUB)) { res.writeHead(403); return res.end('No'); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p) && fs.existsSync(`${p}.html`)) p = `${p}.html`;
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('Not found'); }

  // no-store, or the browser serves a cached ts-nav.js after you edit it and
  // you spend ten minutes debugging a change that already worked.
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(p).slice(1)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`  TeleStats dev server on http://localhost:${PORT}`));
