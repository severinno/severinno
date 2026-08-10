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
#   4. scan-non-ascii.mjs --utf8 --report over the YAML GATE files
#                                    - UTF-8 WELL-FORMEDNESS scan (the
#                                      corruption class) on .github/workflows/*.yml
#                                      + .github/actions/*/action.yml. BLOCKING
#                                      (unlike the informational docs-encoding
#                                      job): a corrupt byte (0x97) in a workflow
#                                      YAML BREAKS the parse entirely (js-yaml
#                                      and PyYAML both throw "invalid start
#                                      byte") - the workflow silently fails to
#                                      load and CI checks silently stop running.
#                                      That is OPERATIONAL, not cosmetic like a
#                                      .md. Legit accents/em-dashes are VALID
#                                      UTF-8 and pass; only INVALID sequences
#                                      fail. Surface: git ls-files of the gate
#                                      files (not docker-compose*.yml etc).
#                                      YAML_GATE_FILES (space-separated)
#                                      OVERRIDES the default for fixture tests.
#   5. scan-non-ascii.mjs --report over the scripts/*.mjs GATE files
#                                    - PURE-ASCII scan (byte >= 0x80). The
#                                      1:1 ASCII conversion the .sh files got
#                                      (f17ffdd) never reached the .mjs - a
#                                      stray accent/emoji/em-dash in a gate
#                                      .mjs is the same silent-failure class
#                                      as a .sh. BLOCKING. Surface DERIVED
#                                      from encoding-surface.mjs
#                                      --print-mjs-gate. MJS_SCAN_FILES
#                                      OVERRIDES for fixture tests.
#
# Exit code = the WORST of the five layers (0 all clean / 1 violation / 2
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
# TARGET_DIRS default). FRAGILE_MODULE is READ by the wrapper itself: it
# overrides the module path layer 3 executes (default: the real module next
# to this script) so a REVERSE-MUTATION test can run layer 3 against a TEMP
# COPY of the module with the scan-scope contracts lifted - proving the
# exclusion wiring through the wrapper, not just through the module API.
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
FRAGILE_MODULE="${FRAGILE_MODULE:-$SCRIPT_DIR/fragile-range-patterns.mjs}"
FRAGILE_EXIT=0
FRAGILE_DIR_ARR=()
if [ -n "${FRAGILE_SCAN_DIRS:-}" ]; then
  read -r -a FRAGILE_DIR_ARR <<< "$FRAGILE_SCAN_DIRS"
else
  FRAGILE_DIRS="$(node "$FRAGILE_MODULE" --print-target-dirs)" || FRAGILE_DIRS=""
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
  node "$FRAGILE_MODULE" --ci "${DIR_ARGS[@]}" || FRAGILE_EXIT=$?
fi
if [ "$FRAGILE_EXIT" -gt "$EXIT_CODE" ]; then
  EXIT_CODE=$FRAGILE_EXIT
fi

# Layer 4: YAML gate files - UTF-8 WELL-FORMEDNESS (the corruption class).
# A corrupt byte (0x97) in a workflow YAML BREAKS THE PARSE entirely (both
# js-yaml and PyYAML throw "unacceptable character / invalid start byte") -
# the workflow silently fails to load and CI checks silently stop running.
# That is an OPERATIONAL failure, not the cosmetic mojibake a corrupt byte
# causes in a .md: so the YAML gate files get a BLOCKING --utf8 scan, unlike
# the docs surface (informational docs-encoding job in pr-check.yml). Legit
# accents/em-dashes in workflow comments are VALID UTF-8 and PASS - only
# INVALID sequences fail. Surface: git ls-files '.github/workflows/*.yml'
# '.github/actions/*/action.yml' (the GATE files; docker-compose*.yml etc.
# are not gate files and are not scanned). YAML_GATE_FILES (space-separated)
# OVERRIDES the default for fixture-driven tests, mirroring the proof layer's
# env overrides. Worst exit wins.
YAML_EXIT=0
YAML_LIST=()
if [ -n "${YAML_GATE_FILES:-}" ]; then
  read -r -a YAML_LIST <<< "$YAML_GATE_FILES"
