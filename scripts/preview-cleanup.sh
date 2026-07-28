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

echo "→ Deleting preview Worker: ${WORKER_NAME}"
if OUTPUT=$(${WRANGLER} delete --name "${WORKER_NAME}" 2>&1); then
  echo "$OUTPUT"
elif grep -Eqi 'not found|does not exist' <<< "$OUTPUT"; then
  echo "  Worker not found (already cleaned up)"
else
  echo "$OUTPUT" >&2
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
