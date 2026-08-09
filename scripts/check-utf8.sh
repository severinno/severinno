#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-utf8.sh - verify source files are valid UTF-8
#
# Scans, by default:
#   src/                all .ts/.tsx source files (valid UTF-8)
#   scripts/            all .sh scripts (valid UTF-8)
#   .github/workflows/  any .sh scripts there (valid UTF-8)
#
# .sh scripts are scp'd to the VPS and executed over ssh, where the remote
# locale may not be UTF-8 - emoji/accents/em-dashes would render as mojibake.
# VALID UTF-8 is this script's job (check_utf8.py, with safe byte-0x97
# Windows-1252 detection - valid 0x97 continuation bytes are never touched).
#
# PURE-ASCII is NOT this script's job anymore (2026-08): every .sh in the
# repo is pure ASCII, enforced by scripts/verify-ascii-proof.sh (strict,
# repo-wide, on every .sh + .husky hook + the frozen docs/ascii-safe.md
# baseline drift check). The old always-on VPS ASCII gate (health-check.sh +
# root *.sh) and the --ascii opt-in scan were REMOVED as redundant - the
# proof audits a strict superset of both. This script DELEGATES all .sh
# ASCII checking to the proof (unless it runs as layer 1 of
# verify-encoding.sh, see below).
#
# SINGLE ENTRY (2026-08): scripts/verify-encoding.sh is the consolidated
# encoding gate entry point (this script + verify-ascii-proof.sh) that CI
# (utf8-check.yml) and the local hooks call as ONE step. verify-encoding.sh
# runs this script as layer 1 with VERIFY_ENCODING_LAYER1=1 so the ASCII
# delegation below is SKIPPED (its layer 2 runs the proof); a standalone run
# of this script delegates to the proof itself. Both invocation styles
# enforce the full gate - never twice.
#
# Usage:
#   ./scripts/check-utf8.sh              # check src/ + scripts/ + workflows
#   ./scripts/check-utf8.sh --ci         # exit 1 on invalid files
#   ./scripts/check-utf8.sh --fix        # replace corrupt byte 0x97
#   ./scripts/check-utf8.sh --ascii      # accepted no-op (proof is always-on)
#
# NOTE (2026-08): a STANDALONE run now emits ALL delegated layers - the
# python UTF-8 scan, the proof output (~40 [ASCII-OK] lines + baseline
# verdict), and the fragile character-class RANGE scan (the 2026-08 bug
# class) - and enforces the full gate including the frozen baseline. This
# also applies to repair paths: `--fix` on a broken tree will surface any
# unrelated ASCII/baseline/fragile-range violation too (same gate, no
# exceptions - the whole point of the consolidation).
#
# Exit codes: see check_utf8.py; a non-zero delegated proof raises it.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/check_utf8.py"

if [ ! -f "$PYTHON_SCRIPT" ]; then
  echo "ERROR: $PYTHON_SCRIPT not found"
  exit 2
fi

# Default scan roots. A positional dir argument overrides src/ but scripts/
# and .github/workflows/ are ALWAYS scanned (they hold the .sh scripts).
# --ascii is intercepted and DROPPED: repo-wide .sh ASCII is always-on via
# the delegated proof, so the flag is accepted only for backward compat.
DEFAULT_DIRS=(src)
ARGS=()
for a in "$@"; do
  case "$a" in
    # --ascii: no-op since 2026-08 - pure-ASCII is always enforced by the
    # delegated proof (verify-ascii-proof.sh), never forwarded to python.
    --ascii) : ;;
    --*)     ARGS+=("$a") ;;
    *)       DEFAULT_DIRS=("$a") ;;
  esac
done

EXIT_CODE=0
python3 "$PYTHON_SCRIPT" "${DEFAULT_DIRS[@]}" "${ARGS[@]}" \
  scripts .github/workflows || EXIT_CODE=$?

# .sh ASCII delegation: ALL .sh checking lives in verify-ascii-proof.sh
# (strict repo-wide pure ASCII + frozen docs/ascii-safe.md baseline). When
# this script runs as LAYER 1 of verify-encoding.sh (VERIFY_ENCODING_LAYER1=1)
# the delegation is skipped - that caller runs the proof as its layer 2, so
# running it here again would audit twice. Standalone runs always delegate,
# so a direct `bash scripts/check-utf8.sh --ci src/` still enforces the
# complete gate. The fragile character-class RANGE scan (the 2026-08 bug
# class, scripts/fragile-range-patterns.mjs) delegates the same way - it is
# verify-encoding.sh's layer 3, so it too must not run twice under layer 1.
# `|| X=$?` under set -e is REQUIRED: a non-zero delegated exit must not
# abort before the verdict below.
DELEGATED_EXIT=0
if [ "${VERIFY_ENCODING_LAYER1:-}" != "1" ]; then
  bash "$SCRIPT_DIR/verify-ascii-proof.sh" || DELEGATED_EXIT=$?
  node "$SCRIPT_DIR/fragile-range-patterns.mjs" --ci || DELEGATED_EXIT=$?
  if [ "$DELEGATED_EXIT" -gt "$EXIT_CODE" ]; then
    EXIT_CODE=$DELEGATED_EXIT
  fi
fi

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "check-utf8: done (all clean)"
elif [ $EXIT_CODE -eq 1 ]; then
  echo "check-utf8: FAILED -- invalid UTF-8 or .sh ASCII violation"
else
  echo "check-utf8: ERROR"
fi

exit $EXIT_CODE
