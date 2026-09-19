#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-jsdom-baseline.sh — Mutation test do guard de drift
# da suíte jsdom de componentes (check-jsdom-baseline.mjs)
#
# Prova que o scripts/check-jsdom-baseline.mjs REALMENTE detecta as DUAS
# direções de regressão que ele existe para bloquear:
#
#   Cenário A (ARQUIVO NOVO):  um arquivo de teste que NÃO está no baseline
#                              passa a falhar — o guard exige FALHA (exit 1)
#                              com a mensagem 'NOVO arquivo falhando'.
#   Cenário B (CRESCIMENTO):   o count de falhas de um arquivo JÁ no baseline
#                              CRESCE (1 → 3) — o guard exige FALHA (exit 1)
#                              com a mensagem 'Crescimento'.
#
# E o CONTROLE: o mesmo run de resultados SEM drift passa (exit 0) — provando
# que a falha vem da MUTAÇÃO, não de um fixture quebrado.
#
# DIFERENÇA vs mutation-seed-dev-e2e: aqui o fixture é criado do zero num
# mktemp e o guard roda em modo --results-file (lê o JSON do vitest de um
# FIXTURE em vez de spawnar a suíte real ~6 min — o mesmo modo que os testes
# unitários usam). O script não toca NENHUM arquivo do repositório real.
#
# Pipeline:
#   1. Cria temp dir com o fixture de resultados (--results-file) — shape
#      jest-like do reporter do vitest (testResults[].assertionResults[].status)
#   2. CONTROLE: --update gera o baseline; run limpo → exit 0 ('nenhum drift')
#   3. MUTAÇÃO A: suite NOVO (zz.test.tsx) falhando → guard DEVE FALHAR
#   4. MUTAÇÃO B: b.test.tsx com 3 falhas (baseline 1) → guard DEVE FALHAR
#   5. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-jsdom-baseline.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com alguma mutação) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-jsdom-baseline.mjs"

TMP_DIR="$(mktemp -d)"
RESULTS="$TMP_DIR/results.json"
BASELINE="$TMP_DIR/baseline.json"

# ── Asserções esperadas (mensagens do guard quando detecta as mutações) ──
# Fonte: scripts/check-jsdom-baseline.mjs (main):
#   novo         → '• NOVO arquivo falhando: <file> (N teste(s))'
#   crescimento  → '• Crescimento: <file> (N → M)'
#
# ⚠️ Source-coupled: estas strings reproduzem a mensagem EXATA do guard. Se
# a mensagem for reformulada em scripts/check-jsdom-baseline.mjs, o mutation
# test falha com 'não pela asserção esperada' (não é guard cego — é o
# esperado por acoplamento; atualizar as duas juntas).
EXPECTED_NEW="NOVO arquivo falhando"
EXPECTED_GROWTH="Crescimento"
EXPECTED_FILE_NEW="zz.test.tsx"
EXPECTED_FILE_GROWTH="b.test.tsx"

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Cleanup (trap EXIT — SEMPRE remove o temp, mesmo com falha) ──────────
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── build_results: (re)escreve o fixture de resultados do vitest ─────────
# Shape jest-like do --reporter=json do vitest (o que o guard parseia):
# testResults[] com name (arquivo), status, assertionResults[].status.
# Fixture base: a.test.tsx (1 falha) + b.test.tsx (1 falha) + c.test.tsx (pass).
build_results() {
  cat > "$RESULTS" <<'EOF'
{"numTotalTests": 3, "testResults": [
  {"name": "/repo/src/components/a.test.tsx", "status": "failed", "assertionResults": [{"status": "failed", "fullName": "a renders"}, {"status": "passed", "fullName": "a clicks"}]},
  {"name": "/repo/src/components/b.test.tsx", "status": "failed", "assertionResults": [{"status": "failed", "fullName": "b renders"}]},
  {"name": "/repo/src/components/c.test.tsx", "status": "passed", "assertionResults": [{"status": "passed", "fullName": "c renders"}]}
]}
EOF
}

