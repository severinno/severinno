#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-doctor-mirrors.sh — Mutation test da COMPARAÇÃO DE
# VALOR dos espelhos do forge-doctor (scripts/forge-doctor.mjs)
#
# Usage:
#   ./scripts/test-mutation-doctor-mirrors.sh
#
# Exit codes:
#   0 — mutação DETECTADA: removida a comparação de valor, o
#       forge-doctor.test.ts fica VERMELHO pela asserção certa ✅
#   1 — suíte CEGA (verde com a mutação) / falhou por outro motivo / a
#       mutação não aplicou / infra ❌
#
# POR QUE: o doctor compara o VALOR dos espelhos (.actrc,
# deploy/env.gitea.example e o .env.gitea do host) com as repository
# variables (vars.BUN_VERSION e as demais do compose). SEM essa comparação,
# dois espelhos que concordam ENTRE SI mas estão os DOIS velhos passam por
# "em sincronia" — o fast path de 0s do tier-1 desliga na forja sem nenhum
# sintoma. Este mutation test remove a comparação (uma linha) e exige que a
# SUÍTE fique vermelha: a regressão não pode voltar em silêncio.
#
# COMO: muta scripts/forge-doctor.mjs IN-PLACE (o teste o lê pelo import real
# — uma cópia em temp não seria exercitada) com backup + trap EXIT de
# restauração, roda o vitest REAL (precisa de node_modules — por isso o home
# é o job do seed-guards.yml, NÃO a matriz node-pura do master) no
# src/lib/__tests__/forge-doctor.test.ts e lê o JSON do reporter
# (--reporter=json) para decidir com FATO estruturado, não com texto:
#
#   CONTROLE — arquivo íntegro → suíte VERDE (success=true, 0 falhas) e o
#     teste do valor DECLARADO existe e passa (fail-fast se ele for
#     renomeado/removido: sem ele a mutação não teria o que acender);
#   MUTAÇÃO  — troca
#       const comparable = MIRROR_VARIABLES.some((name) => wanted[name] !== null && wanted[name] !== "")
#     por
#       const comparable = false
#     (o doctor deixa de perguntar o valor e cai no ramo "sem régua") →
#     suíte VERMELHA (success=false) com:
#       • 'TEMPLATE divergente do valor declarado' FAILING — a asserção que
#         prova a comparação; e
#       • 'env da forja ausente' PASSING — a prova de que a mutação é
#         CIRÚRGICA: o caminho de EXISTÊNCIA (que não é o comparado) segue
#         de pé e o arquivo roda INTEIRO (mesmo nº de testes do controle).
#
# ⚠️ Source-coupled: o sed ancora na linha `const comparable = MIRROR_VARIABLES.some`
# e as asserções nos títulos dos testes ('TEMPLATE divergente do valor
# declarado' / 'env da forja ausente'). Reformular a linha ou renomear os
# testes exige atualizar ESTE script junto (não é guard cego — é o
# acoplamento esperado, como os demais test-mutation-*.sh).
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

DOCTOR="scripts/forge-doctor.mjs"
TEST_FILE="src/lib/__tests__/forge-doctor.test.ts"

TMP_DIR="$(mktemp -d)"
BACKUP_DIR="$TMP_DIR/backup"

RESULTS_CONTROL="$TMP_DIR/control.json"
RESULTS_MUTATION="$TMP_DIR/mutation.json"

# ── Mutação (o bug conhecido) ─────────────────────────────────────────────
# A linha real decide se a régua (o valor declarado) está disponível; a
# mutação a neutraliza, e o doctor passa a NUNCA comparar o valor.
ORIGINAL_MARKER="const comparable = MIRROR_VARIABLES.some"
MUTATED_MARKER="const comparable = false // MUTATION-DOCTOR-MIRRORS"
MUTATION_SED="s|^  const comparable = MIRROR_VARIABLES\\.some.*|  const comparable = false // MUTATION-DOCTOR-MIRRORS|"

# Asserções — títulos de teste (fonte: src/lib/__tests__/forge-doctor.test.ts,
# describe "readMirrors — os espelhos, contra o valor DECLARADO").
#   EXPECTED_FAILURE: o teste que a comparação de valor faz PASSAR — com a
#     comparação removida ele tem de FALHAR (o blocker de drift desaparece).
#   SURGICAL_PASS: o teste do caminho de EXISTÊNCIA (env ausente), que a
#     mutação NÃO toca — ele tem de continuar PASSANDO (mutação cirúrgica).
EXPECTED_FAILURE_TEST="TEMPLATE divergente do valor declarado"
SURGICAL_PASS_TEST="env da forja ausente"

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Restore (trap EXIT — SEMPRE restaura, mesmo com falha) ───────────────
# cp do backup (NUNCA `git checkout --`) para não descartar edições locais
# não-commitadas de quem roda o script na própria máquina.
restore_doctor() {
  if [ -f "$BACKUP_DIR/doctor" ] && [ -f "$DOCTOR" ]; then
    cp "$BACKUP_DIR/doctor" "$DOCTOR"
    echo "  ↻ $DOCTOR restaurado do backup"
  fi
  rm -rf "$TMP_DIR"
}
trap restore_doctor EXIT

