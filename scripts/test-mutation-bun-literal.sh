#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-bun-literal.sh — Mutation test do guard check-bun-mirror
#
# Prova que o scripts/check-bun-mirror.mjs REALMENTE pega regressões de drift:
# num repo FIXTURE temporário, primeiro confirma que o guard PASS com o call
# site correto (${{ vars.BUN_VERSION }}), depois MUTA o mesmo workflow para um
# `bun-version: 1.3.14` LITERAL e exige que o guard FALHE (exit 1) pela
# asserção certa. Se o guard passar com o literal (exit 0), ele está CEGO —
# uma checagem foi removida ou enfraquecida — e o script falha (exit 1),
# bloqueando o CI.
#
# Mutação aplicada (workflow temporário fake.yml):
#   bun-version: ${{ vars.BUN_VERSION }}  →  bun-version: 1.3.14
# O checkLiteralBunLine do guard é o que detecta (versão literal do Bun em
# workflow), e o checkSetupBunCallSite também (call site com literal). Tudo o
# mais (mirror, action, .actrc, cache keys) permanece VÁLIDO — a falha é
# EXATAMENTE a asserção do literal, sem cascata.
#
# DIFERENÇA vs mutation-seed-dev-e2e: aqui o fixture é criado do zero num
# mktemp (o guard é node-puro, sem docker/prisma), e há um passo de CONTROLE
# (fixture limpo passa) — provando que a falha vem da mutação, não de um
# fixture quebrado. O script não toca NENHUM arquivo do repositório real.
#
# Pipeline:
#   1. Cria repo fixture temporário (mirror + action + Dockerfile + .actrc)
#   2. CONTROLE: fake.yml com ${{ vars.BUN_VERSION }} → guard deve PASS (exit 0)
#   3. MUTAÇÃO: reescreve fake.yml com bun-version: 1.3.14 literal
#   4. Guard contra o fixture MUTADO (captura exit)
#   5. Verificar que o guard FALHOU com a asserção esperada (mutation detected)
#   6. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-bun-literal.sh
#
# Exit codes:
#   0 — mutação DETECTADA pelo guard (falhou pela asserção esperada) ✅
#   1 — guard CEGO (passou com literal) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-bun-mirror.mjs"

TMP_DIR="$(mktemp -d)"

# ── Mutação (bug conhecido) ───────────────────────────────────────────────
# O call site correto usa a fonte única; a mutação é o LITERAL da versão.
# Asserção que o guard DEVE emitir quando detecta a mutação. Fonte:
# checkLiteralBunLine em scripts/check-bun-mirror.mjs (também cai no
# checkSetupBunCallSite — ambas as mensagens são esperadas no output).
EXPECTED_FAILURE="versão literal do Bun '1.3.14'"

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

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-bun-mirror deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1 — Cria o repo fixture temporário (VÁLIDO: mirror + action + .actrc)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando repo fixture temporário em $TMP_DIR..."

mkdir -p "$TMP_DIR/.github/workflows" "$TMP_DIR/.github/actions/setup-bun"

# Mirror workflow válido (env.BUN_VERSION = ${{ vars.BUN_VERSION }} — fonte única)
cat > "$TMP_DIR/.github/workflows/sync-bun-mirror.yml" <<'EOF'
name: Sync Bun Mirror
env:
  BUN_VERSION: ${{ vars.BUN_VERSION }}
jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
EOF

# Action válida (sem default, ref inputs.bun-version, ref ao mirror GHCR)
cat > "$TMP_DIR/.github/actions/setup-bun/action.yml" <<'EOF'
inputs:
  bun-version:
    required: false
runs:
  using: composite
  steps:
    - name: Resolve Bun version
      run: |
        VERSION="${{ inputs.bun-version }}"
    - name: Download Bun release (cold cache)
      run: |
        MIRROR="ghcr.io/${GHCR_OWNER}/bun:${BUN_VERSION}"
        docker pull "$MIRROR"
EOF

printf 'FROM scratch\nCOPY bun /bun\n' > "$TMP_DIR/Dockerfile.bun-mirror"
printf -- '--var BUN_VERSION=1.3.14\n' > "$TMP_DIR/.actrc"

pass "Fixture criado (mirror + action + Dockerfile + .actrc)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 2 — CONTROLE: fake.yml com a fonte única → guard deve PASS (exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 2: Controle — call site correto (bun-version: \${{ vars.BUN_VERSION }})..."

cat > "$TMP_DIR/.github/workflows/fake.yml" <<'EOF'
name: Fake
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-bun
        with:
          bun-version: ${{ vars.BUN_VERSION }}
EOF

set +e
CONTROL_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
CONTROL_EXIT=$?
set -e

if [ "$CONTROL_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $CONTROL_EXIT)."
  echo "$CONTROL_OUTPUT" | tail -15
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — fixture limpo passa no guard (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3 — MUTAÇÃO: reescreve fake.yml com bun-version: 1.3.14 LITERAL
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação (bun-version: 1.3.14 literal)..."

cat > "$TMP_DIR/.github/workflows/fake.yml" <<'EOF'
name: Fake
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-bun
        with:
          bun-version: 1.3.14
EOF

pass "Mutação aplicada: bun-version: 1.3.14 (literal)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 4 — Guard contra o fixture MUTADO (deve FALHAR)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 4: Rodando guard contra o fixture MUTADO..."

set +e
GUARD_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
GUARD_EXIT=$?
set -e

echo "$GUARD_OUTPUT" | tail -12

# ═════════════════════════════════════════════════════════════════════════
# STEP 5 — Verificar que o guard DETECTOU a mutação
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Verificando que o guard detectou a mutação..."

# Caso 1 — guard CEGO: PASS com o literal. Uma checagem foi removida/
# enfraquecida (checkLiteralBunLine / checkNoLiteralBunVersion ou o call site
# check). Este é o cenário que o mutation test existe para BLOQUEAR.
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "GUARD CEGO: check-bun-mirror passou com bun-version literal (exit 0)."
  fail "A mutação (bun-version: 1.3.14) não foi detectada — verifique se uma"
  fail "checagem foi removida/enfraquecida em scripts/check-bun-mirror.mjs"
  fail "(checkLiteralBunLine / checkNoLiteralBunVersion / checkSetupBunCallSite)."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou,
# não o literal). Não dá para confirmar que o guard pega ESTA regressão.
if ! echo "$GUARD_OUTPUT" | grep -Fq "$EXPECTED_FAILURE"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO pela asserção esperada:"
  fail "  esperava:  $EXPECTED_FAILURE"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

# Caso 3 — ✅ mutação detectada: guard falhou com a mensagem do literal.
pass "Mutação DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE' (exit $GUARD_EXIT)"
pass "O guard check-bun-mirror está sensível a regressões de drift."

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard do Bun pega regressões de drift"
exit 0
