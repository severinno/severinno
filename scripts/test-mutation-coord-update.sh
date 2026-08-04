#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-coord-update.sh — Mutation test do contrato de
# atualização COORDENADA dos counts de seed (workflows ↔ anchor do teste)
#
# Prova que o seed-e2e-count.test.ts REALMENTE pega o cenário exato do bug
# histórico: atualizar SÓ os comentários dos workflows (128→N) sem tocar a
# âncora do teste. A mutação generaliza os literais documentados dos
# SCAN_FILES (check-e2e-counts.mjs): "128 checks" → "N checks" e o ternary
# da matrix ('128' → 'N') — simulando um dev que "limpa a doc" por conta
# própria — e exige que o seed-e2e-count.test.ts FALHE pela asserção certa.
#
# Por que falha: o teste de integração "deriveExpectedChecks reproduz os
# counts documentados" lê os SCAN_FILES via extractDocumentedCounts e o
# "piso de sites documentados por alvo" (prod ≥ 8, dev ≥ 6) falha quando os
# sites de prod somem da extração. A âncora de valor (sanidade prod=128)
# NÃO muda (a derivação é do código, não da doc) — o que quebra é o
# vínculo doc↔derivação, exatamente o contrato que o incidente 123/128
# expôs. Se o teste PASSAR com a doc generalizada (exit 0), o guard está
# CEGO — a atualização unilateral passaria no CI — e o script falha (1).
#
# Pipeline (in-place + trap, padrão do test-mutation-seed-dev-e2e.sh):
#   1. CONTROLE — vitest no seed-e2e-count.test.ts com o repo REAL → deve
#      PASSAR (exit 0), provando que o fixture/comando base é válido;
#   2. Backup dos SCAN_FILES + mutação (sed) + verificação de que aplicou;
#   3. MUTAÇÃO — vitest de novo → deve FALHAR (exit != 0) com a mensagem
#      do piso (prodSites < 8) — prova end-to-end, não unitária;
#   4. Restaurar os arquivos do backup (trap EXIT — cp, NUNCA git checkout).
#
# O script roda vitest REAL (precisa de node_modules — job dedicado com
# bun install no CI, NÃO vai na matriz node-pura do master mutation-guards).
#
# Usage:
#   ./scripts/test-mutation-coord-update.sh
#
# Exit codes:
#   0 — mutação DETECTADA (controle passou + teste falhou pelo piso) ✅
#   1 — guard CEGO (teste passou com doc mutada) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

# Os MESMOS arquivos que o check-e2e-counts.mjs escaneia (SCAN_FILES) — a
# mutação ataca exatamente onde a doc vive. Fonte única da lista: o guard.
SCAN_FILES=(
  ".github/workflows/pr-check.yml"
  ".github/workflows/seed-guards.yml"
  "scripts/validate-seed-guards-matrix-local.sh"
)

TEST_FILE="src/lib/__tests__/seed-e2e-count.test.ts"
VITEST_CMD=(bun x vitest run --config vitest.config.unit.ts "$TEST_FILE")

BACKUP_DIR="$(mktemp -d)"

# ── Mutação: 128→N nos literais documentados (sed in-place) ───────────────
# 1. "128 checks" → "N checks"  (comentários/echos: prod E2E, test-seed-*-e2e.ts)
# 2. ternary '128' → 'N'        (matrix summary do seed-guards.yml — o site
#    do ternary prod morre; o dev ('162') fica, isolando a falha em prod)
MUTATION_SED=(
  "s/128 checks/N checks/g"
  "s/'128'/'N'/g"
)

# Asserção que o teste DEVE emitir quando a mutação é detectada (piso prod).
# Fonte: src/lib/__tests__/seed-e2e-count.test.ts — describe
# "deriveExpectedChecks reproduz os counts documentados": o teste do piso
# falha com "piso prod violado: esperado ≥ 8 sites documentados..."
EXPECTED_FAILURE="piso prod violado"

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Restore handler (trap EXIT — SEMPRE restaura, mesmo com falha) ──────
# cp do backup (nunca `git checkout --`) para não descartar edições locais
# não-commitadas do dev que rodar o script na própria máquina. Guard `-f`:
# só restaura backups que o cp realmente criou (falha ANTES do backup não
# sobrescreve nada).
restore_files() {
  for i in "${!SCAN_FILES[@]}"; do
    local backup="$BACKUP_DIR/$i"
    local target="${SCAN_FILES[$i]}"
    if [ -f "$backup" ] && [ -f "$target" ]; then
      cp "$backup" "$target"
      echo "  ↻ $target restaurado do backup"
    fi
  done
  rm -rf "$BACKUP_DIR"
}
trap restore_files EXIT

