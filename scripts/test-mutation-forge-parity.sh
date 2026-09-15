#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-forge-parity.sh — Mutation test do check-forge-parity
#
# Prova que o scripts/check-forge-parity.mjs REALMENTE falha nas DUAS classes de
# defeito que ele existe para pegar:
#
#   A) gate NOVO na forja DONA DO MERGE sem classificação  → NAO CLASSIFICADO
#      (a regressão que motivou o guard: um gate novo pulando a forja em
#      silêncio — o PR passa verde por onde rodou e a invariante some da outra)
#   B) gate NOVO no espelho GitHub sem classificação       → NAO CLASSIFICADO
#   C) gate classificado como GITHUB_ONLY que RODA na forja → classificação
#      stale (o gate roda lá ou a classificação mente)
#
# COMO (e por que assim): o guard roda com `--root` contra um FIXTURE que é uma
# CÓPIA dos dois pipelines REAIS (`.gitea/workflows/ci.yml`, o dono do merge, e
# `.github/workflows/pr-check.yml`), com a mutação injetada no arquivo copiado.
# O worktree nunca é tocado e o CONTROLE (cópia sem mutação → exit 0) prova que
# o fixture é fiel: sem ele, um guard que falhasse "de qualquer jeito" passaria
# como detecção. A versão anterior rodava com `--root`, que o guard IGNORAVA
# (lia o cwd) — a mutação nunca era lida e o harness se declarava CEGO.
#
# Pipeline:
#   1. Fixture = cópia dos 2 pipelines reais
#   2. CONTROLE: guard --root fixture → exit 0
#   3. MUTAÇÃO A: gate não classificado na forja (dona do merge) → DEVE FALHAR
#   4. MUTAÇÃO B: gate não classificado no espelho GitHub → DEVE FALHAR
#   5. MUTAÇÃO C: gate GITHUB_ONLY rodando na forja → DEVE FALHAR (stale)
#   6. Cleanup (trap EXIT)
#
# Usage:
#   ./scripts/test-mutation-forge-parity.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard + controle passa ✅
#   1 — guard CEGO (alguma mutação passou) OU controle falso-positivo ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-forge-parity.mjs"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

GITEA_WF=".gitea/workflows/ci.yml"
GITHUB_WF=".github/workflows/pr-check.yml"
FIXTURE="$TMP_DIR/fixture"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-forge-parity deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"

# ── Fixture: cópia FIEL dos dois pipelines ────────────────────────────────

make_fixture() {
  rm -rf "${FIXTURE:?}"
  mkdir -p "$FIXTURE/.gitea/workflows" "$FIXTURE/.github/workflows"
  cp "$SCRIPT_DIR/$GITEA_WF" "$FIXTURE/$GITEA_WF"
  cp "$SCRIPT_DIR/$GITHUB_WF" "$FIXTURE/$GITHUB_WF"
}

# Injeta um job novo (gate) no fim de um pipeline do fixture.
# $1 = caminho relativo do workflow | $2 = comando `run:` do gate
inject_gate() {
  local wf="$1" cmd="$2"
  {
    echo ""
    echo "  mutacao-gate-injetado:"
    echo "    name: Mutacao (gate injetado)"
    echo "    runs-on: self-hosted"
    echo "    steps:"
    echo "      - run: $cmd"
  } >> "$FIXTURE/$wf"
}

run_guard() {
  set +e
  node "$GUARD" --root "$FIXTURE" > "$TMP_DIR/out.txt" 2>&1
  GUARD_EXIT=$?
  set -e
}

# ── CONTROLE ──────────────────────────────────────────────────────────────

header "CONTROLE: fixture (cópia fiel dos 2 pipelines) passa"
make_fixture
run_guard
if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU (exit $GUARD_EXIT): a cópia fiel dos pipelines foi rejeitada"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "cópia fiel passa (exit 0) — o guard não falha 'de qualquer jeito'"

# ── MUTAÇÃO A: gate não classificado na forja (dona do merge) ─────────────

header "MUTAÇÃO A: gate não classificado na FORJA (dona do merge)"
make_fixture
inject_gate "$GITEA_WF" "node scripts/check-gate-nao-classificado-fake.mjs"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com gate não classificado na forja (exit 0)"
  exit 1
fi
if ! grep -qF "NAO CLASSIFICADO" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO citou gate não classificado"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
if ! grep -qF "check-gate-nao-classificado-fake.mjs" "$TMP_DIR/out.txt"; then
  fail "guard falhou mas NÃO nomeou o gate injetado"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação A DETECTADA: a forja não tem gate sem classificação (exit $GUARD_EXIT)"

# ── MUTAÇÃO B: gate não classificado no espelho GitHub ────────────────────

header "MUTAÇÃO B: gate não classificado no ESPELHO GitHub"
make_fixture
inject_gate "$GITHUB_WF" "node scripts/check-gate-nao-classificado-fake.mjs"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com gate não classificado no GitHub (exit 0)"
  exit 1
fi
if ! grep -qF "NAO CLASSIFICADO" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO citou gate não classificado"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação B DETECTADA: o espelho GitHub também exige classificação (exit $GUARD_EXIT)"

# ── MUTAÇÃO C: classificação stale (github-only rodando na forja) ─────────

header "MUTAÇÃO C: gate github-only RODANDO na forja (classificação stale)"
make_fixture
inject_gate "$GITEA_WF" "node scripts/check-dependency-review.mjs"
run_guard

if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "guard CEGO: passou com classificação stale na forja (exit 0)"
  exit 1
fi
if ! grep -qF "classificado como GITHUB_ONLY mas RODA aqui" "$TMP_DIR/out.txt"; then
  fail "guard falhou (exit $GUARD_EXIT) mas NÃO citou a classificação stale"
  sed 's/^/    /' "$TMP_DIR/out.txt" | head -8
  exit 1
fi
pass "mutação C DETECTADA: a isenção não pode mentir sobre onde o gate roda (exit $GUARD_EXIT)"

header "VEREDITO"
pass "MUTATION TEST PASSED — check-forge-parity pega gate novo sem classificação"
pass "(forja E espelho) e isenção stale, com o fixture como única entrada."
exit 0
