#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-unused-deps.sh — Mutation test do guard de
# dependências NÃO UTILIZADAS (check-unused-deps.mjs)
#
# Prova que o scripts/check-unused-deps.mjs REALMENTE detecta a regressão que
# ele existe para bloquear: uma dep de package.json SEM NENHUMA referência em
# código (o item #4 da auditoria — 5 órfãs reais removidas: next-intl,
# react-markdown, @mdxeditor/editor, @tanstack/react-table, zod-to-openapi).
#
#   Cenário A (DEP ÓRFÃ):   uma dep no package.json sem import/ref em código
#                           — o guard DEVE FALHAR (exit 1) citando a dep.
#   Cenário B (REMOVER ref): remover o import da dep usada deixa ela órfã —
#                           o guard DEVE FALHAR (exit 1) citando a dep.
#
# E o CONTROLE: o mesmo fixture com a dep usada passa (exit 0) — provando que
# a falha vem da MUTAÇÃO, não de um fixture quebrado.
#
# DIFERENÇA vs mutation-seed-dev-e2e: o fixture é um mini-repo criado do zero
# num mktemp (package.json + src/index.ts) e o guard roda com --root no temp
# (lê o package.json do temp, não o do repo real). O script não toca NENHUM
# arquivo do repositório real.
#
# Pipeline:
#   1. Cria temp dir com package.json (dep usada lodash + órfã is-odd) e
#      src/index.ts (import da usada)
#   2. CONTROLE: adiciona import da órfã → guard exit 0 ('todas com referência')
#   3. MUTAÇÃO A: remove o import da órfã → guard DEVE FALHAR (exit 1)
#   4. MUTAÇÃO B: remove o import da USADA também → guard DEVE FALHAR (exit 1)
#   5. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-unused-deps.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com a mutação) OU infra ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-unused-deps.mjs"

TMP_DIR="$(mktemp -d)"
PKG="$TMP_DIR/package.json"
SRC="$TMP_DIR/src/index.ts"

EXPECTED_ORPHAN_A="is-odd"
EXPECTED_ORPHAN_B="lodash"

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

# ── build_pkg: (re)escreve o package.json do fixture ─────────────────────
build_pkg() {
  cat > "$PKG" <<'EOF'
{
  "scripts": { "lint": "eslint ." },
  "dependencies": {
    "lodash": "^4.17.0",
    "is-odd": "^3.0.1"
  }
}
EOF
}

# ── build_src: (re)escreve o src/index.ts do fixture ─────────────────────
build_src() {
  mkdir -p "$TMP_DIR/src"
  cat > "$SRC" <<'EOF'
import lodash from "lodash"
console.log(lodash)
EOF
}

# ── run_guard: roda o guard no temp dir (--root) ─────────────────────────
run_guard() {
  set +e
  OUTPUT="$(node "$GUARD" --root "$TMP_DIR" 2>&1)"
  EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-unused-deps deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture + CONTROLE (ambas as deps usadas → exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture em $TMP_DIR (package.json + src/index.ts)..."
build_pkg
build_src

info "STEP 2: Controle — adiciona import da órfã; guard deve PASS (exit 0)..."
cat >> "$SRC" <<'EOF'
import isOdd from "is-odd"
console.log(isOdd(3))
EOF

run_guard
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $EXIT)."
  echo "$OUTPUT" | tail -10
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — fixture limpo passa no guard (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A (remover import da órfã): deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — removendo o import de $EXPECTED_ORPHAN_A..."
build_src

info "STEP 4: Rodando guard contra a mutação A (órfã)..."
run_guard
echo "$OUTPUT" | tail -6

# Caso 1 — guard CEGO: PASS com a mutação.
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (órfã $EXPECTED_ORPHAN_A): check-unused-deps passou com a"
  fail "dep $EXPECTED_ORPHAN_A sem referência (exit 0). Verifique se o scan"
  fail "ainda acusa deps sem import em scripts/check-unused-deps.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO citou a dep órfã esperada.
if ! echo "$OUTPUT" | grep -Fq "$EXPECTED_ORPHAN_A"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a dep órfã esperada:"
  fail "  esperava (dep): $EXPECTED_ORPHAN_A"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi
pass "Mutação A DETECTADA: guard falhou citando $EXPECTED_ORPHAN_A (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B (remover import da USADA também): deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — removendo TODOS os imports (${EXPECTED_ORPHAN_A} + ${EXPECTED_ORPHAN_B})..."
echo "// sem imports" > "$SRC"

info "STEP 6: Rodando guard contra a mutação B (2 órfãs)..."
run_guard
echo "$OUTPUT" | tail -6

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (2 órfãs): check-unused-deps passou com o fixture sem"
  fail "NENHUM import (exit 0). O scan de deps sem ref está quebrado."
  exit 1
fi

if ! echo "$OUTPUT" | grep -Fq "$EXPECTED_ORPHAN_B"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a dep $EXPECTED_ORPHAN_B."
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi
pass "Mutação B DETECTADA: guard falhou citando $EXPECTED_ORPHAN_B (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de unused-deps pega dep órfã (exit 1)"
pass "e passa com o fixture limpo (exit 0)"
exit 0
