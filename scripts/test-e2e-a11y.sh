#!/usr/bin/env bash
# =============================================================================
# scripts/test-e2e-a11y.sh - Accessibility E2E Test Runner
#
# Runs axe-core accessibility audits on the main pages using Playwright.
# By default only runs on Chromium (a11y results are the same across browsers)
# and targets the @a11y tag (critical + serious checks).
#
# Usage:
#   ./scripts/test-e2e-a11y.sh                    # Quick audit (default)
#   ./scripts/test-e2e-a11y.sh --full              # Full audit (all pages)
#   ./scripts/test-e2e-a11y.sh --wcag              # WCAG compliance report
#   ./scripts/test-e2e-a11y.sh --ui                # In Playwright UI mode
#
# Environment:
#   BASE_URL    URL of the app to test (default: http://localhost:3000)
# =============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo " Accessibility Audit"
echo "   Target: ${BASE_URL}"
echo ""

case "${1:-}" in
  --full)
    echo "   Mode: FULL AUDIT (all pages, violations reported)"
    bunx playwright test e2e/a11y.spec.ts \
      --grep @full-audit \
      --project=chromium \
      --reporter=list
    ;;
  --wcag)
    echo "   Mode: WCAG COMPLIANCE REPORT"
    bunx playwright test e2e/a11y.spec.ts \
      --grep @wcag \
      --project=chromium \
      --reporter=list
    ;;
  --ui)
    echo "   Mode: PLAYWRIGHT UI"
    bunx playwright test e2e/a11y.spec.ts \
      --ui \
      --project=chromium
    ;;
  *)
    echo "   Mode: QUICK AUDIT (critical + serious violations only)"
    echo ""
    bunx playwright test e2e/a11y.spec.ts \
      --grep @a11y \
      --project=chromium \
      --reporter=list
    ;;
esac

echo ""
echo "[OK] Audit complete."
