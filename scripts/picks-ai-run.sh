#!/usr/bin/env bash
#
# picks-ai-run.sh — trigger Picks AI on the deployed site and show the result.
#
#   bash scripts/picks-ai-run.sh              # DRY RUN — writes no picks
#   bash scripts/picks-ai-run.sh live         # actually writes the picks
#   bash scripts/picks-ai-run.sh live 1       # ...for a specific week
#   bash scripts/picks-ai-run.sh status       # just show recent runs
#
# The admin secret comes from $ADMIN_SECRET if set, otherwise you are
# prompted (hidden input, never written to shell history).
#
# HOW THIS WORKS, AND WHY IT POLLS
# The actual run is a Netlify BACKGROUND function, because five web searches
# plus a model turn does not fit in the 30s ceiling for scheduled functions
# or the shorter one for synchronous ones. Background functions return 202
# with an empty body, so the result cannot come back on the same request —
# every run records itself in predict_ai_runs and this script polls for it.
#
# Override the site with:  SITE_URL=https://staging.example.com bash ...

set -uo pipefail

SITE="${SITE_URL:-https://telestats.net}"
MODE="${1:-dry}"
WEEK="${2:-}"
ENDPOINT="${SITE}/.netlify/functions/picks-ai-trigger"

case "$MODE" in
  dry|live|status) ;;
  *) echo "Usage: bash scripts/picks-ai-run.sh [dry|live|status] [week]" >&2; exit 1 ;;
esac

SECRET="${ADMIN_SECRET:-}"
if [ -z "$SECRET" ]; then
  printf 'ADMIN_SECRET (input hidden): ' >&2
  read -rs SECRET
  printf '\n' >&2
fi
[ -z "$SECRET" ] && { echo "No admin secret given — aborting." >&2; exit 1; }

FORMATTER="$(dirname "$0")/_format_picks_ai.py"
show() {
  if command -v python3 >/dev/null 2>&1 && [ -f "$FORMATTER" ]; then
    printf '%s' "$1" | python3 "$FORMATTER"
  else
    printf '%s\n' "$1"
  fi
}

fetch_runs() {
  local q=""
  [ -n "$WEEK" ] && q="?week=${WEEK}"
  curl -sS -X GET "${ENDPOINT}${q}" -H "x-admin-secret: ${SECRET}" --max-time 30
}

# ── status only ────────────────────────────────────────────────────────
if [ "$MODE" = "status" ]; then
  echo "→ recent runs from ${ENDPOINT}"
  echo
  show "$(fetch_runs)"
  exit 0
fi

# ── start a run ────────────────────────────────────────────────────────
if [ "$MODE" = "dry" ]; then DRY=true; else DRY=false; fi
if [ -n "$WEEK" ]; then
  BODY=$(printf '{"week":%s,"force":true,"dryRun":%s}' "$WEEK" "$DRY")
else
  BODY=$(printf '{"force":true,"dryRun":%s}' "$DRY")
fi

echo "→ ${ENDPOINT}"
echo "→ ${BODY}"
[ "$MODE" = "dry" ] && echo "→ DRY RUN: researches and reports, writes no picks" \
                    || echo "→ LIVE: picks will be saved"
echo

# How many runs exist now, so we can tell when a new one lands.
BEFORE=$(fetch_runs | python3 -c 'import json,sys
try: print(len((json.load(sys.stdin) or {}).get("runs") or []))
except Exception: print(0)' 2>/dev/null || echo 0)

START=$(curl -sS -X POST "$ENDPOINT" \
  -H "x-admin-secret: ${SECRET}" \
  -H "Content-Type: application/json" \
  --max-time 30 -d "${BODY}")

echo "$START" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get("message") or d.get("error") or json.dumps(d))
except Exception:
    print(sys.stdin.read())' 2>/dev/null || echo "$START"

echo
printf 'Waiting for the run to finish'

for i in $(seq 1 60); do        # up to 5 minutes
  sleep 5
  printf '.'
  NOW=$(fetch_runs | python3 -c 'import json,sys
try: print(len((json.load(sys.stdin) or {}).get("runs") or []))
except Exception: print(-1)' 2>/dev/null || echo -1)
  if [ "$NOW" != "-1" ] && [ "$NOW" -gt "$BEFORE" ] 2>/dev/null; then
    printf '\n\n'
    show "$(fetch_runs)"
    exit 0
  fi
done

printf '\n\nStill running after 5 minutes. Check the Netlify function log for\n'
printf 'picks-ai-background, or run:  bash scripts/picks-ai-run.sh status\n'
