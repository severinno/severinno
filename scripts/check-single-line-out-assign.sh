#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-single-line-out-assign.sh — fail if a tracked .sh/.bash file under
# scripts/ has the pattern `command "..." out=$(...)` on a SINGLE line
#
# WHY: `out=$(...)` at the START of a command is an assignment, but when it
# appears AFTER a command + quoted argument on the same line it becomes a
# POSITIONAL ARGUMENT — `out` is never set and `$?` captures the wrong
# command, so the script silently breaks while looking correct. In
# validate-seed-guards-matrix-local.sh this pattern would have been a FALSE
# POSITIVE: the E2E count string ("128 checks") still appears in the output,
# so check-e2e-counts.mjs passes, while the actual `out` capture and the
# exit-code check are dead code. The correct form is TWO lines:
#
#     cell "Rodando prod E2E (128 checks)..."
#     out=$(cd "$SCRIPT_DIR" && ... 2>&1)
#
# Detection uses plain grep -E (files are LF-enforced by the CRLF guards, so
# MSYS grep text-mode is safe here). Scope: tracked .sh/.bash under scripts/
# (recursive) — the same tree where the count/echo helpers live.
#
# LIMITAÇÃO (intencional): só detecta o padrão numa ÚNICA linha. A variante
# multilinha `cmd "msg" out=$(\n ... \n)` escapa (o regex exige o `)` na
# mesma linha) — fora do escopo pedido, mas o bug de atribuição-posicional é
# o mesmo; se um dia aparecer, ampliar o regex é o primeiro lugar a olhar.
#
# Usage:
#   ./scripts/check-single-line-out-assign.sh       # check; exit 1 on hit
#   ./scripts/check-single-line-out-assign.sh --ci  # same (explicit CI mode)
#
# Env: CHECK_SINGLE_LINE_ROOT — optional repo root override (used by tests).
#
# Exit codes: 0 = clean, 1 = pattern found, 2 = error (no git / bad usage)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for arg in "$@"; do
  case "$arg" in
    --ci) ;; # modo explícito de CI = mesmo comportamento default
    -h | --help)
      awk 'NR >= 2 && /^set -euo pipefail$/ { exit } NR >= 2 { print }' "$0"
      exit 0
      ;;
    *)
      echo "check-single-line-out-assign: unknown argument: $arg" >&2
      echo "Usage: $0 [--ci]" >&2
      exit 2
      ;;
  esac
done

ROOT="${CHECK_SINGLE_LINE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "check-single-line-out-assign: not inside a git work tree" >&2
  exit 2
fi

# Tracked .sh/.bash sob scripts/ (recursivo) — `git ls-files scripts/` +
# filtro de extensão evita subtilezas de pathspec com **.
mapfile -t FILES < <(git ls-files 'scripts/' | grep -E '\.(sh|bash)$' || true)
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "check-single-line-out-assign: no tracked .sh/.bash under scripts/ — nothing to check"
  exit 0
fi

# Comando, string entre aspas e `out=$(` na MESMA linha. O regex exige um
# argumento QUOTADO entre o comando e o `out=` — separa o caso quebrado
# (argumento posicional) do legítimo `out=$(...)` isolado ou `if out=$(...)`.
PATTERN='^[[:space:]]*[[:alnum:]_]+[[:space:]]+"[^"]*"[[:space:]]+out=\$\([^)]*\)'

# UM único grep para TODOS os arquivos (em vez de um grep por arquivo — o
# loop antigo spawnava 43 processos grep no MSYS/Git Bash e custava ~3.4s;
# a versão unificada leva ~0.6s no tempo real do script, ~5-6x mais rápido —
# 40% do overhead do hook eliminado). `--` separa o padrão dos arquivos
# (paths que começam com `-` não viram opção). O output `arquivo:linha:
# conteúdo` é idêntico ao do loop anterior.
mapfile -t VIOLATIONS < <(grep -nHE -- "$PATTERN" "${FILES[@]}" 2>/dev/null || true)

if [ "${#VIOLATIONS[@]}" -eq 0 ]; then
  echo "check-single-line-out-assign: OK — no single-line 'cmd \"...\" out=\$(...)' in scripts/"
  exit 0
fi

echo "check-single-line-out-assign: FAILED — 'comando \"...\" out=\$(...)' na MESMA linha:"
printf '  - %s\n' "${VIOLATIONS[@]}"
echo ""
echo "Numa linha, o 'out=' vira ARGUMENTO POSICIONAL do comando (não atribuição):"
echo "  'out' nunca é setado e '\$?' captura o comando errado — o script quebra"
echo "  silenciosamente enquanto o count de checks na string ainda passa no"
echo "  check-e2e-counts.mjs (falso positivo)."
echo "Correto (duas linhas):"
echo '    cell "Rodando prod E2E (N checks)..."'
echo '    out=$(cd "$SCRIPT_DIR" && ... 2>&1)'
exit 1
