#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-gate-registration.sh — Mutation test da régua do
# REGISTRO da proteção (`registrationDelta` da prova do merge gate)
#
# Usage:
#   ./scripts/test-mutation-gate-registration.sh
#
# Exit codes:
#   0 — as CINCO mutações foram DETECTADAS (pelo veredito por execução e/ou pela
#       suíte unitária) e os controles passaram ✅
#   1 — régua CEGA (a mutação não foi vista) / mutação não-cirúrgica / controle
#       falso / infra ❌
#
# POR QUE ESTA SUÍTE EXISTE
#
# Ligar `enable_status_check` não basta: o que a forja EXIGE é a LISTA de
# `status_check_contexts`, e ela pode estar velha — um `name:` renomeado, ou um
# nome que carregava a CONTAGEM da matriz. O que bloqueia o merge não é
# `ci/required-checks.json`: é a proteção APLICADA. A prova do merge gate lê o
# registro de verdade e o compara com o manifesto (`registrationDelta`), nos dois
# lados: o contexto a MENOS (o job roda e o merge passa com ele vermelho), o a
# MAIS (o PR trava para sempre esperando um check que nunca roda) e qualquer
# contexto com CONTAGEM no nome (a string muda quando a matriz cresce).
#
# Uma régua dessas sem testemunha é uma promessa em prosa: mutar cada metade e
# continuar verde é a regressão silenciosa — a proteção da forja aponta para um
# conjunto que já não é o do repositório e NADA fica vermelho no PR.
#
# DUAS TESTEMUNHAS INDEPENDENTES
#
#   (1) O VEREDITO POR EXECUÇÃO — `scripts/merge-gate-fake-forge.mjs` roda o
#       MOTOR da prova (`proveGiteaMergeGate`, o mesmo caminho de código que o
#       cron executa) contra uma forja DUBLADA, sobre um checkout SINTÉTICO cujo
#       manifesto declara os contextos. O que se lê é o veredito e os
#       bloqueadores NOMEADOS — não o texto do arquivo.
#       É node-puro: roda no master mesmo sem `node_modules`.
#   (2) A SUÍTE UNITÁRIA (`prove-gitea-merge-gate.test.ts`), com âncoras: o
#       vermelho tem de ser O vermelho da metade mutada, e as outras metades
#       seguem VERDES. Sem `vitest` instalado a testemunha se declara NÃO
#       JULGÁVEL em voz alta — nunca um verde por omissão.
#
# AS CINCO METADES (a unidade é a metade, não o arquivo):
#
#   M1 — o contexto a MENOS (`missing`). Mutação: a lista sai vazia ⇒ o registro
#        que perdeu um contexto do manifesto passa como PROVADO.
#   M2 — o contexto a MAIS (`extra`). Mutação: a lista sai vazia ⇒ o PR que trava
#        para sempre deixa de ser NOMEADO (o sintoma ainda aparece na matriz — o
#        que morre aqui é a CAUSA no relatório).
#   M3 — a CONTAGEM no nome (`withCount`). Mutação: a lista sai vazia ⇒ o nome que
#        muda sozinho deixa de ser acusado.
#   M4 — o FIO em `proveGiteaMergeGate` (o `if (!registration.ok)`). Mutação: o
#        delta continua sendo CALCULADO e o veredito o ignora — é o defeito
#        original ("a prova apenas IMPRIMIA o registro").
#   M5 — a DIREÇÃO OPOSTA: a régua da contagem fica GULOSA (`countInContext`).
#        Mutação: qualquer dígito vira contagem ⇒ o contexto editorial legítimo
#        ("… (pré-requisito 0, por execução)") passa a ser ACUSADO e a proteção
#        correta sai VIOLADA — a violação falsa que ensina a ignorar vermelho.
#
# CADA mutação é CIRÚRGICA: o injetor recusa alvo ausente (0 ou 2+ ocorrências) e
# o arquivo mutado tem de continuar com sintaxe válida. Restauração por checksum
# no mesmo trap.
#
# LIMITES DECLARADOS (o que esta prova NÃO cobre):
#   · o TRANSPORTE é dublado (docker, CLI do Gitea e API HTTP); o que é medido é o
#     veredito do motor. O transporte de verdade — Gitea efêmero em container — é
#     medido pelo `merge-gate-proof` (cron semanal + PR que toca os caminhos da
#     prova), onde um `unavailable` é FALHA no cron;
#   · a mutação roda NO LUGAR no repositório: por isso ela vive no master (uma
#     matriz serial dentro de um job), e não num job ao lado do `merge-gate-proof`
#     — dois jobs do mesmo workflow rodariam em paralelo e a prova do Gitea
#     poderia ler o guard mutado. A árvore é restaurada por checksum;
#   · a régua de QUAL contexto o manifesto declara (o `name:` do job, o reusable)
#     é de outro guard (`check-required-checks`), com prova própria.
#
# Pipeline:
#   1. CONTROLE: os quatro desfechos da base íntegra (limpo/proven; menos, mais e
#      contagem VIOLADOS e NOMEADOS) + a suíte verde
#   2. M1..M5: cada mutação ⇒ CEGO/ACUSA medido POR EXECUÇÃO + âncoras da suíte
#   3. CONTROLE FINAL: restaurado (checksum), os desfechos voltam
#   4. Cleanup (trap EXIT — restaura o guard e remove o temp, mesmo com falha)
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

