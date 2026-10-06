#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-unproven-skipped.sh — Mutation test da CLASSE skipped
# (o estado de medição PULADA fechando lacuna — scripts/doctor-unproven.mjs)
#
# Usage:
#   ./scripts/test-mutation-unproven-skipped.sh
#
# Exit codes:
#   0 — as QUATRO mutações DETECTADAS: reintroduzir o "aceita skipped" em cada
#       irmão deixa a suíte VERMELHA pela âncora do PREDICADO mutado ✅
#   1 — suíte CEGA (verde com o fio reintroduzido) / mutação não aplicada /
#       não-cirúrgica / infra ❌
#
# POR QUE: a auditoria de 05/10/2026 não achou UM falso fechamento — achou uma
# CLASSE. O `act-runner-lido` publicava a lacuna como PROVADA com o fato
# `skipped` (a seção pulada pelo perfil `--ci`), e o MESMO predicado "qualquer
# estado que não seja X" morava nos irmãos do MESMO registro: `forjaLida`
# (aceitava skipped e unread), `host-env-presente` (aceitava skipped) e as duas
# metades da fila (aceitavam skipped). O remédio de cada um é a allowlist de
# LEITURA REAL — e ESTE teste prova que o remédio é load-bearing em cada irmão:
# reintroduzir o "aceita skipped" num predicado derruba a suíte PELA ÂNCORA
# DELE, com os irmãos intactos seguindo verdes — a cirurgia é por PREDICADO,
# que é o fio (a classe inteira tem a prova dela na suíte: a tabela
# `CLASSE_SKIPPED`, coberta contra `CLOSED_BY` pelo primeiro teste).
#
# COMO: quatro mutações, cada uma reintroduzindo o defeito da classe num
# predicado — o M4 no `act-runner-lido`, que JÁ foi remediado, é a prova de que
# o remédio dele não é decorativo:
#
#   M1 — `forjaLida` volta a aceitar qualquer estado !== null: a protection
#        pulada (`{state:"skipped"}` do `--no-protection`) ou não lida fecha o
#        gitea-token;
#   M2 — `host-env-presente` recebe "skipped" de volta na allowlist: a imagem
#        NUNCA medida fecha a declaração do env do host;
#   M3 — as DUAS metades da fila recebem "skipped" de volta (UMA edição, porque
#        o fio é o MESMO nas duas): a fila não medida fecha as duas lacunas;
#   M4 — `act-runner-lido` volta ao predicate antigo (qualquer estado !==
#        "unavailable" — literalmente o que a auditoria mediu).
#
# CONTROLE — doctor íntegro → suíte VERDE, com TODAS as âncoras das QUATRO
# mutações vivas (cada uma casando EXATAMENTE UM teste). MUTAÇÃO — fio
# reintroduzido → suíte VERMELHA (success=false) com:
#   • CADA âncora do predicado mutado FAILING — a classe é medida por irmão;
#   • as âncoras INTACTAS PASSING — o IRMÃO não mutado segue fechando pela
#     medição real e recusando o pulado (a mutação é cirúrgica no predicado);
#   • o total de testes igual ao do controle (a suíte rodou INTEIRA).
#
# ⚠️ Source-coupled (como os demais test-mutation-*.sh): a régua única ancora
# nos literais das allowlists de `doctor-unproven.mjs` (o remédio de 05/10/2026)
# e as asserções nos títulos dos testes de classe. Refatorar qualquer um exige
# atualizar ESTE script junto — e ele FALHA (exit 1) em vez de passar em
# silêncio quando isso acontece.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# O SCRATCH DAS FIXTURES É ESTÁVEL E FORA DO `/tmp` (o motivo inteiro, com as
# duas medições, está no cabeçalho do master): a raiz é a MESMA em toda rodada
# e NÃO fica DENTRO do repositório — uma fixture dentro de um repo muda de
# semântica (node_modules, prettier e git passam a alcançá-la).
MUT_SCRATCH="${MUT_SCRATCH:-${XDG_CACHE_HOME:-$HOME/.cache}/severinno-mutacao}"
mkdir -p "$MUT_SCRATCH" 2>/dev/null || {
  echo "❌ o scratch das fixtures não pôde ser criado: $MUT_SCRATCH (infra declarada)" >&2
  exit 2
}

