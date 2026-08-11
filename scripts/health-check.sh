#!/usr/bin/env bash
# =============================================================================
# health-check.sh - single source of truth for the deploy health checks.
#
# Used by EVERY workflow that waits for the app to come up after a deploy:
#   - .github/workflows/deploy.yml         (docker-test smoke test + ssh deploy)
#   - .github/workflows/release-deploy.yml (ssh deploy)
#
# Previously each workflow embedded its own loop (20/3 and 12/5 variants with
# subtle differences: the `|| echo "000"` fallback, em-dash vs hyphen in the
# retry message, `docker image prune -f` on success or not). This script
# consolidates them into ONE versioned program; the workflows just call it
# with different env values.
#
# Env parameters (all optional, with defaults):
#   HEALTH_URL          URL to probe                       (default http://localhost:3000/api/health)
#   HEALTH_ATTEMPTS     max attempts before failing        (default 12)
#   HEALTH_SLEEP        seconds between attempts           (default 5)
#   HEALTH_EXPECT_CODE  HTTP code that means "healthy"     (default 200)
#   HEALTH_DOCKER_PRUNE "1" = `docker image prune -f` on success (default 0).
#                         NON-FATAL: prune failure never flips a green deploy
#                         to red - the deploy verdict is the health check, not
#                         the disk cleanup (best-effort housekeeping).
#
# Exit codes:
#   0  health check passed (got HEALTH_EXPECT_CODE within HEALTH_ATTEMPTS)
#   1  failed after HEALTH_ATTEMPTS attempts
# =============================================================================
set -e

HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-12}"
HEALTH_SLEEP="${HEALTH_SLEEP:-5}"
HEALTH_EXPECT_CODE="${HEALTH_EXPECT_CODE:-200}"
HEALTH_DOCKER_PRUNE="${HEALTH_DOCKER_PRUNE:-0}"

for i in $(seq 1 "$HEALTH_ATTEMPTS"); do
  sleep "$HEALTH_SLEEP"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 --connect-timeout 10 "$HEALTH_URL" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "$HEALTH_EXPECT_CODE" ]; then
    echo "Health check passed (HTTP $HTTP_CODE) after attempt $i/$HEALTH_ATTEMPTS"
    if [ "$HEALTH_DOCKER_PRUNE" = "1" ]; then
      # Best-effort housekeeping: `docker image prune -f` failure must NOT
      # flip a green deploy to red under `set -e` - the `|| echo` keeps the
      # OR-list exit 0 (and surfaces the failure in the logs for follow-up).
      # ASCII-only on purpose: this runs via ssh on the VPS, where the remote
      # locale may not be UTF-8 - emoji/accents would render as mojibake.
      docker image prune -f || echo "WARNING: docker image prune -f failed (non-fatal - deploy stays green)"
    fi
    exit 0
  fi
  echo "Attempt $i/$HEALTH_ATTEMPTS - HTTP $HTTP_CODE, retrying..."
done

echo "Health check failed after $HEALTH_ATTEMPTS attempts"
exit 1
