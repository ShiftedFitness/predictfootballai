#!/usr/bin/env bash
#
# email-preflight.sh — why didn't the email send?
#
# Checks, in one call, everything that can silently stop a results email:
# migration 012 applied, Gmail credentials present, site URL and admin secret
# available, how many players have an email address, and whether the given
# week is actually scored and sendable.
#
#   bash scripts/email-preflight.sh          # general checks
#   bash scripts/email-preflight.sh 1        # ...plus week 1 readiness
#
set -uo pipefail

SITE="${SITE_URL:-https://telestats.net}"
WEEK="${1:-}"

SECRET="${ADMIN_SECRET:-}"
if [ -z "$SECRET" ]; then
  printf 'ADMIN_SECRET (input hidden): ' >&2
  read -rs SECRET
  printf '\n' >&2
fi
[ -z "$SECRET" ] && { echo "No admin secret given." >&2; exit 1; }

Q=""
[ -n "$WEEK" ] && Q="?week=${WEEK}"

RESPONSE=$(curl -sS -X GET "${SITE}/.netlify/functions/week-results-trigger${Q}" \
  -H "x-admin-secret: ${SECRET}" --max-time 30)

FORMATTER="$(dirname "$0")/_format_preflight.py"
if command -v python3 >/dev/null 2>&1 && [ -f "$FORMATTER" ]; then
  printf '%s' "$RESPONSE" | python3 "$FORMATTER"
else
  printf '%s\n' "$RESPONSE"
fi