# A PROVA-DE-APLICAÇÃO — a régua ÚNICA de "a mutação APLICOU" (o gabarito dela é
# `scripts/test-mutation-mutacao-prova.sh`).
# shellcheck source=scripts/mutacao-prova.sh
. "$SCRIPT_DIR/scripts/mutacao-prova.sh"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|a allowlist da FORJA LIDA: com qualquer estado !== null, a protection pulada ou não lida fecha o gitea-token'
  'M2|a allowlist do ENV do HOST: com "skipped" de volta na lista, a imagem nunca medida fecha a declaração'
  'M3|a allowlist das DUAS METADES da fila: com "skipped" de volta, a fila não medida fecha as duas lacunas'
  'M4|a allowlist do REGISTRO do act_runner: o predicate antigo (qualquer estado !== unavailable) volta'
)
cd "$SCRIPT_DIR"

ALVO="scripts/doctor-unproven.mjs"
# A SUÍTE da classe: é ela que a mutação tem de derrubar (a tabela
# `CLASSE_SKIPPED` + a cobertura contra `CLOSED_BY`, ambas no arquivo).
SUITE="src/lib/__tests__/doctor-unproven.test.ts"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
BACKUP="$TMP_DIR/doctor-unproven.mjs.backup"
RESULTS="$TMP_DIR/results.json"

# ── Colors ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

