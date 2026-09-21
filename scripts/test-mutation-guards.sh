#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-guards.sh — Mutation tests MASTER dos guards node-puro
#
# Roda os 36 mutation tests node-puro dos guards de CI num ÚNICO script com
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
#   ./scripts/test-mutation-guards.sh --json             # o CUSTO de cada sub-test
#
# Exit codes:
#   0 — todos os sub-tests passaram (mutações detectadas) ✅
#   1 — pelo menos um sub-test falhou (guard cego / asserção / infra) ❌
#   2 — uso inválido (--scenario com id desconhecido, flag desconhecida)
#
# O CUSTO DE CADA SUB-TEST (`--json`): o modo máquina mede o wall time de CADA
# sub-test e do TOTAL, junto com os sub-tests que falharam. Ele existe para o
# custo do job `mutation-guards` não ser composto à mão: quem entra com um
# sub-test novo (ou paga o job no modelo de latência) lê o custo MEDIDO, com o
# id de quem o pagou. O stdout é SÓ o JSON — toda a saída humana vai para o
# stderr, então `--json | jq` funciona sem filtrar as 32 tabelas.
#
# A MATRIZ É DERIVADA — e por isso não há prosa de sub-test para envelhecer:
# cada entrada traz `id|script`, e a DESCRIÇÃO sai do bloco `METADES=(...)` do
# PRÓPRIO script granular (o dono diz o que cada metade dele tira do lugar).
# `--list` imprime a matriz inteira com a descrição derivada; o sub-test que não
# declara metade nenhuma FALHA aqui, e o `check-mutation-count` recusa o mesmo
# caso no PR (uma régua só, a de `scripts/metades.mjs`). Acrescentar uma mutação
# = uma linha no bloco da suíte (a descrição se atualiza sozinha nos dois lugares).
# Cada script granular é a FONTE ÚNICA do seu cenário (sem duplicação de
# fixtures/mutações/asserções — o harness só orquestra). TODOS os sub-tests
# rodam mesmo se um falhar (fail-CONTINUE, não fail-fast) — o exit final é
# agregado: 0 se TODOS passarem, 1 se QUALQUER um falhar.
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── A DESCRIÇÃO DE CADA SUB-TEST (derivada, nunca escrita à mão) ──────────
# A fonte única é o bloco `METADES=(...)` do PRÓPRIO script granular — a mesma
# régua que o `check-mutation-count` usa para conferir a doc (`scripts/metades.`
# `mjs`). Uma suíte que não declara metade nenhuma sai nomeada, e o sub-test
# FALHA: fail-closed — "não li o bloco" nunca vale como "não há metade".

descricao_de() { # $1 = script granular relativo a SCRIPT_DIR
  local rel="$1"
  node "$SCRIPT_DIR/scripts/metades.mjs" "$SCRIPT_DIR/$rel" --descricao 2>&1
}

escreve_a_descricao() { # a descrição: derivada, ou o motivo da FALTA escrita
  local rel="$1" texto
  if texto="$(descricao_de "$rel")"; then
    printf '%s' "$texto"
    return 0
  fi
  printf '%s' "❌ NÃO DECLARA as metades (bloco METADES=(...) ausente/ilegível): $texto"
  return 1
}

# O número de metades da suíte (a MESMA leitura da tabela final e do `--json`:
# duas derivações divergiriam no dia em que o formato da descrição mudasse).
contagem_de() { # $1 = script granular relativo a SCRIPT_DIR
  local rel="$1" desc n
  desc="$(descricao_de "$rel" 2>/dev/null || echo "0 metade(s)")"
  n="${desc%% metade*}"
  case "$n" in '' | *[!0-9]*) n=0 ;; esac
  printf '%s' "$n"
}