# A PROVA-DE-APLICAÇÃO — a régua ÚNICA de "a mutação APLICOU" (o gabarito dela é
# `scripts/test-mutation-mutacao-prova.sh`).
# shellcheck source=scripts/mutacao-prova.sh
. "$SCRIPT_DIR/scripts/mutacao-prova.sh"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|o contexto a MENOS (missing)'
  'M2|o contexto a MAIS (extra)'
  'M3|a CONTAGEM no nome (withCount)'
  'M4|o FIO em proveGiteaMergeGate (o if (!registration.ok))'
  'M5|a DIREÇÃO OPOSTA: a régua da contagem fica GULOSA (countInContext)'
)
cd "$SCRIPT_DIR"

GUARD="scripts/prove-gitea-merge-gate.mjs"
FORJA="scripts/merge-gate-fake-forge.mjs"
SUITE="src/lib/__tests__/prove-gitea-merge-gate.test.ts"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
BACKUP="$TMP_DIR/guard.backup"
FIXTURE="$TMP_DIR/fixture"
F_FORJA="$TMP_DIR/forja.json"
F_VEREDITO="$TMP_DIR/veredito.txt"
F_BLOCKERS="$TMP_DIR/blockers.txt"
F_DELTA="$TMP_DIR/delta.txt"
F_CONTEXTOS="$TMP_DIR/contextos.txt"
F_CASOS="$TMP_DIR/casos.txt"
F_SUITE="$TMP_DIR/suite.txt"
# O `node -e` que reduz o JSON a arquivos roda em PROCESSO FILHO: os caminhos
# precisam estar no ambiente dele.
export F_FORJA F_VEREDITO F_BLOCKERS F_DELTA F_CONTEXTOS F_CASOS

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