# ── Helpers ───────────────────────────────────────────────────────────────

# run_vitest: roda o arquivo de teste com o reporter JSON e captura
# output/exit. $1 = caminho do JSON de resultados.
run_vitest() {
  local results="$1"
  rm -f "$results"
  set +e
  VITEST_LOG="$(bun x vitest run --config vitest.config.unit.ts --reporter=json --outputFile="$results" "$TEST_FILE" 2>&1)"
  VITEST_EXIT=$?
  set -e
}

# results_summary: imprime "success|failed|passed|total" do JSON do vitest.
results_summary() {
  node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    process.stdout.write(
      [j.success, j.numFailedTests, j.numPassedTests, j.numTotalTests].join("|"),
    )
  ' "$1"
}

# test_status: status do teste cujo fullName contém o texto; "absent" se não
# existir. $1 = JSON, $2 = substring do fullName.
test_status() {
  node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const sub = process.argv[2]
    const hits = (j.testResults ?? [])
      .flatMap((f) => f.assertionResults ?? [])
      .filter((r) => (r.fullName ?? "").includes(sub))
    process.stdout.write(
      hits.length === 0 ? "absent" : hits.map((h) => h.status).join(","),
    )
  ' "$1" "$2"
}

# ── CONTROLE — doctor íntegro → suíte VERDE ──────────────────────────────
# Prova que o fixture base é válido e que o teste da comparação EXISTE e
# passa antes da mutação (sem isso a detecção abaixo seria vácuo).
assert_control_pass() {
  info "CONTROLE — doctor íntegro → suíte deve ficar VERDE (exit 0)..."
  run_vitest "$RESULTS_CONTROL"
  echo "$VITEST_LOG" | tail -6

  if [ ! -f "$RESULTS_CONTROL" ]; then
    fail "CONTROLE FALHOU: o vitest não produziu o JSON de resultados."
    fail "Ambiente sem node_modules? Este script precisa de bun install."
    exit 1
  fi

  local summary success failed total
  summary="$(results_summary "$RESULTS_CONTROL")"
  success="${summary%%|*}"
  failed="$(echo "$summary" | cut -d'|' -f2)"
  total="$(echo "$summary" | cut -d'|' -f4)"

  if [ "$VITEST_EXIT" -ne 0 ] || [ "$success" != "true" ] || [ "$failed" != "0" ]; then
    fail "CONTROLE FALHOU: suíte não ficou verde com o doctor ÍNTEGRO"
    fail "  (exit=$VITEST_EXIT, success=$success, failed=$failed)."
    fail "O fixture base não é válido — o mutation test não pode prosseguir."
    exit 1
  fi

  # Fail-fast: o teste que a mutação deve acender precisa EXISTIR e passar
  # agora. Se ele foi renomeado/removido, o script falha AQUI (e não passa
  # vacuamente depois, com uma mutação que ninguém detecta).
  local expected_now surgical_now
  expected_now="$(test_status "$RESULTS_CONTROL" "$EXPECTED_FAILURE_TEST")"
  surgical_now="$(test_status "$RESULTS_CONTROL" "$SURGICAL_PASS_TEST")"
  if [ "$expected_now" != "passed" ] || [ "$surgical_now" != "passed" ]; then
    fail "CONTROLE FALHOU: os testes-âncora não estão no estado esperado."
    fail "  '$EXPECTED_FAILURE_TEST' → '$expected_now' (esperado 'passed')"
    fail "  '$SURGICAL_PASS_TEST' → '$surgical_now' (esperado 'passed')"
    fail "Renomeou/removeu um teste? Atualize as asserções DESTE script junto."
    exit 1
  fi

  CONTROL_TOTAL="$total"
  pass "Controle OK — $total testes verdes, incluindo o do valor DECLARADO"
}

