#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-mutation-count.sh — Mutation test do COUNT GUARD
# (check-mutation-count.mjs — nº de sub-tests do master)
#
# Prova que o guard de drift de counts REALMENTE falha nas regressões que ele
# existe para bloquear — o bug que aconteceu de verdade (12→13 em 08/2026,
# corrigido à mão em 5+ lugares): alguém adiciona um sub-test na matriz do
# master e NÃO atualiza o pr-check.yml e o README.
#
#   Cenário A (JOB NAME):   adiciona 1 sub-test na matriz (14) mas o name do
#                           job mutation-guards fica "(13 node-pure...)" → o
#                           guard DEVE FALHAR (exit 1) citando o name.
#   Cenário B (SUMMARY):    o summary fica "All 13..." com matriz 14 → DEVE
#                           FALHAR citando o summary.
#   Cenário C (README):     o README fica com "13 sub-tests" e a matriz vira
#                           14 → DEVE FALHAR citando README.md:linha.
#   Cenário D (HISTÓRICA):  ref histórica "era de 5 sub-tests" no README NÃO
#                           pode falhar o guard (a matriz segue 13) → CONTROLE.
#   CONTROLE:               fixture consistente (matriz 13 + refs 13) → exit 0.
#
# DIFERENÇA vs os demais mutation tests: aqui o guard é executado com --root
# contra um FIXTURE MINIMAL (não o repo real) — o guard lê só 3 arquivos
# (scripts/test-mutation-guards.sh, .github/workflows/pr-check.yml,
# README.md), então o fixture replica esses 3 com a matriz e as refs.
#
# Pipeline:
#   1. Cria fixture consistente (matriz 13 + refs 13 em pr-check/README)
#   2. CONTROLE: guard --root fixture → exit 0
#   3. MUTAÇÃO A: matriz 14 (name 13) → guard DEVE FALHAR (exit 1) citando name
#   4. MUTAÇÃO B: matriz 14 (summary 13) → guard DEVE FALHAR citando summary
#   5. MUTAÇÃO C: matriz 14 (README 13) → guard DEVE FALHAR citando README.md
#   6. CONTROLE D: ref histórica "era de 5" com matriz 13 → exit 0 (não-falso-positivo)
#   7. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-mutation-count.sh
#
# Exit codes:
#   0 — mutações DETECTADAS + controles passam ✅
#   1 — guard CEGO (alguma mutação passou) OU controle falso-positivo ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="node $SCRIPT_DIR/scripts/check-mutation-count.mjs --root"

TMP_DIR="$(mktemp -d)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Cleanup (trap EXIT) ────────────────────────────────────────────────────
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── make_fixture: cria os 3 arquivos que o guard lê ───────────────────────
# $1 = count da matriz | $2 = count do job name | $3 = count do summary
# $4 = count do README | $5 = (opcional) ref histórica extra no README
make_fixture() {
  local matrix_count="$1" job_name="$2" summary="$3" readme_count="$4"
  local historical="${5:-}"

  rm -rf "$TMP_DIR/scripts" "$TMP_DIR/.github" "$TMP_DIR/README.md"
  mkdir -p "$TMP_DIR/scripts" "$TMP_DIR/.github/workflows"

  # master com a matriz
  {
    echo '#!/usr/bin/env bash'
    echo "# Roda os $matrix_count mutation tests node-puro dos guards de CI num ÚNICO script"
    echo 'SUBTESTS=('
    for i in $(seq 1 "$matrix_count"); do
      echo "  \"sub-$i|Desc $i|scripts/test-mutation-sub-$i.sh\""
    done
    echo ')'
  } > "$TMP_DIR/scripts/test-mutation-guards.sh"

  # pr-check.yml com o job mutation-guards
  {
    echo "# Roda os $matrix_count mutation tests node-puro dos guards de CI num JOB SÓ via"
    echo 'jobs:'
    echo '  mutation-guards:'
    echo "    name: Mutation guards master ($job_name node-pure mutation tests)"
    echo '    steps:'
    echo '      - run: bash scripts/test-mutation-guards.sh'
    echo '      - name: Summary'
    echo "        run: echo \"✅ All $summary node-pure mutation tests passed (...).\""
  } > "$TMP_DIR/.github/workflows/pr-check.yml"

  # README.md
  {
    echo "# Repo"
    echo "**$readme_count sub-tests node-puro** via \`scripts/test-mutation-guards.sh\`"
    echo "| master \`mutation-guards\` ($readme_count sub-tests) | x |"
    if [ -n "$historical" ]; then
      echo "era de $historical sub-tests e o timing-budget foi adicionado após a medição de $historical."
    fi
  } > "$TMP_DIR/README.md"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-mutation-count deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture consistente (matriz 13 + refs 13) → CONTROLE exit 0
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture consistente (matriz 13 + refs 13)..."
make_fixture 13 13 13 13

info "STEP 2: Controle — guard contra fixture consistente deve PASS (exit 0)..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU (exit $EXIT): fixture consistente foi rejeitado."
  echo "$OUTPUT" | tail -5
  exit 1
fi
pass "Controle OK — fixture consistente passa (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A (job name stale): matriz 14, name 13 → DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: MUTAÇÃO A — adiciona 1 sub-test na matriz (14) sem tocar o name (13)..."
make_fixture 14 13 13 13

info "STEP 4: Rodando o guard contra a mutação A..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (name): matriz 14 com name do job 13 passou (exit 0)."
  exit 1
fi
if ! grep -Fq "name do job" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO citou o name do job."
  exit 1
fi
pass "Mutação A DETECTADA: guard falhou citando o name do job (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B (summary stale): matriz 14, summary 13 → DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: MUTAÇÃO B — matriz 14 com summary 13 (e name 14 para isolar)..."
make_fixture 14 14 13 13

info "STEP 6: Rodando o guard contra a mutação B..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (summary): matriz 14 com summary 13 passou (exit 0)."
  exit 1
fi
if ! grep -Fq "summary" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO citou o summary."
  exit 1
fi
pass "Mutação B DETECTADA: guard falhou citando o summary (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — MUTAÇÃO C (README stale): matriz 14, README 13 → DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: MUTAÇÃO C — matriz 14 com README 13 (e pr-check 14 para isolar)..."
make_fixture 14 14 14 13

info "STEP 8: Rodando o guard contra a mutação C..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (README): matriz 14 com README 13 passou (exit 0)."
  exit 1
fi
if ! grep -Fq "README.md:" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO citou o README.md com linha."
  exit 1
fi
pass "Mutação C DETECTADA: guard falhou citando README.md:linha (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 9+10 — CONTROLE D (ref histórica): "era de 5" com matriz 13 → exit 0
# ═════════════════════════════════════════════════════════════════════════

info "STEP 9: CONTROLE D — ref HISTÓRICA 'era de 5 sub-tests' com matriz 13..."
make_fixture 13 13 13 13 "5"

info "STEP 10: Guard contra o fixture com ref histórica..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e

if [ "$EXIT" -ne 0 ]; then
  fail "FALSO POSITIVO: ref histórica 'era de 5 sub-tests' fez o guard falhar"
  fail "(exit $EXIT) com matriz 13 consistente."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Controle D OK — ref histórica é ignorada (exit 0, sem falso positivo)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — check-mutation-count pega drift de count no"
pass "job name, no summary e no README (todos exit 1) + não falso-positiva"
pass "em refs históricas."
exit 0
