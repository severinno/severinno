#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-ascii-proof.sh - auditable ASCII-safe proof for the repo's shell
# scripts. STRICT and repo-wide: every .sh (and the .husky hooks) must be
# PURE ASCII - no VPS/locale mojibake, no exceptions.
#
# Turns the manual PCRE proof (grep -P '[\x80-\xFF]' ...) into a VERSIONED
# audit that CI runs on every PR. Two reporting sections, ONE strict rule:
#
#   1. VPS-bound - scripts/health-check.sh (scp'd by the reusable health-check
#      workflow) + the root *.sh supervisor scripts. These run over ssh on the
#      VPS where the remote locale may not be UTF-8.
#
#   2. Ops - the remaining scripts/*.sh + the .husky hooks. Their accented
#      banners were previously tolerated (legitimate UTF-8); since 2026-08
#      they were transliterated 1:1 to ASCII, so strict ASCII applies
#      repo-wide via scripts/scan-non-ascii.mjs. check-utf8.sh DELEGATES all
#      .sh ASCII to this proof (its own VPS gate + --ascii scan were removed
#      as redundant - this audit covers a strict superset of both).
#
# FROZEN BASELINE (docs/ascii-safe.md): the audited surface is a CONTRACT,
# not just a scan. The machine-parseable manifest in docs/ascii-safe.md
# registers every audited file; the proof FAILS if the real audit surface
# drifts from it - a NEW .sh/hook that is not registered, or a registered
# file that disappeared, both fail until the baseline is regenerated:
#
#   bash scripts/verify-ascii-proof.sh --sync
#
# --sync rewrites ONLY the manifest block (between the
# <!-- ASCII-BASELINE:VPS --> / <!-- ASCII-BASELINE:OPS --> /
# <!-- ASCII-BASELINE:END --> markers), preserving the surrounding prose,
# and prints the new file counts. Commit the updated baseline together with
# the change that required it.
#
# Uses scripts/scan-non-ascii.mjs (raw byte iteration - immune to the
# locale-dependent `[^ -~]` grep RANGE that silently passed an em-dash
# through this same gate in 2026-08). There is no pattern to break.
# BATCHED scan: the proof runs ONE node invocation per section (VPS + OPS)
# with the scanner's --report mode (was one spawn per file - 39 node spawns
# in this repo, the gate's dominant cost). The per-file [ASCII-OK]/[VIOLATION]
# output is unchanged.
# Dependencies: node only (pre-installed on GitHub runners).
#
# SINGLE ENTRY: scripts/verify-encoding.sh runs this proof + check-utf8.sh in
# ONE call (CI utf8-check.yml + the local hooks). This script stays directly
# invokable for its focused audit / baseline regeneration (--sync). When
# check-utf8.sh is run STANDALONE it delegates its .sh ASCII to this proof;
# when run as layer 1 of verify-encoding.sh it skips that delegation
# (VERIFY_ENCODING_LAYER1=1) because this proof runs as layer 2.
#
# Env overrides (tests inject temp fixtures; CI uses the repo defaults):
#   VPS_SH_FILES          space-separated paths that must be pure ASCII
#   OPS_SH_FILES          space-separated paths that must be pure ASCII
#   ASCII_BASELINE_FILE   path to the baseline manifest (default:
#                         docs/ascii-safe.md). Fixture-mode runs (VPS or OPS
#                         overrides set) check the baseline ONLY when this is
#                         also set, so baseline-less fixture suites stay fast.
#
# NO root override (e.g. ASCII_PROOF_ROOT) BY DESIGN: unlike the fragile-
# range scan, whose gateFiles() DISCOVERS files by walking a root, this
# proof's audit surface is an EXPLICIT LIST (env-injected or default globs).
# Fixture isolation is already full via the three overrides above - the
# baseline mutation tests (drift/sync/CRLF) run on temp fixtures without
# touching the real repo, so a root redirect would add precedence ambiguity
# without closing any gap. (Decision recorded 2026-08 to avoid re-asking.)
#
# Usage:
#   bash scripts/verify-ascii-proof.sh          # audit + baseline check
#   bash scripts/verify-ascii-proof.sh --sync   # regenerate baseline manifest
#
# Exit codes:
#   0  proof holds - every listed file is pure ASCII and the baseline matches
#   1  at least one listed file has a non-ASCII byte, or the baseline drifted
#      (a listed file is missing, or a manifest entry is no longer audited)
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASELINE_FILE="${ASCII_BASELINE_FILE:-$SCRIPT_DIR/../docs/ascii-safe.md}"

