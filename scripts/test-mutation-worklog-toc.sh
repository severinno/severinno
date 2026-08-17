#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-worklog-toc.sh — Mutation test do guard de sincronia
# do índice (TOC) do worklog (scripts/check-worklog-toc.mjs)
#
# Prova que o guard REALMENTE detecta a regressão que ele existe para
# bloquear: uma entrada nova do worklog.md sem linha no índice, um link do
# índice apontando para âncora inexistente, um slug errado, ou uma linha
# stale apontando para entrada que não existe mais. Sem o guard, o índice
# vira navegação manual quebrada silenciosamente.
#
#   CONTROLE:      fixture limpo (TOC sincronizado) → guard exit 0
#   MUTAÇÃO A:     entrada sem linha no índice (reverse) → guard DEVE FALHAR
#   MUTAÇÃO B:     link do índice sem âncora (forward) → guard DEVE FALHAR
#   MUTAÇÃO C:     âncora com slug errado (anchor) → guard DEVE FALHAR
#   MUTAÇÃO D:     linha stale (ID sem entrada) → guard DEVE FALHAR
#   MUTAÇÃO E:     linha do índice sem resumo (empty-summary) → guard DEVE
#                  FALHAR (o resumo é requisito do usuário — não só âncora)
#   MUTAÇÃO F:     entradas coladas sem separador '---' (glued) → guard DEVE
#                  FALHAR (a regressão que o reparo da task corrigiu)
#
# O script NÃO toca NENHUM arquivo do repo: o guard roda com --root num
# fixture temporário com o worklog.md mutado.
#
# Usage:
#   ./scripts/test-mutation-worklog-toc.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com a mutação) OU infra ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-worklog-toc.mjs"

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

# ── build_fixture: worklog.md com TOC sincronizado (linha + âncora + resumo) ──
build_fixture() {
  cat > "$TMP_DIR/worklog.md" <<'EOF'
# Severinno — Worklog

## Índice de Task IDs

- [TASK-1](#task-1) — Testar o guard de TOC.

---

Task ID: TASK-1
<a id="task-1"></a>
Agent: buffy (test)
Task: Testar o guard de TOC.

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
echo "   🧪 SEVERINNO — MUTATION TEST (check-worklog-toc deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture base + CONTROLE (TOC sincronizado → exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture limpo (TOC sincronizado)..."
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
# STEP 3+4 — MUTAÇÃO A: entrada sem linha no índice (reverse)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — entrada sem linha no índice..."
cat > "$TMP_DIR/worklog.md" <<'EOF'
# Worklog

## Índice de Task IDs

- [TASK-1](#task-1) — Testar o guard de TOC.

---

Task ID: TASK-1
<a id="task-1"></a>
Agent: buffy (test)
Task: Testar o guard de TOC.

Work Log:

- feito.

---

Task ID: TASK-2
Agent: buffy (test)
Task: Sem linha no índice.

Work Log:

- feito.
EOF

info "STEP 4: Rodando guard contra a mutação A (sem linha no índice)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (reverse): passou com entrada sem linha no índice."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'sem linha no índice'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a falta de linha — veja acima."
  exit 1
fi
pass "Mutação A DETECTADA: guard citou 'sem linha no índice' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B: link do índice sem âncora (forward)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — link do índice sem âncora..."
cat > "$TMP_DIR/worklog.md" <<'EOF'
# Worklog

## Índice de Task IDs

- [TASK-1](#task-1) — Testar o guard de TOC.

---

Task ID: TASK-1
Agent: buffy (test)
Task: Sem âncora.

Work Log:

- feito.
EOF

info "STEP 6: Rodando guard contra a mutação B (sem âncora)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (forward): passou com link sem âncora."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'sem âncora'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a falta de âncora — veja acima."
  exit 1
fi
pass "Mutação B DETECTADA: guard citou 'sem âncora' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — MUTAÇÃO C: âncora com slug errado (anchor)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: Aplicando mutação C — slug errado no link do índice..."
cat > "$TMP_DIR/worklog.md" <<'EOF'
# Worklog

## Índice de Task IDs

- [TASK-1](#task-1-ERRADO) — Testar o guard de TOC.

---

Task ID: TASK-1
<a id="task-1"></a>
Agent: buffy (test)
Task: Slug errado.

Work Log:

- feito.
EOF

info "STEP 8: Rodando guard contra a mutação C (slug errado)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (anchor): passou com slug ≠ slugify(id)."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq '≠ slug esperado'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou o slug esperado — veja acima."
  exit 1
fi
pass "Mutação C DETECTADA: guard citou '≠ slug esperado' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 9+10 — MUTAÇÃO D: linha stale do índice (ID sem entrada)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 9: Aplicando mutação D — linha stale no índice..."
cat > "$TMP_DIR/worklog.md" <<'EOF'
# Worklog

## Índice de Task IDs

- [TASK-1](#task-1) — Testar o guard de TOC.
- [GHOST](#ghost) — Entrada que não existe.
<a id="ghost"></a>

---

Task ID: TASK-1
<a id="task-1"></a>
Agent: buffy (test)
Task: Linha stale.

Work Log:

- feito.
EOF

info "STEP 10: Rodando guard contra a mutação D (linha stale)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (stale): passou com linha do índice sem entrada real."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'stale'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a linha stale — veja acima."
  exit 1
fi
pass "Mutação D DETECTADA: guard citou 'stale' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 11+12 — MUTAÇÃO E: linha do índice sem resumo (empty-summary)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 11: Aplicando mutação E — linha do índice sem resumo..."
cat > "$TMP_DIR/worklog.md" <<'EOF'
# Worklog

## Índice de Task IDs

- [TASK-1](#task-1) — —

---

Task ID: TASK-1
<a id="task-1"></a>
Agent: buffy (test)
Task: Sem resumo.

Work Log:

- feito.
EOF

info "STEP 12: Rodando guard contra a mutação E (sem resumo)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (empty-summary): passou com linha do índice sem resumo."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'sem resumo'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a falta de resumo — veja acima."
  exit 1
fi
pass "Mutação E DETECTADA: guard citou 'sem resumo' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 13+14 — MUTAÇÃO F: entradas coladas sem separador '---' (glued)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 13: Aplicando mutação F — duas entradas coladas (sem separador)..."
cat > "$TMP_DIR/worklog.md" <<'EOF'
# Worklog

## Índice de Task IDs

- [TASK-1](#task-1) — Primeira.
- [TASK-2](#task-2) — Segunda colada.

---

Task ID: TASK-1
<a id="task-1"></a>
Agent: buffy (test)
Task: Primeira.

Work Log:

- feito.

Task ID: TASK-2
<a id="task-2"></a>
Agent: buffy (test)
Task: Segunda colada.

Work Log:

- feito.
EOF

info "STEP 14: Rodando guard contra a mutação F (entradas coladas)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (glued): passou com duas entradas sem separador '---'."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'coladas'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou as entradas coladas — veja acima."
  exit 1
fi
pass "Mutação F DETECTADA: guard citou 'coladas' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard pega entrada sem linha no índice"
pass "(reverse, exit 1), link sem âncora (forward, exit 1), slug errado"
pass "(anchor, exit 1), linha stale (exit 1), linha sem resumo"
pass "(empty-summary, exit 1) e entradas coladas (glued, exit 1) — o"
pass "índice nunca dessincroniza nem o worklog volta a colar entradas."
exit 0
