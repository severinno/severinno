#!/bin/bash
# =============================================================================
# benchmark-api.sh — API Performance Benchmark
# =============================================================================
# Measures API response times for key endpoints before/after optimization.
#
# Usage:
#   ./scripts/benchmark-api.sh                    # Run benchmark
#   ./scripts/benchmark-api.sh --save baseline    # Save as baseline
#   ./scripts/benchmark-api.sh --compare baseline # Compare with baseline
#
# Requirements:
#   - curl, jq
#   - API running on BASE_URL (default: http://localhost:3000)
# =============================================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────

BASE_URL="${BASE_URL:-http://localhost:3000}"
RESULTS_DIR="./docs/benchmarks"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="${RESULTS_DIR}/api-benchmark-${TIMESTAMP}.json"

# ── Colors ─────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Functions ──────────────────────────────────────────────────────────────

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Measure response time for a single request
measure_request() {
  local url="$1"
  local label="$2"
  
  local start_time=$(date +%s%N)
  local status_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  local end_time=$(date +%s%N)
  local duration_ms=$(( (end_time - start_time) / 1000000 ))
  
  echo "{\"label\":\"$label\",\"url\":\"$url\",\"status\":$status_code,\"duration_ms\":$duration_ms}"
}

# Run benchmark for an endpoint (10 requests, calculate average)
benchmark_endpoint() {
  local url="$1"
  local label="$2"
  local iterations="${3:-10}"
  
  log_info "Benchmarking: $label ($iterations requests)"
  
  local total_ms=0
  local min_ms=999999
  local max_ms=0
  local success_count=0
  
  for i in $(seq 1 $iterations); do
    local result=$(measure_request "$url" "$label")
    local status=$(echo "$result" | jq -r '.status')
    local duration=$(echo "$result" | jq -r '.duration_ms')
    
    total_ms=$((total_ms + duration))
    
    if [ "$duration" -lt "$min_ms" ]; then
      min_ms=$duration
    fi
    if [ "$duration" -gt "$max_ms" ]; then
      max_ms=$duration
    fi
    
    if [ "$status" -ge 200 ] && [ "$status" -lt 400 ]; then
      success_count=$((success_count + 1))
    fi
  done
  
  local avg_ms=$((total_ms / iterations))
  local success_rate=$((success_count * 100 / iterations))
  
  echo "{\"label\":\"$label\",\"avg_ms\":$avg_ms,\"min_ms\":$min_ms,\"max_ms\":$max_ms,\"iterations\":$iterations,\"success_rate\":$success_rate}"
}

# ── Main ───────────────────────────────────────────────────────────────────

main() {
  log_info "Starting API benchmark against $BASE_URL"
  log_info "Timestamp: $TIMESTAMP"
  echo ""
  
  # Create results directory
  mkdir -p "$RESULTS_DIR"
  
  # Define endpoints to benchmark
  declare -a ENDPOINTS=(
    "$BASE_URL/api/health"
    "$BASE_URL/api/health/detailed"
    "$BASE_URL/api/providers"
    "$BASE_URL/api/categories"
    "$BASE_URL/api/metrics/prometheus"
  )
  
  declare -a LABELS=(
    "health"
    "health-detailed"
    "providers-list"
    "categories-list"
    "metrics-prometheus"
  )
  
  # Run benchmarks
  echo "["
  local first=true
  
  for i in "${!ENDPOINTS[@]}"; do
    local endpoint="${ENDPOINTS[$i]}"
    local label="${LABELS[$i]}"
    
    if [ "$first" = true ]; then
      first=false
    else
      echo ","
    fi
    
    benchmark_endpoint "$endpoint" "$label" 10
  done
  
  echo "]"
  
  log_success "Benchmark complete!"
  log_info "Results saved to: $RESULTS_FILE"
}

# ── Parse arguments ────────────────────────────────────────────────────────

case "${1:-}" in
  --save)
    mkdir -p "$RESULTS_DIR"
    main | jq '.' > "${RESULTS_DIR}/api-benchmark-${2:-$TIMESTAMP}.json"
    log_success "Baseline saved to ${RESULTS_DIR}/api-benchmark-${2:-$TIMESTAMP}.json"
    ;;
  --compare)
    if [ -f "${RESULTS_DIR}/api-benchmark-${2}.json" ]; then
      log_info "Comparing with baseline: $2"
      log_info "Current results:"
      main | jq '.'
      echo ""
      log_info "Baseline ($2):"
      cat "${RESULTS_DIR}/api-benchmark-${2}.json" | jq '.'
    else
      log_error "Baseline not found: ${RESULTS_DIR}/api-benchmark-${2}.json"
      exit 1
    fi
    ;;
  *)
    main | jq '.'
    ;;
esac
