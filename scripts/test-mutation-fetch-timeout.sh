#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-fetch-timeout.sh — Mutation test do guard de hangs de
# fetch (check-fetch-timeout.mjs)
#
# Prova que o scripts/check-fetch-timeout.mjs REALMENTE detecta a regressão
# que ele existe para bloquear: um `fetch(` em src/ SEM signal de timeout
# (AbortSignal.timeout / envTimeoutSignal). Um serviço que aceita TCP mas
# nunca responde deixa o fetch pendente para sempre, travando o fluxo
# chamador (booking, logout, alertas, fetches do client).
#
#   CONTROLE:      fixture limpo (fetch com envTimeoutSignal) → guard exit 0
#   MUTAÇÃO A:     src/lib/bad.ts com `fetch("/api/leak")` (sem signal) →
#                  guard DEVE FALHAR (exit 1) citando bad.ts
#   MUTAÇÃO B:     src/lib/bad.ts com `fetch(url, { signal: controller.signal })`
#                  (AbortController MANUAL, que nunca aborta sozinho — a
#                  classe de bug do routing.ts pré-sweep) → guard DEVE FALHAR
#                  (exit 1): só AbortSignal.timeout/envTimeoutSignal contam
#   PROSA EXENTA:  docstring citando `fetch(` → guard DEVE PASSAR (exit 0) —
#                  menção documental não é fetch real
#   TESTE EXENTO:  src/lib/bad.test.ts com fetch sem signal → guard DEVE
#                  PASSAR (exit 0) — arquivos de teste são excluídos
#
# O script NÃO toca NENHUM arquivo do repo: o guard roda com --root num
# fixture temporário. (O próprio test-mutation-*.sh contém o padrão — o guard
# exclui *.test.*/__tests__ do scan; ver o docstring do check-fetch-timeout.mjs.)
#
# Usage:
#   ./scripts/test-mutation-fetch-timeout.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com a mutação) OU infra ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-fetch-timeout.mjs"

TMP_DIR="$(mktemp -d)"

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

# ── build_fixture: fixture limpo (fetch com envTimeoutSignal) ─────────────
build_fixture() {
  mkdir -p "$TMP_DIR/src/lib"
  cat > "$TMP_DIR/src/lib/client.ts" <<'EOF'
import { envTimeoutSignal } from "@/lib/fetch-timeout"

export async function call(url: string) {
  const res = await fetch(url, {
    method: "POST",
    signal: envTimeoutSignal("API_TIMEOUT_MS", 15_000),
  })
  return res.json()
}
EOF
}

# ── run_guard: roda o guard no fixture (--root) ───────────────────────────
run_guard() {
  set +e
  OUTPUT="$(node "$GUARD" --root "$TMP_DIR" 2>&1)"
  EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-fetch-timeout deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture base + CONTROLE (fetch com envTimeoutSignal → exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture limpo (fetch com envTimeoutSignal)..."
build_fixture

info "STEP 2: Controle — fixture limpo; guard deve PASS (exit 0)..."
run_guard
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $EXIT)."
  echo "$OUTPUT" | tail -10
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — fixture limpo passa no guard (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A (.ts): fetch sem signal
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — src/lib/bad.ts com fetch sem signal..."
cat > "$TMP_DIR/src/lib/bad.ts" <<'EOF'
export async function leak() {
  const res = await fetch("/api/leak")
  return res
}
EOF

info "STEP 4: Rodando guard contra a mutação A (fetch sem signal)..."
run_guard
echo "$OUTPUT" | tail -6

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (.ts): check-fetch-timeout passou com fetch sem signal"
  fail "em src/lib/bad.ts (exit 0). O guard não varre fetch( sem timeout."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "bad.ts"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou src/lib/bad.ts — veja o output acima."
  exit 1
fi
pass "Mutação A DETECTADA: guard falhou citando bad.ts (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B (.ts): signal de AbortController MANUAL (sem timeout)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — signal de AbortController manual (sem timeout)..."
cat > "$TMP_DIR/src/lib/bad.ts" <<'EOF'
export async function leak(url: string) {
  const controller = new AbortController()
  const res = await fetch(url, { signal: controller.signal })
  return res
}
EOF

info "STEP 6: Rodando guard contra a mutação B (signal manual, nunca aborta)..."
run_guard
echo "$OUTPUT" | tail -6

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (signal manual): passou com AbortController que NUNCA aborta"
  fail "(exit 0) — só AbortSignal.timeout/envTimeoutSignal fecham a classe de hangs."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "bad.ts"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou src/lib/bad.ts — veja o output acima."
  exit 1
fi
pass "Mutação B DETECTADA: guard rejeitou signal manual citando bad.ts (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — PROSA EXENTA (docstring): menção documental NÃO é fetch
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: Resetando fixture para limpo e aplicando docstring com menção a fetch( ..."
build_fixture
cat > "$TMP_DIR/src/lib/docs.ts" <<'EOF'
/**
 * Exemplo de uso antigo: `fetch("/api/x")` sem signal era um hang potencial.
 * Hoje todo fetch passa envTimeoutSignal.
 */
export const note = "fetch( sem timeout = classe de hangs"
EOF

info "STEP 8: Rodando guard contra a prosa exenta (docstring + string)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -ne 0 ]; then
  fail "PROSA EXENTA FALHOU: guard rejeitou menção documental (exit $EXIT)."
  fail "Comentários/strings citando fetch( não são chamadas reais."
  echo "$OUTPUT" | tail -10
  exit 1
fi
pass "Prosa exenta OK: docstring citando fetch( passa (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 9+10 — TESTE EXENTO (.test.ts): mocks de fetch não precisam de signal
# ═════════════════════════════════════════════════════════════════════════

info "STEP 9: Aplicando arquivo de teste com fetch sem signal (deve ser excluído)..."
cat > "$TMP_DIR/src/lib/client.test.ts" <<'EOF'
import { vi } from "vitest"
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }))
EOF

info "STEP 10: Rodando guard contra o arquivo de teste..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -ne 0 ]; then
  fail "TESTE EXENTO FALHOU: guard rejeitou arquivo de teste (exit $EXIT)."
  echo "$OUTPUT" | tail -10
  exit 1
fi
pass "Teste exento OK: *.test.ts com mock de fetch passa (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard pega fetch sem signal (exit 1),"
pass "pega signal MANUAL de AbortController (exit 1), e passa com prosa"
pass "documental e arquivos de teste (exit 0)"
exit 0
