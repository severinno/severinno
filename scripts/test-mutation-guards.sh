#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-guards.sh — Mutation tests MASTER dos guards node-puro
#
# Roda os 15 mutation tests node-puro dos guards de CI num ÚNICO script com
# MATRIZ de sub-tests — o pr-check passa a rodar UM job só (mutation-guards)
# em vez de 5 jobs separados, reduzindo o overhead de setup por job
# (checkout + container por job) SEM perder a granularidade de diagnóstico:
# cada sub-test roda o seu script granular original (que imprime os STEPS
# detalhados de CONTROLE/MUTAÇÃO) e o harness reporta o verdict por sub-test
# + tabela final.
#
# Usage:
#   ./scripts/test-mutation-guards.sh                    # matriz completa
#   ./scripts/test-mutation-guards.sh --scenario readme  # 1 sub-test
#   ./scripts/test-mutation-guards.sh --list             # lista a matriz
#
# Exit codes:
#   0 — todos os sub-tests passaram (mutações detectadas) ✅
#   1 — pelo menos um sub-test falhou (guard cego / asserção / infra) ❌
#   2 — uso inválido (--scenario com id desconhecido, flag desconhecida)
#
# Matriz de sub-tests (id|descrição|script granular):
#   bun-literal    → scripts/test-mutation-bun-literal.sh
#                    bun-version LITERAL em workflow deve FALHAR (drift)
#   bun-removal    → scripts/test-mutation-bun-removal.sh
#                    REMOÇÃO do input bun-version (--staged) deve FALHAR
#   hooks-symmetry → scripts/test-mutation-hooks-symmetry.sh
#                    guard novo no pre-commit + linha stale devem FALHAR
#   readme         → scripts/test-mutation-readme-guards.sh  (matriz aninhada:
#                    anchors + toc + images — 1 sub-test, 0 re-rodada dupla)
#   readme-reverse → scripts/test-mutation-readme-reverse.sh
#                    drift SEMÂNTICO do README (baseline reverse) deve FALHAR
#   docs-anchor    → scripts/test-mutation-readme-docs-anchor.sh
#                    âncora quebrada em docs/*.md (fixture COM docs/) deve
#                    FALHAR — cobre o scan default dos docs (discoverDocTargets)
#   producer-sent  → scripts/test-mutation-producer-sentinel.sh
#                    sentinel 'com CRLF' REMOVIDO do audit_blob_crlf_history.py
#                    (cópia em temp) deve FALHAR o validate-all-text-alert.test.ts
#   mutation-jobs  → scripts/test-mutation-mutation-jobs.sh
#                    script órfão (forward) + matriz quebrada (reverse) do
#                    check-mutation-jobs devem FALHAR
#   workflow-refs  → scripts/test-mutation-workflow-refs.sh
#                    alvo TRANSITIVO de entry deletado (workflow bun run →
#                    scripts/X) + entry órfã do --pkg-internal devem FALHAR
#   utf8-scope     → scripts/test-mutation-utf8-scope.sh
#                    call site sem src/ deve FALHAR
#   timing-budget  → scripts/test-mutation-timing-budget.sh
#                    payload 300s > budget 240s do measure-mutation-timing
#                    deve FALHAR (exit 1) + controle 35s passa + warn-only
#                    + DRIFT: step renomeado → exit 2 (drift de contrato)
#                    + MEDIAN: faixa soft DERIVADA da mediana (--warn-median
#                    4 --warn-margin 0.2 — controle/warn/mutação/validação)
#                    + DRIFT RELATIVO: --fail-drift 50% vs mediana 62.5s —
#                    100s (+60%) falha exit 1 ANTES do teto; teto 240s
#                    segue falhando (300s vs mediana alta 227.5s, +31.87%
#                    < 50%, só exceeded); controle 35s/80s passam (drift
#                    negativo / +28% < threshold)
#   e2e-cache-budget → scripts/test-mutation-e2e-cache-budget.sh
#                    gate de budget de 10 min (600s) do job 'E2E Cache':
#                    payload 900s > 600s deve FALHAR (exit 1) + controle
#                    300s passa + warn 500s + drift exit 2. SKIP (exit 0)
#                    enquanto scripts/measure-e2e-cache.mjs não existir —
#                    ativa sozinho quando o medidor for criado
#   no-leaked-imports → scripts/test-mutation-no-leaked-imports.sh
#                    import de dep NÃO declarada que resolve no node_modules
#                    do PAI (worktree aninhado — o bug do z-ai-web-dev-sdk)
#                    deve FALHAR; dep inexistente deve FALHAR; dep declarada
#                    com install pendente deve PASSAR (exit 0)
#
# Cada script granular é a FONTE ÚNICA do seu cenário (sem duplicação de
# fixtures/mutações/asserções — o harness só orquestra). TODOS os sub-tests
# rodam mesmo se um falhar (fail-CONTINUE, não fail-fast) — o exit final é
# agregado: 0 se TODOS passarem, 1 se QUALQUER um falhar.
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Matriz de sub-tests ───────────────────────────────────────────────────
# Formato: id|descrição curta|script granular relativo a SCRIPT_DIR.
# Adicionar um mutation test node-puro novo = adicionar UMA linha aqui (o
# script granular já deve existir com exit 0 = mutação detectada).
SUBTESTS=(
  "bun-literal|Bun — literal bun-version em workflow|scripts/test-mutation-bun-literal.sh"
  "bun-removal|Bun --staged — remoção do input bun-version|scripts/test-mutation-bun-removal.sh"
  "hooks-symmetry|Hooks — guard novo no pre-commit + linha stale|scripts/test-mutation-hooks-symmetry.sh"
  "readme|README — anchors + toc + images (matriz aninhada)|scripts/test-mutation-readme-guards.sh"
  "readme-reverse|README — drift semântico (baseline reverse) deve FALHAR|scripts/test-mutation-readme-reverse.sh"
  "docs-anchor|Docs — âncora quebrada em docs/*.md (fixture com docs/)|scripts/test-mutation-readme-docs-anchor.sh"
  "producer-sent|Produtor — sentinel 'com CRLF' removido do audit all-text|scripts/test-mutation-producer-sentinel.sh"
  "mutation-jobs|Mutation-jobs — script órfão + matriz quebrada|scripts/test-mutation-mutation-jobs.sh"
  "workflow-refs|Workflow-refs — alvo transitivo deletado + entry órfã|scripts/test-mutation-workflow-refs.sh"
  "utf8-scope|UTF-8 — call site sem src/|scripts/test-mutation-utf8-scope.sh"
  "timing-budget|Timing — gate de budget 240/180/100s (três faixas) + drift exit 2 + faixa soft derivada da mediana (--warn-median) + gate de drift relativo (--fail-drift) do mutation-coord|scripts/test-mutation-timing-budget.sh"
  "e2e-cache-budget|E2E Cache — gate de budget 600s (10 min) + drift exit 2 (SKIP até medidor)|scripts/test-mutation-e2e-cache-budget.sh"
  "lint-guard|Lint Guard — prettier --check + eslint --max-warnings 0 devem FALHAR (arquivo mal formatado / warning)|scripts/test-mutation-lint-guard.sh"
  "mutation-count|Count — drift do nº de sub-tests (job name/summary/README) deve FALHAR|scripts/test-mutation-mutation-count.sh"
  "no-leaked-imports|No-leaked-imports — import resolvendo no node_modules do PAI + dep inexistente devem FALHAR (install pendente passa)|scripts/test-mutation-no-leaked-imports.sh"
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
  info "Matriz de sub-tests do test-mutation-guards.sh:"
  echo ""
  for entry in "${SUBTESTS[@]}"; do
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
  for entry in "${SUBTESTS[@]}"; do
    id="${entry%%|*}"
    if [ "$id" = "$SELECTED_ID" ]; then
      FOUND=true
      break
    fi
  done
  if [ "$FOUND" = false ]; then
    fail "Sub-test desconhecido: '$SELECTED_ID'. Sub-tests disponíveis:"
    for entry in "${SUBTESTS[@]}"; do
      id="${entry%%|*}"
      echo "   - $id"
    done
    exit 2
  fi
fi

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TESTS MASTER (guards node-puro)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── Executa a matriz (fail-CONTINUE: todos rodam, exit agregado) ────────

TOTAL=0
PASSED=0
FAILED_LIST=()

for entry in "${SUBTESTS[@]}"; do
  id="${entry%%|*}"
  rest="${entry#*|}"
  desc="${rest%%|*}"
  script="${rest#*|}"

  if [ -n "$SELECTED_ID" ] && [ "$id" != "$SELECTED_ID" ]; then
    continue
  fi

  TOTAL=$((TOTAL + 1))

  echo "  ───────────────────────────────────────────────────────────────"
  printf "   ${CYAN}▶ Sub-test [%s]${NC} — %s\n" "$id" "$desc"
  echo "  ───────────────────────────────────────────────────────────────"

  set +e
  SUBTEST_OUTPUT="$(bash "$SCRIPT_DIR/$script" 2>&1)"
  SUBTEST_EXIT=$?
  set -e

  # granularidade preservada: imprime o output COMPLETO do script granular
  echo "$SUBTEST_OUTPUT"

  if [ "$SUBTEST_EXIT" -eq 0 ]; then
    pass "Sub-test [$id] PASS (exit 0)"
    PASSED=$((PASSED + 1))
  else
    fail "Sub-test [$id] FALHOU (exit $SUBTEST_EXIT)"
    FAILED_LIST+=("$id")
  fi
  echo ""
done

# ── Tabela final ─────────────────────────────────────────────────────────

echo "  ═════════════════════════════════════════════════════════════════"
echo "   📊 RESUMO — mutation tests master (guards node-puro)"
echo "  ═════════════════════════════════════════════════════════════════"
printf "   %-10s %-6s %s\n" "Sub-test" "Result" "Status"
for entry in "${SUBTESTS[@]}"; do
  id="${entry%%|*}"
  if [ -n "$SELECTED_ID" ] && [ "$id" != "$SELECTED_ID" ]; then
    continue
  fi
  # Verdict da célula = SOMENTE a pertença a FAILED_LIST (sem gate de
  # PASSED: com todos os sub-tests falhando, PASSED=0 — um gate `$PASSED
  # -gt 0 &&` faria a condição curto-circuitar e TODAS as linhas sairiam
  # como PASS no momento exato em que tudo falhou).
  if printf '%s\n' "${FAILED_LIST[@]}" | grep -qx "$id"; then
    printf "   %-10s ${RED}%-6s${NC} ❌\n" "$id" "FAIL"
  else
    printf "   %-10s ${GREEN}%-6s${NC} ✅\n" "$id" "PASS"
  fi
done
echo ""
printf "   Total: %d | Passed: %d | Failed: %d\n" "$TOTAL" "$PASSED" "${#FAILED_LIST[@]}"
echo ""

if [ "${#FAILED_LIST[@]}" -gt 0 ]; then
  fail "MUTATION TESTS FALHARAM: ${FAILED_LIST[*]} — um sub-test não detectou a"
  fail "mutação (guard cego / asserção quebrada) ou o script granular falhou."
  exit 1
fi

pass "MUTATION TESTS PASSED — os guards (bun literal, bun remoção, hooks simetria,"
pass "README anchors/toc/images + reverse, docs anchor, produtor sentinel,"
pass "mutation-jobs, workflow-refs, UTF-8 escopo, timing-budget [240/180/100s + drift exit 2 + mediana],"
pass "e2e-cache-budget [600s/10 min + drift exit 2], lint-guard [prettier + eslint],"
pass "mutation-count [drift do nº de sub-tests do master], no-leaked-imports [leak do"
pass "node_modules do pai + dep inexistente + install pendente]) detectam todas as mutações."
exit 0