SYNC_MODE=false
for a in "$@"; do
  case "$a" in
    --sync) SYNC_MODE=true ;;
    *) echo "usage: $0 [--sync]" >&2; exit 2 ;;
  esac
done

# --- 1. File lists (env overridable; unset OR empty -> repo defaults) ------
# The DEFAULT VPS/OPS glob patterns are DERIVED from the encoding-surface
# manifest (scripts/encoding-surface.mjs --print-vps-sh / --print-ops-sh,
# single source of truth - same pattern as the fragile-range TARGET_DIRS
# derivation), then expanded with nullglob exactly as the old inline globs
# were. The scripts/*.sh exclusion of health-check.sh (VPS-bound, not ops)
# is a SHELL semantic kept here, not in the manifest. Derivation failure
# fails loudly (exit 2): a gate must never silently degrade to auditing
# fewer files than the manifest declares.
if [ -n "${VPS_SH_FILES:-}" ]; then
  read -r -a VPS_LIST <<< "$VPS_SH_FILES"
else
  VPS_PATTERNS="$(node "$SCRIPT_DIR/encoding-surface.mjs" --print-vps-sh)" || VPS_PATTERNS=""
  if [ -z "$VPS_PATTERNS" ]; then
    echo "verify-ascii-proof: encoding-surface derivation failed (VPS_SH_PATTERNS unavailable)" >&2
    exit 2
  fi
  read -r -a VPS_PAT_ARR <<< "$VPS_PATTERNS"
  shopt -s nullglob
  VPS_LIST=()
  for p in "${VPS_PAT_ARR[@]}"; do
    for f in $p; do
      [ -n "$f" ] && VPS_LIST+=("$f")
    done
  done
  shopt -u nullglob
fi

if [ -n "${OPS_SH_FILES:-}" ]; then
  read -r -a OPS_LIST <<< "$OPS_SH_FILES"
else
  OPS_PATTERNS="$(node "$SCRIPT_DIR/encoding-surface.mjs" --print-ops-sh)" || OPS_PATTERNS=""
  if [ -z "$OPS_PATTERNS" ]; then
    echo "verify-ascii-proof: encoding-surface derivation failed (OPS_SH_PATTERNS unavailable)" >&2
    exit 2
  fi
  read -r -a OPS_PAT_ARR <<< "$OPS_PATTERNS"
  shopt -s nullglob
  OPS_LIST=()
  for p in "${OPS_PAT_ARR[@]}"; do
    for f in $p; do
      [ -n "$f" ] || continue
      [ "$f" = "scripts/health-check.sh" ] && continue
      OPS_LIST+=("$f")
    done
  done
  shopt -u nullglob
fi

# Fixture mode: unit tests inject VPS/OPS overrides. The baseline check runs
# in fixture mode ONLY when ASCII_BASELINE_FILE is also set (baseline tests
# opt in with a temp manifest); otherwise it is skipped so fixture-only
# suites don't need to maintain a manifest. Real repo mode always checks.
FIXTURE_MODE=false
[ -n "${VPS_SH_FILES:-}" ] || [ -n "${OPS_SH_FILES:-}" ] && FIXTURE_MODE=true
CHECK_BASELINE=false
if [ "$FIXTURE_MODE" = false ] || [ -n "${ASCII_BASELINE_FILE:-}" ]; then
  CHECK_BASELINE=true
fi

in_array() {
  local needle="$1"
  shift
  local e
  for e in "$@"; do
    [ "$e" = "$needle" ] && return 0
  done
  return 1
}

# Extract one manifest section (VPS or OPS) from the baseline file.
# CRLF-tolerant: docs/ascii-safe.md is a COMMITTED file parsed here, and a
# CRLF-converted copy (editor save, autocrlf=true checkout) must not false-
# fail a clean repo - every line drops a trailing \r before the marker regex
# and before being printed (same class as the repo's other committed-file
# parsers: bundle-report, golden-copy-utils normalizeCrlf).
extract_section() {
  local section="$1" file="$2"
  awk -v sec="$section" '
    { sub(/\r$/, "") }
    /^<!-- ASCII-BASELINE:[A-Z]+ -->$/ {
      if ($0 == ("<!-- ASCII-BASELINE:" sec " -->")) insec = 1
      else if (insec) exit
      next
    }
    insec && NF { print }
  ' "$file"
}