# O RELÓGIO da medição de custo: milissegundos desde a época. `date +%s%N` é o
# caminho barato (GNU coreutils, o do runner); a máquina que imprime o literal
# `N` cai no python3 — melhor um spawn por sub-test do que um número que não é
# tempo (e o `%3N` do GNU não existe no BSD, que imprime `N` do mesmo jeito).
agora_ms() {
  local n
  n="$(date +%s%N 2>/dev/null || echo N)"
  case "$n" in
    *N) python3 -c 'import time; print(int(time.time() * 1000))' ;;
    *) printf '%s' "$((n / 1000000))" ;;
  esac
}

# O JSON do `--json`, no stdout ORIGINAL (o fd 3 aberto no parse das flags): o
# stdout corrente é o stderr desde que o modo máquina ligou, então a saída humana
# e o dado não se misturam e o run é um só.
imprime_json() {
  [ "$JSON_OUT" = true ] || return 0
  printf '%s\n' "${REGISTROS[@]}" | {
    CUSTO_MS="$CUSTO_TOTAL_MS" PASSED="$PASSED" METADES="$TOTAL_METADES" FALHAS="${FAILED_LIST[*]:-}" node -e '
const fs = require("node:fs")
const linhas = fs.readFileSync(0, "utf8").split("\n").filter((l) => l.trim() !== "")
const subtests = linhas.map((linha) => {
  const [id, script, ms, exit, metades] = linha.split("|")
  return { id, script, ms: Number(ms), exit: Number(exit), metades: Number(metades) }
})
// O custo dos sub-tests e o SOBRANTE do harness sao separados: o proximo
// sub-test entra com o custo MEDIDO dele, e a diferenca entre a soma e o total
// do master e o que o harness (variedade de fixtures, parse das metades) custa.
const subtestsMs = subtests.reduce((acc, s) => acc + s.ms, 0)
const totalMs = Number(process.env.CUSTO_MS)
const summary = {
  count: subtests.length,
  passed: Number(process.env.PASSED),
  failed: (process.env.FALHAS || "").split(/\s+/).filter(Boolean),
  metades: Number(process.env.METADES),
  subtestsMs,
  harnessMs: totalMs - subtestsMs,
  totalMs,
}
process.stdout.write(
  JSON.stringify({ tool: "test-mutation-guards", subtests, summary }, null, 2) + "\n",
)
'
  } 1>&3
}

# ── Matriz de sub-tests ───────────────────────────────────────────────────
# Formato: id|script granular (relativo a SCRIPT_DIR). SEM descrição escrita à
# mão: ela é DERIVADA do bloco METADES da própria suíte (ver `descricao_de`).
# Adicionar um mutation test node-puro novo = UMA linha aqui + o bloco METADES
# no script granular (que já deve existir com exit 0 = mutação detectada).
SUBTESTS=(
  "bun-literal|scripts/test-mutation-bun-literal.sh"
  "bun-removal|scripts/test-mutation-bun-removal.sh"
  "hooks-symmetry|scripts/test-mutation-hooks-symmetry.sh"
  "readme|scripts/test-mutation-readme-guards.sh"
  "readme-reverse|scripts/test-mutation-readme-reverse.sh"
  "docs-anchor|scripts/test-mutation-readme-docs-anchor.sh"
  "producer-sent|scripts/test-mutation-producer-sentinel.sh"
  "mutation-jobs|scripts/test-mutation-mutation-jobs.sh"
  "workflow-refs|scripts/test-mutation-workflow-refs.sh"
  "utf8-scope|scripts/test-mutation-utf8-scope.sh"
  "timing-budget|scripts/test-mutation-timing-budget.sh"
  "e2e-cache-budget|scripts/test-mutation-e2e-cache-budget.sh"
  "lint-guard|scripts/test-mutation-lint-guard.sh"
  "mutation-count|scripts/test-mutation-mutation-count.sh"
  "no-setup-bun|scripts/test-mutation-no-setup-bun.sh"
  "runner-base|scripts/test-mutation-runner-base.sh"
  "no-leaked-imports|scripts/test-mutation-no-leaked-imports.sh"
  "reconciliation|scripts/test-mutation-reconciliation.sh"
  "nested-guard|scripts/test-mutation-nested-guard.sh"
  "pipefail-sigpipe|scripts/test-mutation-pipefail-sigpipe.sh"
  "hook-ci-parity|scripts/test-mutation-hook-ci-parity.sh"
  "hook-commands|scripts/test-mutation-hook-commands.sh"
  "workflow-defaults|scripts/test-mutation-workflow-defaults.sh"
  "workflow-run-syntax|scripts/test-mutation-workflow-run-syntax.sh"
  "merge-latency|scripts/test-mutation-merge-latency.sh"
  "registry-defaults|scripts/test-mutation-registry-defaults.sh"
  "job-deps|scripts/test-mutation-job-deps.sh"
  "remedy-tty|scripts/test-mutation-remedy-tty.sh"
  "canal-fixers|scripts/test-mutation-canal-fixers.sh"
  "required-applied|scripts/test-mutation-required-checks-applied.sh"
  "gate-registration|scripts/test-mutation-gate-registration.sh"
  "archived-pipeline|scripts/test-mutation-archived-pipeline.sh"
  "github-deps|scripts/test-mutation-github-dependencies.sh"
  "cut-stages|scripts/test-mutation-cut-stages.sh"
  "mirror-coverage|scripts/test-mutation-mirror-coverage.sh"
  "pre-commit-proof|scripts/test-mutation-pre-commit-proof.sh"
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
JSON_OUT=false

while [ $# -gt 0 ]; do
  case "$1" in
    --list)
      LIST_ONLY=true
      shift
      ;;
    --json)
      JSON_OUT=true
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
      fail "Flag desconhecida: $1 (use --scenario <id> | --list | --json)"
      exit 2
      ;;
  esac
