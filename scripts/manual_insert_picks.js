/**
 * One-off script to manually insert picks for a user.
 * Run with env vars:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/manual_insert_picks.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const USER_ID = 12;
const MATCH_IDS = [306, 307, 308, 309, 310];

const picks = [
  { match_id: 306, pick: 'DRAW' },
  { match_id: 307, pick: 'DRAW' },
  { match_id: 308, pick: 'AWAY' },
  { match_id: 309, pick: 'AWAY' },
  { match_id: 310, pick: 'AWAY' },
];

async function run() {
  // 1. Check for existing predictions for these matches
  const { data: existing, error: checkErr } = await supabase
    .from('predict_predictions')
    .select('id, match_id, pick')
    .eq('user_id', USER_ID)
    .in('match_id', MATCH_IDS);

  if (checkErr) {
    console.error('Error checking existing:', checkErr.message);
    process.exit(1);
  }

  if (existing && existing.length > 0) {
    console.log('User already has predictions for these matches:');
    console.table(existing);
    console.log('Aborting — delete these first if you want to re-insert.');
    process.exit(0);
  }

  // 2. Insert picks
  const rows = picks.map(p => ({
    user_id: USER_ID,
    match_id: p.match_id,
    pick: p.pick,
  }));

  const { data, error } = await supabase
    .from('predict_predictions')
    .insert(rows)
    .select();

  if (error) {
    console.error('Insert error:', error.message);
    process.exit(1);
  }

  console.log('Successfully inserted picks:');
  console.table(data);
}

run();
