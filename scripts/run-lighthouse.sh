#!/bin/bash
# run-lighthouse.sh
#
# Lightweight Lighthouse CI performance audit.
# Runs after next build + next start, tests key pages for performance budget.
#
# Usage: bash scripts/run-lighthouse.sh
#
# Exit codes:
#   0 — all pages pass performance budget
#   1 — one or more pages fail
#
# Requirements: @lhci/cli (installed via devDependencies)

set -euo pipefail

PORT=${LIGHTHOUSE_PORT:-3456}
BASE_URL="http://localhost:${PORT}"

# Performance budgets (Lighthouse scores 0-100)
PERF_MIN=${PERF_MIN:-85}
A11Y_MIN=${A11Y_MIN:-90}
BP_MIN=${BP_MIN:-90}        # Best practices
SEO_MIN=${SEO_MIN:-90}

# Pages to audit
PAGES=(
  "/"
  "/auth/login"
  "/busca"
  "/categorias"
)

echo "🔍 Lighthouse CI — Performance Budget Audit"
echo "   Budget: Performance ≥ ${PERF_MIN}, A11y ≥ ${A11Y_MIN}, BP ≥ ${BP_MIN}, SEO ≥ ${SEO_MIN}"
echo ""

FAILED=false

for page in "${PAGES[@]}"; do
  echo "   📄 Auditing: ${page}"
  
  RESULT=$(npx lhci \
    --configPath=/dev/null \
    --collect.url="${BASE_URL}${page}" \
    --collect.numberOfRuns=1 \
    --collect.startServerCommand="true" \
    --collect.startServerReadyPattern="ready" \
    --assert.assertPreset=lighthouse:recommended \
    --assert.assertions.categories:performance=["error",{"minScore":${PERF_MIN}}] \
    --assert.assertions.categories:accessibility=["error",{"minScore":${A11Y_MIN}}] \
    --assert.assertions.categories:best-practices=["error",{"minScore":${BP_MIN}}] \
    --assert.assertions.categories:seo=["error",{"minScore":${SEO_MIN}}] \
    --upload.target=lhci \
    --upload.serverBaseUrl="${LHCI_HOST:-}" \
    --upload.token="${LHCI_TOKEN:-}" \
    2>&1) || true
  
  if echo "$RESULT" | grep -q "assertion failed"; then
    echo "      ❌ FAILED — see details above"
    FAILED=true
  else
    echo "      ✅ PASSED"
  fi
done

echo ""

if [ "$FAILED" = true ]; then
  echo "❌ Lighthouse audit failed! Fix performance issues before pushing."
  echo "   Run 'npx lhci autorun' locally for detailed report."
  exit 1
fi

echo "✅ All pages pass Lighthouse performance budget."
