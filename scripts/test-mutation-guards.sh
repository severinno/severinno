#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-guards.sh — Mutation tests MASTER dos guards node-puro
#
# Roda os 43 mutation tests node-puro dos guards de CI num ÚNICO script com
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
#   1 — pelo menos um sub-test REPROVOU depois de re-medido (guard cego /
#       asserção / infra) ❌
#   2 — nenhum reprovou, mas ≥1 ficou INDETERMINADO (FLAKE: a 1ª tentativa
#       reprovou e a re-medição PASSOU na MESMA árvore) ◐
#   3 — uso inválido (--scenario com id desconhecido, flag desconhecida)
#
# A RE-MEDIÇÃO DO VERMELHO (a mesma disciplina do prover da pilha): um sub-test
# que sai vermelho é re-medido UMA vez antes de virar veredito. Um vermelho pode
# nascer do AMBIENTE — as suítes desta matriz sobem fixture, criam container e
# batem em porta/memória —, e publicar o 1º tiro como veredito acusa um defeito
# que não existe (o instrumento mente para o lado caro: manda consertar o que não
# quebrou). A régua é a REPETIÇÃO, nunca a 2ª tentativa sozinha:
#   · verde               → VERDE (o verde NÃO é re-medido: 1 tentativa);
#   · vermelho + vermelho → VERMELHO (o vermelho é da ÁRVORE — repetiu);
#   · vermelho + verde    → INDETERMINADO (`flake: true`): as duas se
#     CONTRADIZEM na mesma árvore — não vale verde nem vale reprovação, e o
#     exit 2 é o único que diz isso (um 1 aqui seria uma regressão inventada);
#   · vermelho + tentativa que nem rodou (exit 126/127) → VERMELHO: a 2ª não
#     contradisse a 1ª.
# O que foi repetido é DITO nos dois lugares: no `--json` cada sub-test leva
# `tentativas`, `exit1`, `exit2`, `ms1`, `ms2` e `flake` — e o `ms` publicado é a
# SOMA das tentativas, porque o custo do job é o que ele pagou —, e o log marca
# o flake com 🌀, com `Flaky: N` no resumo.
#
# O CUSTO DE CADA SUB-TEST (`--json`): o modo máquina mede o wall time de CADA
# sub-test e do TOTAL, junto com os sub-tests que falharam, os que ficaram
# INDETERMINADOS (FLAKES) e as TENTATIVAS de cada um (1 ou 2, pela re-medição).
# Ele existe para o
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
# agregado: 0 se TODOS passarem, 1 se QUALQUER um reprovar (a re-medição do
# cabeçalho decide isso), 2 se nenhum reprovou e algum ficou INDETERMINADO.
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
    CUSTO_MS="$CUSTO_TOTAL_MS" PASSED="$PASSED" METADES="$TOTAL_METADES" FALHAS="${FAILED_LIST[*]:-}" FLAKES="${FLAKY_LIST[*]:-}" node -e '
