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
#   Cenário C (--staged):   num repo GIT real (init + commit base), uma dep
#                           ADICIONADA no git diff --cached sem ref no índice
#                           — o guard --staged DEVE FALHAR (exit 1); com o
#                           import TAMBÉM staged, DEVE PASSAR (exit 0). Prova
#                           o modo pre-commit end-to-end (o import em arquivo
#                           não-staged NÃO conta — o commit não o carrega).
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
#   5. CENÁRIO C (--staged): git init + commit base → dep órfã staged DEVE
#      FALHAR (exit 1); import staged junto → DEVE PASSAR (exit 0); import só
#      no working tree (não staged) → DEVE FALHAR (exit 1)
#   6. Cleanup (trap EXIT — rm -rf do temp)
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

# O SCRATCH DAS FIXTURES É ESTÁVEL E FORA DO `/tmp`: o `/tmp` é limpo por FORA e a
# rodada LONGA perdia fixture no meio da medição (o motivo inteiro, com as duas
# medições, está no cabeçalho do master). A raiz é a MESMA em toda rodada e NÃO
# fica DENTRO do repositório: uma fixture dentro de um repo muda de semântica —
# `node_modules`, o prettier e o git do projeto passam a alcançá-la (medido).
MUT_SCRATCH="${MUT_SCRATCH:-${XDG_CACHE_HOME:-$HOME/.cache}/severinno-mutacao}"
mkdir -p "$MUT_SCRATCH" 2>/dev/null || {
  echo "❌ o scratch das fixtures não pôde ser criado: $MUT_SCRATCH (infra declarada)" >&2
  exit 2
}
GUARD="$SCRIPT_DIR/scripts/check-unused-deps.mjs"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
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
# GIT_TMP (Cenário C, repo git real) nasce DEPOIS do trap — a variável vazia
# no rm -rf é inócua no caso comum; a inicialização previne o leak se o
# cenário C falhar antes do rm -rf do próprio passo.
GIT_TMP=""
cleanup() {
  rm -rf "$TMP_DIR" "$GIT_TMP"
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
if ! grep -Fq "$EXPECTED_ORPHAN_A" <<< "$OUTPUT"; then
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

if ! grep -Fq "$EXPECTED_ORPHAN_B" <<< "$OUTPUT"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a dep $EXPECTED_ORPHAN_B."
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi
pass "Mutação B DETECTADA: guard falhou citando $EXPECTED_ORPHAN_B (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7-10 — CENÁRIO C (--staged): repo git real, dep adicionada no diff
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: Cenário C — transforma o fixture em repo GIT real (init + commit base)..."
GIT_TMP="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
git -C "$GIT_TMP" init -q -b main
(cd "$GIT_TMP" && git config user.email test@example.com && git config user.name Test)
mkdir -p "$GIT_TMP/src"
cat > "$GIT_TMP/package.json" <<'EOF'
{
  "scripts": {},
  "dependencies": { "lodash": "^4.17.0" }
}
EOF
cat > "$GIT_TMP/src/index.ts" <<'EOF'
import lodash from "lodash"
EOF
git -C "$GIT_TMP" add -A
git -C "$GIT_TMP" commit -qm base

run_staged() {
  set +e
  OUTPUT="$(node "$GUARD" --staged --root "$GIT_TMP" 2>&1)"
  EXIT=$?
  set -e
}

info "STEP 8: Controle staged — dep órfã ADICIONADA no staged DEVE FALHAR (exit 1)..."
# heredoc (não node -e com path embutido — o MSYS/Windows não converte paths
# dentro de strings do script; o cat é determinístico em ambos os shells)
cat > "$GIT_TMP/package.json" <<'EOF'
{
  "scripts": {},
  "dependencies": {
    "lodash": "^4.17.0",
    "is-odd": "^3.0.1"
  }
}
EOF
git -C "$GIT_TMP" add package.json
run_staged
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (--staged): dep is-odd adicionada no diff --cached sem ref no"
  fail "índice passou (exit 0). O modo --staged não pega dep órfã do commit."
  exit 1
fi
if ! grep -Fq "is-odd" <<< "$OUTPUT"; then
  fail "--staged falhou (exit $EXIT) mas NÃO citou a dep is-odd."
  echo "$OUTPUT" | tail -6
  exit 1
fi
pass "--staged DETECTA dep órfã do commit: falhou citando is-odd (exit $EXIT)"

info "STEP 9: Controle staged — import TAMBÉM staged DEVE PASSAR (exit 0)..."
cat > "$GIT_TMP/src/index.ts" <<'EOF'
import lodash from "lodash"
import isOdd from "is-odd"
EOF
git -C "$GIT_TMP" add src/index.ts
run_staged
if [ "$EXIT" -ne 0 ]; then
  fail "--staged rejeitou o par CORRETO (dep + import staged, exit $EXIT):"
  echo "$OUTPUT" | tail -6
  exit 1
fi
pass "--staged aceita o par commitado (dep + import staged, exit 0)"

info "STEP 10: Controle staged — import SÓ no working tree (não staged) DEVE FALHAR..."
# desfaz o import staged mas mantém no working tree: o commit carregaria a
# dep órfã (o --staged lê o ÍNDICE, não o working tree)
git -C "$GIT_TMP" restore --staged src/index.ts
run_staged
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (--staged): import fora do índice contou como ref — o guard"
  fail "deveria ler o ÍNDICE (o que será commitado), não o working tree."
  exit 1
fi
if ! grep -Fq "git add" <<< "$OUTPUT"; then
  fail "--staged falhou (exit $EXIT) mas a mensagem não orienta o git add."
  echo "$OUTPUT" | tail -6
  exit 1
fi
pass "--staged NÃO conta import fora do índice (orienta git add, exit $EXIT)"
rm -rf "$GIT_TMP"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de unused-deps pega dep órfã (exit 1),"
pass "passa com o fixture limpo (exit 0) e o modo --staged pega dep órfã do"
pass "commit no pre-commit (exit 1)"
exit 0
