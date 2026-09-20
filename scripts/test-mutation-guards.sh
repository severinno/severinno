#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-guards.sh — Mutation tests MASTER dos guards node-puro
#
# Roda os 32 mutation tests node-puro dos guards de CI num ÚNICO script com
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
#                    versão LITERAL na chamada do setup deve FALHAR (drift)
#   bun-removal    → scripts/test-mutation-bun-removal.sh
#                    REMOÇÃO da chamada do setup (--staged) deve FALHAR
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
#                    scripts/X) + entry órfã do --pkg-internal devem FALHAR; e
#                    as DUAS metades da regra de comentário de FIM DE LINHA
#                    (stripping removido: o guard ACUSA código morto; regra sem
#                    a âncora de espaço: o guard fica CEGO na ref que EXECUTA),
#                    com o guard real mutado no lugar e restaurado por checksum
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
#   workflow-run-syntax → scripts/test-mutation-workflow-run-syntax.sh
#                    os TRÊS mecanismos do gate de sintaxe dos `run:` devem ser
#                    LOAD-BEARING: mutar a metade do AVISO (o heredoc que o
#                    bash aprova, exit 0), o STDIN do bash (o corpo julgado) ou
#                    o LIMITE da máscara de `${{ }}` (lazy → gulosa) tem de
#                    CEGAR o guard — e cada mutação é cirúrgica (as outras
#                    metades seguem mordendo)
#   gate-registration → scripts/test-mutation-gate-registration.sh
#                    a régua do REGISTRO da proteção da forja (`registrationDelta`
#                    da prova do merge gate) tem de ser LOAD-BEARING nas CINCO
#                    metades: o contexto a MENOS, o a MAIS, a CONTAGEM no nome,
#                    o FIO do veredito (o delta calculado e ignorado) e a régua da
#                    contagem GULOSA, que ACUSA o contexto editorial legítimo
#                    (violação falsa). O veredito é medido POR EXECUÇÃO (o motor
#                    da prova contra a forja dublada — sem docker, node-puro) e a
#                    suíte unitária entra pelas âncoras da metade mutada
#   archived-pipeline → scripts/test-mutation-archived-pipeline.sh
#                    as CONDIÇÕES de cada passo do retrato arquivado
#                    (`.woodpecker.yml`) contra a forja têm de ser LOAD-BEARING
#                    nas SEIS metades: a EXIGÊNCIA de declarar (`when:` ausente),
#                    o ESTREITAMENTO do `if:` do job, a contraparte por marcador
#                    (existência do alvo e MESMO trabalho), o fail-closed da
#                    leitura e o desempate do casamento ambíguo. Cada mutação
#                    cega a SUA classe com as vizinhas seguindo vermelhas, e o
#                    passo SÃO do fixture (o controle) segue verde em todas
#   github-deps    → scripts/test-mutation-github-dependencies.sh
#                    a CATRACA do inventário do GitHub tem de ser LOAD-BEARING nas
#                    NOVE metades: a comparação de CONJUNTOS (o que é NOVO e o que
#                    SUMIU), a do CONTADOR (medido > declarado), a NOMEAÇÃO do item
#                    novo e do delta do contador, o ESCOPO da contagem (o auditor não
#                    conta a própria prosa, senão o medido sobe ao DOCUMENTAR a
#                    classe) e os TRÊS fail-closed do dado (o
#                    AUSENTE, o ILEGÍVEL e o contador que não é número). O veredito
#                    é medido POR EXECUÇÃO no CLI (o defeito é injetado no dado
#                    versionado e restaurado por checksum) e a suíte unitária é a
#                    testemunha do que a API do módulo julga em todo PR
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
  "bun-literal|Bun — versao literal na chamada do setup + o REMENDO (--fix) da declaracao APAGADA (a chave-pai devolvida e a ancora unica que RECUSA em vez de adivinhar)|scripts/test-mutation-bun-literal.sh"
  "bun-removal|Bun --staged — remoção da chamada do setup|scripts/test-mutation-bun-removal.sh"
  "hooks-symmetry|Hooks — guard novo no pre-commit + linha stale|scripts/test-mutation-hooks-symmetry.sh"
  "readme|README — anchors + toc + images (matriz aninhada)|scripts/test-mutation-readme-guards.sh"
  "readme-reverse|README — drift semântico (baseline reverse) deve FALHAR|scripts/test-mutation-readme-reverse.sh"
  "docs-anchor|Docs — âncora quebrada em docs/*.md (fixture com docs/)|scripts/test-mutation-readme-docs-anchor.sh"
  "producer-sent|Produtor — sentinel 'com CRLF' removido do audit all-text|scripts/test-mutation-producer-sentinel.sh"
  "mutation-jobs|Mutation-jobs — script órfão + matriz quebrada|scripts/test-mutation-mutation-jobs.sh"
  "workflow-refs|Workflow-refs — alvo transitivo deletado + entry órfã + as duas metades da regra de comentário de fim de linha (stripping removido ACUSA código morto; regra sem a âncora de espaço fica CEGA na ref que EXECUTA)|scripts/test-mutation-workflow-refs.sh"
  "utf8-scope|UTF-8 — call site sem src/|scripts/test-mutation-utf8-scope.sh"
  "timing-budget|Timing — gate de budget 240/180/100s (três faixas) + drift exit 2 + faixa soft derivada da mediana (--warn-median) + gate de drift relativo (--fail-drift) do mutation-coord|scripts/test-mutation-timing-budget.sh"
  "e2e-cache-budget|E2E Cache — gate de budget 600s (10 min) + drift exit 2 (SKIP até medidor)|scripts/test-mutation-e2e-cache-budget.sh"
  "lint-guard|Lint Guard — prettier --check + eslint --max-warnings 0 devem FALHAR (arquivo mal formatado / warning)|scripts/test-mutation-lint-guard.sh"
  "mutation-count|Count — drift do nº de sub-tests (job name/summary/README) deve FALHAR|scripts/test-mutation-mutation-count.sh"
  "no-setup-bun|No-setup-bun — guard de ação externa deve FALHAR|scripts/test-mutation-no-setup-bun.sh"
  "runner-base|Runner-base — digest pinado deve ser detectado|scripts/test-mutation-runner-base.sh"
  "no-leaked-imports|No-leaked-imports — import resolvendo no node_modules do PAI + dep inexistente devem FALHAR (install pendente passa)|scripts/test-mutation-no-leaked-imports.sh"
  "reconciliation|Reconciliation — fechamento de issues de dívida (reconcileDebt close) deve ser detectado|scripts/test-mutation-reconciliation.sh"
  "nested-guard|Nested guard — NESTED_GUARD_ENV (defesa em profundidade contra recursão) deve ser detectado|scripts/test-mutation-nested-guard.sh"
  "pipefail-sigpipe|SIGPIPE — pipe para grep quieto deve ser detectado nos DOIS contextos (pipefail declarado E passo sem shell, com a marca da premissa do runner); a declaracao 'defaults: run: shell:' que LIGA o pipefail FALHA o gate; herestring/heredoc/script sem pipefail/cota do baseline nao acendem; o --fix aposenta o caso mecanico e nao corrompe expressao do runner; e o CANAL DO REMEDIO (o patch que vai ao PR) tem as tres metades medidas: o patch APLICA pelo git apply e fecha o gate, o preview NAO grava (quem grava e o --fix), e cada fixer tem marcador PROPRIO (um marcador comum faria a reconciliacao de um retirar o comentario do outro)|scripts/test-mutation-pipefail-sigpipe.sh"
  "hook-ci-parity|Hooks x CI — a segunda regua no hook (bunx tsc sem o heap), o comando novo sem decisao, o recorte sem razao, a declaracao que envelheceu, o gate do CORE sumido, o hook fantasma, o SUB-GUARD de um runner sem decisao local e a DESCIDA cega do lado local (os sub-guards do check-utf8.sh acusam) devem FALHAR|scripts/test-mutation-hook-ci-parity.sh"
  "hook-commands|Comandos dos hooks — o caminho tipado, a entrada de scripts ausente e o indeterminado nao declarado devem CEGAR o guard, e a funcao do proprio hook deve ACUSAR o sao (violacao falsa no hook real); cada mutacao cirurgica, com a suite unitaria VERMELHA|scripts/test-mutation-hook-commands.sh"
  "workflow-defaults|Defaults — a declaracao defaults:run:shell: nao pode virar passo/gate/ref/comando do job nos guards que leem YAML de workflow (leitura unica compartilhada); cada metade dessa leitura mutada FALHA o guard sendo medido|scripts/test-mutation-workflow-defaults.sh"
  "workflow-run-syntax|Sintaxe dos run: E dos scripts — as QUINZE mutacoes (o aviso, o stdin do bash, o limite da mascara, o indice do --staged, os shells medidos, a guarda do fixer, a segunda fonte, o PULO NOMEADO do passo nao-bash, o PULO NOMEADO do ARQUIVO de shebang nao-bash — a simetria do anterior pela decisao da outra fonte —, as cinco da terceira fonte e a GARANTIA DO PREVIEW do --fix --dry-run) devem CEGAR o guard ou ACUSAR o sao (violacao falsa do M8/M14) ou GRAVAR no preview; cada mutacao cirurgica|scripts/test-mutation-workflow-run-syntax.sh"
  "merge-latency|Latencia de merge — a DETECCAO da cobertura, o EXIT CODE do --check e o PAPEL do dono do merge devem CEGAR o gate (por execucao) e/ou a suite unitaria; cada mutacao cirurgica, com controlo final|scripts/test-mutation-merge-latency.sh"
  "registry-defaults|Defaults do registry/namespace — a COMPARACAO de valor, a REGRA do script JS (o resolvedor obrigatorio), a REGUA DE COMENTARIO por linguagem, o VALOR VAZIO (que nao e default), o LITERAL DE RESERVA do resolvedor, o FALLBACK LITERAL do workflow e a GRAFIA dele (as aspas nao sao julgadas: o tipo novo, declarado numa forma inedita num CI ficticio, entra SO pela TABELA com a regua byte a byte igual) devem CEGAR o gate ou ACUSAR o sao (violacao falsa), cada um com a suite unitaria VERMELHA no recorte que mede o mecanismo|scripts/test-mutation-registry-defaults.sh"
  "job-deps|Dependencias dos jobs — o job que RODA comando dependente de node_modules SEM instalar deve FALHAR (e a isencao declarada o salva); mutar a leitura do grafo (import de topo vira tardio), o install some, o addedAt some, a regra do sem-objeto e a escalada do --review devem CEGAR o guard, cada um com a suite unitaria VERMELHA; cirurgico, com o guard restaurado por checksum|scripts/test-mutation-job-deps.sh"
  "remedy-tty|Resposta do remedio (o TERMINAL DE CONTROLE) — as DUAS metades que a trazem (a funcao que abre o /dev/tty e o ponto que a CHAMA) devem deixar a suite do pty VERMELHA nas ancoras do fluxo do operador (o 'sim' no terminal faz o commit entrar, o 'nao' bloqueia, a FASE B reexecuta), com o fail-closed SEGUINDO VERDE — e o pty e o vitest declarados quando faltam, nunca um verde por omissao|scripts/test-mutation-remedy-tty.sh"
  "required-applied|Required checks APLICADOS — o RENAME do name: de um job que e required check SEM a reaplicacao declarada (e o check novo, e o orfao, e a declaracao ausente) deve deixar o PR VERMELHO: as QUATRO metades que sustentam isso (a regua do contexto derivado, a regua do orfao, o fio que as julga em main() e o fail-closed do carregamento) e as DUAS do applier (o ALVO do --forge e o CARIMBO sem churn) e as DUAS da forja que RECUSA a feature (o marcador GRAVADO e o MOTIVO obrigatorio dele) caem cada uma no SEU fato, com as outras metades SEGUINDO verdes — cirurgico, com o guard restaurado por checksum|scripts/test-mutation-required-checks-applied.sh"
  "gate-registration|Merge gate — o REGISTRO da protecao (a MENOS, a MAIS, CONTAGEM no nome e o fio do veredito) medido por EXECUCAO contra a forja dublada + anchors da suite; a regua da contagem gulosa ACUSA o contexto editorial (violacao FALSA)|scripts/test-mutation-gate-registration.sh"
  "archived-pipeline|Retrato arquivado — as CONDIcoes de cada passo (.woodpecker.yml) contra a forja: a exigencia de declarar (when ausente), o ESTREITAMENTO do if do job, o marcador (arquivo tipado e trabalho do job) e o fail-closed da leitura devem CEGAR o guard, com as classes vizinhas SEGUINDO vermelhas e o passo SAO do fixture imune; cada mutacao cirurgica, guard restaurado por checksum|scripts/test-mutation-archived-pipeline.sh"
  "github-deps|Inventario do GitHub — a CATRACA: a comparacao de CONJUNTOS (o item NOVO e o item SUMIDO), a do CONTADOR (medido > declarado), a NOMEACAO do item novo e do delta, o ESCOPO da contagem (o auditor nao conta a propria prosa: sem a exclusao o medido sobe ao DOCUMENTAR a classe) e os TRES fail-closed do dado (o AUSENTE, o ILEGIVEL e o contador que nao e numero) devem CEGAR o CLI ou deixar o vermelho GENERICO, com a suite unitaria VERMELHA em cada metade|scripts/test-mutation-github-dependencies.sh"
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
  fail "MUTATION TESTS FALHARAM: ${FAILED_LIST[*]} — um sub-test não detectou a"
  fail "mutação (guard cego / asserção quebrada) ou o script granular falhou."
  exit 1