# --- 2. --sync: regenerate the manifest block, preserving surrounding prose -
if [ "$SYNC_MODE" = true ]; then
  if [ ! -f "$BASELINE_FILE" ]; then
    cat > "$BASELINE_FILE" <<'DOC'
# ASCII-Safe Baseline - Severinno (auto-created by verify-ascii-proof.sh --sync)

<!-- ASCII-BASELINE:VPS -->
<!-- ASCII-BASELINE:OPS -->
<!-- ASCII-BASELINE:END -->
DOC
  fi
  TMP_BLOCK="$(mktemp)"
  {
    echo "<!-- ASCII-BASELINE:VPS -->"
    printf '%s\n' "${VPS_LIST[@]}"
    echo "<!-- ASCII-BASELINE:OPS -->"
    printf '%s\n' "${OPS_LIST[@]}"
    echo "<!-- ASCII-BASELINE:END -->"
  } > "$TMP_BLOCK"
  TMP_OUT="$(mktemp)"
  awk -v block="$TMP_BLOCK" '
    BEGIN { n = 0; while ((getline line < block) > 0) { n++; new[n] = line } }
    { sub(/\r$/, "") }
    $0 == "<!-- ASCII-BASELINE:VPS -->" {
      for (i = 1; i <= n; i++) print new[i]
      inblock = 1
      next
    }
    inblock == 1 && $0 == "<!-- ASCII-BASELINE:END -->" { inblock = 0; next }
    inblock == 1 { next }
    { print }
  ' "$BASELINE_FILE" > "$TMP_OUT"
  # Anti-silent-no-op guard: if the input had no manifest markers (hand-
  # edited or mangled), the awk matches nothing and would write the file back
  # byte-identical while reporting success. Refuse instead of pretending.
  if ! grep -q '<!-- ASCII-BASELINE:VPS -->' "$TMP_OUT"; then
    echo "verify-ascii-proof: ERROR - no manifest markers found in $BASELINE_FILE; nothing to sync." >&2
    echo "  (the baseline needs the <!-- ASCII-BASELINE:VPS --> / OPS / END block; recreate it or fix the file)" >&2
    rm -f "$TMP_OUT" "$TMP_BLOCK"
    exit 2
  fi
  mv "$TMP_OUT" "$BASELINE_FILE"
  rm -f "$TMP_BLOCK"
  echo "verify-ascii-proof: baseline synced -> $BASELINE_FILE ($((${#VPS_LIST[@]} + ${#OPS_LIST[@]})) files registered)"
  exit 0
fi

# --- 3. Baseline drift check (frozen audit surface contract) ---------------
BASELINE_DRIFT=0
VPS_BASE=()
OPS_BASE=()
if [ "$CHECK_BASELINE" = true ]; then
  if [ ! -f "$BASELINE_FILE" ]; then
    echo "  [BASELINE]  $BASELINE_FILE nao existe - rode: bash scripts/verify-ascii-proof.sh --sync"
    BASELINE_DRIFT=1
  else
    mapfile -t VPS_BASE < <(extract_section VPS "$BASELINE_FILE")
    mapfile -t OPS_BASE < <(extract_section OPS "$BASELINE_FILE")

    for f in "${VPS_LIST[@]}"; do
      if ! in_array "$f" "${VPS_BASE[@]:-}"; then
        echo "  [BASELINE-DRIFT]  $f e auditado mas NAO registrado (VPS) - rode --sync"
        BASELINE_DRIFT=1
      fi
    done
    for f in "${VPS_BASE[@]:-}"; do
      if ! in_array "$f" "${VPS_LIST[@]:-}"; then
        echo "  [BASELINE-DRIFT]  $f registrado mas fora do audit (VPS) - rode --sync"
        BASELINE_DRIFT=1
      fi
    done

    for f in "${OPS_LIST[@]}"; do
      if ! in_array "$f" "${OPS_BASE[@]:-}"; then
        echo "  [BASELINE-DRIFT]  $f e auditado mas NAO registrado (OPS) - rode --sync"
        BASELINE_DRIFT=1
      fi
    done
    for f in "${OPS_BASE[@]:-}"; do
      if ! in_array "$f" "${OPS_LIST[@]:-}"; then
        echo "  [BASELINE-DRIFT]  $f registrado mas fora do audit (OPS) - rode --sync"
        BASELINE_DRIFT=1
      fi
    done
  fi
