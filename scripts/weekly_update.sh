#!/bin/bash
# ============================================================
# weekly_update.sh
# Weekly current-season stats refresh
#
# Usage:
#   ./scripts/weekly_update.sh [--dry-run] [--league <league>]
#
# This script:
#   1. Runs the FBref ingestion for all 6 leagues (or one specific league)
#   2. Rebuilds performance scores (optional, enable below)
#   3. Logs output to data/logs/
#
# Prerequisites:
#   - Node.js v18+
#   - npm packages: cheerio, node-fetch@2
#   - Environment variables: Supabase_Project_URL, Supabase_Service_Role
#
# Recommended: Run every Monday morning via cron or manually
#   crontab: 0 8 * * 1 cd /path/to/predictfootballai && ./scripts/weekly_update.sh >> data/logs/cron.log 2>&1
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/data/logs"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$LOG_DIR/ingest_${TIMESTAMP}.log"

# Create log directory
mkdir -p "$LOG_DIR"

echo "============================================" | tee -a "$LOG_FILE"
echo "Weekly Stats Update - $(date)" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"

# Check for required env vars
if [ -z "${Supabase_Project_URL:-}" ] || [ -z "${Supabase_Service_Role:-}" ]; then
  echo "ERROR: Supabase_Project_URL and Supabase_Service_Role must be set" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
  echo "Export them before running:" | tee -a "$LOG_FILE"
  echo "  export Supabase_Project_URL='https://cifnegfabbcywcxhtpfn.supabase.co'" | tee -a "$LOG_FILE"
  echo "  export Supabase_Service_Role='your-service-role-key'" | tee -a "$LOG_FILE"
  exit 1
fi

# Check for cheerio dependency
if ! node -e "require('cheerio')" 2>/dev/null; then
  echo "Installing cheerio..." | tee -a "$LOG_FILE"
  cd "$PROJECT_DIR" && npm install cheerio --save
fi

# Run ingestion
echo "" | tee -a "$LOG_FILE"
echo "Starting FBref ingestion..." | tee -a "$LOG_FILE"
cd "$PROJECT_DIR"
node scripts/ingest_current_season.js "$@" 2>&1 | tee -a "$LOG_FILE"

INGEST_EXIT=$?

if [ $INGEST_EXIT -eq 0 ]; then
  echo "" | tee -a "$LOG_FILE"
  echo "✓ Ingestion completed successfully" | tee -a "$LOG_FILE"

  # Optional: Rebuild performance scores
  # Uncomment the block below if you want to auto-rebuild after each update
  # echo "" | tee -a "$LOG_FILE"
  # echo "Rebuilding performance scores..." | tee -a "$LOG_FILE"
  # node -e "
  #   const fetch = require('node-fetch');
  #   const url = process.env.Supabase_Project_URL + '/rest/v1/rpc/compute_performance_scores';
  #   fetch(url, {
  #     method: 'POST',
  #     headers: {
  #       'apikey': process.env.Supabase_Service_Role,
  #       'Authorization': 'Bearer ' + process.env.Supabase_Service_Role,
  #       'Content-Type': 'application/json',
  #     },
  #     body: '{}'
  #   }).then(r => console.log('Performance scores rebuild:', r.status))
  #     .catch(e => console.error('Error:', e.message));
  # " 2>&1 | tee -a "$LOG_FILE"
else
  echo "" | tee -a "$LOG_FILE"
  echo "✗ Ingestion failed with exit code $INGEST_EXIT" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "Log saved to: $LOG_FILE" | tee -a "$LOG_FILE"
echo "============================================" | tee -a "$LOG_FILE"
