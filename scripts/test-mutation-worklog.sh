#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-worklog.sh — Mutation test do guard de integridade do
# worklog (scripts/check-worklog.mjs)
#
# Prova que o guard REALMENTE detecta a regressão que ele existe para
# bloquear: uma entrada do worklog.md sem o formato mínimo de auditoria
# (Task ID/Agent/Task/Work Log) ou com Task ID duplicado. Sem o guard, o
# worklog vira uma pilha de entradas sem contexto rastreável (quem/qual
# tarefa) e IDs duplicados quebram referências cruzadas entre threads.
#
#   CONTROLE:      fixture limpo (entrada completa) → guard exit 0
#   MUTAÇÃO A:     entrada sem "Agent:" → guard DEVE FALHAR (exit 1)
#   MUTAÇÃO B:     entrada sem "Task:" → guard DEVE FALHAR (exit 1)
#   MUTAÇÃO C:     entrada sem "Work Log:" → guard DEVE FALHAR (exit 1)
#   MUTAÇÃO D:     Task ID duplicado → guard DEVE FALHAR (exit 1)
#   MUTAÇÃO E:     entrada sem Task ID/Stage → guard DEVE FALHAR (exit 1)
#
# O script NÃO toca NENHUM arquivo do repo: o guard roda com --root num
# fixture temporário com o worklog.md mutado.
#
# Usage:
#   ./scripts/test-mutation-worklog.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com a mutação) OU infra ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-worklog.mjs"

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

# ── build_fixture: worklog.md íntegro (entrada completa + head de prosa) ──
build_fixture() {
  cat > "$TMP_DIR/worklog.md" <<'EOF'
# Severinno — Worklog

Prosa do head sem headers de entrada.

---

Task ID: TASK-1
Agent: buffy (test)
Task: Testar o guard de integridade.

Work Log:

- feito X.
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
echo "   🧪 SEVERINNO — MUTATION TEST (check-worklog deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture base + CONTROLE (formato completo → exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture limpo (entrada completa)..."
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
# STEP 3+4 — MUTAÇÃO A: entrada sem "Agent:"
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — entrada sem 'Agent:'..."
cat > "$TMP_DIR/worklog.md" <<'EOF'
# Worklog

---

Task ID: TASK-1
Task: Sem agent.

Work Log:

- feito.
EOF

info "STEP 4: Rodando guard contra a mutação A (sem Agent)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (Agent): passou com entrada sem 'Agent:'."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'sem "Agent:"'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a falta de Agent — veja acima."
  exit 1
fi
pass "Mutação A DETECTADA: guard citou 'sem Agent:' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B: entrada sem "Task:"
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — entrada sem 'Task:'..."
cat > "$TMP_DIR/worklog.md" <<'EOF'
# Worklog

---

Task ID: TASK-1
Agent: buffy (test)

Work Log:

- feito.
EOF

info "STEP 6: Rodando guard contra a mutação B (sem Task)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (Task): passou com entrada sem 'Task:'."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'sem "Task:"'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a falta de Task — veja acima."
  exit 1
fi
pass "Mutação B DETECTADA: guard citou 'sem Task:' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — MUTAÇÃO C: entrada sem "Work Log:"
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: Aplicando mutação C — entrada sem 'Work Log:'..."
cat > "$TMP_DIR/worklog.md" <<'EOF'
# Worklog

---

Task ID: TASK-1
Agent: buffy (test)
Task: Sem work log.
EOF

info "STEP 8: Rodando guard contra a mutação C (sem Work Log)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (Work Log): passou com entrada sem 'Work Log:'."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'sem "Work Log:"'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a falta de Work Log — veja acima."
  exit 1
fi
pass "Mutação C DETECTADA: guard citou 'sem Work Log:' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 9+10 — MUTAÇÃO D: Task ID duplicado
# ═════════════════════════════════════════════════════════════════════════

info "STEP 9: Aplicando mutação D — Task ID duplicado..."
cat > "$TMP_DIR/worklog.md" <<'EOF'
# Worklog

---

Task ID: DUP
Agent: buffy (test)
Task: Primeira.

Work Log:

- feito.

---

Task ID: DUP
Agent: buffy (test)
Task: Segunda.

Work Log:

- feito.
EOF

info "STEP 10: Rodando guard contra a mutação D (ID duplicado)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (dup): passou com Task ID 'DUP' em duas entradas."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "duplicado"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a duplicação — veja acima."
  exit 1
fi
pass "Mutação D DETECTADA: guard citou ID duplicado (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 11+12 — MUTAÇÃO E: entrada sem Task ID/Stage
# ═════════════════════════════════════════════════════════════════════════

info "STEP 11: Aplicando mutação E — entrada sem Task ID nem Stage..."
cat > "$TMP_DIR/worklog.md" <<'EOF'
# Worklog

---

Agent: buffy (test)
Task: Sem ID.

Work Log:

- feito.
EOF

info "STEP 12: Rodando guard contra a mutação E (sem ID)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (sem ID): passou com entrada sem Task ID/Stage."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'sem "Task ID:"'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a falta de Task ID — veja acima."
  exit 1
fi
pass "Mutação E DETECTADA: guard citou 'sem Task ID:' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard pega entrada sem Agent/Task/Work Log"
pass "(exit 1), Task ID duplicado (exit 1) e entrada sem Task ID/Stage"
pass "(exit 1) — o worklog nunca perde o mínimo auditável."
exit 0
