#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-utf8.sh - verify source files are valid UTF-8
#
# Scans, by default:
#   src/                all .ts/.tsx source files (valid UTF-8)
#   scripts/            all .sh scripts (valid UTF-8)
#   .github/workflows/  any .sh scripts there (valid UTF-8)
#   .zscripts/          any .sh scripts there (valid UTF-8) - workspace-agent
#                       operational scripts, ALWAYS scanned since 2026-08
#
# .sh scripts are scp'd to the VPS and executed over ssh, where the remote
# locale may not be UTF-8 - emoji/accents/em-dashes would render as mojibake.
# VALID UTF-8 is this script's job (check_utf8.py, with safe byte-0x97
# Windows-1252 detection - valid 0x97 continuation bytes are never touched).
#
# PURE-ASCII is NOT this script's job anymore (2026-08): every AUDITED .sh
# (scripts/*.sh, root *.sh, .husky hooks) is pure ASCII, enforced by
# scripts/verify-ascii-proof.sh (strict, + the frozen docs/ascii-safe.md
# baseline drift check). EXCEPTION: .zscripts/*.sh are deliberately OUT of
# the ASCII proof (legit CJK banners - workspace-agent tooling, never scp'd
# to the VPS; strict ASCII would false-fail them); their encoding contract
# is VALID UTF-8, enforced HERE by the always-scanned .zscripts dir below
# (decision: docs/ascii-safe.md 'Who protects .zscripts and the YAML gate
# files?'). The old always-on VPS ASCII gate (health-check.sh +
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
#   ./scripts/check-utf8.sh --ext md     # also audit .md files (on-demand; --ext
#                                        # is forwarded to check_utf8.py)
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

# Default scan roots. A positional dir argument overrides src/ but scripts/,
# .github/workflows/ and .zscripts/ are ALWAYS scanned (they hold the .sh
# scripts; .zscripts since 2026-08 - see the header EXCEPTION note).
# --ascii is intercepted and DROPPED: repo-wide .sh ASCII is always-on via
# the delegated proof, so the flag is accepted only for backward compat.
DEFAULT_DIRS=(src)
ARGS=()
POSITIONAL=("$@")
i=0
while [ "$i" -lt "${#POSITIONAL[@]}" ]; do
  a="${POSITIONAL[$i]}"
  case "$a" in
    # --ascii: no-op since 2026-08 - pure-ASCII is always enforced by the
    # delegated proof (verify-ascii-proof.sh), never forwarded to python.
    --ascii) : ;;
    --ext)
      # --ext consumes the NEXT argument as its extension value; without
      # this, the value would be mistaken for a positional scan dir.
      ARGS+=("$a")
      if [ "$((i + 1))" -lt "${#POSITIONAL[@]}" ]; then
        i=$((i + 1))
        ARGS+=("${POSITIONAL[$i]}")
      fi
      ;;
    --*)     ARGS+=("$a") ;;
    *)       DEFAULT_DIRS=("$a") ;;
  esac
  i=$((i + 1))
done

# Fixed dirs DERIVED from the encoding-surface manifest (single source of
# truth - scripts/encoding-surface.mjs --print-always-dirs), the same
# pattern as the fragile-range TARGET_DIRS derivation below: no second
# "scripts .github/workflows .zscripts" list to keep in sync with the
# module and docs/ascii-safe.md. Derivation failure fails loudly (exit 2) -
# a gate must never silently degrade to scanning fewer dirs.
# ENCODING_SURFACE_MODULE OVERRIDES the module path (mirroring FRAGILE_MODULE
# in verify-encoding.sh layer 3) so a fixture-driven test can run this
# wrapper against a TEMP COPY of the manifest with a 5th ALWAYS_SCAN_DIRS
# entry - proving the derivation covers future dirs through the real wiring
# (the encoding-surface GROWTH CONTRACT test).
ENCODING_SURFACE_MODULE="${ENCODING_SURFACE_MODULE:-$SCRIPT_DIR/encoding-surface.mjs}"
EXIT_CODE=0
FIXED_DIRS="$(node "$ENCODING_SURFACE_MODULE" --print-always-dirs)" || FIXED_DIRS=""
if [ -z "$FIXED_DIRS" ]; then
  echo "check-utf8: encoding-surface derivation failed (ALWAYS_SCAN_DIRS unavailable)" >&2
  EXIT_CODE=2
else
  read -r -a FIXED_DIR_ARR <<< "$FIXED_DIRS"
  python3 "$PYTHON_SCRIPT" "${DEFAULT_DIRS[@]}" "${ARGS[@]}" "${FIXED_DIR_ARR[@]}" || EXIT_CODE=$?
fi

# .sh ASCII delegation: ALL .sh checking lives in verify-ascii-proof.sh
# (strict repo-wide pure ASCII + frozen docs/ascii-safe.md baseline). When
# this script runs as LAYER 1 of verify-encoding.sh (VERIFY_ENCODING_LAYER1=1)
# the delegation is skipped - that caller runs the proof as its layer 2, so
# running it here again would audit twice. Standalone runs always delegate,
# so a direct `bash scripts/check-utf8.sh --ci src/` still enforces the
# complete gate. The fragile character-class RANGE scan (the 2026-08 bug
# class, scripts/fragile-range-patterns.mjs) delegates the same way - it is
# verify-encoding.sh's layer 3, so it too must not run twice under layer 1.
# A standalone run DERIVES the fragile scan's --dir targets from the
# module's TARGET_DIRS (--print-target-dirs, single source of truth) - the
# same e2e/ + src/ trees verify-encoding.sh layer 3 scans, so the standalone
# entry enforces the SAME executable-code surface. NOTE: this delegation
# does NOT honor a FRAGILE_SCAN_DIRS override (unlike verify-encoding.sh
# layer 3) - fixture-driven layer-3 tests route through verify-encoding.sh,
# and this standalone entry always audits the real repo. `|| X=$?` under
# set -e is REQUIRED: a non-zero delegated exit must not abort before the
# verdict.
DELEGATED_EXIT=0
if [ "${VERIFY_ENCODING_LAYER1:-}" != "1" ]; then
  bash "$SCRIPT_DIR/verify-ascii-proof.sh" || DELEGATED_EXIT=$?
  FRAGILE_DIRS="$(node "$SCRIPT_DIR/fragile-range-patterns.mjs" --print-target-dirs)" || FRAGILE_DIRS=""
  if [ -z "$FRAGILE_DIRS" ]; then
    echo "check-utf8: fragile-range derivation failed (TARGET_DIRS unavailable)" >&2
    DELEGATED_EXIT=2
  else
    read -r -a FRAGILE_DIR_ARR <<< "$FRAGILE_DIRS"
    FRAGILE_ARGS=()
    for d in "${FRAGILE_DIR_ARR[@]}"; do
      FRAGILE_ARGS+=(--dir "$d")
    done
    node "$SCRIPT_DIR/fragile-range-patterns.mjs" --ci "${FRAGILE_ARGS[@]}" || DELEGATED_EXIT=$?
  fi
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
