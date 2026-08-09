#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-docs-encoding.sh  --  informational non-blocking UTF-8 corruption audit
# for the docs surface (.md, .css, .html).
#
# WHY THIS EXISTS (read before you reach for check-utf8.sh --ext md):
#   `check-utf8.sh --ext md --ci` scans the DEFAULT SURFACE (src/ + fixed
#   dirs scripts/, .github/workflows/, .zscripts/), which holds ZERO .md
#   files  --  it is a silent no-op for docs corruption. The CORRECT surface
#   for docs is `git ls-files '*.md' '*.css' '*.html'`, exactly what the CI
#   `docs-encoding` job audits. This script mirrors THAT command.
#
#   This script is INFORMATIONAL (exit 0 always)  --  docs NEVER block a
#   commit or push. Corrupted docs are visual mojibake in GitHub, not a
#   silent operational failure. The --utf8 mode validates WELL-FORMEDNESS
#   only (legit Portuguese accents, em-dashes etc. pass)  --  see
#   docs/ascii-safe.md "Who protects the docs?" for the full rationale.
#
# Usage:
#   bash scripts/check-docs-encoding.sh          # scan git-tracked docs surface
#   bash scripts/check-docs-encoding.sh <file..> # scan specific files instead
#
# Exit codes: ALWAYS 0 (informational only).
#   Violations are reported to stderr with "[docs-encoding]" prefix.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN="$SCRIPT_DIR/scan-non-ascii.mjs"

if [ $# -gt 0 ]; then
  # Specific file list (hermetic test mode -- fixture files)
  FILES=("$@")
else
  # Tracked docs surface DERIVED from the encoding-surface manifest
  # (scripts/encoding-surface.mjs --print-docs, single source of truth --
  # same pattern as the fragile-range TARGET_DIRS derivation). The docs
  # globs are also listed in pr-check.yml's docs-encoding job and in
  # docs/ascii-safe.md, so the manifest keeps all three in sync.
  # Guard against running outside a git repo (hermetic test path):
  # with --set -e, `git ls-files` failing would abort the script, so we
  # suppress its stderr and convert a non-zero exit to an empty list.
  DOCS_PATTERNS="$(node "$SCRIPT_DIR/encoding-surface.mjs" --print-docs)" || DOCS_PATTERNS=""
  if [ -z "$DOCS_PATTERNS" ]; then
    # Informational gate: derivation failure SKIPS the layer (never blocks),
    # and FILES=() is EXPLICIT - an empty DOCS_PAT_ARR would make `git
    # ls-files "${DOCS_PAT_ARR[@]}"` expand to ZERO args and list ALL
    # tracked files (not skip), so the empty-list guard is required here.
    echo "[docs-encoding] encoding-surface derivation failed (DOCS_PATTERNS unavailable) -- skipping" >&2
    FILES=()
  else
    read -r -a DOCS_PAT_ARR <<< "$DOCS_PATTERNS"
    mapfile -t FILES < <(git ls-files "${DOCS_PAT_ARR[@]}" 2>/dev/null || true)
  fi
fi

if [ ${#FILES[@]} -eq 0 ]; then
  echo "[docs-encoding] no docs files to scan  --  skipping"
  exit 0
fi

# Run the UTF-8 well-formedness scanner in report mode.
# We do NOT use --ci here: this is INFORMATIONAL, not a gate.
# Violations are warnings only (printed to stderr), exit is always 0.
OUTPUT="$(node "$SCAN" --utf8 --report "${FILES[@]}" 2>&1)" || true

# Print the scan output (per-file verdicts)
echo "$OUTPUT"

# Check for INVALID-UTF8 verdicts (non-blocking  --  report to stderr only)
if echo "$OUTPUT" | grep -q '^INVALID-UTF8'; then
  echo "[docs-encoding] WARNING: invalid UTF-8 detected in docs surface (corruption  --  informational only, not blocking)" >&2
  echo "$OUTPUT" | grep '^INVALID-UTF8' | while IFS=$'\t' read -r verdict file pos; do
    echo "[docs-encoding]   $file:$pos" >&2
  done
fi

# Always exit 0  --  NEVER block a commit/push on docs corruption.
exit 0