fi

pass "MUTATION TESTS PASSED — os guards (bun literal, bun remoção, hooks simetria,"
pass "README anchors/toc/images + reverse, docs anchor, produtor sentinel,"
pass "mutation-jobs, workflow-refs [transitivo + órfã + comentário de fim de linha nas duas metades],"
pass "UTF-8 escopo, timing-budget [240/180/100s + drift exit 2 + mediana],"
pass "e2e-cache-budget [600s/10 min + drift exit 2], lint-guard [prettier + eslint],"
pass "mutation-count [drift do nº de sub-tests do master], no-leaked-imports [leak do"
pass "node_modules do pai + dep inexistente + install pendente],"
pass "reconciliation [fechamento de issues de dívida via reconcileDebt]),"
pass "nested-guard [NESTED_GUARD_ENV — defesa em profundidade contra recursão] e"
pass "registry-defaults [valor do default, script JS, régua de comentário, valor vazio, literal do resolvedor, fallback do YAML e a grafia dele (o tipo novo pela tabela)]) e"
pass "job-deps [install ou isenção declarada; grafo de imports, addedAt, regra do sem-objeto e a revisão do --review],"
pass "required-applied [o RENAME sem a reaplicação declarada: as duas réguas da"
pass "comparação, o fio em main(), o fail-closed da declaração ausente, o alvo do"
pass "--forge e o carimbo sem churn] e"
pass "gate-registration [o REGISTRO da proteção da forja: o contexto a MENOS, o a"
pass "MAIS, a CONTAGEM no nome, o FIO do veredito e a régua da contagem gulosa que"
pass "acusa o contexto editorial — veredito por execução + âncoras da suíte] e"
pass "archived-pipeline [as CONDIÇÕES de cada passo do retrato arquivado contra a"
pass "forja: a exigência de declarar, o estreitamento do \`if:\` do job, a contraparte"
pass "por marcador (existência e trabalho), o fail-closed da leitura e o desempate do"
pass "casamento ambíguo]"
pass "detectam todas as mutações."
exit 0
