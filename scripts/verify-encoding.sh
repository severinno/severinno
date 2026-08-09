#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-encoding.sh - single encoding gate entry point.
#
# Consolidates the encoding checks that used to run as separate CI steps
# (and separate hook lines) into ONE call:
#
#   1. scripts/check-utf8.sh         - valid UTF-8 for .ts/.tsx/.sh. All .sh
#                                      PURE-ASCII checking is delegated to
#                                      layer 2 (see check-utf8.sh header);
#                                      layer 1 runs with VERIFY_ENCODING_LAYER1=1
#                                      so the delegation is skipped (no double
#                                      audit).
#   2. scripts/verify-ascii-proof.sh - strict repo-wide pure-ASCII proof on
#                                      every .sh + .husky hook + the frozen
#                                      docs/ascii-safe.md baseline drift check
#   3. scripts/fragile-range-patterns.mjs --ci
#                                    - the fragile character-class RANGE scan
#                                      (the 2026-08 em-dash bug class). Same
#                                      patterns the vitest guard imports; wired
#                                      here so the class is blocked even when
#                                      the gate runs without the vitest suite.
#                                      Scan surface: gate files + the
#                                      module's TARGET_DIRS trees
#                                      (DERIVED via the module's
#                                      --print-target-dirs query, single
#                                      source of truth). NOT scanned:
#                                      .md/.css/.html + the docs/ tree -
#                                      canonical decision record in
#                                      fragile-range-patterns.mjs (the
#                                      DECISION RECORD block just below
#                                      TARGET_EXTS); enforced by the
#                                      EXCLUSION CONTRACT tests in the
#                                      guard suite.
#
# Exit code = the WORST of the three layers (0 all clean / 1 violation / 2
# usage error), so a regression in any layer fails the single step.
# Args are forwarded to check-utf8.sh (e.g. --ci src/, --dry-run, --ext md
# for an on-demand doc audit); --sync is intercepted and routed to
# verify-ascii-proof.sh (baseline regeneration).
#
# Usage:
#   bash scripts/verify-encoding.sh                  # all layers, defaults
#   bash scripts/verify-encoding.sh --ci src/        # CI (utf8-check.yml)
#   bash scripts/verify-encoding.sh --dry-run --ci src/   # local hooks
#   bash scripts/verify-encoding.sh --sync           # forward to proof only
#
# Env overrides pass through untouched - fixture-driven tests keep working
# through this entry point: the proof layer's VPS_SH_FILES/OPS_SH_FILES/
# ASCII_BASELINE_FILE, layer 3's FRAGILE_SCAN_ROOT (synthetic/alternate repo
# root) and FRAGILE_SCAN_DIRS (space-separated dirs REPLACING the derived
# TARGET_DIRS default).
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SYNC_MODE=false
UTF8_ARGS=()
for a in "$@"; do
  case "$a" in
    --sync) SYNC_MODE=true ;;
    *)      UTF8_ARGS+=("$a") ;;
  esac
done

# --sync is a MAINTENANCE op: baseline regeneration only. Mixing it with
# normal gate args (e.g. "--ci src/ --sync") would silently ignore them -
# refuse loudly instead (the same no-silent-ignore posture the gates keep).
if [ "$SYNC_MODE" = true ] && [ "${#UTF8_ARGS[@]}" -gt 0 ]; then
  echo "verify-encoding: --sync cannot be combined with other args (it regenerates the baseline only)." >&2
  echo "  usage: bash scripts/verify-encoding.sh --sync   OR   bash scripts/verify-encoding.sh [--ci src/ ...]" >&2
  exit 2
fi

EXIT_CODE=0

# --sync is baseline regeneration only: no UTF-8 scan needed, so the proof
# runs standalone and we exit immediately (no layer-1 work to aggregate).
if [ "$SYNC_MODE" = true ]; then
  bash "$SCRIPT_DIR/verify-ascii-proof.sh" --sync || EXIT_CODE=$?
  exit "$EXIT_CODE"
fi

# Layer 1: UTF-8 validity. VERIFY_ENCODING_LAYER1=1 tells check-utf8.sh to
# SKIP its .sh ASCII delegation (see check-utf8.sh header) - this wrapper
# runs the proof as layer 2 below, so delegating inside layer 1 would audit
# twice. `|| X=$?` under set -e is required: a non-zero gate must not abort
# before the proof reports.
VERIFY_ENCODING_LAYER1=1 bash "$SCRIPT_DIR/check-utf8.sh" "${UTF8_ARGS[@]+"${UTF8_ARGS[@]}"}" || EXIT_CODE=$?

# Layer 2: strict ASCII proof + frozen baseline. Worst exit code wins.
bash "$SCRIPT_DIR/verify-ascii-proof.sh" || EXIT_CODE=$?

# Layer 3: fragile character-class RANGE scan (the 2026-08 bug class). The
# patterns live in scripts/fragile-range-patterns.mjs - the SAME module the
# vitest guard imports - wired here so a fragile range in any gate file is
# blocked even when the gate runs without the vitest suite. The DEFAULT
# --dir targets are DERIVED from the module's TARGET_DIRS export via its
# --print-target-dirs query mode - the module is the single source of
# truth, so adding a dir to TARGET_DIRS picks it up in every gate
# automatically and there is no second "e2e/ src/" list in this wrapper to
# drift. FRAGILE_SCAN_DIRS (space-separated) OVERRIDES the derived default
# for fixture-driven tests, mirroring the proof layer's env overrides. If
# the derivation fails, layer 3 fails loudly (exit 2) - a gate must never
# silently degrade to scanning fewer trees than the module declares. Worst
# exit wins.
FRAGILE_EXIT=0
FRAGILE_DIR_ARR=()
if [ -n "${FRAGILE_SCAN_DIRS:-}" ]; then
  read -r -a FRAGILE_DIR_ARR <<< "$FRAGILE_SCAN_DIRS"
else
  FRAGILE_DIRS="$(node "$SCRIPT_DIR/fragile-range-patterns.mjs" --print-target-dirs)" || FRAGILE_DIRS=""
  if [ -z "$FRAGILE_DIRS" ]; then
    echo "verify-encoding: layer 3 could not derive TARGET_DIRS from fragile-range-patterns.mjs (--print-target-dirs failed)" >&2
    FRAGILE_EXIT=2
  else
    read -r -a FRAGILE_DIR_ARR <<< "$FRAGILE_DIRS"
  fi
fi
DIR_ARGS=()
for d in "${FRAGILE_DIR_ARR[@]}"; do
  DIR_ARGS+=(--dir "$d")
done
if [ "$FRAGILE_EXIT" -eq 0 ]; then
  node "$SCRIPT_DIR/fragile-range-patterns.mjs" --ci "${DIR_ARGS[@]}" || FRAGILE_EXIT=$?
fi
if [ "$FRAGILE_EXIT" -gt "$EXIT_CODE" ]; then
  EXIT_CODE=$FRAGILE_EXIT
fi

exit "$EXIT_CODE"
