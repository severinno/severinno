#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-no-setup-bun.sh — Mutation test do guard check-no-setup-bun
#
# Prova que o scripts/check-no-setup-bun.mjs REALMENTE pega a reintrodução de
# oven-sh/setup-bun nos workflows — e pega nas DUAS forjas (o escopo que o guard
# perdeu em 09/2026, quando a forja virou dona do merge e reintroduziu o action
# externo em 3 call sites sem ninguém reclamar).
#
# COMO (e por que assim): o guard é executado com `--root` contra um FIXTURE
# mínimo (só os diretórios de workflow), exatamente como
# test-mutation-mutation-count.sh faz. A versão anterior deste script rodava o
# guard no repo REAL depois de copiar o fixture para dentro do worktree — o
# fixture era lido, mas o veredito lia o exit code da sondagem da função pura
# (`require()` do módulo ESM), interpretando "a função ACHOU a ocorrência" como
# "o guard passou": o harness invertia a evidência e se declarava CEGO enquanto
# a detecção funcionava. Aqui a evidência é o EXIT CODE do guard real, com o
# fixture como raiz — sem tocar o worktree e sem caminho morto.
#
# Pipeline:
#   1. CONTROLE (repo real): guard passa (exit 0 — nenhuma ocorrência)
#   2. CONTROLE (fixture limpo): guard --root fixture → exit 0
#   3. MUTAÇÃO A (.github/workflows): action reintroduzido → DEVE FALHAR (exit 1)
#   4. MUTAÇÃO B (.gitea/workflows): action reintroduzido na forja DONA DO MERGE
#      → DEVE FALHAR (exit 1) — a regressão que o escopo Gitea existe para pegar
#   5. INFRA: --root inexistente → exit 2 (fail-closed, nunca "passou")
#   6. Cleanup (trap EXIT)
#
# Usage:
#   ./scripts/test-mutation-no-setup-bun.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard + controles passam ✅
#   1 — guard CEGO (alguma mutação passou) OU controle falso-positivo ❌
# =============================================================================

set -euo pipefail

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

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'A|oven-sh/setup-bun reintroduzido em .github/workflows'
  'B|o action reintroduzido na forja DONA DO MERGE (.gitea/workflows)'
)
GUARD="$SCRIPT_DIR/scripts/check-no-setup-bun.mjs"

# A versão do FIXTURE vem do ESPELHO do repositório (.actrc) — o call site do
# fixture cita uma versão, e um literal aqui envelheceria sozinho depois do bump
# (o fixture passaria a testar uma versão que o repo não declara). Fail-closed:
# sem a linha, o script PARA em vez de inventar uma reserva.
FIXTURE_VERSION="$(sed -n 's/^--var BUN_VERSION=//p' "$SCRIPT_DIR/.actrc" 2>/dev/null | head -1 || true)"
if [ -z "$FIXTURE_VERSION" ]; then
  echo "❌ .actrc não declara '--var BUN_VERSION=' — o fixture precisa de uma versão DECLARADA" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-no-setup-bun deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"

# ── CONTROLE 1: repo real ─────────────────────────────────────────────────

header "CONTROLE: guard passa no repo real"
if node "$GUARD" > "$TMP_DIR/ctrl-real.txt" 2>&1; then
  pass "guard PASS no repo real (exit 0)"
else
  ctrl_exit=$?
  fail "guard FALHOU no repo real (exit $ctrl_exit)"
  cat "$TMP_DIR/ctrl-real.txt"
  exit 1
fi

# ── make_fixture: cria um sandbox com (ou sem) o action proibido ──────────
# $1 = forge dir (`.github/workflows` | `.gitea/workflows`) | $2 = "mutado"|"limpo"

make_fixture() {
  local forge_dir="$1" mode="${2:-mutado}"
  rm -rf "${TMP_DIR:?}/fixture"
  mkdir -p "$TMP_DIR/fixture/$forge_dir"
  if [ "$mode" = "mutado" ]; then
    cat > "$TMP_DIR/fixture/$forge_dir/ci.yml" <<'YAML'
name: Fake CI

on:
  push:

jobs:
  check:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun test
YAML
  else
    # Heredoc SEM quotes: a versão do fixture é DERIVADA (ver o topo).
    cat > "$TMP_DIR/fixture/$forge_dir/ci.yml" <<YAML
name: Fake CI

on:
  push:

jobs:
  check:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - run: bash scripts/setup-bun-ci.sh $FIXTURE_VERSION
YAML
  fi
}

