#!/usr/bin/env bash
set -euo pipefail

# Delete an ephemeral preview D1 database and its per-PR Worker.
#
# Usage:
#   ./scripts/preview-cleanup.sh <identifier>
#
# Example:
#   ./scripts/preview-cleanup.sh pr-42
#   ./scripts/preview-cleanup.sh my-feature

IDENTIFIER="${1:?Usage: preview-cleanup.sh <identifier>}"
DB_NAME="wa-grants-preview-${IDENTIFIER}"
WORKER_NAME="wa-commongrants-api-${IDENTIFIER}"
WRANGLER="pnpm exec wrangler"

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] || [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "  ✗ CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required" >&2
  exit 1
fi

echo "→ Deleting preview Worker: ${WORKER_NAME}"
RESPONSE_FILE=$(mktemp)
trap 'rm -f "${RESPONSE_FILE}"' EXIT
HTTP_STATUS=$(
  curl -sS \
    -X DELETE \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -o "${RESPONSE_FILE}" \
    -w '%{http_code}' \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${WORKER_NAME}"
)
if [[ "${HTTP_STATUS}" =~ ^2 ]]; then
  echo "  ✓ Deleted preview Worker"
elif [ "${HTTP_STATUS}" = "404" ]; then
  echo "  Worker not found (already cleaned up)"
else
  cat "${RESPONSE_FILE}" >&2
  echo "  ✗ Failed to delete preview Worker" >&2
  exit 1
fi

echo "→ Deleting preview database: ${DB_NAME}"
if OUTPUT=$(${WRANGLER} d1 delete "${DB_NAME}" 2>&1); then
  echo "$OUTPUT"
elif grep -Eqi 'not found|does not exist' <<< "$OUTPUT"; then
  echo "  Database not found (already cleaned up)"
else
  echo "$OUTPUT" >&2
  echo "  ✗ Failed to delete preview database" >&2
  exit 1
fi

echo "  ✓ Cleanup complete"
