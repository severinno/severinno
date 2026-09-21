#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-readme-guards.sh — Mutation tests CONSOLIDADOS dos
# guards node-puro de README (anchors + toc + images)
#
# Roda os 3 mutation tests dos guards de README num ÚNICO script com MATRIZ
# de cenários — o pr-check roda o MASTER mutation-guards, que o inclui como
# sub-test 'readme' (scripts/test-mutation-guards.sh), reduzindo o overhead
# de setup por job (checkout + container por job) SEM perder a granularidade
# de diagnóstico:
# cada cenário roda o seu script granular original (que imprime os STEPS
# detalhados de CONTROLE/MUTAÇÃO) e o harness reporta o verdict por cenário
# + tabela final.
#
# Matriz de cenários (id|descrição|script granular):
#   anchors → scripts/test-mutation-readme-anchors.sh
#             heading renomeado (forward) + label errado (reverse)
#   toc     → scripts/test-mutation-readme-toc.sh
#             parágrafo→heading antes do índice (heading fora do TOC)
#   images  → scripts/test-mutation-readme-images.sh
#             count-pin derivado (badge removido) + src inexistente
#
# Cada script granular é a FONTE ÚNICA do seu cenário (sem duplicação de
# fixtures/mutações/asserções — o harness só orquestra). TODOS os cenários
# rodam mesmo se um falhar (fail-CONTINUE, não fail-fast) — o exit final é
# agregado: 0 se TODOS passarem, 1 se QUALQUER um falhar.
#
# Usage:
#   ./scripts/test-mutation-readme-guards.sh              # matriz completa
#   ./scripts/test-mutation-readme-guards.sh --scenario toc   # 1 cenário
#   ./scripts/test-mutation-readme-guards.sh --list       # lista a matriz
#
# Exit codes:
#   0 — todos os cenários passaram (mutações detectadas) ✅
#   1 — pelo menos um cenário falhou (guard cego / asserção / infra) ❌
#   2 — uso inválido (--scenario com id desconhecido, flag desconhecida)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'anchors|heading renomeado (forward) + label errado (reverse) na âncora'
  'toc|parágrafo virado heading antes do índice (heading fora do TOC)'
  'images|count-pin derivado (badge removido) + src inexistente'
)

# ── Matriz de cenários ────────────────────────────────────────────────────
# Formato: id|descrição curta|script granular relativo a SCRIPT_DIR.
# Adicionar um guard novo = adicionar UMA linha aqui (o script granular já
# deve existir com exit 0 = mutação detectada).
SCENARIOS=(
  "anchors|Anchors — heading renomeado (forward) + label errado (reverse)|scripts/test-mutation-readme-anchors.sh"
  "toc|TOC — parágrafo→heading antes do índice|scripts/test-mutation-readme-toc.sh"
  "images|Images — count-pin derivado + src inexistente|scripts/test-mutation-readme-images.sh"
)

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Parse de flags ────────────────────────────────────────────────────────

LIST_ONLY=false
SELECTED_ID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --list)
      LIST_ONLY=true
      shift
      ;;
    --scenario)
      if [ $# -lt 2 ]; then
        fail "Uso: --scenario <id> (falta o id)"
        exit 2
      fi
      SELECTED_ID="$2"
      shift 2
      ;;
    *)
      fail "Flag desconhecida: $1 (use --scenario <id> | --list)"
      exit 2
      ;;
  esac
done

# ── --list: imprime a matriz e sai ────────────────────────────────────────

if [ "$LIST_ONLY" = true ]; then
  echo ""
  info "Matriz de cenários do test-mutation-readme-guards.sh:"
  echo ""
  for entry in "${SCENARIOS[@]}"; do
    id="${entry%%|*}"
    rest="${entry#*|}"
    desc="${rest%%|*}"
    printf "   %-10s %s\n" "• $id" "— $desc"
  done
  echo ""
  exit 0
fi

# ── Valida --scenario (id conhecido?) ─────────────────────────────────────