else
  # YAML gate globs DERIVED from the encoding-surface manifest (single
  # source of truth - scripts/encoding-surface.mjs --print-yaml-gate),
  # same pattern as the fragile-range TARGET_DIRS derivation. Derivation
  # failure fails loudly (exit 2): a gate must never silently degrade to
  # scanning fewer surfaces. `2>/dev/null || true` on git ls-files keeps
  # the fallback robust outside a git repo (hermetic fixture runs) - an
  # empty list simply skips the layer.
  YAML_PATTERNS="$(node "$SCRIPT_DIR/encoding-surface.mjs" --print-yaml-gate)" || YAML_PATTERNS=""
  if [ -z "$YAML_PATTERNS" ]; then
    echo "verify-encoding: encoding-surface derivation failed (YAML_GATE_PATTERNS unavailable)" >&2
    YAML_EXIT=2
  else
    read -r -a YAML_PAT_ARR <<< "$YAML_PATTERNS"
    mapfile -t YAML_LIST < <(git ls-files "${YAML_PAT_ARR[@]}" 2>/dev/null || true)
  fi
fi
if [ "${#YAML_LIST[@]}" -gt 0 ]; then
  node "$SCRIPT_DIR/scan-non-ascii.mjs" --utf8 --report "${YAML_LIST[@]}" || YAML_EXIT=$?
  if [ "$YAML_EXIT" -eq 0 ]; then
    echo "yaml-gate: clean (${#YAML_LIST[@]} YAML gate files, well-formed UTF-8)"
  else
    echo "yaml-gate: FAILED - invalid UTF-8 in a YAML gate file (workflow parse would break - blocking)" >&2
  fi
fi
if [ "$YAML_EXIT" -gt "$EXIT_CODE" ]; then
  EXIT_CODE=$YAML_EXIT
fi

# Layer 5: scripts/*.mjs gate files - PURE-ASCII scan (--report, byte
# >= 0x80). The 1:1 ASCII conversion the .sh files got (f17ffdd) never
# reached the .mjs - they carried box-drawing banners, em-dashes, emoji
# and accents in CLI output/docblocks, and a stray non-ASCII byte in a
# gate .mjs is the SAME silent-failure class as a .sh (e.g. the accented
# byte that escaped this gate until a manual scan-non-ascii --report
# caught it).
# BLOCKING (unlike the informational docs-encoding job): scripts/*.mjs
# are EXECUTABLE gate logic, so the scan is the ASCII-strictness mirror
# of layer 2 for the .mjs surface. Legit accents in docblock prose are
# NOT allowed here (layer 5 is byte-strict); the .md/.css/.html doc
# surfaces keep their legit-unicode-by-design posture in the
# informational job. Surface: git ls-files 'scripts/*.mjs' - DERIVED
# from encoding-surface.mjs --print-mjs-gate (single source of truth,
# same pattern as layer 4). MJS_SCAN_FILES (space-separated) OVERRIDES
# the default for fixture-driven tests.
MJS_EXIT=0
MJS_LIST=()
if [ -n "${MJS_SCAN_FILES:-}" ]; then
  read -r -a MJS_LIST <<< "$MJS_SCAN_FILES"
else
  MJS_PATTERNS="$(node "$SCRIPT_DIR/encoding-surface.mjs" --print-mjs-gate)" || MJS_PATTERNS=""
  if [ -z "$MJS_PATTERNS" ]; then
    echo "verify-encoding: encoding-surface derivation failed (MJS_GATE_PATTERNS unavailable)" >&2
    MJS_EXIT=2
  else
    read -r -a MJS_PAT_ARR <<< "$MJS_PATTERNS"
    mapfile -t MJS_LIST < <(git ls-files "${MJS_PAT_ARR[@]}" 2>/dev/null || true)
  fi
fi
if [ "${#MJS_LIST[@]}" -gt 0 ]; then
  node "$SCRIPT_DIR/scan-non-ascii.mjs" --report "${MJS_LIST[@]}" || MJS_EXIT=$?
  if [ "$MJS_EXIT" -eq 0 ]; then
    echo "mjs-gate: clean (${#MJS_LIST[@]} scripts/*.mjs, pure ASCII)"
  else
    echo "mjs-gate: FAILED - non-ASCII byte in a scripts/*.mjs gate file (blocking)" >&2
  fi
fi
if [ "$MJS_EXIT" -gt "$EXIT_CODE" ]; then
  EXIT_CODE=$MJS_EXIT
fi

exit "$EXIT_CODE"
