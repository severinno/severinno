#!/bin/bash
# check-bundle-size.sh
#
# Checks Next.js build output against performance budgets.
# Run after `next build` to validate bundle sizes.
#
# Usage: bash scripts/check-bundle-size.sh
#
# Exit codes:
#   0 — all bundles within budget
#   1 — one or more bundles exceed budget

set -euo pipefail

BUILD_DIR=".next"
BUDGET_JS_KB=${BUDGET_JS_KB:-500}    # max KB for JS bundles
BUDGET_CSS_KB=${BUDGET_CSS_KB:-100}  # max KB for CSS bundles

if [ ! -d "$BUILD_DIR" ]; then
  echo "❌ Build directory not found. Run 'next build' first."
  exit 1
fi

echo "📦 Checking bundle sizes..."
echo "   Budget: JS ≤ ${BUDGET_JS_KB}KB, CSS ≤ ${BUDGET_CSS_KB}KB"

OVER_BUDGET=false

# Check JS bundles
for f in $(find "$BUILD_DIR/static/chunks" -name '*.js' -size +${BUDGET_JS_KB}k 2>/dev/null); do
  size=$(du -k "$f" | cut -f1)
  name=$(basename "$f")
  echo "   ⚠️  JS over budget: $name (${size}KB > ${BUDGET_JS_KB}KB)"
  OVER_BUDGET=true
done

# Check CSS bundles
for f in $(find "$BUILD_DIR/static/css" -name '*.css' -size +${BUDGET_CSS_KB}k 2>/dev/null); do
  size=$(du -k "$f" | cut -f1)
  name=$(basename "$f")
  echo "   ⚠️  CSS over budget: $name (${size}KB > ${BUDGET_CSS_KB}KB)"
  OVER_BUDGET=true
done

# Summary
TOTAL_JS=$(find "$BUILD_DIR/static/chunks" -name '*.js' -exec du -k {} + 2>/dev/null | tail -1 | cut -f1 || echo "0")
TOTAL_CSS=$(find "$BUILD_DIR/static/css" -name '*.css' -exec du -k {} + 2>/dev/null | tail -1 | cut -f1 || echo "0")

echo ""
echo "   📊 Total JS: ${TOTAL_JS}KB"
echo "   📊 Total CSS: ${TOTAL_CSS}KB"

if [ "$OVER_BUDGET" = true ]; then
  echo ""
  echo "❌ Bundle size budget exceeded!"
  echo "   Reduce bundle size or increase budgets in scripts/check-bundle-size.sh"
  exit 1
fi

echo ""
echo "✅ All bundles within budget."