restore() {
  if [ -f "$BACKUP" ]; then cp "$BACKUP" "$GUARD"; fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT

# ── A fixture: um checkout SINTÉTICO cujo manifesto declara TRÊS contextos ──
# Um deles carrega PARÊNTESES com um número EDITORIAL ("pré-requisito 0, por
# execução"): é o par que a M5 (direção oposta) usa — a régua da contagem não
# pode acusá-lo. O manifesto é a FONTE dos contextos, como na prova de verdade.
make_fixture() {
  mkdir -p "$FIXTURE/ci" "$FIXTURE/.gitea/workflows"

  cat >"$FIXTURE/ci/required-checks.json" <<'JSON'
{
  "version": 1,
  "branches": ["main"],
  "forges": {
    "gitea": {
      "workflow": ".gitea/workflows/ci.yml",
      "jobs": ["lint", "tests", "bring-up-proof"]
    }
  }
}
JSON

  cat >"$FIXTURE/.gitea/workflows/ci.yml" <<'YAML'
name: ci
on:
  pull_request:
jobs:
  lint:
    name: Lint
    runs-on: ubuntu-bun
    steps:
      - run: bun run lint
  tests:
    name: Tests
    runs-on: ubuntu-bun
    steps:
      - run: bun run test:run
  bring-up-proof:
    name: Bring-up Gate Proof (pré-requisito 0, por execução)
    runs-on: ubuntu-bun
    steps:
      - run: bun run test:bring-up
YAML
}

# ── mutar <alvo> <troca>: a CIRURGIA, o MARCADOR e o CONTEÚDO são da régua única
# (`mutacao_aplicar`); aqui só o alvo e a sintaxe do guard.
mutar() { # <alvo-texto> <troca-texto>
  local antes
  antes="$(cksum "$GUARD" | cut -d' ' -f1)"
  mutacao_aplicar "$GUARD" "$1" "$2" "$antes"
  mutacao_sintaxe_node "$GUARD"
}

# ── A testemunha de EXECUÇÃO: o veredito do motor, contra a forja dublada ──
# O helper imprime JSON; aqui ele é reduzido a ARQUIVOS (veredito, bloqueadores,
# delta, contextos, casos) para as asserções lerem — `grep` em ARQUIVO, nunca
# `… | grep` sob `set -o pipefail` (a classe de SIGPIPE que o repositório gateia).
rodar_forja() {
  local knob="$1" code=0
  node "$FORJA" --fixture "$FIXTURE" --registro "$knob" >"$F_FORJA" 2>"$TMP_DIR/forja.err" || code=$?
  if [ "$code" -ne 0 ]; then return "$code"; fi
  node -e '
const fs = require("fs")
const j = JSON.parse(fs.readFileSync(process.env.F_FORJA, "utf8"))
const w = (p, v) => fs.writeFileSync(p, `${v}\n`)
w(process.env.F_VEREDITO, j.verdict)
w(process.env.F_BLOCKERS, (j.blockers ?? []).join("\n"))
w(process.env.F_DELTA, JSON.stringify(j.registration))
w(process.env.F_CONTEXTOS, (j.contexts ?? []).join("\n"))
w(process.env.F_CASOS, j.cases.map((c) => c[1]).join(","))
'
}

dir_forja() { sed 's/^/      /' "$F_BLOCKERS" | grep -v '^      $' || true; }

exigir_forja() {
  local knob="$1" cenario="$2" code=0
  rodar_forja "$knob" || code=$?
  if [ "$code" -ne 0 ]; then
    fail "$cenario: a forja dublada não mediu (exit $code)"
    sed 's/^/      /' "$TMP_DIR/forja.err" | tail -5
    exit 1
  fi
}

exigir_veredito() {
  local esperado="$1" cenario="$2" obtido
  obtido="$(cat "$F_VEREDITO")"
  if [ "$obtido" != "$esperado" ]; then
    fail "$cenario: veredito '$obtido' (esperado '$esperado')"
    dir_forja
    exit 1
  fi
  pass "$cenario: veredito '$obtido'"
}

exigir_blocker() {
  local trecho="$1" cenario="$2"
  if ! grep -qF "$trecho" "$F_BLOCKERS"; then
    fail "$cenario: NENHUM bloqueador com '$trecho' — a causa não foi nomeada"
    dir_forja
    exit 1
  fi
  pass "$cenario: bloqueador nomeia '$trecho'"
}

exigir_sem_blocker() {
  local trecho="$1" cenario="$2"
  if grep -qF "$trecho" "$F_BLOCKERS"; then
    fail "$cenario: o bloqueador '$trecho' CONTINUA no relatório — a metade mutada não é load-bearing"
    dir_forja
    exit 1
  fi
  pass "$cenario: o bloqueador '$trecho' sumiu do relatório"
}

# ── A testemunha unitária (âncoras) ───────────────────────────────────────
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

rodar_suite() {
  set +e
  (cd "$SCRIPT_DIR" && NO_COLOR=1 bun x vitest run --config vitest.config.unit.ts "$SUITE") \
    >"$TMP_DIR/suite.bruto" 2>&1
  SUITE_EXIT=$?
  set -e
  # ANSI FORA antes de julgar (o vitest colore mesmo com a saída redirecionada, e
  # uma sequência de escape no começo da linha esconderia o `FAIL`/`×`).
  sed -E $'s/\033\[[0-9;]*[a-zA-Z]//g' "$TMP_DIR/suite.bruto" >"$F_SUITE"
  FAIL_LINES="$(grep -E "^[[:space:]]*(FAIL|×)" "$F_SUITE" || true)"
}

mostrar_suite() { tail -12 "$F_SUITE" | sed 's/^/      /'; }

exigir_suite_verde() {
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado; o veredito por execução SEGUE medindo)"
    return 0
  fi
  rodar_suite
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "$cenario: a suíte ficou VERMELHA sem mutação — o vermelho seguinte não provaria nada (ambiente)"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERDE (exit 0) — a testemunha mede"
}

