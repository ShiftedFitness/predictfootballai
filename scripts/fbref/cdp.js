/**
 * cdp.js — minimal Chrome DevTools Protocol client. No dependencies.
 *
 * Attaches to an ALREADY-RUNNING real Chrome via --remote-debugging-port.
 * It deliberately does not launch its own browser: a Chrome that a script
 * starts (and every headless build) sits on Cloudflare's "Performing security
 * verification" page indefinitely, while a normal Chrome with a persistent
 * profile clears it in about fifteen seconds and then stays cleared.
 *
 * Node 22+ ships a global WebSocket, so this needs nothing from npm.
 *
 * Launch Chrome first:
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-fbref" &
 */

const PORT = Number(process.env.CDP_PORT || 9222);

// ─── DevTools HTTP endpoints ────────────────────────────────────────────────

async function devtools(path, method = 'GET') {
  const res = await fetch(`http://localhost:${PORT}${path}`, { method });
  if (!res.ok) throw new Error(`CDP ${method} ${path}: ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function browserInfo() {
  try {
    return await devtools('/json/version');
  } catch (e) {
    throw new Error(
      `Cannot reach Chrome on port ${PORT}. Start it with:\n` +
      `  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ` +
      `--remote-debugging-port=${PORT} --user-data-dir="$HOME/.chrome-fbref" &`
    );
  }
}

// ─── One tab ────────────────────────────────────────────────────────────────

class Tab {
  constructor(ws, targetId) {
    this.ws = ws;
    this.targetId = targetId;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
      }
    });
  }

  /** Open a new tab in the running browser and connect to it. */
  static async open() {
    // Chrome 111+ requires PUT here; GET returns 405.
    const target = await devtools('/json/new?about:blank', 'PUT');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP websocket failed')), { once: true });
    });
    const tab = new Tab(ws, target.id);
    await tab.send('Page.enable');
    await tab.send('Runtime.enable');
    return tab;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 60_000);
    });
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  /** Evaluate an expression in the page and return its value. */
  async eval(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text || 'evaluate failed');
    return result.value;
  }

  async close() {
    try { await devtools(`/json/close/${this.targetId}`); } catch { /* already gone */ }
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

// ─── Navigation, with the Cloudflare interstitial handled ───────────────────

const CHALLENGE = /just a moment|checking your browser|performing security verification/i;

/**
 * Navigate and return the settled page HTML.
 *
 * A fresh profile meets Cloudflare's managed challenge on the first FBref
 * page and clears it in roughly fifteen seconds; after that the clearance
 * cookie lives in the profile and later pages load normally. So this waits
 * on the *challenge* rather than on a fixed delay — the first call is slow,
 * every subsequent one returns as soon as the load event fires.
 */
async function navigate(tab, url, { timeoutMs = 90_000 } = {}) {
  await tab.send('Page.navigate', { url });

  // Polling beats waiting on Page.loadEventFired here. The challenge page
  // fires its own load event, and so does the real page that replaces it, so
  // a single load event proves nothing. What we actually want is: the URL is
  // the one we asked for, the document has finished, and the title is no
  // longer Cloudflare's.
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await tab.eval(
      '({ href: location.href, ready: document.readyState, title: document.title, ' +
      'len: document.documentElement.outerHTML.length })'
    ).catch(() => null);

    if (state && state.ready === 'complete' && !CHALLENGE.test(state.title || '')) {
      // A settled FBref page is tens of kilobytes. Anything tiny is a stub
      // that has not been replaced yet.
      if (state.len > 20_000 && state.title) {
        return {
          title: state.title,
          url: state.href,
          html: await tab.eval('document.documentElement.outerHTML'),
        };
      }
    }

    if (Date.now() > deadline) {
      throw new Error(
        `${url} never settled (last: ${JSON.stringify(state)}).\n` +
        `    If this is the Cloudflare challenge, open the URL in the Chrome ` +
        `window on port ${PORT} and clear it by hand once.`
      );
    }
    await sleep(1_500);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { Tab, navigate, browserInfo, devtools, sleep, PORT };