# ── CONTROLE 2: fixture limpo ─────────────────────────────────────────────

header "CONTROLE: fixture limpo (setup-bun-ci.sh) NÃO acende o guard"
make_fixture ".github/workflows" "limpo"
set +e
node "$GUARD" --root "$TMP_DIR/fixture" > "$TMP_DIR/ctrl-clean.txt" 2>&1
CTRL_CLEAN_EXIT=$?
set -e
if [ "$CTRL_CLEAN_EXIT" -ne 0 ]; then
  fail "FALSO POSITIVO: fixture limpo rejeitado (exit $CTRL_CLEAN_EXIT)"
  cat "$TMP_DIR/ctrl-clean.txt"
  exit 1
fi
pass "fixture limpo passa (exit 0)"

# ── MUTAÇÃO A: oven-sh/setup-bun no GitHub ────────────────────────────────

header "MUTAÇÃO A: oven-sh/setup-bun reintroduzido em .github/workflows"
make_fixture ".github/workflows" "mutado"
set +e
node "$GUARD" --root "$TMP_DIR/fixture" > "$TMP_DIR/mut-a.txt" 2>&1
MUT_A_EXIT=$?
set -e

if [ "$MUT_A_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com oven-sh/setup-bun no GitHub (exit 0)"
  exit 1
fi
if ! grep -qiE "oven-sh/setup-bun|setup-bun" "$TMP_DIR/mut-a.txt"; then
  fail "guard falhou (exit $MUT_A_EXIT) mas pela RAZÃO ERRADA"
  sed 's/^/    /' "$TMP_DIR/mut-a.txt"
  exit 1
fi
if ! grep -qF ".github/workflows/" "$TMP_DIR/mut-a.txt"; then
  fail "guard falhou mas NÃO nomeou o arquivo da forja GitHub"
  sed 's/^/    /' "$TMP_DIR/mut-a.txt"
  exit 1
fi
pass "mutação A DETECTADA: GitHub com o action externo faz o guard falhar (exit $MUT_A_EXIT)"

# ── MUTAÇÃO B: oven-sh/setup-bun na FORJA (dona do merge) ─────────────────

header "MUTAÇÃO B: oven-sh/setup-bun reintroduzido em .gitea/workflows"
make_fixture ".gitea/workflows" "mutado"
set +e
node "$GUARD" --root "$TMP_DIR/fixture" > "$TMP_DIR/mut-b.txt" 2>&1
MUT_B_EXIT=$?
set -e

if [ "$MUT_B_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com oven-sh/setup-bun na forja DONA DO MERGE (exit 0)"
  exit 1
fi
if ! grep -qF ".gitea/workflows/" "$TMP_DIR/mut-b.txt"; then
  fail "guard falhou mas NÃO nomeou o arquivo da forja — o escopo Gitea está fora"
  sed 's/^/    /' "$TMP_DIR/mut-b.txt"
  exit 1
fi
pass "mutação B DETECTADA: a forja dona do merge está DENTRO da cobertura (exit $MUT_B_EXIT)"

# ── INFRA: --root inexistente é fail-closed ───────────────────────────────

header "INFRA: --root inexistente NÃO pode passar como limpo"
set +e
node "$GUARD" --root "$TMP_DIR/nao-existe" > "$TMP_DIR/infra.txt" 2>&1
INFRA_EXIT=$?
set -e

if [ "$INFRA_EXIT" -ne 2 ]; then
  fail "esperado exit 2 (infra) para --root inexistente, obtido $INFRA_EXIT"
  sed 's/^/    /' "$TMP_DIR/infra.txt"
  exit 1
fi
pass "'--root' inexistente é fail-closed (exit 2)"

header "VEREDITO"
pass "MUTATION TEST PASSED — check-no-setup-bun pega o action externo nas duas"
pass "forjas, não falso-positiva no call site canônico e é fail-closed sem a raiz."
exit 0
