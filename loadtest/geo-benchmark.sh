#!/bin/bash
# geo-benchmark.sh — Run autocannon load test against health endpoint
# Usage: bash loadtest/geo-benchmark.sh [base_url]

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
DURATION=10
CONNECTIONS=10
RESULTS_DIR="loadtest/results"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_FILE="$RESULTS_DIR/geo-benchmark-$TIMESTAMP.json"

mkdir -p "$RESULTS_DIR"

echo "Running geo benchmark against $BASE_URL"
echo "  Connections: $CONNECTIONS"
echo "  Duration:    ${DURATION}s"
echo ""

npx autocannon -c "$CONNECTIONS" -d "$DURATION" -j -i loadtest/geo-loadtest.js "$BASE_URL" | tee "$RESULTS_FILE"

echo ""
echo "Results saved to $RESULTS_FILE"