fi

# --- 4. ASCII scan (strict, repo-wide) -------------------------------------
# BATCHED per section: scan-non-ascii.mjs --report prints one TAB-separated
# verdict line per file (ASCII-OK/VIOLATION/ERROR) for the whole section in a
# single node spawn. The loop below maps each verdict onto the same per-file
# [ASCII-OK]/[VIOLATION] output the audit has always printed. ERROR (missing
# file) counts as a violation - never a silent skip. A scanner-level failure
# (exit 2) fails the gate loudly instead of passing it silently.
EXIT_CODE=0
VPS_OK=()
VPS_BAD=()
OPS_OK=()
OPS_BAD=()

scan_section() {
  local label="$1"
  shift
  [ $# -eq 0 ] && return 0
  local out rc=0 verdict path seen_violation=0
  out="$(node "$SCRIPT_DIR/scan-non-ascii.mjs" --report "$@" 2>&1)" || rc=$?
  while IFS=$'\t' read -r verdict path _; do
    case "$verdict" in
      "ASCII-OK")
        echo "  [ASCII-OK]   $path"
        if [ "$label" = VPS ]; then VPS_OK+=("$path"); else OPS_OK+=("$path"); fi
        ;;
      "VIOLATION"|"ERROR")
        echo "  [VIOLATION]  $path  (non-ASCII byte)"
        if [ "$label" = VPS ]; then VPS_BAD+=("$path"); else OPS_BAD+=("$path"); fi
        EXIT_CODE=1
        seen_violation=1
        ;;
    esac
  done <<< "$out"
  # Scanner-level failure (crash, missing module, usage error) with NO
  # per-file verdicts must fail the gate loudly - never a silent pass.
  if [ "$rc" -ne 0 ] && [ "$seen_violation" -eq 0 ]; then
    echo "  [SCAN-ERROR]  scan-non-ascii.mjs failed (exit $rc)" >&2
    echo "$out" | sed 's/^/                 /' >&2
    EXIT_CODE=1
  fi
}

echo "=== verify-ascii-proof ==="
echo ""
echo "VPS-bound shell scripts (pure ASCII required):"
scan_section VPS "${VPS_LIST[@]}"
echo ""
echo "Ops shell scripts + hooks (pure ASCII required):"
scan_section OPS "${OPS_LIST[@]}"

echo ""
if [ "$EXIT_CODE" -eq 0 ] && [ "$BASELINE_DRIFT" -eq 0 ]; then
  echo "Verdict: ASCII-safe state PROVEN - ${#VPS_OK[@]} VPS-bound + ${#OPS_OK[@]} ops/hooks pure ASCII."
  if [ "$CHECK_BASELINE" = true ]; then
    echo "  Baseline OK ($BASELINE_FILE): $((${#VPS_BASE[@]} + ${#OPS_BASE[@]})) files registered."
  fi
  echo "verify-ascii-proof: done (all clean)"
else
  echo "Verdict: ASCII-safe state VIOLATED."
  if [ "${#VPS_BAD[@]}" -gt 0 ]; then
    echo "  VPS-bound violations:"
    for f in "${VPS_BAD[@]}"; do
      echo "    - $f"
    done
  fi
  if [ "${#OPS_BAD[@]}" -gt 0 ]; then
    echo "  Ops/hook violations:"
    for f in "${OPS_BAD[@]}"; do
      echo "    - $f"
    done
  fi
  if [ "$BASELINE_DRIFT" -ne 0 ]; then
    echo "  Baseline drift: the audit surface no longer matches docs/ascii-safe.md."
    echo "  Run 'bash scripts/verify-ascii-proof.sh --sync' and commit the updated baseline."
  fi
  echo "verify-ascii-proof: FAILED"
fi
exit $((EXIT_CODE || BASELINE_DRIFT))