if [ -n "$SELECTED_ID" ]; then
  FOUND=false
  for entry in "${SCENARIOS[@]}"; do
    id="${entry%%|*}"
    if [ "$id" = "$SELECTED_ID" ]; then
      FOUND=true
      break
    fi
  done
  if [ "$FOUND" = false ]; then
    fail "Cenário desconhecido: '$SELECTED_ID'. Cenários disponíveis:"
    for entry in "${SCENARIOS[@]}"; do
      id="${entry%%|*}"
      echo "   - $id"
    done
    exit 2
  fi
fi

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TESTS CONSOLIDADOS (guards de README)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── Executa a matriz (fail-CONTINUE: todos rodam, exit agregado) ────────

TOTAL=0
PASSED=0
FAILED_LIST=()

for entry in "${SCENARIOS[@]}"; do
  id="${entry%%|*}"
  rest="${entry#*|}"
  desc="${rest%%|*}"
  script="${rest#*|}"

  if [ -n "$SELECTED_ID" ] && [ "$id" != "$SELECTED_ID" ]; then
    continue
  fi

  TOTAL=$((TOTAL + 1))

  echo "  ───────────────────────────────────────────────────────────────"
  printf "   ${CYAN}▶ Cenário [%s]${NC} — %s\n" "$id" "$desc"
  echo "  ───────────────────────────────────────────────────────────────"

  set +e
  SCENARIO_OUTPUT="$(bash "$SCRIPT_DIR/$script" 2>&1)"
  SCENARIO_EXIT=$?
  set -e

  # granularidade preservada: imprime o output COMPLETO do script granular
  echo "$SCENARIO_OUTPUT"

  if [ "$SCENARIO_EXIT" -eq 0 ]; then
    pass "Cenário [$id] PASS (exit 0)"
    PASSED=$((PASSED + 1))
  else
    fail "Cenário [$id] FALHOU (exit $SCENARIO_EXIT)"
    FAILED_LIST+=("$id")
  fi
  echo ""
done

# ── Tabela final ─────────────────────────────────────────────────────────

echo "  ═════════════════════════════════════════════════════════════════"
echo "   📊 RESUMO — mutation tests de guards de README"
echo "  ═════════════════════════════════════════════════════════════════"
printf "   %-10s %-6s %s\n" "Cenário" "Result" "Status"
for entry in "${SCENARIOS[@]}"; do
  id="${entry%%|*}"
  if [ -n "$SELECTED_ID" ] && [ "$id" != "$SELECTED_ID" ]; then
    continue
  fi
  # Verdict da célula = SOMENTE a pertença a FAILED_LIST (sem gate de
  # PASSED: com todos os cenários falhando, PASSED=0 — um gate `$PASSED
  # -gt 0 &&` faria a condição curto-circuitar e TODAS as linhas sairiam
  # como PASS no momento exato em que tudo falhou).
  # Herestring (não pipe): sob `set -o pipefail`, `printf | grep -qx` pode
  # falhar por SIGPIPE (o grep -q fecha o stdin cedo) — flaky pelo tamanho.
  if grep -qx "$id" <<<"$(printf '%s\n' "${FAILED_LIST[@]}")"; then
    printf "   %-10s ${RED}%-6s${NC} ❌\n" "$id" "FAIL"
  else
    printf "   %-10s ${GREEN}%-6s${NC} ✅\n" "$id" "PASS"
  fi
done
echo ""
printf "   Total: %d | Passed: %d | Failed: %d\n" "$TOTAL" "$PASSED" "${#FAILED_LIST[@]}"
echo ""

if [ "${#FAILED_LIST[@]}" -gt 0 ]; then
  fail "MUTATION TESTS FALHARAM: ${FAILED_LIST[*]} — um cenário não detectou a"
  fail "mutação (guard cego / asserção quebrada) ou o script granular falhou."
  exit 1
fi

pass "MUTATION TESTS PASSED — os guards de README (anchors, toc, images) detectam todas as mutações."
exit 0
