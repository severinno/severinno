#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-forge-parity.sh — Mutation test do guard check-forge-parity
#
# Prova que o scripts/check-forge-parity.mjs REALMENTE pega gates não
# classificados. O guard descobre todos os gates das duas pipelines e exige
# que cada um esteja classificado como CORE ou GITHUB_ONLY com razão escrita.
#
# Uma mutação que ADICIONA um gate novo (sem classificação) ao workflow
# deve fazer o guard FALHAR — se passar, ele está CEGO para a classe de
# defeito que existe para impedir.
#
# Pipeline:
#   1. CONTROLE: guard passa no repo real (exit 0 — todos classificados)
#   2. MUTAÇÃO: cria workflow fixture com um gate não classificado
#   3. Roda o guard contra o fixture
#   4. Verifica que o guard FALHOU (exit 1) com a asserção esperada
#   5. Cleanup
#
# Usage:
#   ./scripts/test-mutation-forge-parity.sh
#
# Exit codes:
#   0 — mutação DETECTADA pelo guard (falhou pela asserção esperada) ✅
#   1 — guard CEGO (passou com gate não classificado) OU falha de infra ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-forge-parity.mjs"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
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
  fail "guard FALHOU no repo real (exit $ctrl_exit) — pode haver gate não classificado"
  cat "$CTRL_OUT"
  exit 1
fi

# ── MUTAÇÃO: workflow com gate não classificado ───────────────────────────

header "MUTAÇÃO: gate não classificado no workflow"

# Cria um workflow fixture mínimo com um gate que NÃO está em CORE nem GITHUB_ONLY
FIXTURE_DIR="$TMP_DIR/.github/workflows"
mkdir -p "$FIXTURE_DIR"

cat > "$FIXTURE_DIR/fake-guard.yml" <<'YAML'
name: Fake Guard Workflow

on:
  push:

jobs:
  fake-unclassified-guard:
    name: Fake Guard (não classificado)
    runs-on: self-hosted
    steps:
      - run: echo "gate que ninguém classificou"
YAML

# Roda o guard com o fixture como diretório de workflow
MUT_OUT="$TMP_DIR/mut-out.txt"
MUT_EXIT=0
node "$GUARD" --root "$TMP_DIR" > "$MUT_OUT" 2>&1 || MUT_EXIT=$?

header "VEREDITO"

if [ "$MUT_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com gate não classificado (exit 0)"
  cat "$MUT_OUT"
  exit 1
fi

# Guard falhou — verificar se é pela asserção esperada (gate não classificado)
if grep -qiE "não classificado|NAO CLASSIFICADO|unclassified|classifique|decida" "$MUT_OUT"; then
  pass "mutação DETECTADA: gate não classificado faz o guard FALHAR (exit $MUT_EXIT)"
  exit 0
else
  fail "mutação fez o guard falhar (exit $MUT_EXIT) mas pela RAZÃO ERRADA"
  echo "  Esperado: mensagem sobre gate não classificado"
  echo "  Obtido:"
  cat "$MUT_OUT" | sed 's/^/    /'
  exit 1
fi
