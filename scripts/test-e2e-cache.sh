#!/usr/bin/env bash
# =============================================================================
# scripts/test-e2e-cache.sh - E2E Cache Validation Pipeline
#
# Complete pipeline that validates HTTP cache headers end-to-end:
#   1. Start PostgreSQL + Redis via docker-compose.test.yml
#   2. Wait for both containers to be healthy
#   3. Push Prisma schema (creates tables if they don't exist)
#   4. Start Next.js dev server on port 3000
#   5. Run Playwright cache tests (--grep cache)
#   6. Clean up (stop dev server + containers)
#
# Usage:
#   ./scripts/test-e2e-cache.sh               # Full pipeline
#   ./scripts/test-e2e-cache.sh --skip-docker  # Skip container start (use existing)
#   ./scripts/test-e2e-cache.sh --skip-cleanup # Keep containers running after
#   ./scripts/test-e2e-cache.sh --ui           # Playwright UI mode
#
# Environment:
#   DATABASE_URL   Test DB URL (default: postgresql://severinno:severinno_test@localhost:5433/severinno_test)
#   REDIS_URL      Test Redis URL (default: redis://localhost:6381)
#   BASE_URL       Dev server URL (default: http://localhost:3000)
# =============================================================================

set -euo pipefail

# -- Config ----------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"
DATABASE_URL="${DATABASE_URL:-postgresql://severinno:severinno_test@localhost:5433/severinno_test}"
REDIS_URL="${REDIS_URL:-redis://localhost:6381}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
PLAYWRIGHT_ARGS="--grep cache --project chromium --reporter list"

SKIP_DOCKER=false
SKIP_CLEANUP=false
UI_MODE=false

for arg in "$@"; do
  case "$arg" in
    --skip-docker)  SKIP_DOCKER=true ;;
    --skip-cleanup) SKIP_CLEANUP=true ;;
    --ui)           UI_MODE=true; PLAYWRIGHT_ARGS="--grep cache --project chromium --ui" ;;
  esac
done

DEV_PID=""

# -- Cleanup handler ------------------------------------------------------

cleanup() {
  local exit_code=$?

  echo ""
  echo "  -- Cleanup ----------------------------------------------------"

  # Stop dev server
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    echo "  Stopping dev server (PID $DEV_PID)..."
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi

  # Stop containers
  if [ "$SKIP_CLEANUP" = false ] && [ "$SKIP_DOCKER" = false ]; then
    echo "  Stopping test containers..."
    docker compose -f "$COMPOSE_FILE" down -v --timeout 10 2>/dev/null || true
  fi

  if [ "$exit_code" -eq 0 ]; then
    echo "  [OK] Pipeline complete."
  else
    echo "  [FAIL] Pipeline failed (exit code $exit_code)."
  fi
}
trap cleanup EXIT

# -- Colors ----------------------------------------------------------------

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}[OK]${NC} $1"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $1"; }
info() { echo -e "  ${YELLOW}[i]${NC} $1"; }

# =========================================================================
# STEP 1 - Start containers
# =========================================================================

echo ""
echo "  ================================================================="
echo "    SEVERINNO - E2E CACHE VALIDATION PIPELINE"
echo "  ================================================================="
echo ""

if [ "$SKIP_DOCKER" = false ]; then
  info "STEP 1: Starting PostgreSQL + Redis containers..."

  docker compose -f "$COMPOSE_FILE" up -d postgis redis

  # Wait for PostgreSQL to be healthy
  echo "  Waiting for PostgreSQL..."
  for i in $(seq 1 20); do
    if docker compose -f "$COMPOSE_FILE" ps postgis --format "{{.Status}}" 2>/dev/null \
      | grep -qi "healthy"; then
      pass "PostgreSQL healthy after ${i}s"
      break
    fi
    if [ "$i" -eq 20 ]; then
      fail "PostgreSQL did not become healthy"
      exit 1
    fi
    sleep 2
  done

  # Wait for Redis to be healthy
  echo "  Waiting for Redis..."
  for i in $(seq 1 15); do
    if docker compose -f "$COMPOSE_FILE" ps redis --format "{{.Status}}" 2>/dev/null \
      | grep -qi "healthy"; then
      pass "Redis healthy after ${i}s"
      break
    fi
    if [ "$i" -eq 15 ]; then
      fail "Redis did not become healthy"
      exit 1
    fi
    sleep 2
  done
else
  info "STEP 1: Skipping container start (--skip-docker)"
fi

# =========================================================================
# STEP 2 - Push Prisma schema
# =========================================================================

info "STEP 2: Syncing Prisma schema..."
cd "$SCRIPT_DIR"

# Ensure Prisma client is generated first (required for @prisma/client types)
DATABASE_URL="$DATABASE_URL" bunx prisma generate 2>&1 | tail -20
echo ""
DATABASE_URL="$DATABASE_URL" bunx prisma db push --accept-data-loss --skip-generate 2>&1 \
  | tail -10

if [ $? -eq 0 ]; then
  pass "Schema synced"
else
  fail "Schema sync failed"
  exit 1
fi

# =========================================================================
# STEP 3 - Start dev server
# =========================================================================

info "STEP 3: Starting Next.js dev server..."

# Kill any existing dev server on port 3000
fuser -k 3000/tcp 2>/dev/null || true
sleep 1

DATABASE_URL="$DATABASE_URL" \
REDIS_URL="$REDIS_URL" \
bunx next dev -p 3000 &>/tmp/nextdev-e2e-cache.log &
DEV_PID=$!

# Wait for server to respond
echo "  Waiting for dev server at $BASE_URL..."
for i in $(seq 1 60); do
  if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null \
    | grep -q "200"; then
    pass "Dev server ready after ${i}s (PID $DEV_PID)"
    break
  fi
  if [ "$i" -eq 60 ]; then
    fail "Dev server did not start in time"
    tail -20 /tmp/nextdev-e2e-cache.log 2>/dev/null || true
    exit 1
  fi
  sleep 2
done

# Quick smoke test: verify expected routes return 200
info "  Smoke test: checking API routes..."
for route in "/api/health" "/api/providers?page=1&limit=1" "/api/categories?limit=1" "/api/search?q=teste"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$route" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    pass "GET $route -> $status"
  else
    fail "GET $route -> $status (expected 200)"
    exit 1
  fi
done

# =========================================================================
# STEP 4 - Run Playwright cache tests
# =========================================================================

info "STEP 4: Running Playwright cache tests..."

cd "$SCRIPT_DIR"

# Verify Playwright browsers are installed
if ! bunx playwright install --check chromium 2>/dev/null; then
  info "Installing Playwright Chromium browser..."
  bunx playwright install chromium --with-deps 2>&1 | tail -5
fi

if [ "$UI_MODE" = true ]; then
  bunx playwright test e2e/providers-cache.spec.ts $PLAYWRIGHT_ARGS
  exit_code=$?
else
  echo ""
  bunx playwright test e2e/providers-cache.spec.ts $PLAYWRIGHT_ARGS
  exit_code=$?
fi

# =========================================================================
# Result
# =========================================================================

echo ""
if [ "$exit_code" -eq 0 ]; then
  pass "ALL CACHE TESTS PASSED"
else
  fail "Some cache tests failed (exit code $exit_code)"
fi

exit "$exit_code"
