#!/bin/bash
# =============================================================================
# benchmark-compare.sh — Performance Benchmark Comparison
# =============================================================================
# Compares API performance before and after optimizations.
#
# Usage:
#   ./scripts/benchmark-compare.sh                    # Run and compare
#   ./scripts/benchmark-compare.sh --save baseline    # Save as baseline
#   ./scripts/benchmark-compare.sh --compare baseline # Compare with baseline
#
# Requirements:
#   - curl, jq
#   - API running on BASE_URL
# =============================================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────

BASE_URL="${BASE_URL:-http://localhost:3001}"
RESULTS_DIR="./docs/benchmarks"
ITERATIONS=20

# ── Colors ─────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Functions ──────────────────────────────────────────────────────────────

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_header() { echo -e "\n${CYAN}══════════════════════════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}\n"; }

# Measure single request
measure() {
  local url="$1"
  local start=$(date +%s%N)
  local status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  local end=$(date +%s%N)
  local ms=$(( (end - start) / 1000000 ))
  echo "$status:$ms"
}

# Benchmark endpoint
benchmark() {
  local url="$1"
  local label="$2"
  local total=0
  local min=999999
  local max=0
  local success=0
  
  for i in $(seq 1 $ITERATIONS); do
    local result=$(measure "$url")
    local status=$(echo "$result" | cut -d: -f1)
    local ms=$(echo "$result" | cut -d: -f2)
    
    total=$((total + ms))
    [ "$ms" -lt "$min" ] && min=$ms
    [ "$ms" -gt "$max" ] && max=$ms
    [ "$status" -ge 200 ] && [ "$status" -lt 400 ] && success=$((success + 1))
  done
  
  local avg=$((total / ITERATIONS))
  local success_rate=$((success * 100 / ITERATIONS))
  
  echo "{\"label\":\"$label\",\"avg_ms\":$avg,\"min_ms\":$min,\"max_ms\":$max,\"success_rate\":$success_rate}"
}

# Print results table
print_results() {
  local data="$1"
  
  echo ""
  echo "┌─────────────────────┬──────────┬──────────┬──────────┬──────────┐"
  echo "│ Endpoint            │ Avg (ms) │ Min (ms) │ Max (ms) │ Success  │"
  echo "├─────────────────────┼──────────┼──────────┼──────────┼──────────┤"
  
  echo "$data" | jq -r '.[] | "│ \(.label | .[0:19] | . + " " * (19 - length)) │ \(.avg_ms | tostring | .[0:8] | . + " " * (8 - length)) │ \(.min_ms | tostring | .[0:8] | . + " " * (8 - length)) │ \(.max_ms | tostring | .[0:8] | . + " " * (8 - length)) │ \(.success_rate | tostring | .[0:7])% │"'
  
  echo "└─────────────────────┴──────────┴──────────┴──────────┴──────────┘"
}

# Compare two results
compare() {
  local baseline="$1"
  local current="$2"
  
  log_header "Performance Comparison"
  
  echo "┌─────────────────────┬──────────┬──────────┬──────────┬──────────┐"
  echo "│ Endpoint            │ Baseline │ Current  │ Delta    │ Status   │"
  echo "├─────────────────────┼──────────┼──────────┼──────────┼──────────┤"
  
  for i in $(seq 0 $(($(echo "$baseline" | jq length) - 1))); do
    local label=$(echo "$baseline" | jq -r ".[$i].label")
    local base_avg=$(echo "$baseline" | jq -r ".[$i].avg_ms")
    local curr_avg=$(echo "$current" | jq -r ".[$i].avg_ms")
    local delta=$((curr_avg - base_avg))
    local pct=$((delta * 100 / (base_avg > 0 ? base_avg : 1)))
    
    local status="✅ OK"
    [ "$delta" -gt 100 ] && status="⚠️ SLOW"
    [ "$delta" -gt 500 ] && status="🔴 REGRESSED"
    [ "$delta" -lt -50 ] && status="🚀 FASTER"
    
    echo "│ $(printf '%-19s' "$label") │ $(printf '%7s' "${base_avg}ms") │ $(printf '%7s' "${curr_avg}ms") │ $(printf '%+7s' "${delta}ms") │ $status │"
  done
  
  echo "└─────────────────────┴──────────┴──────────┴──────────┴──────────┘"
}

# ── Main ───────────────────────────────────────────────────────────────────

run_benchmark() {
  log_header "API Performance Benchmark"
  
  log_info "Target: $BASE_URL"
  log_info "Iterations: $ITERATIONS per endpoint"
  echo ""
  
  # Define endpoints
  local endpoints=(
    "$BASE_URL/api/health|health"
    "$BASE_URL/api/health/detailed|health-detailed"
    "$BASE_URL/api/providers|providers-list"
    "$BASE_URL/api/categories|categories-list"
    "$BASE_URL/api/metrics/prometheus|metrics"
  )
  
  local results="[]"
  
  for entry in "${endpoints[@]}"; do
    local url=$(echo "$entry" | cut -d'|' -f1)
    local label=$(echo "$entry" | cut -d'|' -f2)
    
    log_info "Benchmarking: $label"
    local result=$(benchmark "$url" "$label")
    results=$(echo "$results" | jq ". + [$result]")
  done
  
  print_results "$results"
  echo "$results"
}

# ── Parse arguments ────────────────────────────────────────────────────────

mkdir -p "$RESULTS_DIR"

case "${1:-}" in
  --save)
    local name="${2:-$(date +%Y%m%d_%H%M%S)}"
    local results=$(run_benchmark)
    echo "$results" | jq '.' > "${RESULTS_DIR}/benchmark-${name}.json"
    log_success "Baseline saved: ${RESULTS_DIR}/benchmark-${name}.json"
    ;;
  --compare)
    local baseline_file="${RESULTS_DIR}/benchmark-${2}.json"
    if [ ! -f "$baseline_file" ]; then
      log_error "Baseline not found: $baseline_file"
      exit 1
    fi
    
    local baseline=$(cat "$baseline_file")
    local current=$(run_benchmark)
    compare "$baseline" "$current"
    ;;
  *)
    run_benchmark | jq '.'
    ;;
esac