# ── MUTAÇÃO — comparação de valor REMOVIDA → suíte VERMELHA ──────────────
assert_mutation_detected() {
  info "MUTAÇÃO — comparação de valor removida → suíte deve ficar VERMELHA..."
  run_vitest "$RESULTS_MUTATION"
  echo "$VITEST_LOG" | tail -6

  # Caso 0 — SUÍTE CEGA: passou com a regressão aplicada. É exatamente a
  # falha silenciosa que este cenário existe para impedir.
  if [ "$VITEST_EXIT" -eq 0 ]; then
    fail "SUÍTE CEGA: o forge-doctor.test.ts passou (exit 0) com a comparação"
    fail "de valor REMOVIDA — a regressão voltaria em silêncio."
    exit 1
  fi

  if [ ! -f "$RESULTS_MUTATION" ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o vitest não produziu JSON (a mutação quebrou"
    fail "o carregamento do arquivo, e não só a comparação)."
    exit 1
  fi

  local summary success failed total
  summary="$(results_summary "$RESULTS_MUTATION")"
  success="${summary%%|*}"
  failed="$(echo "$summary" | cut -d'|' -f2)"
  total="$(echo "$summary" | cut -d'|' -f4)"

  # Caso 1 — falhou por INFRA/erro de carregamento, não por asserção: o
  # arquivo não rodou inteiro (menos testes que o controle) ou o reporter
  # saiu sem falhas de teste.
  if [ "$success" != "false" ] || [ "$failed" = "0" ] || [ "$total" != "$CONTROL_TOTAL" ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: a suíte falhou por outro motivo"
    fail "  (success=$success, failed=$failed, total=$total; controle=$CONTROL_TOTAL)."
    fail "A mutação tem de derrubar SÓ a comparação, não o arquivo inteiro."
    exit 1
  fi

  # Caso 2 — o teste-âncora da comparação NÃO ficou vermelho: a suíte falhou,
  # mas por outra razão — não dá para afirmar que ela pega ESTA regressão.
  local expected_now surgical_now
  expected_now="$(test_status "$RESULTS_MUTATION" "$EXPECTED_FAILURE_TEST")"
  if [ "$expected_now" != "failed" ]; then
    fail "Suíte vermelha, mas SEM a asserção esperada falhando:"
    fail "  '$EXPECTED_FAILURE_TEST' → '$expected_now' (esperado 'failed')"
    fail "A falha pode ser outro invariante — veja o log acima."
    exit 1
  fi

  # Caso 3 — o caminho de EXISTÊNCIA também caiu: a mutação não foi cirúrgica
  # (não removeu SÓ a comparação), então a prova não isola a causa.
  surgical_now="$(test_status "$RESULTS_MUTATION" "$SURGICAL_PASS_TEST")"
  if [ "$surgical_now" != "passed" ]; then
    fail "Mutação NÃO-CIRÚRGICA: o caminho de EXISTÊNCIA também caiu"
    fail "  '$SURGICAL_PASS_TEST' → '$surgical_now' (esperado 'passed')"
    fail "A mutação deve remover SÓ a comparação de valor."
    exit 1
  fi

  pass "Mutação DETECTADA: suíte VERMELHA ($failed de $total testes falharam)"
  pass "  • '$EXPECTED_FAILURE_TEST' → FAILED (a comparação) "
  pass "  • '$SURGICAL_PASS_TEST' → PASSED (mutação cirúrgica)"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (espelhos do doctor, comparação de valor)"
echo "   Mutação: 'const comparable = MIRROR_VARIABLES.some(...)' → false"
echo "   (scripts/forge-doctor.mjs IN-PLACE, backup + trap de restauração)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── Backup ANTES de qualquer mutação (o trap restaura a partir dele) ─────

mkdir -p "$BACKUP_DIR"
cp "$DOCTOR" "$BACKUP_DIR/doctor"
pass "Backup do doctor criado ($BACKUP_DIR/doctor)"

# ── CONTROLE ──────────────────────────────────────────────────────────────

assert_control_pass

# ── MUTAÇÃO ───────────────────────────────────────────────────────────────
# Fail-fast da mutação: a linha original presente ANTES; ausente + a marcada
# presente DEPOIS; e o arquivo mutado ainda é sintaticamente válido.

info "Aplicando mutação: neutralizando a régua da comparação de valor..."
if ! grep -Fq "$ORIGINAL_MARKER" "$DOCTOR"; then
  fail "MUTAÇÃO NÃO APLICOU: a linha original não existe em $DOCTOR"
  fail "  esperava:  $ORIGINAL_MARKER"
  fail "O doctor foi refatorado? Atualize o sed DESTE script junto."
  exit 1
fi

sed -i "$MUTATION_SED" "$DOCTOR"

if grep -Fq "$ORIGINAL_MARKER" "$DOCTOR" || ! grep -Fq "$MUTATED_MARKER" "$DOCTOR"; then
  fail "MUTAÇÃO NÃO APLICOU (o sed não trocou a linha)."
  exit 1
fi
if ! node --check "$DOCTOR" >/dev/null 2>&1; then
  fail "MUTAÇÃO NÃO-CIRÚRGICA: o arquivo mutado não é válido sintaticamente."
  exit 1
fi
pass "Mutação aplicada: comparação de valor neutralizada (sintaxe válida)"

assert_mutation_detected

# ═════════════════════════════════════════════════════════════════════════
# Result (restore roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — a remoção da comparação de valor dos espelhos"
pass "  do doctor FAZ a suíte ficar vermelha; a regressão não volta em silêncio."
pass "  • controle: doctor íntegro → verde (o teste-âncora existe e passa)"
pass "  • mutação: comparação neutralizada → vermelha pela asserção do valor"
pass "  • cirúrgica: o caminho de EXISTÊNCIA segue verde e o arquivo roda inteiro"
exit 0