# ── run_vitest: roda o teste e captura output/exit ───────────────────────
run_vitest() {
  set +e
  VITEST_OUTPUT="$("${VITEST_CMD[@]}" 2>&1)"
  VITEST_EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (contrato de atualização coordenada)"
echo "   Mutação: doc dos workflows 128→N (anchor do teste INTOCADO)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1 — CONTROLE: repo real → o teste DEVE passar
# ═════════════════════════════════════════════════════════════════════════

info "CONTROLE — seed-e2e-count.test.ts no repo REAL (exit 0 esperado)..."
run_vitest
echo "$VITEST_OUTPUT" | tail -4

if [ "$VITEST_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: seed-e2e-count.test.ts saiu com exit $VITEST_EXIT no repo real."
  fail "O fixture/comando base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — teste passa no repo real (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 2 — Backup + mutação da doc (128→N) nos SCAN_FILES
# ═════════════════════════════════════════════════════════════════════════

info "STEP 2: backup + mutação 128→N nos SCAN_FILES..."

for i in "${!SCAN_FILES[@]}"; do
  cp "${SCAN_FILES[$i]}" "$BACKUP_DIR/$i"
done

# Fail-fast: se o padrão não existir (doc refatorada), o sed vira no-op
# silencioso → o teste passaria e o script acusaria "guard cego" sendo que
# o problema é o padrão do mutation test. Pare com mensagem clara.
if ! grep -Fq "128 checks" "${SCAN_FILES[@]}"; then
  fail "Padrão '128 checks' não encontrado nos SCAN_FILES."
  fail "A doc dos workflows mudou? Atualize MUTATION_SED neste script."
  exit 1
fi

for file in "${SCAN_FILES[@]}"; do
  for pat in "${MUTATION_SED[@]}"; do
    sed -i "$pat" "$file"
  done
done

# Verifica que a mutação realmente aplicou (novo presente + antigo ausente).
if grep -Fq "N checks" "${SCAN_FILES[@]}" && ! grep -Fq "128 checks" "${SCAN_FILES[@]}"; then
  pass "Mutação aplicada: '128 checks' → 'N checks' (anchor do teste intocado)"
else
  fail "Mutação não aplicou corretamente (sed falhou?)."
  exit 1
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 3 — MUTAÇÃO: o teste DEVE falhar pelo piso de sites documentados
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: seed-e2e-count.test.ts com a doc MUTADA (falha esperada)..."
run_vitest
echo "$VITEST_OUTPUT" | tail -12

# Caso 1 — guard CEGO: o teste PASSOU com a doc mutada. A atualização
# unilateral 128→N não foi detectada — exatamente a regressão que este
# cenário existe para bloquear.
if [ "$VITEST_EXIT" -eq 0 ]; then
  fail "GUARD CEGO: seed-e2e-count.test.ts passou (exit 0) com a doc 128→N."
  fail "Um PR que atualizasse SÓ os comentários dos workflows passaria no CI."
  fail "O contrato de atualização coordenada não está enforced."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (infra/schema/quebra
# diferente da mutação). Não dá para confirmar que o guard pega ESTA
# regressão → falha com diagnóstico claro.
if ! echo "$VITEST_OUTPUT" | grep -Fq "$EXPECTED_FAILURE"; then
  fail "Teste falhou (exit $VITEST_EXIT) mas NÃO pela asserção esperada:"
  fail "  esperava:  $EXPECTED_FAILURE"
  fail "Falha pode ser infra/outra asserção — veja o output acima."
  exit 1
fi

# Caso 3 — ✅ mutação detectada: o teste falhou com a mensagem do piso.
pass "Mutação DETECTADA: teste falhou com '$EXPECTED_FAILURE' (exit $VITEST_EXIT)"
pass "O contrato de atualização coordenada está enforced — doc 128→N sozinha"
pass "não passa: o seed-e2e-count.test.ts trava o PR até a doc e o anchor"
pass "serem atualizados juntos."

# ═════════════════════════════════════════════════════════════════════════
# Result (restore roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o seed-e2e-count.test.ts pega o cenário exato do bug:"
pass "  • controle: teste passa no repo real (exit 0)"
pass "  • mutação: doc dos workflows 128→N → teste FALHA com '$EXPECTED_FAILURE'"
pass "  • anchor do teste NUNCA foi tocado (a derivação é do código)"
pass "Os SCAN_FILES foram restaurados do backup (real intocado)."
exit 0