# exigir_suite_vermelha <cenário> <âncoras devidas> <âncoras intocadas>
exigir_suite_vermelha() {
  local cenario="$1" devidos="$2" intocadas="$3"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada (vitest ausente, declarado)"
    return 0
  fi
  local IFS='|' a faltando="" caiu=""
  rodar_suite
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte ficou VERDE com a metade mutada — ela não é load-bearing"
    mostrar_suite
    exit 1
  fi
  for a in $devidos; do
    if ! grep -qF "$a" <<<"$FAIL_LINES"; then faltando="$faltando
      · $a"; fi
  done
  if [ -n "$faltando" ]; then
    fail "$cenario: vermelho pelo motivo ERRADO — as âncoras desta metade não caíram:$faltando"
    mostrar_suite
    exit 1
  fi
  for a in $intocadas; do
    if grep -qF "$a" <<<"$FAIL_LINES"; then caiu="$caiu
      · $a"; fi
  done
  if [ -n "$caiu" ]; then
    fail "$cenario: a mutação derrubou TAMBÉM as outras metades — mediu-se a suíte quebrando, não esta régua:$caiu"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERMELHA pela metade mutada — e as outras metades seguem verdes"
}

# ── As âncoras (títulos como o vitest os reporta) ─────────────────────────
ANCORA_MENOS="contexto a MENOS: o job roda e o merge passa — nomeado"
ANCORA_MAIS="contexto a MAIS: o PR trava para sempre — nomeado"
ANCORA_CONTAGEM="CONTAGEM no lado do MANIFESTO também reprova"
ANCORA_EDITORIAL="NÃO acusa os contextos legítimos que só têm parênteses"
ANCORA_FIO_SUBCONJUNTO="REGRESSÃO: applier que registra um SUBCONJUNTO sai VIOLADO"
ANCORA_FIO_CONTAGEM="REGRESSÃO: proteção registrada com CONTAGEM sai VIOLADA"
ANCORA_PROVEN="PROVEN: verde mergeia, vermelho e ausente não"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — régua do REGISTRO da proteção ($GUARD)"
echo "  ═════════════════════════════════════════════════════════════════"

cp "$GUARD" "$BACKUP"
make_fixture
pass "Backup do guard + fixture sintética em $FIXTURE"

# ── CONTROLE A — o manifesto do fixture declara os três contextos ─────────
# Inclui o contexto EDITORIAL: sem ele na fixture, a M5 (direção oposta) não
# teria o que acusar indevidamente.
header "CONTROLE A — a fixture resolve os contextos do manifesto (com o editorial)"
exigir_forja limpo "CONTROLE A"
exigir_veredito proven "CONTROLE A (registro em sincronia)"
if ! grep -qF "pré-requisito 0, por execução" "$F_CONTEXTOS"; then
  fail "CONTROLE A: o manifesto do fixture NÃO tem o contexto editorial — a M5 ficaria sem o que acusar"
  sed 's/^/      /' "$F_CONTEXTOS"
  exit 1
fi
pass "CONTROLE A: o manifesto tem o contexto editorial ('pré-requisito 0, por execução')"
if ! grep -qF "," "$F_CASOS"; then
  fail "CONTROLE A: a matriz não rodou (casos: '$(cat "$F_CASOS")')"
  exit 1
fi
pass "CONTROLE A: a matriz rodou ($(cat "$F_CASOS"))"

# ── CONTROLE B — a régua MORDE: os três defeitos são VIOLADOS e NOMEADOS ──
# Sem este passo, uma régua que \"não mede nada\" passaria como detector.
header "CONTROLE B — o registro errado é VIOLADO, com a causa nomeada"
exigir_forja menos "CONTROLE B (a MENOS)"
exigir_veredito violated "CONTROLE B (a MENOS)"
exigir_blocker "NAO registrou 1 contexto(s)" "CONTROLE B (a MENOS)"
exigir_blocker "'Tests'" "CONTROLE B (a MENOS, nomeia o contexto)"
exigir_forja mais "CONTROLE B (a MAIS)"
exigir_veredito violated "CONTROLE B (a MAIS)"
exigir_blocker "que o manifesto NAO declara" "CONTROLE B (a MAIS)"
exigir_blocker "'Guard que sumiu'" "CONTROLE B (a MAIS, nomeia o contexto)"
exigir_forja contagem "CONTROLE B (CONTAGEM)"
exigir_veredito violated "CONTROLE B (CONTAGEM)"
exigir_blocker "carrega CONTAGEM" "CONTROLE B (CONTAGEM)"

