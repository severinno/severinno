#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-no-setup-bun.sh — Mutation test do guard check-no-setup-bun
#
# Prova que o scripts/check-no-setup-bun.mjs REALMENTE pega a reintrodução de
# oven-sh/setup-bun@v2 nos workflows. O guard varre todas as forjas (via
# forge-workflows.mjs) procurando a string "oven-sh/setup-bun".
#
# Uma mutação que ADICIONA `uses: oven-sh/setup-bun@v2` a um workflow deve
# fazer o guard FALHAR — se passar, ele está CEGO para a regressão que existe
# para impedir.
#
# Pipeline:
#   1. CONTROLE: guard passa no repo real (exit 0 — nenhuma ocorrência)
#   2. MUTAÇÃO: cria workflow fixture com oven-sh/setup-bun
#   3. Roda o guard
#   4. Verifica que o guard FALHOU (exit 1) com a asserção esperada
#   5. Cleanup
#
# Usage:
#   ./scripts/test-mutation-no-setup-bun.sh
#
# Exit codes:
#   0 — mutação DETECTADA pelo guard ✅
#   1 — guard CEGO OU falha de infra ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-no-setup-bun.mjs"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

# ── CONTROLE ──────────────────────────────────────────────────────────────

header "CONTROLE: guard passa no repo real"
CTRL_OUT="$TMP_DIR/ctrl-out.txt"
if node "$GUARD" > "$CTRL_OUT" 2>&1; then
  pass "guard PASS no repo real (exit 0)"
else
  ctrl_exit=$?
  fail "guard FALHOU no repo real (exit $ctrl_exit)"
  cat "$CTRL_OUT"
  exit 1
fi

# ── MUTAÇÃO: workflow com oven-sh/setup-bun ───────────────────────────────

header "MUTAÇÃO: oven-sh/setup-bun reintroduzido"

# Para esta mutação, precisamos de um fixture que o guard encontre.
# O guard usa forge-workflows.mjs para descobrir os diretórios de workflow.
# Criamos um fixture minimalista com o action proibido.
FIXTURE_DIR="$TMP_DIR/.github/workflows"
mkdir -p "$FIXTURE_DIR"

cat > "$FIXTURE_DIR/fake-ci.yml" <<'YAML'
name: Fake CI

on:
  push:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun test
YAML

# O guard precisa encontrar o fixture. Rodamos com o root apontando para o tmp.
# O guard lê forge-workflows.mjs que usa os mesmos diretórios do repositório
# real — para o fixture, precisamos criar o .gitea/workflows também.
GITEA_DIR="$TMP_DIR/.gitea/workflows"
mkdir -p "$GITEA_DIR"
cat > "$GITEA_DIR/ci.yml" <<'YAML'
name: CI

on:
  push:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
YAML

MUT_OUT="$TMP_DIR/mut-out.txt"
MUT_EXIT=0
# O guard lê os workflows via forge-workflows.mjs, que lista os diretórios
# hardcoded. Para testar com o fixture, precisamos rodar o guard de forma
# que ele encontre o fixture. Como o guard lê os diretórios reais, testamos
# injetando a ocorrência no workspace real ( temporariamente ) via um symlink.
# Na prática, o guard varre os diretórios de forge-workflows.mjs que são
# relativos ao cwd do script. Rodamos com cwd apontando para o fixture.
#
# Abordagem alternativa: roda o guard diretamente e verifica o output.
# O guard lê os workflows de .github/ e .gitea/ do cwd. Criamos os fixtures
# no diretório do repo temporariamente.
#
# NOTA: para não tocar no repo real, usamos a função findSetupBunRefs
# exportada do guard e a testamos diretamente.
node -e "
const { findSetupBunRefs } = require('$GUARD');
const content = require('fs').readFileSync('$FIXTURE_DIR/fake-ci.yml', 'utf8');
const refs = findSetupBunRefs(content);
if (refs.length > 0) {
  process.exit(0);
} else {
  process.exit(1);
}
" > "$MUT_OUT" 2>&1 || MUT_EXIT=$?

# Abordagem alternativa: se o teste direto da função não funcionar (ESM),
# usamos o output do guard
if [ "$MUT_EXIT" -ne 0 ]; then
  # Tenta rodar o guard de forma que o fixture seja encontrado
  # Copia o fixture para o repo real temporariamente
  FAKE_WORKFLOW="$SCRIPT_DIR/.github/workflows/_mutation-test-fake-ci.yml"
  cp "$FIXTURE_DIR/fake-ci.yml" "$FAKE_WORKFLOW"
  trap 'rm -rf "$TMP_DIR"; rm -f "'"$FAKE_WORKFLOW"'"' EXIT

  MUT_EXIT=0
  node "$GUARD" > "$MUT_OUT" 2>&1 || MUT_EXIT=$?
fi

header "VEREDITO"

if [ "$MUT_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com oven-sh/setup-bun (exit 0)"
  cat "$MUT_OUT"
  exit 1
fi

# Guard falhou — verificar se é pela asserção esperada
if grep -qiE "oven-sh/setup-bun|setup-bun|action externo|proibido" "$MUT_OUT"; then
  pass "mutação DETECTADA: oven-sh/setup-bun faz o guard FALHAR (exit $MUT_EXIT)"
  exit 0
else
  fail "mutação fez o guard falhar (exit $MUT_EXIT) mas pela RAZÃO ERRADA"
  echo "  Obtido:"
  cat "$MUT_OUT" | sed 's/^/    /'
  exit 1
fi
