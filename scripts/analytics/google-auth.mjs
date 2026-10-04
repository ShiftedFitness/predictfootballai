/**
 * google-auth.mjs
 *
 * Exchanges a Google service-account key for a short-lived access token.
 *
 * Hand-rolled rather than pulling in `googleapis`, which is a very large
 * dependency for what is a signed JWT and one POST. Both APIs we use — GA4
 * Data and Search Console — are plain REST.
 *
 * SECURITY: this module is the *only* thing that touches the private key.
 * The weekly job runs extraction as a separate deterministic step and writes
 * plain JSON to analytics/input/. Nothing downstream — including any Claude
 * session reading those files — is ever given the credentials.
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  the full key file, as a single-line string (CI), or
 *   GOOGLE_SERVICE_ACCOUNT_FILE  a path to the key file (local runs)
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function loadServiceAccount() {
  // Locally you can point at the key file instead of pasting it into an env var.
  // Keep that file OUTSIDE the repo (e.g. ~/.config/shiftedlabs/ga-service-account.json).
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  const raw = file ? readFileSync(file.replace(/^~(?=\/)/, homedir()), 'utf-8') : process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not set. Paste the whole service-account ' +
        'key file into that env var (GitHub secret, or .env locally).',
    );
  }
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }
  if (!key.client_email || !key.private_key) {
    throw new Error('Service account JSON is missing client_email or private_key.');
  }
  return key;
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Build and sign the assertion Google wants in exchange for a token.
 * Scopes are read-only by construction — this pipeline must never be able
 * to modify an analytics property.
 */
function signAssertion(key, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: scopes.join(' '),
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(key.private_key.replace(/\\n/g, '\n'), 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${header}.${claims}.${signature}`;
}

let cached = null;

/** Access token, cached for the life of the process. */
export async function getAccessToken(
  scopes = [
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/webmasters.readonly',
  ],
) {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const key = loadServiceAccount();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signAssertion(key, scopes),
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Google's errors here are genuinely useful; surface them rather than
    // a generic failure, because 90% of setup problems land on this line.
    throw new Error(
      `Google token exchange failed (${res.status}): ${body.error ?? ''} ${body.error_description ?? ''}`.trim(),
    );
  }

  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Authenticated POST returning parsed JSON, with a readable error on failure. */
export async function googlePost(url, payload, label) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? JSON.stringify(body).slice(0, 300);
    throw new Error(`${label} failed (${res.status}): ${msg}`);
  }
  return body;
}