done

# ── --json: o stdout fica SÓ com o JSON ───────────────────────────────────
# O fd 3 guarda o stdout ORIGINAL e o fd 1 passa a ser o stderr: toda a saída
# humana (as 32 tabelas, o resumo, as metades) continua visível como diagnóstico
# — mas em `--json | jq` ela não contamina o dado. O humano e a máquina leem o
# MESMO run, sem duas execuções do master (que custa minutos).
if [ "$JSON_OUT" = true ]; then
  exec 3>&1 1>&2
fi

# O relógio do master INTEIRO (o custo do job é este, não a soma dos sub-tests).
INICIO_MS="$(agora_ms)"

# ── --list: imprime a matriz e sai ────────────────────────────────────────

if [ "$LIST_ONLY" = true ]; then
  echo ""
  info "Matriz de sub-tests do test-mutation-guards.sh:"
  echo ""
  for entry in "${SUBTESTS[@]}"; do
    id="${entry%%|*}"
    script="${entry#*|}"
    desc="$(escreve_a_descricao "$script" || true)"
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
# Os registros do `--json`: `id|script|ms|exit|metades` por sub-test, na ordem da
# matriz. O esquema é montado pelo node no fim (um JSON montado à mão em bash
# escapa errado no dia em que um id tiver aspas).
REGISTROS=()
# O total é o WALL TIME do master inteiro (não a soma dos sub-tests): a diferença
# entre os dois é o que o harness custa, e é ela que diz quanto o próximo
# sub-test acrescenta ao job — não só o tempo do script dele.
CUSTO_TOTAL_MS=0