const fs = require("node:fs")
const linhas = fs.readFileSync(0, "utf8").split("\n").filter((l) => l.trim() !== "")
const subtests = linhas.map((linha) => {
  const [id, script, ms, exit, metades, tentativas, exit1, exit2, ms1, ms2, flake] = linha.split("|")
  return {
    id,
    script,
    ms: Number(ms),
    exit: Number(exit),
    metades: Number(metades),
    // AS TENTATIVAS: o `--json` publica a re-medição (ver o cabeçalho) — o
    // `exit` é o da ÚLTIMA tentativa (o que o veredito leu) e a CLASSE vai em
    // `flake`, do mesmo jeito que o prover da pilha publica um commit re-medido:
    // quem lê o registro distingue "medido uma vez" de "medido duas vezes" sem
    // depender de prosa.
    tentativas: Number(tentativas),
    exit1: Number(exit1),
    exit2: exit2 === "" ? null : Number(exit2),
    ms1: Number(ms1),
    ms2: ms2 === "" ? null : Number(ms2),
    flake: flake === "true",
  }
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
  // Os FLAKES contam À PARTE: eles não são "não passou" (a 2ª tentativa
  // passou) nem "passou" (a 1ª reprovou) — somá-los a qualquer um dos dois é
  // a mentira que a re-medição existe para não publicar.
  flakes: (process.env.FLAKES || "").split(/\s+/).filter(Boolean),
  // Quantas tentativas a matriz pagou no total (uma re-medição por vermelho):
  // o custo do job cresce com isso, e o número fica dito em vez de deduzido.
  tentativas: subtests.reduce((acc, s) => acc + (s.tentativas || 1), 0),
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
  "runner-labels|scripts/test-mutation-runner-labels.sh"
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
  "doc-hashes|scripts/test-mutation-doc-hashes.sh"
  "github-deps|scripts/test-mutation-github-dependencies.sh"
  "cut-stages|scripts/test-mutation-cut-stages.sh"
  "mirror-coverage|scripts/test-mutation-mirror-coverage.sh"
  "pre-commit-proof|scripts/test-mutation-pre-commit-proof.sh"
  "bench-freshness|scripts/test-mutation-bench-freshness.sh"
  "stack-per-commit|scripts/test-mutation-stack-per-commit.sh"
  "lint-scope|scripts/test-mutation-lint-scope.sh"
  "act-origin|scripts/test-mutation-act-origin.sh"
  "commit-import-exports|scripts/test-mutation-commit-import-exports.sh"
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
        exit 3
      fi
      SELECTED_ID="$2"
      shift 2
      ;;
    *)
      fail "Flag desconhecida: $1 (use --scenario <id> | --list | --json)"
      exit 3
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
    exit 3
  fi
fi

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TESTS MASTER (guards node-puro)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── Executa a matriz (fail-CONTINUE: todos rodam, exit agregado) ────────

# ── UMA TENTATIVA de um sub-test (a re-medição chama isto duas vezes) ────
# O output COMPLETO do script granular é impresso como sempre (é a
# granularidade de diagnóstico do master); o par `ms|exit` sai por
# TENTATIVA_MS/TENTATIVA_EXIT, que o laço lê para decidir o veredito.
TENTATIVA_MS=0
TENTATIVA_EXIT=0

roda_tentativa() { # $1 = script granular, $2 = rótulo da tentativa
  local script="$1" rotulo="$2" inicio="" saida=""
  inicio="$(agora_ms)"
  # `set +e` só aqui: o exit do script granular É o dado desta tentativa, e sob
  # `set -e` o master morreria no primeiro vermelho (fail-fast — o oposto do que
  # a matriz promete).
  set +e
  saida="$(bash "$SCRIPT_DIR/$script" 2>&1)"
  TENTATIVA_EXIT=$?
  set -e
  TENTATIVA_MS=$(( $(agora_ms) - inicio ))
  printf '%s\n' "$saida"
  info "$rotulo: exit $TENTATIVA_EXIT em ${TENTATIVA_MS}ms"
}

# O rótulo da 2ª tentativa. A que NEM RODOU (126 = não executável, 127 = comando
# não encontrado) não contradisse a 1ª: o veredito é o mesmo vermelho, mas a
# prosa não pode afirmar que ela "repetiu" — ela não mediu nada.
rotulo_da_repeticao() { # $1 = exit da 1ª tentativa, $2 = exit da 2ª
  case "$2" in
    126 | 127) printf 'a 2ª tentativa NÃO MEDIU (exit %s) — o vermelho não foi contradito' "$2" ;;
    *) printf 'a 2ª tentativa REPETIU o vermelho (exit %s → %s)' "$1" "$2" ;;
  esac
}

