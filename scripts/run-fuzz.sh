#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run-fuzz.sh
#
# Runs all fuzz tests with seed=42 (hardcoded in each test suite) and
# prints a formatted summary table.
#
# Uses scripts/format-fuzz-results.mjs for output formatting, avoiding
# fragile /dev/stdin pipes that break on Windows Git Bash.
#
# Usage:
#   bash scripts/run-fuzz.sh                 # run all + table output
#   bash scripts/run-fuzz.sh --json          # JSON output for CI
#   bash scripts/run-fuzz.sh --only radius   # filter by filename pattern
#   bash scripts/run-fuzz.sh --verbose       # show raw vitest output
#
# Exit codes:
#   0 — all fuzz tests passed
#   1 — one or more fuzz tests failed
#   2 — unexpected error
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

MODE="table"
VERBOSE=false
ONLY=""

for arg in "$@"; do
  case "$arg" in
    --verbose)    VERBOSE=true ;;
    --json)       MODE="json" ;;
    --only=*)     ONLY="${arg#*=}" ;;
    --only)       # space-separated handled below
                  ;;
  esac
done

# Auto-discover fuzz test files via glob pattern.
# Matches: *-fuzz*.test.ts or *-fuzz*.test.tsx
# Excludes helpers like fuzz-utils.ts (no .test. in name).
FUZZ_FILES=()
while IFS= read -r -d '' f; do
  FUZZ_FILES+=("$f")
done < <(find src/ -type f \
  \( -name '*-fuzz*.test.ts' -o -name '*-fuzz*.test.tsx' \) \
  -print0 2>/dev/null | sort -z)

# Filter by --only pattern
if [ -n "$ONLY" ]; then
  FILTERED=()
  for f in "${FUZZ_FILES[@]}"; do
    if [[ "$f" == *"$ONLY"* ]]; then
      FILTERED+=("$f")
    fi
  done
  FUZZ_FILES=("${FILTERED[@]}")
fi

if [ ${#FUZZ_FILES[@]} -eq 0 ]; then
  echo "❌ No fuzz files matched pattern '${ONLY:-*}'."
  exit 2
fi

# Check prerequisites
for cmd in npx node; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "❌ $cmd not found. Is Node.js installed?"
    exit 2
  fi
done

# ---------------------------------------------------------------------------
# --verbose mode: just run vitest directly, skip formatting
# ---------------------------------------------------------------------------

if $VERBOSE; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════════════╗"
  echo "║                   Severinno — Fuzz Test Runner                     ║"
  echo "╚══════════════════════════════════════════════════════════════════════╝"
  echo ""
  echo "  Seed:   42 (default)"
  echo ""
  npx vitest run "${FUZZ_FILES[@]}" --reporter=verbose
  exit $?
fi

# ---------------------------------------------------------------------------
# Normal mode: header
# ---------------------------------------------------------------------------

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║                   Severinno — Fuzz Test Runner                     ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""

if [ -n "$ONLY" ]; then
  echo "  Filter: --only=$ONLY"
fi
echo "  Seed:   42 (default)"
echo ""

# ---------------------------------------------------------------------------
# Run each fuzz file, capture vitest JSON output to temp files
# ---------------------------------------------------------------------------

TEMP_DIR=$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/fuzz-$$")
mkdir -p "$TEMP_DIR"
JSON_FILES=()

for file in "${FUZZ_FILES[@]}"; do
  label=$(basename "$file" | sed 's/\.[^.]*$//')
  json_out="$TEMP_DIR/$label.json"

  # Extract FUZZ_ITERATIONS from source file (POSIX-compatible sed, no -P flag)
  iters=$(sed -n 's/.*FUZZ_ITERATIONS[[:space:]]*=[[:space:]]*\([0-9]*\).*/\1/p' "$file" 2>/dev/null | head -1 || echo "")
  if [ -z "$iters" ]; then
    iters=0
  fi

  # Capture stdout only (vitest outputs progress on stderr)
  npx vitest run "$file" --reporter=json > "$json_out" 2>/dev/null || true

  # Write iteration count alongside the JSON so the formatter can read it
  echo "$iters" > "$TEMP_DIR/$label.iters"

  JSON_FILES+=("$json_out")
done

# ---------------------------------------------------------------------------
# Format output via the Node.js helper
# ---------------------------------------------------------------------------

FORMATTER="$SCRIPT_DIR/format-fuzz-results.mjs"

if [ "$MODE" = "json" ]; then
  node "$FORMATTER" --json "${JSON_FILES[@]}"
  EXIT_CODE=$?
else
  node "$FORMATTER" "${JSON_FILES[@]}"
  EXIT_CODE=$?
fi

# Cleanup
rm -rf "$TEMP_DIR" 2>/dev/null || true

exit $EXIT_CODE
