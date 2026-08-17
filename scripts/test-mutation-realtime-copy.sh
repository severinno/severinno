#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-realtime-copy.sh — Mutation test do guard de
# cobertura do COPY do realtime (scripts/check-realtime-copy.mjs)
#
# Prova que o guard REALMENTE detecta a regressão que ele existe para
# bloquear: um módulo novo importado por mini-services/realtime/index.ts sem
# cobertura no Dockerfile (a imagem boota com "module not found"), ou uma
# lista explícita do COPY com entrada órfã. Sem o guard, a lista deriva do
# código silenciosamente e a próxima imagem quebrada passa no CI.
#
#   CONTROLE:      fixture limpo (glob *.ts + módulos no diretório) → exit 0
#   MUTAÇÃO A:     módulo importado SEM arquivo no diretório → guard DEVE
#                  FALHAR (forward — module not found no boot)
#   MUTAÇÃO B:     lista explícita do COPY omitindo módulo importado → guard
#                  DEVE FALHAR (forward — lista driftou do código)
#   MUTAÇÃO C:     entrada órfã na lista explícita (sem uso) → guard DEVE
#                  FALHAR (reverse — arquivo morto na imagem)
#   MUTAÇÃO D:     glob *.ts cobre módulo novo → guard DEVE PASSAR (sem falso
#                  positivo — o glob é o fix atual do repo)
#
# O script NÃO toca NENHUM arquivo do repo: o guard roda com --root num
# fixture temporário com mini-services/realtime/{index.ts,Dockerfile,*.ts}.
#
# Usage:
#   ./scripts/test-mutation-realtime-copy.sh
#
# Exit code:
#   0 — mutações DETECTADAS (ou cobertas) pelo guard ✅
#   1 — guard CEGO (passou com a mutação que deveria falhar) OU infra ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-realtime-copy.mjs"

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

# ── build_fixture: index.ts + 4 módulos + Dockerfile com glob *.ts ───────
build_fixture() {
  mkdir -p "$TMP_DIR/mini-services/realtime"

  cat > "$TMP_DIR/mini-services/realtime/index.ts" <<'EOF'
import { readSecret } from "./security"
import { persist } from "./redis-telemetry"
import { check } from "./booking-participant"
export { createOrphanAlert } from "./ops-alert"
EOF

  cat > "$TMP_DIR/mini-services/realtime/security.ts" <<'EOF'
export { parseRealtimePort } from "./port"
EOF

  cat > "$TMP_DIR/mini-services/realtime/port.ts" <<'EOF'
export const parseRealtimePort = () => 3003
EOF

  cat > "$TMP_DIR/mini-services/realtime/redis-telemetry.ts" <<'EOF'
import { readSecret } from "./security"
EOF

  cat > "$TMP_DIR/mini-services/realtime/booking-participant.ts" <<'EOF'
EOF

  cat > "$TMP_DIR/mini-services/realtime/ops-alert.ts" <<'EOF'
EOF

  cat > "$TMP_DIR/mini-services/realtime/Dockerfile" <<'EOF'
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}-slim AS runner
WORKDIR /app
COPY package.json bun.lock ./
COPY *.ts ./
CMD ["bun", "index.ts"]
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
echo "   🧪 SEVERINNO — MUTATION TEST (check-realtime-copy deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture base + CONTROLE (glob cobre tudo → exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture limpo (glob *.ts + 5 módulos)..."
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
# STEP 3+4 — MUTAÇÃO A: módulo importado sem arquivo (module not found)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — import ./ghost sem ghost.ts no diretório..."
cat > "$TMP_DIR/mini-services/realtime/index.ts" <<'EOF'
import { x } from "./ghost"
EOF

info "STEP 4: Rodando guard contra a mutação A (módulo sem arquivo)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (forward): passou com ./ghost sem arquivo no diretório."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'ghost'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou o módulo — veja acima."
  exit 1
fi
pass "Mutação A DETECTADA: guard citou 'ghost' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B: lista explícita omitindo módulo importado
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — COPY explícito sem ops-alert.ts..."
cat > "$TMP_DIR/mini-services/realtime/index.ts" <<'EOF'
import { readSecret } from "./security"
import { persist } from "./redis-telemetry"
import { check } from "./booking-participant"
export { createOrphanAlert } from "./ops-alert"
EOF

cat > "$TMP_DIR/mini-services/realtime/Dockerfile" <<'EOF'
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}-slim AS runner
WORKDIR /app
COPY package.json bun.lock ./
COPY index.ts security.ts redis-telemetry.ts booking-participant.ts ./
CMD ["bun", "index.ts"]
EOF

info "STEP 6: Rodando guard contra a mutação B (ops-alert fora do COPY)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (lista): passou com ops-alert.ts fora do COPY explícito."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'ops-alert'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou ops-alert — veja acima."
  exit 1
fi
pass "Mutação B DETECTADA: guard citou 'ops-alert' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — MUTAÇÃO C: entrada órfã na lista explícita (reverse)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: Aplicando mutação C — ghost.ts na lista do COPY sem uso..."
cat > "$TMP_DIR/mini-services/realtime/Dockerfile" <<'EOF'
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}-slim AS runner
WORKDIR /app
COPY package.json bun.lock ./
COPY index.ts security.ts redis-telemetry.ts booking-participant.ts ops-alert.ts ghost.ts ./
CMD ["bun", "index.ts"]
EOF

info "STEP 8: Rodando guard contra a mutação C (entrada órfã)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (reverse): passou com ghost.ts órfão no COPY."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'órfã'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a entrada órfã — veja acima."
  exit 1
fi
pass "Mutação C DETECTADA: guard citou a entrada órfã (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 9+10 — MUTAÇÃO D: glob cobre módulo novo (sem falso positivo)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 9: Aplicando mutação D — módulo NOVO + import, glob *.ts mantido..."
cat > "$TMP_DIR/mini-services/realtime/user-plan.ts" <<'EOF'
EOF
cat > "$TMP_DIR/mini-services/realtime/index.ts" <<'EOF'
import { readSecret } from "./security"
import { loadPlan } from "./user-plan"
EOF
cat > "$TMP_DIR/mini-services/realtime/Dockerfile" <<'EOF'
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}-slim AS runner
WORKDIR /app
COPY package.json bun.lock ./
COPY *.ts ./
CMD ["bun", "index.ts"]
EOF

info "STEP 10: Rodando guard contra a mutação D (glob cobre módulo novo)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -ne 0 ]; then
  fail "GUARD FALSO POSITIVO: rejeitou user-plan.ts coberto pelo glob — exit $EXIT."
  echo "$OUTPUT" | tail -10
  exit 1
fi
pass "Mutação D COBERTA: glob *.ts aceitou user-plan.ts (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard pega módulo importado sem arquivo"
pass "(forward, exit 1), módulo fora da lista explícita do COPY (exit 1),"
pass "entrada órfã na lista (reverse, exit 1) e NÃO cria falso positivo"
pass "para o glob *.ts com módulo novo (exit 0) — o COPY nunca deriva do código."
exit 0
