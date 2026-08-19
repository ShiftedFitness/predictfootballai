#!/usr/bin/env bash
#
# picks-ai-run.sh — trigger Picks AI on the deployed site.
#
# Exists because pasting a long curl command into a terminal is a reliable
# way to get "URL rejected: Malformed input to a URL function" — copying
# from rendered text can turn straight quotes into smart quotes or insert
# line breaks. A script file has none of those problems.
#
#   bash scripts/picks-ai-run.sh              # DRY RUN — writes nothing
#   bash scripts/picks-ai-run.sh live         # actually writes the picks
#   bash scripts/picks-ai-run.sh live 3       # ...for a specific week
#
# The admin secret is read from $ADMIN_SECRET if set, otherwise you are
# prompted (input hidden, never written to shell history).
#
# Override the site with:  SITE_URL=https://staging.example.com bash ...

set -uo pipefail

SITE="${SITE_URL:-https://telestats.net}"
MODE="${1:-dry}"
WEEK="${2:-}"

if [ "$MODE" != "dry" ] && [ "$MODE" != "live" ]; then
  echo "Usage: bash scripts/picks-ai-run.sh [dry|live] [week]" >&2
  exit 1
fi

SECRET="${ADMIN_SECRET:-}"
if [ -z "$SECRET" ]; then
  printf 'ADMIN_SECRET (input hidden): ' >&2
  read -rs SECRET
  printf '\n' >&2
fi
if [ -z "$SECRET" ]; then
  echo "No admin secret given — aborting." >&2
  exit 1
fi

# Build the JSON body with printf so no quoting can be mangled.
if [ "$MODE" = "dry" ]; then
  DRY=true
else
  DRY=false
fi

if [ -n "$WEEK" ]; then
  BODY=$(printf '{"week":%s,"force":true,"dryRun":%s}' "$WEEK" "$DRY")
else
  BODY=$(printf '{"force":true,"dryRun":%s}' "$DRY")
fi

echo "→ ${SITE}/.netlify/functions/picks-ai"
echo "→ ${BODY}"
if [ "$MODE" = "dry" ]; then
  echo "→ DRY RUN: researches and reports, writes nothing"
else
  echo "→ LIVE: picks will be saved"
fi
echo

RESPONSE=$(curl -sS -X POST \
  "${SITE}/.netlify/functions/picks-ai" \
  -H "x-admin-secret: ${SECRET}" \
  -H "Content-Type: application/json" \
  --max-time 300 \
  -d "${BODY}")
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo "curl failed (exit ${STATUS})." >&2
  exit $STATUS
fi

# Pretty-print if python is around, otherwise raw.
FORMATTER="$(dirname "$0")/_format_picks_ai.py"
if command -v python3 >/dev/null 2>&1 && [ -f "$FORMATTER" ]; then
  printf '%s' "$RESPONSE" | python3 "$FORMATTER"
else
  printf '%s\n' "$RESPONSE"
fi