TOTAL=0
PASSED=0
FAILED_LIST=()
# Os FLAKES (a 1ª reprovou e a 2ª PASSOU na MESMA árvore) ficam À PARTE dos dois
# lados: não são "não passou" e não são "passou" — ver o cabeçalho.
FLAKY_LIST=()
# Os registros do `--json`: `id|script|ms|exit|metades|tentativas|exit1|exit2|ms1|ms2|flake`
# por sub-test, na ordem da matriz (`ms` = SOMA das tentativas, `exit` = o da
# última). O esquema é montado pelo node no fim (um JSON montado à mão em bash
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

  # ── A 1ª tentativa ───────────────────────────────────────────────────
  # O relógio cerca a execução do script granular (não a leitura do bloco, que
  # é o mesmo trabalho para todos).
  roda_tentativa "$script" "custo do sub-test [$id]"

  TENTATIVAS=1
  EXIT1="$TENTATIVA_EXIT"
  MS1="$TENTATIVA_MS"
  # Vazio (e não 0) quando NÃO houve 2ª tentativa: no `--json` o campo sai
  # `null`, que é "não houve", e um 0 diria "mediu em 0ms".
  EXIT2=""
  MS2=""
  FLAKE=false
  SUBTEST_EXIT="$EXIT1"
  SUBTEST_MS="$MS1"

  # ── A RE-MEDIÇÃO: o 1º tiro vermelho NÃO é veredito (ver o cabeçalho) ───
  if [ "$EXIT1" -ne 0 ]; then
    info "sub-test [$id] VERMELHO (exit $EXIT1) — RE-MEDINDO uma vez: a régua é a repetição, nunca o 1º tiro"
    roda_tentativa "$script" "2ª tentativa do sub-test [$id]"

    TENTATIVAS=2
    EXIT2="$TENTATIVA_EXIT"
    MS2="$TENTATIVA_MS"
    # O `ms` publicado é a SOMA: uma re-medição custa o que ela custou, e o
    # número versionado tem de ser o que o job pagou por este sub-test.
    SUBTEST_MS=$((MS1 + MS2))
    # O `exit` publicado é o da ÚLTIMA tentativa (é o veredito que o master leu):
    # um flake sai com `exit: 0` MAIS `flake: true` — a classe não se esconde
    # dentro do exit, e quem lê o registro sabe qual dos dois casos é.
    SUBTEST_EXIT="$EXIT2"
    if [ "$EXIT2" -eq 0 ]; then
      FLAKE=true
    fi
  fi

  REGISTROS+=("$id|$script|$SUBTEST_MS|$SUBTEST_EXIT|$(contagem_de "$script")|$TENTATIVAS|$EXIT1|$EXIT2|$MS1|$MS2|$FLAKE")

  if [ "$FLAKE" = true ]; then
    fail "Sub-test [$id] INDETERMINADO (🌀 FLAKE): a 1ª tentativa reprovou (exit $EXIT1) e a 2ª"
    fail "  PASSOU na MESMA árvore — as duas se CONTRADIZEM: não vale verde (a regressão"
    fail "  existiu) nem reprovação (ela não repetiu). Repita a suíte [$id] para decidir."
    FLAKY_LIST+=("$id")
  elif [ "$SUBTEST_EXIT" -ne 0 ]; then
    if [ "$TENTATIVAS" -eq 2 ]; then
      fail "Sub-test [$id] FALHOU (exit $EXIT2) — $(rotulo_da_repeticao "$EXIT1" "$EXIT2")"
    else
      fail "Sub-test [$id] FALHOU (exit $EXIT1)"
    fi
    FAILED_LIST+=("$id")
  elif [ "$BLOCO_OK" = true ]; then
    pass "Sub-test [$id] PASS (exit 0)"
    PASSED=$((PASSED + 1))
  else
    fail "Sub-test [$id] FALHOU: a suíte passou, mas ela não DECLARA as metades"
    fail "  (a descrição do sub-test e a prosa da doc derivam do bloco METADES)"
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
  # Verdict da célula = SOMENTE a pertença a FAILED_LIST/FLAKY_LIST (sem gate de
  # PASSED: com todos os sub-tests falhando, PASSED=0 — um gate `$PASSED
  # -gt 0 &&` faria a condição curto-circuitar e TODAS as linhas sairiam
  # como PASS no momento exato em que tudo falhou).
  # O FLAKE tem marca PRÓPRIA (🌀): ele não é PASS (a regressão existiu) nem FAIL
  # (ela não repetiu) — quem lê a tabela precisa distinguir os dois de longe.
  # Herestring (não pipe): sob `set -o pipefail`, `printf | grep -qx` pode
  # falhar por SIGPIPE (o grep -q fecha o stdin cedo) — flaky pelo tamanho.
  if grep -qx "$id" <<<"$(printf '%s\n' "${FLAKY_LIST[@]:-}")"; then
    printf "   %-10s ${YELLOW}%-6s${NC} 🌀\n" "$id" "FLAKE"
  elif grep -qx "$id" <<<"$(printf '%s\n' "${FAILED_LIST[@]}")"; then
    printf "   %-10s ${RED}%-6s${NC} ❌\n" "$id" "FAIL"
  else
    printf "   %-10s ${GREEN}%-6s${NC} ✅\n" "$id" "PASS"
  fi
done
echo ""
printf "   Total: %d | Passed: %d | Failed: %d | Flaky: %d\n" \
  "$TOTAL" "$PASSED" "${#FAILED_LIST[@]}" "${#FLAKY_LIST[@]}"
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
  fail "mutação (guard cego / asserção quebrada) ou o script granular falhou — e a"
  fail "re-medição REPETIU o vermelho (ou não mediu: a 1ª tentativa não foi contradita)."
  if [ "${#FLAKY_LIST[@]}" -gt 0 ]; then
    fail "${#FLAKY_LIST[@]} sub-test(s) ficaram INDETERMINADOS (FLAKE 🌀) e seguem NOMEADOS:"
    fail "  ${FLAKY_LIST[*]} — o veredito da matriz é o dos vermelhos, o flake não vira verde nem"
    fail "  some dentro deles: repita a suíte de cada um para decidir o que ele é."
  fi
  exit 1
fi

if [ "${#FLAKY_LIST[@]}" -gt 0 ]; then
  fail "MUTATION TESTS INDETERMINADOS (exit 2): ${FLAKY_LIST[*]} — a 1ª tentativa reprovou"
  fail "e a 2ª PASSOU na MESMA árvore (FLAKE 🌀). As duas se CONTRADIZEM: não é regressão"
  fail "(o vermelho não repetiu) e não é verde (ele existiu). Repita a suíte para decidir —"
  fail "a matriz não publica veredito sobre UM tiro, e é este exit 2 que separa o flake"
  fail "da regressão de verdade."
  exit 2
fi

pass "MUTATION TESTS PASSED — os $TOTAL sub-test(s) node-puro detectaram as mutações,"
pass "e as $TOTAL_METADES metade(s) estão DECLARADAS no próprio script (bloco METADES)."
pass "A prosa deste resumo é derivada delas: acrescentar uma mutação é acrescentar"
pass "uma linha no bloco da suíte — o master e a doc não têm texto à mão para envelhecer."
exit 0
