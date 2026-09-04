#!/usr/bin/env node
/**
 * backup_tables.js — snapshot the stats tables to local NDJSON.
 *
 * Written because this machine has no pg_dump, no psql, no Supabase CLI and
 * no Homebrew, and because Supabase's own automatic backups only exist on
 * paid plans. This needs nothing installed beyond what package.json already
 * pulls in.
 *
 * Usage:
 *   node scripts/backup_tables.js                 # back up the default set
 *   node scripts/backup_tables.js players clubs   # back up named tables only
 *
 * Reads Supabase_Project_URL and Supabase_Service_Role from .env in the
 * repo root. Read-only — it never writes to the database.
 *
 * Output:
 *   data/backups/<timestamp>/<table>.ndjson   one JSON object per line
 *   data/backups/<timestamp>/manifest.json    row counts + provenance
 *
 * Restore is a plain read of the NDJSON back through an upsert, which is
 * why the format is line-delimited: a 250k-row file streams rather than
 * needing to be parsed whole.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.join(__dirname, '..');

// ─── .env (no dotenv dependency) ─────────────────────────────────────────────

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) {
    die('.env not found in the repo root. Create it and fill in the two Supabase values.');
  }
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v && !process.env[k]) process.env[k] = v;
  }
}

function die(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

// ─── Tables ──────────────────────────────────────────────────────────────────

// Everything the rebuild could touch. Missing tables are skipped, not fatal —
// several of the rollups are known to be empty or absent.
const DEFAULT_TABLES = [
  'players',
  'clubs',
  'competitions',
  'player_season_stats',
  'current_season_player_stats',
  'ingestion_meta',
  'player_club_totals',
  'player_competition_totals',
  'player_club_competition_totals',
  'player_club_total_competition',
  'player_totals',
  'player_performance_scores',
];

const PAGE = 1000;

async function dumpTable(client, table, outDir) {
  const out = path.join(outDir, `${table}.ndjson`);
  const stream = fs.createWriteStream(out, { flags: 'w' });

  let offset = 0;
  let rows = 0;

  for (;;) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .range(offset, offset + PAGE - 1);

    if (error) {
      stream.end();
      fs.unlinkSync(out);
      // A missing table is expected for some of the rollups.
      if (/does not exist|schema cache/i.test(error.message)) {
        return { table, rows: null, skipped: error.message };
      }
      throw new Error(`${table}: ${error.message}`);
    }

    if (!data || data.length === 0) break;

    for (const row of data) stream.write(JSON.stringify(row) + '\n');
    rows += data.length;
    offset += data.length;

    process.stdout.write(`\r    ${table} … ${rows.toLocaleString()} rows`);

    if (data.length < PAGE) break;
  }

  await new Promise((res) => stream.end(res));
  process.stdout.write(`\r    ${table.padEnd(34)} ${String(rows).padStart(9)} rows\n`);
  return { table, rows, bytes: fs.statSync(out).size };
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  loadEnv();

  const url = process.env.Supabase_Project_URL || process.env.SUPABASE_URL;
  const key = process.env.Supabase_Service_Role || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    die('Supabase_Project_URL and Supabase_Service_Role must both be set in .env.');
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url.trim())) {
    die(`Supabase_Project_URL looks wrong: "${url}"\n    Expected something like https://xxxxxxxx.supabase.co`);
  }

  const tables = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TABLES;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(ROOT, 'data', 'backups', stamp);
  fs.mkdirSync(outDir, { recursive: true });

  const client = createClient(url.trim().replace(/\/$/, ''), key.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`\n  Backing up ${tables.length} tables → data/backups/${stamp}/\n`);

  const results = [];
  for (const t of tables) {
    try {
      results.push(await dumpTable(client, t, outDir));
    } catch (e) {
      console.log('');
      die(`${e.message}\n    Nothing further was written. Fix and re-run.`);
    }
  }

  const present = results.filter((r) => r.rows !== null);
  const skipped = results.filter((r) => r.rows === null);
  const total = present.reduce((a, r) => a + r.rows, 0);
  const bytes = present.reduce((a, r) => a + (r.bytes || 0), 0);

  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(
      { taken_at: new Date().toISOString(), project_url: url, tables: results },
      null, 2
    ) + '\n'
  );

  console.log(`\n  ✓ ${total.toLocaleString()} rows across ${present.length} tables` +
              `  (${(bytes / 1048576).toFixed(1)} MB)`);
  if (skipped.length) {
    console.log(`    skipped (not present): ${skipped.map((s) => s.table).join(', ')}`);
  }
  console.log(`  ✓ data/backups/${stamp}/\n`);
})();
