#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-bun-removal.sh — Mutation test do checkStagedRemovedBunVersion
#
# Prova que o scripts/check-bun-mirror.mjs (modo --staged) REALMENTE pega a
# regressão de REMOÇÃO: num repo git FIXTURE temporário, primeiro confirma
# que o guard PASS com o call site correto (${{ vars.BUN_VERSION }}) staged,
# depois MUTA o mesmo workflow para REMOVER a linha `bun-version:` (o call
# site `uses:` SOBREVIVE, mas perde o input) e exige que o guard FALHE
# (exit 1) pela asserção certa. Se o guard passar com a remoção (exit 0),
# ele está CEGO — a checagem de remoção foi removida/enfraquecida — e o
# script falha (exit 1), bloqueando o CI.
#
# POR QUE UM REPO GIT REAL: o modo --staged do guard roda
# `git diff --cached -- .github/workflows` — a remoção do input só aparece
# como linha `-` no diff quando há um COMMIT base com o bun-version e a
# mutação fica STAGED. Diferente do test-mutation-bun-literal (scan global,
# fixture de arquivos puros), aqui o fixture precisa de git init + commit +
# git add para o diff existir — espelhando o check-bun-mirror-staged-cli.test.ts.
#
# Mutação aplicada (workflow temporário fake.yml):
#   with:
#     bun-version: ${{ vars.BUN_VERSION }}   →   (linha REMOVIDA)
# O checkStagedRemovedBunVersion do guard é o que detecta (call site
# sobreviveu sem o input). Tudo o mais (mirror, action, .actrc, cache keys)
# permanece VÁLIDO — a falha é EXATAMENTE a asserção da remoção, sem cascata.
#
# DIFERENÇA vs mutation-seed-dev-e2e: aqui o fixture é criado do zero num
# mktemp (o guard é node-puro, sem docker/prisma), e há um passo de CONTROLE
# (fixture limpo passa) — provando que a falha vem da mutação, não de um
# fixture quebrado. O script não toca NENHUM arquivo do repositório real.
#
# Pipeline:
#   1. Cria repo git fixture temporário (.github/workflows/fake.yml com o
#      call site correto: bun-version: ${{ vars.BUN_VERSION }})
#   2. CONTROLE: git add do arquivo (diff staged inteiro) → guard --staged
#      deve PASS (exit 0) — o call site adicionado com o input passa
#   3. Commit base (HEAD = workflow com bun-version)
#   4. MUTAÇÃO: reescreve fake.yml REMOVENDO a linha bun-version:, git add
#   5. Guard --staged contra o diff MUTADO (captura exit)
#   6. Verificar que o guard FALHOU com a asserção esperada (mutation detected)
#   7. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-bun-removal.sh
#
# Exit codes:
#   0 — mutação DETECTADA pelo guard (falhou pela asserção esperada) ✅
#   1 — guard CEGO (passou com a remoção) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-bun-mirror.mjs"

TMP_DIR="$(mktemp -d)"

# ── Mutação (bug conhecido) ───────────────────────────────────────────────
# O call site correto usa a fonte única; a mutação REMOVE a linha
# `bun-version:` inteira (o `uses:` sobrevive como contexto no diff).
# Asserção que o guard DEVE emitir quando detecta a mutação. Fonte:
# checkStagedRemovedBunVersion em scripts/check-bun-mirror.mjs.
EXPECTED_FAILURE="REMOÇÃO do input bun-version do call site do setup-bun"

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
echo "   🧪 SEVERINNO — MUTATION TEST (check-bun-mirror --staged deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1 — Cria o repo git fixture temporário com o call site CORRETO
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando repo git fixture temporário em $TMP_DIR..."

mkdir -p "$TMP_DIR/.github/workflows"

git -C "$TMP_DIR" init -q
# config local do fixture (repo temporário — NUNCA global; espelha o
# check-bun-mirror-staged-cli.test.ts)
git -C "$TMP_DIR" config user.email "t@t"
git -C "$TMP_DIR" config user.name "t"
git -C "$TMP_DIR" config core.autocrlf "false"