# ── CONTROLE C — a testemunha unitária mede (verde no estado íntegro) ─────
header "CONTROLE C — a suíte unitária está verde antes de mutar"
exigir_suite_verde "CONTROLE C"

# ── M1 — o contexto a MENOS ───────────────────────────────────────────────
# `missing` é a metade que acusa o job que RODA e cujo merge passa. Vazia, o
# registro que perdeu um contexto do manifesto sai PROVADO.
header "M1 — o contexto a MENOS (missing)"
mutar '  const missing = (expected ?? []).filter((c) => !reg.has(c))' \
  '  const missing = [] // MUTACAO M1'
pass "Mutação M1 aplicada (sintaxe válida)"

exigir_forja menos "M1"
exigir_veredito proven "M1 (CEGO)"
info "CEGO: o registro perdeu 'Tests' e a prova saiu PROVADA — o job roda e o merge passa com ele vermelho"

exigir_forja mais "M1 CIRÚRGICA"
exigir_blocker "'Guard que sumiu'" "M1 CIRÚRGICA (a régua da MAIS segue mordendo)"

exigir_suite_vermelha "M1" "$ANCORA_MENOS|registro VAZIO" "$ANCORA_MAIS"
cp "$BACKUP" "$GUARD"
pass "Guard restaurado — base íntegra para a M2"

# ── M2 — o contexto a MAIS ────────────────────────────────────────────────
# `extra` acusa o check que o workflow já não tem: o PR trava para sempre. A
# testemunha aqui é o BLOQUEADOR NOMEADO, não o veredito: sem esta régua o
# sintoma ainda aparece (a matriz não fecha o caso verde), mas a CAUSA some do
# relatório — e é ela que diz o que consertar.
header "M2 — o contexto a MAIS (extra)"
mutar '  const extra = (registered ?? []).filter((c) => !exp.has(c))' \
  '  const extra = [] // MUTACAO M2'
pass "Mutação M2 aplicada (sintaxe válida)"

exigir_forja mais "M2"
exigir_sem_blocker "'Guard que sumiu'" "M2 (CEGO)"
info "CEGO: o registro tem um contexto que o manifesto não declara e a prova deixa de NOMEÁ-LO (o veredito segue violado — pelo sintoma, não pela causa)"

exigir_forja menos "M2 CIRÚRGICA"
exigir_blocker "'Tests'" "M2 CIRÚRGICA (a régua da MENOS segue mordendo)"

exigir_suite_vermelha "M2" "$ANCORA_MAIS" "$ANCORA_MENOS"
cp "$BACKUP" "$GUARD"
pass "Guard restaurado — base íntegra para a M3"

# ── M3 — a CONTAGEM no nome do contexto ───────────────────────────────────
# Um contexto com número derivado muda sozinho quando a matriz cresce: a
# proteção passa a exigir um check que não existe. Sem `withCount`, esse defeito
# deixa de ser acusado — a causa desaparece do relatório.
header "M3 — a CONTAGEM no nome (withCount)"
mutar '  const withCount = [...new Set([...(registered ?? []), ...(expected ?? [])])]' \
  '  const withCount = [] || [...new Set([...(registered ?? []), ...(expected ?? [])])] // MUTACAO M3'
pass "Mutação M3 aplicada (sintaxe válida)"

exigir_forja contagem "M3"
exigir_sem_blocker "carrega CONTAGEM" "M3 (CEGO)"
exigir_blocker "NAO registrou" "M3 (as outras duas metades seguem no relatório)"
info "CEGO: 'Lint (3 checks)' registrado e nenhuma palavra sobre a contagem"

exigir_forja menos "M3 CIRÚRGICA"
exigir_blocker "'Tests'" "M3 CIRÚRGICA (a régua da MENOS segue mordendo)"

exigir_suite_vermelha "M3" "$ANCORA_CONTAGEM" "$ANCORA_MENOS"
cp "$BACKUP" "$GUARD"
pass "Guard restaurado — base íntegra para a M4"

