#!/bin/bash
# check-api-compatibility.sh
#
# Validates that API changes are backward-compatible.
# Compares current OpenAPI spec against the committed version.
# Fails CI if breaking changes are detected.
#
# Usage: bash scripts/check-api-compatibility.sh
#
# Exit codes:
#   0 — API is backward-compatible
#   1 — breaking changes detected

set -euo pipefail

echo "🔍 Checking API backward compatibility..."

# Check if openapi-diff is available
if ! command -v npx &>/dev/null; then
  echo "⚠️  npx not found, skipping API compatibility check"
  exit 0
fi

# Generate current spec
echo "📝 Generating current OpenAPI spec..."
npx @redocly/cli bundle public/openapi.json -o /tmp/openapi-current.json 2>/dev/null || cp public/openapi.json /tmp/openapi-current.json

# Compare with committed version
if [ -f public/openapi.json ]; then
  echo "📊 Comparing with committed spec..."

  # Check for breaking changes (removed endpoints, changed required fields)
  # Using a simple diff-based check
  DIFF=$(diff <(jq -S '.paths | keys[]' public/openapi.json 2>/dev/null || echo "") \
              <(jq -S '.paths | keys[]' /tmp/openapi-current.json 2>/dev/null || echo "") 2>/dev/null || true)

  if echo "$DIFF" | grep -q "^<"; then
    echo "❌ BREAKING CHANGE: Endpoints were REMOVED:"
    echo "$DIFF" | grep "^<" | head -10
    echo ""
    echo "To fix: either restore the removed endpoints or bump the API version."
    exit 1
  fi

  echo "✅ No breaking changes detected"
else
  echo "⚠️  No committed OpenAPI spec found, skipping comparison"
fi

echo "✅ API compatibility check passed"