# Workflow válido (call site com a fonte única — ${{ vars.BUN_VERSION }})
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

pass "Fixture criado (.github/workflows/fake.yml com bun-version: \${{ vars.BUN_VERSION }})"

# ═════════════════════════════════════════════════════════════════════════
# STEP 2 — CONTROLE: git add do arquivo → guard --staged deve PASS (exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 2: Controle — call site correto staged → guard --staged deve PASS..."

git -C "$TMP_DIR" add .github/workflows/fake.yml

set +e
CONTROL_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" --staged 2>&1)"
CONTROL_EXIT=$?
set -e

if [ "$CONTROL_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $CONTROL_EXIT)."
  echo "$CONTROL_OUTPUT" | tail -15
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — call site correto staged passa no guard --staged (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3 — Commit base (HEAD = workflow com bun-version)
# ═════════════════════════════════════════════════════════════════════════

git -C "$TMP_DIR" commit -qm "base"

pass "Commit base criado (HEAD com bun-version: \${{ vars.BUN_VERSION }})"

# ═════════════════════════════════════════════════════════════════════════
# STEP 4 — MUTAÇÃO: remove a linha bun-version: (uses: sobrevive) e stage
# ═════════════════════════════════════════════════════════════════════════

info "STEP 4: Aplicando mutação (remoção da linha bun-version:)..."

cat > "$TMP_DIR/.github/workflows/fake.yml" <<'EOF'
name: Fake
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-bun
        with:
EOF

git -C "$TMP_DIR" add .github/workflows/fake.yml

# Fail-fast: o diff staged DEVE conter a remoção do bun-version (se não,
# a mutação não produziu o cenário que o guard precisa ver).
if git -C "$TMP_DIR" diff --cached -- .github/workflows/fake.yml | grep -Fq -- "-          bun-version: \${{ vars.BUN_VERSION }}"; then
  pass "Mutação aplicada: bun-version: REMOVIDO do call site (uses: sobrevive)"
else
  fail "Mutação não aplicou (linha bun-version: não aparece como remoção no diff staged)."
  git -C "$TMP_DIR" diff --cached -- .github/workflows/fake.yml | head -20
  exit 1
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 5 — Guard --staged contra o fixture MUTADO (deve FALHAR)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Rodando guard --staged contra o fixture MUTADO..."

set +e
GUARD_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" --staged 2>&1)"
GUARD_EXIT=$?
set -e

echo "$GUARD_OUTPUT" | tail -12

# ═════════════════════════════════════════════════════════════════════════
# STEP 6 — Verificar que o guard DETECTOU a mutação
# ═════════════════════════════════════════════════════════════════════════

info "STEP 6: Verificando que o guard detectou a mutação..."

# Caso 1 — guard CEGO: PASS com a remoção. O checkStagedRemovedBunVersion foi
# removido/enfraquecido. Este é o cenário que o mutation test existe para
# BLOQUEAR.
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "GUARD CEGO: check-bun-mirror --staged passou com o bun-version REMOVIDO (exit 0)."
  fail "A mutação (remoção da linha bun-version: do call site sobrevivente) não foi"
  fail "detectada — verifique se checkStagedRemovedBunVersion foi"
  fail "removido/enfraquecido em scripts/check-bun-mirror.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou,
# não a remoção do input). Não dá para confirmar que o guard pega ESTA
# regressão.
if ! echo "$GUARD_OUTPUT" | grep -Fq "$EXPECTED_FAILURE"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO pela asserção esperada:"
  fail "  esperava:  $EXPECTED_FAILURE"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

# Caso 3 — ✅ mutação detectada: guard falhou com a mensagem da remoção.
pass "Mutação DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE' (exit $GUARD_EXIT)"
pass "O guard check-bun-mirror (--staged) está sensível a regressões de remoção."

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard --staged pega a remoção do input bun-version"
exit 0