# ── M4 — o FIO: o delta calculado e IGNORADO ──────────────────────────────
# É o defeito ORIGINAL: a prova lia o registro e o imprimia; uma aplicação que
# registrasse um subconjunto passava como verde. Aqui o delta continua sendo
# calculado (`ok: false` no JSON) e o veredito o ignora.
header "M4 — o FIO em proveGiteaMergeGate (registration.ok)"
mutar '    if (!registration.ok) {' '    if (false) { // MUTACAO M4'
pass "Mutação M4 aplicada (sintaxe válida)"

exigir_forja menos "M4"
exigir_veredito proven "M4 (CEGO)"
if ! grep -qF '"ok":false' "$F_DELTA"; then
  fail "M4: o delta deveria estar calculado (ok:false) — a mutação atingiu outra coisa"
  echo "      delta: $(cat "$F_DELTA")"
  exit 1
fi
pass "M4: o delta FOI calculado ($(cat "$F_DELTA")) e o veredito o ignorou — é o defeito original"

exigir_forja contagem "M4 CIRÚRGICA"
exigir_sem_blocker "NAO registrou" "M4 CIRÚRGICA (a causa do registro não é mais nomeada)"

exigir_suite_vermelha "M4" "$ANCORA_FIO_SUBCONJUNTO|$ANCORA_FIO_CONTAGEM" "$ANCORA_MENOS"
cp "$BACKUP" "$GUARD"
pass "Guard restaurado — base íntegra para a M5"

# ── M5 — a DIREÇÃO OPOSTA: a régua da contagem fica GULOSA ────────────────
# Um dígito qualquer vira contagem; o contexto editorial legítimo ("… (pré-
# requisito 0, por execução)") passa a ser ACUSADO e uma proteção correta sai
# VIOLADA. A violação falsa é o outro lado do mesmo defeito: ela ensina a
# ignorar vermelho.
header "M5 — a DIREÇÃO OPOSTA (countInContext guloso)"
mutar '  return /\([^()]*\d+\s+[^()]*\)/.exec(String(context ?? ""))?.[0] ?? null' \
  '  return /\d+/.exec(String(context ?? ""))?.[0] ?? null // MUTACAO M5'
pass "Mutação M5 aplicada (sintaxe válida)"

exigir_forja limpo "M5"
exigir_veredito violated "M5 (ACUSA o são)"
exigir_blocker "carrega CONTAGEM" "M5 (a acusação falsa)"
exigir_blocker "pré-requisito 0, por execução" "M5 (acusou o contexto editorial)"

exigir_forja menos "M5 CIRÚRGICA"
exigir_blocker "'Tests'" "M5 CIRÚRGICA (a régua da MENOS segue mordendo)"

exigir_suite_vermelha "M5" "$ANCORA_EDITORIAL|$ANCORA_PROVEN" "$ANCORA_MENOS"
cp "$BACKUP" "$GUARD"
pass "Guard restaurado (checksum conferido abaixo)"

# ── CONTROLE FINAL — a árvore voltou ao comportamento original ────────────
header "CONTROLE FINAL — o guard restaurado volta a medir os quatro desfechos"
if ! cmp -s "$BACKUP" "$GUARD"; then
  fail "O guard NÃO voltou ao estado original (backup ≠ atual)."
  exit 1
fi
exigir_forja limpo "CONTROLE FINAL"
exigir_veredito proven "CONTROLE FINAL (limpo)"
exigir_forja menos "CONTROLE FINAL"
exigir_veredito violated "CONTROLE FINAL (a MENOS)"
exigir_suite_verde "CONTROLE FINAL"

# ── Veredito ──────────────────────────────────────────────────────────────
echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo -e "   ${GREEN}✅ MUTATION TEST PASSOU${NC} — as CINCO metades são LOAD-BEARING:"
echo "      • o contexto a MENOS (missing) → vaziá-la faz o registro incompleto sair PROVADO"
echo "      • o contexto a MAIS (extra) → vaziá-la tira a CAUSA do relatório"
echo "      • a CONTAGEM no nome (withCount) → vaziá-la deixa o nome derivado passar"
echo "      • o FIO do veredito → o delta calculado e ignorado é o defeito original"
echo "      • a régua da contagem gulosa → acusa o contexto editorial (violação FALSA)"
echo "      e cada mutação é CIRÚRGICA: o guard é restaurado entre as medições, com"
echo "      o veredito medido POR EXECUÇÃO contra a forja dublada e a suíte unitária"
echo "      pelas âncoras da metade mutada."
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

exit 0
