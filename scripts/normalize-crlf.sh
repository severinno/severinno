#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# normalize-crlf.sh — normalize tracked source files to LF in one command
#
# WHY: On Windows, core.autocrlf=true + a checkout that predates
# .gitattributes leaves the working tree with CRLF while blobs stay LF
# (i/lf w/crlf). Git Bash tolerates CRLF, but Linux containers (act/CI)
# reject it ('set: pipefail: invalid option name'). This script applies the
# documented fix (README → Bugs conhecidos) to ANY fresh checkout/worktree:
#
#   1. Detect tracked files (.sh/.ts/.md by default) with CRLF on disk
#   2. Rewrite CRLF → LF (raw bytes via scripts/check_crlf.py — grep/sed
#      fail on MSYS which strips CR in text mode)
#   3. git add --renormalize ONLY on files whose sole change was line
#      endings (git diff --quiet passes), syncing the index stat cache
#      without staging any real content — real edits stay unstaged.
#      NB: a file whose BLOB was committed as CRLF gets its EOL-only index
#      rewrite staged here by design (that IS the normalization); only real
#      content edits are preserved unstaged.
#
# Usage:
#   ./scripts/normalize-crlf.sh              # normalize + renormalize
#   ./scripts/normalize-crlf.sh --check      # exit 1 if any CRLF found
#   ./scripts/normalize-crlf.sh --dry-run    # list files, change nothing
#
#   Exit codes: --check exits 1 when CRLF is found (CI gate); the default
#   fix and --dry-run exit 0 (informational — don't pipe --dry-run into CI
#   as a gate).
#
# Env:
#   NORMALIZE_CRLF_EXTS — space-separated extensions (default: .sh .ts .md)
#   CHECK_CRLF_ROOT     — repo root override (used by tests)
#
# Exit codes: 0 = clean/done, 1 = CRLF found (--check), 2 = error/usage
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_SCRIPT="$SCRIPT_DIR/check_crlf.py"

MODE="fix"
EXTS="${NORMALIZE_CRLF_EXTS:-.sh .ts .md}"

for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --dry-run) MODE="dry" ;;
    -h | --help)
      # Drift-proof: imprime o header do comentário até a linha do shebang
      # body (set -euo pipefail), sem range hardcoded.
      awk 'NR >= 2 && /^set -euo pipefail$/ { exit } NR >= 2 { print }' "$0"
      exit 0
      ;;
    *)
      echo "normalize-crlf: unknown argument: $arg" >&2
      echo "Usage: $0 [--check] [--dry-run]" >&2
      exit 2
      ;;
  esac
done

if [ ! -f "$PY_SCRIPT" ]; then
  echo "normalize-crlf: ERROR: $PY_SCRIPT not found" >&2
  exit 2
fi

PY="python3"
command -v python3 >/dev/null 2>&1 || PY="python"

ROOT="${CHECK_CRLF_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "normalize-crlf: not inside a git work tree" >&2
  exit 2
fi

# Build git pathspecs from the extension list (each quoted → literal glob)
PATTERNS=()
for ext in $EXTS; do
  PATTERNS+=("*$ext")
done

mapfile -t FILES < <(git ls-files "${PATTERNS[@]}")
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "normalize-crlf: no tracked files matching [$EXTS]"
  exit 0
fi

# Detect CRLF offenders (raw bytes — works on Git Bash and Linux)
mapfile -t OFFENDERS < <("$PY" "$PY_SCRIPT" "${FILES[@]}" || true)

if [ "${#OFFENDERS[@]}" -eq 0 ]; then
  echo "normalize-crlf: OK — no CRLF found in tracked [$EXTS] files"
  exit 0
fi

if [ "$MODE" = "check" ]; then
  echo "normalize-crlf: FAILED — CRLF in ${#OFFENDERS[@]} tracked file(s):"
  printf '  - %s\n' "${OFFENDERS[@]}"
  echo ""
  echo "Fix: ./scripts/normalize-crlf.sh"
  exit 1
fi

if [ "$MODE" = "dry" ]; then
  echo "normalize-crlf: dry-run — would convert ${#OFFENDERS[@]} file(s):"
  printf '  - %s\n' "${OFFENDERS[@]}"
  exit 0
fi

# Convert CRLF → LF on disk
echo "normalize-crlf: converting ${#OFFENDERS[@]} file(s) CRLF → LF..."
"$PY" "$PY_SCRIPT" --fix "${OFFENDERS[@]}"

# Renormalize ONLY files whose sole change was line endings (git diff
# quiet), so real unstaged edits are never staged by this script.
RENORM=()
for f in "${OFFENDERS[@]}"; do
  if git diff --quiet -- "$f"; then
    RENORM+=("$f")
  else
    echo "  (kept unstaged — real changes detected): $f"
  fi
done

if [ "${#RENORM[@]}" -gt 0 ]; then
  echo "normalize-crlf: git add --renormalize on ${#RENORM[@]} file(s) (index stat cache)..."
  git add --renormalize -- "${RENORM[@]}"
fi

echo "normalize-crlf: done."
exit 0
