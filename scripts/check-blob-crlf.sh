#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-blob-crlf.sh — fail if any tracked .sh/.bash BLOB has CRLF/mixed EOL
#
# WHY: the working-tree guard (check-crlf.sh) catches CRLF on disk, but a
# file COMMITTED with CRLF in its blob (e.g. autocrlf disabled, or committed
# before .gitattributes) reproduces CRLF on every fresh checkout — including
# Linux containers (act/CI), where `set -euo pipefail` fails with
# 'pipefail: invalid option name'. This guard inspects the git INDEX (the
# blob EOL as recorded), so in CI it equals the committed state: permanent
# regression prevention across ALL branches.
#
# Detection delegates to scripts/check_blob_crlf.py (`git ls-files --eol -z`),
# which parses the `i/` column — `lf` clean, anything else fail-closed.
#
# Usage:
#   ./scripts/check-blob-crlf.sh            # check blobs; exit 1 on any CRLF
#   ./scripts/check-blob-crlf.sh --ci       # same (explicit CI mode)
#   ./scripts/check-blob-crlf.sh --fix      # git add --renormalize offenders
#
# Env: CHECK_CRLF_ROOT — optional repo root override (used by tests).
#
# Exit codes: 0 = clean/done, 1 = CRLF found, 2 = error (no git / bad usage)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_SCRIPT="$SCRIPT_DIR/check_blob_crlf.py"

MODE="check"
for arg in "$@"; do
  case "$arg" in
    --ci) MODE="check" ;;
    --fix) MODE="fix" ;;
    -h | --help)
      awk 'NR >= 2 && /^set -euo pipefail$/ { exit } NR >= 2 { print }' "$0"
      exit 0
      ;;
    *)
      echo "check-blob-crlf: unknown argument: $arg" >&2
      echo "Usage: $0 [--ci] [--fix]" >&2
      exit 2
      ;;
  esac
done

if [ ! -f "$PY_SCRIPT" ]; then
  echo "check-blob-crlf: ERROR: $PY_SCRIPT not found" >&2
  exit 2
fi

PY="python3"
command -v python3 >/dev/null 2>&1 || PY="python"

ROOT="${CHECK_CRLF_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "check-blob-crlf: not inside a git work tree" >&2
  exit 2
fi

if [ "$MODE" = "fix" ]; then
  "$PY" "$PY_SCRIPT" --fix
  echo "check-blob-crlf: done. Review 'git diff --cached' (EOL-only) and commit."
  exit 0
fi

mapfile -t OFFENDERS < <("$PY" "$PY_SCRIPT" || true)
if [ "${#OFFENDERS[@]}" -eq 0 ]; then
  echo "check-blob-crlf: OK — all tracked .sh/.bash blobs use LF"
  exit 0
fi

echo "check-blob-crlf: FAILED — CRLF/mixed BLOB in tracked shell scripts:"
printf '  - %s\n' "${OFFENDERS[@]}"
echo ""
echo "These blobs reproduce CRLF on every checkout — Linux containers fail"
echo "with 'set: pipefail: invalid option name'."
echo "Fix: ./scripts/check-blob-crlf.sh --fix   (git add --renormalize, review, commit)"
exit 1
