#!/bin/bash
# =============================================================================
# verify-staging.sh — Staging Environment Verification
# =============================================================================
# Validates all staging services are healthy and responding.
#
# Usage:
#   ./scripts/verify-staging.sh
#
# Requirements:
#   - curl, jq
#   - Staging environment running
#
# Exit codes:
#   0 — success
#   1 — failure
# =============================================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────

BASE_URL="${BASE_URL:-http://localhost:3001}"

# ── Colors ─────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Functions ──────────────────────────────────────────────────────────────

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

check_endpoint() {
  local url="$1"
  local label="$2"
  local expected_status="${3:-200}"
  
  local status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  
  if [ "$status" = "$expected_status" ]; then
    log_success "$label (HTTP $status)"
    return 0
  else
    log_error "$label (HTTP $status, expected $expected_status)"
    return 1
  fi
}

check_service() {
  local name="$1"
  local status=$(curl -s "$BASE_URL/api/health" | jq -r ".checks.$name // \"unknown\"")
  
  case "$status" in
    "ok"|"healthy")
      log_success "$name: $status"
      return 0
      ;;
    "degraded")
      log_warning "$name: $status"
      return 0
      ;;
    "disabled")
      log_warning "$name: disabled (intentional)"
      return 0
      ;;
    *)
      log_error "$name: $status"
      return 1
      ;;
  esac
}

# ── Main ───────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║       Severinno Staging Environment Verification           ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  
  local passed=0
  local failed=0
  
  # ── 1. Health Endpoints ────────────────────────────────────────────────
  log_info "Checking health endpoints..."
  
  check_endpoint "$BASE_URL/api/health" "Health (lightweight)" && passed=$((passed + 1)) || failed=$((failed + 1))
  check_endpoint "$BASE_URL/api/health/detailed" "Health (detailed)" && passed=$((passed + 1)) || failed=$((failed + 1))
  check_endpoint "$BASE_URL/api/metrics/prometheus" "Metrics (Prometheus)" && passed=$((passed + 1)) || failed=$((failed + 1))
  
  echo ""
  
  # ── 2. Service Health ──────────────────────────────────────────────────
  log_info "Checking service health..."
  
  for service in app database redis pgbouncer rabbitmq realtime; do
    check_service "$service" && passed=$((passed + 1)) || failed=$((failed + 1))
  done
  
  echo ""
  
  # ── 3. API Endpoints ───────────────────────────────────────────────────
  log_info "Checking API endpoints..."
  
  check_endpoint "$BASE_URL/api/providers" "Providers API" && passed=$((passed + 1)) || failed=$((failed + 1))
  check_endpoint "$BASE_URL/api/categories" "Categories API" && passed=$((passed + 1)) || failed=$((failed + 1))
  check_endpoint "$BASE_URL/api/auth/login" "Auth Login (GET)" 405 && passed=$((passed + 1)) || failed=$((failed + 1))
  
  echo ""
  
  # ── 4. Metrics Validation ──────────────────────────────────────────────
  log_info "Validating metrics format..."
  
  local metrics=$(curl -s "$BASE_URL/api/metrics/prometheus" 2>/dev/null)
  
  if grep -q "http_request_duration_ms_bucket" <<< "$metrics"; then
    log_success "Request duration histogram present"
    passed=$((passed + 1))
  else
    log_warning "Request duration histogram missing"
    failed=$((failed + 1))
  fi
  
  if grep -q "http_active_connections" <<< "$metrics"; then
    log_success "Active connections gauge present"
    passed=$((passed + 1))
  else
    log_warning "Active connections gauge missing"
    failed=$((failed + 1))
  fi
  
  echo ""
  
  # ── Summary ────────────────────────────────────────────────────────────
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║                     Verification Summary                   ║"
  echo "╠══════════════════════════════════════════════════════════════╣"
  echo "║  Total checks:    $((passed + failed))                                       ║"
  echo "║  Passed:          $passed                                       ║"
  echo "║  Failed:          $failed                                       ║"
  echo "║  Status:          $([ $failed -eq 0 ] && echo "✅ ALL PASSED" || echo "❌ SOME FAILED")                              ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  
  [ $failed -eq 0 ] && exit 0 || exit 1
}

main