for entry in "${SUBTESTS[@]}"; do
  id="${entry%%|*}"
  script="${entry#*|}"
  if desc="$(descricao_de "$script")"; then
    BLOCO_OK=true
  else
    BLOCO_OK=false
    desc="❌ NÃO DECLARA as metades (o bloco METADES=(...) é a fonte única da descrição): $desc"
  fi

  if [ -n "$SELECTED_ID" ] && [ "$id" != "$SELECTED_ID" ]; then
    continue
  fi

  TOTAL=$((TOTAL + 1))

  echo "  ───────────────────────────────────────────────────────────────"
  printf "   ${CYAN}▶ Sub-test [%s]${NC} — %s\n" "$id" "$desc"
  echo "  ───────────────────────────────────────────────────────────────"

  # O CUSTO deste sub-test: o relógio cerca a execução do script granular (não a
  # leitura do bloco, que é o mesmo trabalho para todos).
  SUBTEST_INICIO="$(agora_ms)"
  set +e
  SUBTEST_OUTPUT="$(bash "$SCRIPT_DIR/$script" 2>&1)"
  SUBTEST_EXIT=$?
  set -e
  SUBTEST_MS=$(( $(agora_ms) - SUBTEST_INICIO ))
  REGISTROS+=("$id|$script|$SUBTEST_MS|$SUBTEST_EXIT|$(contagem_de "$script")")

  # granularidade preservada: imprime o output COMPLETO do script granular
  echo "$SUBTEST_OUTPUT"
  info "custo do sub-test [$id]: ${SUBTEST_MS}ms"

  if [ "$SUBTEST_EXIT" -eq 0 ] && [ "$BLOCO_OK" = true ]; then
    pass "Sub-test [$id] PASS (exit 0)"
    PASSED=$((PASSED + 1))
  elif [ "$SUBTEST_EXIT" -eq 0 ]; then
    fail "Sub-test [$id] FALHOU: a suíte passou, mas ela não DECLARA as metades"
    fail "  (a descrição do sub-test e a prosa da doc derivam do bloco METADES)"
    FAILED_LIST+=("$id")
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

# ── As METADES declaradas por cada sub-test (derivadas, uma a uma) ────────
#
# A tabela acima responde "o sub-test passou?". Esta responde "o que ele
# protege?" — e a resposta sai do bloco METADES da própria suíte, do mesmo
# jeito que a descrição do cabeçalho de cada sub-test. Nada aqui foi escrito à
# mão: acrescentar uma mutação muda este resumo sem ninguém editar o master.

echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧬 METADES DECLARADAS (a descrição de cada sub-test vem daqui)"
echo "  ═════════════════════════════════════════════════════════════════"
TOTAL_METADES=0
for entry in "${SUBTESTS[@]}"; do
  id="${entry%%|*}"
  script="${entry#*|}"
  if [ -n "$SELECTED_ID" ] && [ "$id" != "$SELECTED_ID" ]; then
    continue
  fi
  desc="$(descricao_de "$script" || echo "0 metade(s)")"
  n="$(contagem_de "$script")"
  TOTAL_METADES=$((TOTAL_METADES + n))
  printf "   %-10s %4s metade(s)  — %s\n" "$id" "$n" "${desc#*metade(s): }" | cut -c1-150
done
echo ""
printf "   %d metade(s) declarada(s) em %d sub-test(s) — a régua é scripts/metades.mjs\n" \
  "$TOTAL_METADES" "$TOTAL"
echo ""

CUSTO_TOTAL_MS=$(( $(agora_ms) - INICIO_MS ))

# O DADO (o custo de cada sub-test) sai ANTES do veredito: um sub-test vermelho
# ainda tem custo medido (é a suíte que fica vermelha, não a medição), e o
# consumidor do `--json` precisa do retrato inteiro nos dois caminhos.
imprime_json

if [ "${#FAILED_LIST[@]}" -gt 0 ]; then
  fail "MUTATION TESTS FALHARAM: ${FAILED_LIST[*]} — um sub-test não detectou a"
  fail "mutação (guard cego / asserção quebrada) ou o script granular falhou."
  exit 1
fi

pass "MUTATION TESTS PASSED — os $TOTAL sub-test(s) node-puro detectaram as mutações,"
pass "e as $TOTAL_METADES metade(s) estão DECLARADAS no próprio script (bloco METADES)."
pass "A prosa deste resumo é derivada delas: acrescentar uma mutação é acrescentar"
pass "uma linha no bloco da suíte — o master e a doc não têm texto à mão para envelhecer."
exit 0