# ── run_guard: roda o guard no temp dir (cwd = temp — paths relativos) ──
run_guard() {
  set +e
  OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" --baseline baseline.json --results-file results.json 2>&1)"
  EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-jsdom-baseline deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture + CONTROLE (run limpo → exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture de resultados do vitest em $TMP_DIR..."

build_results

info "STEP 2: Controle — --update gera o baseline; run limpo deve PASS (exit 0)..."

set +e
UPDATE_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" --baseline baseline.json --results-file results.json --update 2>&1)"
UPDATE_EXIT=$?
set -e

if [ "$UPDATE_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: --update não gerou o baseline (exit $UPDATE_EXIT)."
  echo "$UPDATE_OUTPUT" | tail -10
  exit 1
fi
if [ ! -f "$BASELINE" ]; then
  fail "CONTROLE FALHOU: baseline.json não foi criado pelo --update."
  exit 1
fi

run_guard
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o run LIMPO (exit $EXIT)."
  echo "$OUTPUT" | tail -10
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — run limpo passa no guard (exit 0, baseline com 2 falhas)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A (arquivo NOVO falhando): deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — suite zz.test.tsx NOVO falhando..."

cat > "$RESULTS" <<'EOF'
{"numTotalTests": 4, "testResults": [
  {"name": "/repo/src/components/a.test.tsx", "status": "failed", "assertionResults": [{"status": "failed", "fullName": "a renders"}]},
  {"name": "/repo/src/components/b.test.tsx", "status": "failed", "assertionResults": [{"status": "failed", "fullName": "b renders"}]},
  {"name": "/repo/src/components/zz.test.tsx", "status": "failed", "assertionResults": [{"status": "failed", "fullName": "zz renders"}]}
]}
EOF

info "STEP 4: Rodando guard contra a mutação A (novo arquivo)..."
run_guard
echo "$OUTPUT" | tail -8

# Caso 1 — guard CEGO: PASS com a mutação. O findDrift foi removido/
# enfraquecido. Este é o cenário que o mutation test existe para BLOQUEAR.
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (novo arquivo): check-jsdom-baseline passou com suite NOVO"
  fail "falhando (exit 0). Verifique se findDrift ainda acusa arquivo fora"
  fail "do baseline em scripts/check-jsdom-baseline.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
if ! grep -Fq "$EXPECTED_NEW" <<<"$OUTPUT" || ! grep -Fq "$EXPECTED_FILE_NEW" <<<"$OUTPUT"; then
  fail "Guard falhou (exit $EXIT) mas NÃO pela asserção esperada:"
  fail "  esperava (mensagem): $EXPECTED_NEW"
  fail "  esperava (arquivo):  $EXPECTED_FILE_NEW"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

pass "Mutação A DETECTADA: guard falhou com '❌ $EXPECTED_NEW' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B (crescimento 1 → 3): deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — b.test.tsx com 3 falhas (baseline 1)..."

cat > "$RESULTS" <<'EOF'
{"numTotalTests": 4, "testResults": [
  {"name": "/repo/src/components/a.test.tsx", "status": "failed", "assertionResults": [{"status": "failed", "fullName": "a renders"}]},
  {"name": "/repo/src/components/b.test.tsx", "status": "failed", "assertionResults": [{"status": "failed", "fullName": "b one"}, {"status": "failed", "fullName": "b two"}, {"status": "failed", "fullName": "b three"}]}
]}
EOF

info "STEP 6: Rodando guard contra a mutação B (crescimento)..."
run_guard
echo "$OUTPUT" | tail -8

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (crescimento): check-jsdom-baseline passou com count de"
  fail "b.test.tsx crescendo 1 → 3 (exit 0). Verifique se findDrift ainda"
  fail "acusa count acima do baseline em scripts/check-jsdom-baseline.mjs."
  exit 1
fi

if ! grep -Fq "$EXPECTED_GROWTH" <<<"$OUTPUT" || ! grep -Fq "$EXPECTED_FILE_GROWTH" <<<"$OUTPUT"; then
  fail "Guard falhou (exit $EXIT) mas NÃO pela asserção esperada:"
  fail "  esperava (mensagem): $EXPECTED_GROWTH"
  fail "  esperava (arquivo):  $EXPECTED_FILE_GROWTH"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

pass "Mutação B DETECTADA: guard falhou com '❌ $EXPECTED_GROWTH' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de drift jsdom pega arquivo NOVO falhando"
pass "e CRESCIMENTO de count (controle limpo passa; ambas as mutações falham)"
exit 0