# ── Restore (trap EXIT — SEMPRE restaura, mesmo com falha) ────────────────
# cp do backup (NUNCA `git checkout --`) para não descartar edições locais
# não-commitadas de quem roda o script na própria máquina.
restore() {
  if [ -f "$BACKUP" ] && [ -f "$ALVO" ]; then
    cp "$BACKUP" "$ALVO"
    echo "  ↻ $ALVO restaurado do backup"
  fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT
# TERM/INT também RESTAURAM: uma execução morta no meio de uma mutação deixaria
# o doctor com a classe do falso fechamento reintroduzida — o `exit` dispara o
# trap de EXIT acima. (SIGKILL não dá chance a trap nenhum: confira depois com
# `git diff scripts/doctor-unproven.mjs` — o marcador MUTACAO aparece na linha.)
trap 'exit 130' INT TERM

# ── Helpers ───────────────────────────────────────────────────────────────

# mutar <antes> <depois> [<contagem>]: a CIRURGIA, o MARCADOR e o CONTEÚDO são
# da régua única (`mutacao_aplicar`), e a sintaxe continua sendo conferida aqui.
mutar() {
  local antes
  antes="$(cksum "$ALVO" | cut -d' ' -f1)"
  mutacao_aplicar "$ALVO" "$1" "$2" "$antes" "${3:-1}"
  mutacao_sintaxe_node "$ALVO"
}

# run_suite: roda a suíte da classe com o reporter JSON e captura output/exit
# em SUITE_LOG/SUITE_EXIT (o `|| code=$?` com pipefail: o exit do PIPELINE é o
# do vitest, não o do tail).
SUITE_EXIT=0
SUITE_LOG=""
run_suite() {
  rm -f "$RESULTS"
  SUITE_EXIT=0
  local log
  log="$(bun x vitest run --config vitest.config.unit.ts --reporter=json \
    --outputFile="$RESULTS" "$SUITE" 2>&1 | tail -3)" || SUITE_EXIT=$?
  SUITE_LOG="$log"
  return 0
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

# anchor_report: imprime "N|status1,status2" para os testes cujo fullName contém
# a substring — o N é o que impede âncora AMBÍGUA de medir o predicado errado.
anchor_report() {
  node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const sub = process.argv[2]
    const hits = (j.testResults ?? [])
      .flatMap((f) => f.assertionResults ?? [])
      .filter((r) => (r.fullName ?? "").includes(sub))
    process.stdout.write(
      hits.length === 0 ? "0|absent" : `${hits.length}|${hits.map((h) => h.status).join(",")}`,
    )
  ' "$1" "$2"
}

# assert_anchors: exige que CADA entrada de "$@" (formato "nome|substring")
# esteja no estado esperado ($1 = json, $2 = expected status, resto = âncoras).
assert_anchors() {
  local results="$1" expected="$2"
  shift 2
  local entry name sub report count statuses checked=0
  for entry in "$@"; do
    name="${entry%%|*}"
    sub="${entry#*|}"
    report="$(anchor_report "$results" "$sub")"
    count="${report%%|*}"
    statuses="${report#*|}"
    if [ "$count" != "1" ] || [ "$statuses" != "$expected" ]; then
      # Os diagnósticos vão para STDERR: a função roda dentro de `$(...)` e um
      # `fail` no stdout seria engolido.
      fail "âncora do predicado '$name' fora do estado esperado." >&2
      fail "  \"$sub\" → $count teste(s) casaram, status '$statuses' (esperado 1 casando, '$expected')" >&2
      fail "Renomeou/removeu/duplicou um teste? Atualize as âncoras DESTE script." >&2
      return 1
    fi
    checked=$((checked + 1))
  done
  echo "$checked"
}

# ── Âncoras — UM PREDICADO POR ÂNCORA (a unidade é o IRMÃO, não o arquivo) ──
# Formato: "nome|substring ÚNICA do fullName do teste de classe do predicado".
A_FORJA_RED=("forja lida|fechável por 'gitea-forja-lida' fica open")
A_FORJA_INTACT=(
  "a cobertura da classe|todo closedBy está classificado na tabela da classe"
  "o registro do act_runner|fechável por 'act-runner-lido' fica open"
)
A_HOST_RED=("env do host|fechável por 'host-env-presente' fica open")
A_HOST_INTACT=(
  "a cobertura da classe|todo closedBy está classificado na tabela da classe"
  "a forja dona do merge|fechável por 'gitea-forja-lida' fica open"
)
A_FILA_RED=(
  "a fila do gitea|fechável por 'fila-gitea-medida' fica open"
  "a fila do github|fechável por 'fila-github-medida' fica open"
)
A_FILA_INTACT=(
  "a cobertura da classe|todo closedBy está classificado na tabela da classe"
  "o registro do act_runner|fechável por 'act-runner-lido' fica open"
)
A_REGISTRO_RED=("o registro do act_runner|fechável por 'act-runner-lido' fica open")
A_REGISTRO_INTACT=(
  "a cobertura da classe|todo closedBy está classificado na tabela da classe"
  "a forja dona do merge|fechável por 'gitea-forja-lida' fica open"
)

# Todas as âncoras — o CONTROLE exige cada uma VIVA (1 teste casando, passed).
ALL_ANCHORS=(
  "${A_FORJA_RED[@]}"
  "${A_FORJA_INTACT[@]}"
  "${A_HOST_RED[@]}"
  "${A_HOST_INTACT[@]}"
  "${A_FILA_RED[@]}"
  "${A_FILA_INTACT[@]}"
  "${A_REGISTRO_RED[@]}"
  "${A_REGISTRO_INTACT[@]}"
)

# ── MUTAÇÃO — o fio da classe reintroduzido → suíte VERMELHA ──────────────
# Lê os globais MUT_* (definidos antes de cada chamada) e decide pelo JSON.
assert_mutacao() {
  info "MUTAÇÃO $MUT_NOME — a suíte deve ficar VERMELHA pela âncora do predicado mutado..."
  mutar "$MUT_ANTES" "$MUT_DEPOIS" "$MUT_CONTAGEM"
  pass "Mutação $MUT_NOME aplicada em $ALVO (sintaxe válida)"

  run_suite
  echo "$SUITE_LOG" | tail -3

  # Caso 0 — SUÍTE CEGA: passou com a classe reintroduzida. É exatamente o
  # falso fechamento que o registro existe para não publicar.
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "SUÍTE CEGA: a suíte passou (exit 0) com o fio da classe reintroduzido."
    exit 1
  fi

  if [ ! -f "$RESULTS" ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o vitest não produziu JSON (a mutação quebrou"
    fail "o carregamento do arquivo, e não só o fio que ela afirma reintroduzir)."
    exit 1
  fi

  local summary success failed total
  summary="$(results_summary "$RESULTS")"
  success="${summary%%|*}"
  failed="$(echo "$summary" | cut -d'|' -f2)"
  total="$(echo "$summary" | cut -d'|' -f4)"

  # Caso 1 — falhou por INFRA/erro de carregamento, não por asserção: a suíte
  # não rodou inteira (menos testes que o controle) ou saiu sem falhas de teste.
  if [ "$success" != "false" ] || [ "$failed" = "0" ] || [ "$total" != "$CONTROL_TOTAL" ]; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: a suíte falhou por outro motivo"
    fail "  (success=$success, failed=$failed, total=$total; controle=$CONTROL_TOTAL)."
    fail "Reintroduzir o 'aceita skipped' tem de derrubar as asserções da classe, não o arquivo inteiro."
    exit 1
  fi

  # Caso 2 — uma âncora do PREDICADO mutado não caiu: a classe é medida por
  # irmão, então TODAS as âncoras dele têm de ficar vermelhas.
  local red intact
  if ! red="$(assert_anchors "$RESULTS" failed "${MUT_RED[@]}")"; then
    fail "Nem toda âncora do predicado mutado caiu com o fio da classe reintroduzido."
    fail "A âncora que seguiu verde não mede o fio — veja o log acima."
    exit 1
  fi

  # Caso 3 — uma âncora INTACTA caiu: a mutação não foi cirúrgica no predicado
  # (derrubou um irmão que ela não toca).
  if ! intact="$(assert_anchors "$RESULTS" passed "${MUT_INTACT[@]}")"; then
    fail "Mutação $MUT_NOME NÃO-CIRÚRGICA: uma âncora de IRMÃO INTACTO caiu."
    fail "A mutação deve reintroduzir o fio SÓ no predicado que ela nomeia."
    exit 1
  fi

  pass "Mutação $MUT_NOME DETECTADA: suíte VERMELHA ($failed de $total testes falharam)"
  pass "  • $red âncora(s) do predicado mutado FAILED, $intact âncora(s) intacta(s) PASSED"
  # Devolve o arquivo ao estado íntegro antes da próxima mutação.
  cp "$BACKUP" "$ALVO"
  pass "Alvo restaurado — base íntegra para a próxima mutação"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (a CLASSE skipped do registro datado)"
echo "   M1. forjaLida aceita qualquer estado !== null (a protection pulada)"
echo "   M2. host-env-presente aceita 'skipped' (a imagem nunca medida)"
echo "   M3. fila-gitea/fila-github aceitam 'skipped' (a fila não medida)"
echo "   M4. act-runner-lido volta ao predicate antigo (o que a auditoria achou)"
echo "   (IN-PLACE com backup + trap de restauração, régua única de aplicação)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── Backup ANTES de qualquer mutação (o trap restaura a partir dele) ─────
cp "$ALVO" "$BACKUP"
pass "Backup do alvo criado ($BACKUP)"

# ── CONTROLE — doctor íntegro → suíte VERDE, com TODAS as âncoras vivas ──
# Sem isto a detecção abaixo seria vácuo: âncora renomeada/removida (ou
# ambígua) não acenderia com a mutação, e o script passaria sem provar nada.
header "CONTROLE — doctor íntegro → a suíte da classe deve ficar VERDE"
run_suite
echo "$SUITE_LOG" | tail -3

if [ "$SUITE_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: a suíte da classe não ficou verde com o doctor ÍNTEGRO (exit $SUITE_EXIT)."
  exit 1
fi
if [ ! -f "$RESULTS" ]; then
  fail "CONTROLE FALHOU: o vitest não produziu o JSON de resultados."
  fail "Ambiente sem node_modules? Este script precisa de bun install."
  exit 1
fi

summary="$(results_summary "$RESULTS")"
success="${summary%%|*}"
failed="$(echo "$summary" | cut -d'|' -f2)"
CONTROL_TOTAL="$(echo "$summary" | cut -d'|' -f4)"

if [ "$success" != "true" ] || [ "$failed" != "0" ]; then
  fail "CONTROLE FALHOU: suíte não ficou verde com o doctor íntegro"
  fail "  (success=$success, failed=$failed)."
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi

if ! CONTROL_ALIVE="$(assert_anchors "$RESULTS" passed "${ALL_ANCHORS[@]}")"; then
  fail "CONTROLE FALHOU: nem todas as âncoras das QUATRO mutações estão vivas agora."
  exit 1
fi
pass "Controle OK — $CONTROL_TOTAL testes verdes, com $CONTROL_ALIVE âncoras vivas (1 teste cada)"

# ── MUTAÇÃO M1 — a allowlist da FORJA LIDA ────────────────────────────────
header "MUTAÇÃO M1 — forjaLida volta a aceitar qualquer estado !== null"
info "Reintroduzindo o 'aceita tudo que não é null' (a protection pulada fecha)..."
MUT_NOME="M1 (a forja lida aceita a seção pulada)"
MUT_ANTES='return FORJA_LIDA.includes(estadoDaForja(facts, forge))'
MUT_DEPOIS='return estadoDaForja(facts, forge) !== null // MUTACAO M1: qualquer estado !== null fecha (a classe do falso fechamento)'
MUT_CONTAGEM=1
MUT_RED=("${A_FORJA_RED[@]}")
MUT_INTACT=("${A_FORJA_INTACT[@]}")
assert_mutacao

# ── MUTAÇÃO M2 — a allowlist do ENV DO HOST ───────────────────────────────
header "MUTAÇÃO M2 — host-env-presente aceita 'skipped' de novo"
info "Colocando 'skipped' de volta na allowlist do env do host..."
MUT_NOME="M2 (o env do host fecha com a imagem nunca medida)"
MUT_ANTES='["exists", "missing", "exists-private"].includes(facts.image.state),'
MUT_DEPOIS='["exists", "missing", "exists-private", "skipped"].includes(facts.image.state), // MUTACAO M2: a seção pulada volta a fechar'
MUT_CONTAGEM=1
MUT_RED=("${A_HOST_RED[@]}")
MUT_INTACT=("${A_HOST_INTACT[@]}")
assert_mutacao

# ── MUTAÇÃO M3 — as DUAS METADES da fila (UMA edição, o fio é o mesmo) ────
header "MUTAÇÃO M3 — fila-gitea/fila-github aceitam 'skipped' de novo"
info "Colocando 'skipped' de volta na allowlist das DUAS metades da fila..."
MUT_NOME="M3 (a fila não medida fecha as duas lacunas)"
MUT_ANTES='FILA_MEDIDA.includes(metade.state)'
MUT_DEPOIS='(FILA_MEDIDA.includes(metade.state) || metade.state === "skipped") // MUTACAO M3: a fila pulada volta a fechar'
MUT_CONTAGEM=2
MUT_RED=("${A_FILA_RED[@]}")
MUT_INTACT=("${A_FILA_INTACT[@]}")
assert_mutacao

# ── MUTAÇÃO M4 — o REGISTRO do act_runner volta ao predicate antigo ───────
header "MUTAÇÃO M4 — act-runner-lido volta ao predicate que a auditoria achou"
info "Trocando a allowlist de leitura real por 'qualquer estado !== unavailable'..."
MUT_NOME="M4 (o registro do act_runner fecha com a medição pulada)"
MUT_ANTES='["proven", "violated"].includes(facts.runnerLabels.state),'
MUT_DEPOIS='facts.runnerLabels.state !== "unavailable", // MUTACAO M4: o predicate antigo, o que a auditoria mediu'
MUT_CONTAGEM=1
MUT_RED=("${A_REGISTRO_RED[@]}")
MUT_INTACT=("${A_REGISTRO_INTACT[@]}")
assert_mutacao

# ═════════════════════════════════════════════════════════════════════════
# CONTROLE FINAL — o alvo voltou byte a byte ao original
# ═════════════════════════════════════════════════════════════════════════

header "CONTROLE FINAL — o alvo restaurado voltou ao estado original"
if ! cmp -s "$BACKUP" "$ALVO"; then
  fail "O alvo NÃO voltou ao estado original (backup ≠ atual)."
  exit 1
fi
pass "Controle final OK — $ALVO está byte a byte igual ao backup"

# ── Veredito ──────────────────────────────────────────────────────────────
echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo -e "   ${GREEN}✅ MUTATION TEST PASSOU${NC} — a CLASSE skipped é load-bearing:"
echo "      • a allowlist da FORJA LIDA → com qualquer estado !== null, a"
echo "        protection pulada/não lida fecha o gitea-token"
echo "      • a allowlist do ENV DO HOST → com 'skipped' de volta, a imagem"
echo "        nunca medida fecha a declaração do env"
echo "      • a allowlist das DUAS METADES da fila → com 'skipped' de volta, a"
echo "        fila não medida fecha as duas lacunas numa edição só"
echo "      • a allowlist do REGISTRO do act_runner → o predicate antigo (o que"
echo "        a auditoria mediu em 05/10/2026) volta a publicar o falso fechamento"
echo "      Cada mutação é CIRÚRGICA no predicado (a âncora DELE cai, os irmãos"
echo "      seguem verdes), passa pela RÉGUA ÚNICA de aplicação e é restaurada"
echo "      entre as medições, byte a byte, no controle final."
echo "  ═════════════════════════════════════════════════════════════════"
echo ""
exit 0
