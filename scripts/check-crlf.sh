#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-crlf.sh — fail if any tracked .sh/.bash file has CRLF in the working
# tree
#
# WHY: Git Bash (MSYS) tolerates CRLF line endings in shell scripts, but
# Linux containers (act, GitHub Actions ubuntu runners) do NOT:
# `set -euo pipefail` fails with "pipefail: invalid option name". On
# Windows, `core.autocrlf=true` + a checkout that predates .gitattributes
# leaves every .sh with CRLF in the working tree — silently breaking every
# shell job in CI. The act/CI container copies the working tree, so the
# WORKING TREE is exactly what must be validated.
#
# Detection delegates to scripts/check_crlf.py (raw byte reads) because
# `grep -q $'\r'` does NOT work on Git Bash/MSYS: MSYS strips CR before grep
# sees it, so CRLF goes undetected exactly where the bug happens.
#
# This guard complements check-utf8.sh (encoding) and runs in the same CI
# workflow (.github/workflows/utf8-check.yml) plus the pre-commit hook.
#
# ESCOPO INTENCIONAL (.sh/.bash apenas — NÃO estender para .ts/.tsx):
#   - .sh/.bash: CRLF quebra bash em containers Linux (act/CI) — o working
#     tree é copiado para o container, então o CRLF no disco vira falha
#     funcional (`set: pipefail: invalid option name`). Guard necessário.
#   - .ts/.tsx: CRLF NÃO quebra nada (tsc/next/bun/vitest aceitam CRLF); os
#     blobs são 100% LF (`.gitattributes` `*.ts text eol=lf` força LF no
#     checkout e no commit — fato invariante); prettier (endOfLine: lf) +
#     lint-staged normalizam no commit; e o git NÃO enxerga o CRLF do working
#     tree (ex.: num checkout Windows pré-normalização, a maioria dos .ts
#     aparece w/crlf no disco enquanto o git status não os marca — o clean
#     filter normaliza na comparação). Um guard de working tree para .ts/.tsx
#     falharia em CADA checkout Windows sem proteger nada — ruído puro. O
#     artefato de checkout é corrigido uma vez com ./scripts/normalize-crlf.sh
#     (já cobre .ts/.md).
#
# Usage:
#   ./scripts/check-crlf.sh              # check; exit 1 on any CRLF found
#   ./scripts/check-crlf.sh --ci         # same (explicit CI mode)
#   ./scripts/check-crlf.sh --fix        # rewrite CRLF -> LF in place
#
# Env: CHECK_CRLF_ROOT — optional repo root override (used by tests).
#
# Exit codes: 0 = clean, 1 = CRLF found, 2 = error (no git / bad usage)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_SCRIPT="$SCRIPT_DIR/check_crlf.py"

MODE="check"
for arg in "$@"; do
  case "$arg" in
    --ci) MODE="check" ;;
    --fix) MODE="fix" ;;
    -h | --help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "check-crlf: unknown argument: $arg" >&2
      echo "Usage: $0 [--ci] [--fix]" >&2
      exit 2
      ;;
  esac
done

if [ ! -f "$PY_SCRIPT" ]; then
  echo "check-crlf: ERROR: $PY_SCRIPT not found" >&2
  exit 2
fi

if command -v python3 >/dev/null 2>&1 && python3 -c "import sys" >/dev/null 2>&1; then
  PY="python3"
elif command -v python >/dev/null 2>&1 && python -c "import sys" >/dev/null 2>&1; then
  PY="python"
elif [ -f "$SCRIPT_DIR/check_crlf.mjs" ]; then
  PY="node"
  PY_SCRIPT="$SCRIPT_DIR/check_crlf.mjs"
else
  echo "check-crlf: ERROR: python or node is required" >&2
  exit 2
fi

ROOT="${CHECK_CRLF_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "check-crlf: not inside a git work tree" >&2
  exit 2
fi

mapfile -t FILES < <(git ls-files '*.sh' '*.bash')
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "check-crlf: no tracked .sh/.bash files — nothing to check"
  exit 0
fi

if [ "$MODE" = "fix" ]; then
  mapfile -t CRLF_FILES < <("$PY" "$PY_SCRIPT" --fix "${FILES[@]}" || true)
  if [ "${#CRLF_FILES[@]}" -gt 0 ]; then
    printf '  fixed: %s\n' "${CRLF_FILES[@]}"
    echo "check-crlf: done. Run 'git add --renormalize' to sync the index stat cache."
  else
    echo "check-crlf: OK — all tracked shell scripts use LF line endings"
  fi
  exit 0
fi

mapfile -t CRLF_FILES < <("$PY" "$PY_SCRIPT" "${FILES[@]}" || true)
if [ "${#CRLF_FILES[@]}" -eq 0 ]; then
  echo "check-crlf: OK — all tracked shell scripts use LF line endings"
  exit 0
fi

echo "check-crlf: FAILED — CRLF line endings in tracked shell scripts:"
printf '  - %s\n' "${CRLF_FILES[@]}"
echo ""
echo "These break bash in Linux containers ('set: pipefail: invalid option name')."
echo "Fix: ./scripts/check-crlf.sh --fix   (then git add --renormalize)"
exit 1
