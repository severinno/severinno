#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-runner-labels.sh — Mutation test da ORDEM DECLARADA do
# container do runner (`scripts/check-runner-labels.mjs`)
#
# Usage:
#   bash scripts/test-mutation-runner-labels.sh
#
# Exit codes:
#   0 — a metade foi DETECTADA (o compose volta a vencer a sonda E a suíte
#       unitária fica vermelha pela âncora certa) e o controle passou ✅
#   1 — a metade NÃO sustentou o veredito (a leitura não mudou com o mecanismo
#       desligado), mutação não-cirúrgica ou restauração falhou ❌
#   2 — infra: a leitura por execução não pôde ser montada
#
# O QUE ISTO PROVA (e por que o guard passar hoje não basta)
#
# O nome do container do runner era derivado (`container_name` do compose → o
# service label que o próprio compose põe), e isso amarrava a medição à STACK:
# uma SONDA — o ensaio da metade da versão contra um container de teste, com a
# imagem pinada — não tinha como se declarar sem TOMAR o nome da stack. A ordem
# passou a ser **declarado vence derivado** (`--container` → a variável
# `GITEA_RUNNER_CONTAINER` → o compose), e a FONTE viaja até o veredito da
# versão (`no container 'x' (declarado por GITEA_RUNNER_CONTAINER)`): medir uma
# sonda NÃO é medir a stack.
#
# Essa precedência passa em silêncio quando o declarado perde: basta pôr o
# compose na frente para a sonda voltar a ser ignorada — e o veredito da versão
# passaria a dizer "o binário do runner reporta X" sobre um container que
# ninguém declarou medir. É essa a classe que esta suíte mede:
#
#   M1 — a ORDEM DECLARADA. A declaração deixa de ser lida (`if (nomeDeclarado
#        !== "")` nunca abre) e a escada volta a ser a derivada: a sonda é
#        IGNORADA, o `container_name` do compose ganha, e o veredito da versão
#        perde a fonte. A suíte exige as DUAS testemunhas vermelhas.
#
# DUAS TESTEMUNHAS INDEPENDENTES
#
#   (1) A LEITURA POR EXECUÇÃO — o driver importa o `check-runner-labels.mjs`
#       (o mutado, quando há mutação) e chama a MESMA função que o veredito
#       chama (`resolveRunnerContainer`) com o `run` DUBLADO: nenhum `docker`
#       deste host entra na medição, e o que se lê é o RESULTADO (o container e
#       a FONTE). A mesma leitura desce ao veredito da versão
#       (`compareActRunnerVersion`), que é onde a sonda não pode se confundir
#       com a stack.
#   (2) A SUÍTE UNITÁRIA (`check-runner-labels.test.ts`) — o que roda em todo
#       PR. A âncora é o título da metade mutada ("o DECLARADO vence o
#       container_name do compose"), para o vermelho não ser de outro caso.
#       Sem `vitest` instalado a testemunha se declara NÃO JULGÁVEL em voz alta.
#
# A CIRURGIA: a injeção casa exatamente 1 ocorrência (0 ou 2+ = a suíte PARA em
# vez de medir outra coisa), o guard mutado tem de continuar com sintaxe válida,
# e a restauração é conferida por CHECKSUM no trap EXIT — um `exit` no meio não
# deixa o guard mutado na árvore.
#
# LIMITES DECLARADOS (o que esta prova NÃO cobre):
#   · o CLI no host da forja (com o `docker` de verdade) não é exercitado aqui:
#     o que se mede é a RÉGUA da precedência, e o guard real sobre a stack real
#     é o `runner-labels:check` rodando onde a forja está.
#   · a comparação de LABELS (declarado × registrado) e o fail-closed do
#     "não consegui olhar" têm as suas próprias metades na suíte unitária; esta
#     suíte mede a ORDEM, e é só ela que ela declara.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# A PROVA-DE-APLICAÇÃO — a régua ÚNICA de "a mutação APLICOU" (o gabarito dela é
# `scripts/test-mutation-mutacao-prova.sh`).
# shellcheck source=scripts/mutacao-prova.sh
. "$SCRIPT_DIR/scripts/mutacao-prova.sh"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'ordem-declarada|a ORDEM declarada: o compose volta a vencer a SONDA (o declarado perde a precedência e a fonte some do veredito)'
)

cd "$SCRIPT_DIR"

GUARD="scripts/check-runner-labels.mjs"
SUITE="src/lib/__tests__/check-runner-labels.test.ts"

TMP_DIR="$(mktemp -d)"
F_DRIVER="$TMP_DIR/driver.json"

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

# ── Backup da FONTE + restauração VERIFICADA (trap EXIT) ──────────────────
# A mutação é aplicada NO LUGAR (é o arquivo que o driver importa e que a suíte
# unitária lê). O checksum é a testemunha de que a árvore voltou.
BACKUP="$TMP_DIR/guard.original.mjs"
cp "$GUARD" "$BACKUP"
GUARD_SUM="$(cksum "$GUARD" | cut -d' ' -f1)"

restore() {
  if [ -f "$BACKUP" ]; then cp -f "$BACKUP" "$GUARD" 2>/dev/null || true; fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT

restaurar_original() {
  cp -f "$BACKUP" "$GUARD"
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$GUARD_SUM" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum do guard diverge) — restaure a partir de $BACKUP"
    exit 1
  fi
  pass "guard restaurado (checksum confere)"
}

# ── O DRIVER: a leitura por execução ──────────────────────────────────────
# Importa o guard (mutado, quando há mutação) e lê as TRÊS escadas da ordem +
# o veredito da VERSÃO. O `run` é dublado: nenhum `docker` do host entra na
# medição, e o `container_name` do render é o da stack (`gitea-runner`), para a
# sonda declarada (`sonda-do-ensaio`) só poder vencer por PRECEDÊNCIA.
rodar_driver() {
  set +e
  GUARD_URL="file://$SCRIPT_DIR/$GUARD" node --input-type=module -e '
const mod = await import(process.env.GUARD_URL)

// O render do compose: o container da STACK tem nome, e é ele que ganharia se a
// ordem derivada voltasse a valer.
const RENDER = { services: { runner: { container_name: "gitea-runner" } } }
// O render SEM nome: a terceira escada (o service label), pela resposta dublada.
const SEM_NOME = { services: { runner: {} } }
const chamadas = []
const run = (bin, args) => {
  chamadas.push([bin, ...args].join(" "))
  return { status: 0, stdout: "gitea-runner-por-label\n", stderr: "" }
}

const sonda = mod.resolveRunnerContainer({
  cwd: "/repo",
  run,
  rendered: RENDER,
  declarado: "sonda-do-ensaio",
})
const chamadasDaSonda = chamadas.length
const branco = mod.resolveRunnerContainer({ cwd: "/repo", run, rendered: RENDER, declarado: "   " })
const porLabel = mod.resolveRunnerContainer({ cwd: "/repo", run, rendered: SEM_NOME, declarado: null })

// A FONTE no veredito da VERSÃO: o binário reporta OUTRA coisa que a tag pina
// (é o caso em que o detalhe nomeia o container e a fonte dele). A imagem da
// SONDA é a nossa namespace com um nome FORA do Bun e uma TAG que declara
// versão: um `ubuntu-bun:<semver>` seria acusado pelo guard da fonte única do
// Bun mesmo aqui (a escada da sentinela não cobre a forma prefixada pelo nome
// do Bun), e o que a medição da FONTE precisa é só uma tag que pese no veredito.
const imagem = "ghcr.io/severinno/runner-sonda:9.9.9"
const versao = mod.compareActRunnerVersion({
  declaredImage: imagem,
  reported: "0.6.1",
  container: sonda.container,
  fonte: sonda.detail,
})
const versaoSemFonte = mod.compareActRunnerVersion({
  declaredImage: imagem,
  reported: "0.6.1",
  container: sonda.container,
})

process.stdout.write(
  JSON.stringify({
    sonda: { ok: sonda.ok, container: sonda.container, detail: sonda.detail, docker: chamadasDaSonda },
    branco: { container: branco.container, detail: branco.detail },
    porLabel: { container: porLabel.container, detail: porLabel.detail },
    versao: { state: versao.state, detail: versao.detail },
    versaoSemFonte: { state: versaoSemFonte.state, detail: versaoSemFonte.detail },
  }) + "\n",
)
' >"$F_DRIVER" 2>"$TMP_DIR/driver.err"
  DRIVER_EXIT=$?
  set -e
}

ler() { python3 -c "
import json,sys
d = json.load(open('$F_DRIVER'))
v = d
for k in sys.argv[1].split('.'):
    v = v[int(k)] if k.isdigit() else v[k]
print(v)
" "$1"; }

rodar_driver_e_checar() { # <cenário> — o driver rodou e produziu leitura
  local cenario="$1"
  rodar_driver
  if [ "$DRIVER_EXIT" -ne 0 ]; then
    fail "$cenario: a LEITURA QUEBROU (driver exit $DRIVER_EXIT) — a mutação derrubou o módulo em vez de medir a régua"
    sed 's/^/      /' "$TMP_DIR/driver.err" | tail -6
    exit 1
  fi
}

# exigir_igual <caminho> <esperado> <cenário> — o valor MEDIDO, byte a byte.
exigir_igual() {
  local caminho="$1" esperado="$2" cenario="$3"
  local obtido
  obtido="$(ler "$caminho")"
  if [ "$obtido" != "$esperado" ]; then
    fail "$cenario: a leitura de $caminho é '$obtido' e devia ser '$esperado'"
    echo "      leitura: $(cat "$F_DRIVER")"
    exit 1
  fi
  pass "$cenario ($caminho = $esperado)"
}

# exigir_contem <caminho> <trecho> <cenário> — o trecho aparece na leitura.
exigir_contem() {
  local caminho="$1" trecho="$2" cenario="$3"
  local obtido
  obtido="$(ler "$caminho")"
  if ! grep -qF "$trecho" <<<"$obtido"; then
    fail "$cenario: a leitura de $caminho não contém '$trecho'"
    echo "      leitura: $obtido"
    exit 1
  fi
  pass "$cenario ($caminho contém '$trecho')"
}

# exigir_ausente <caminho> <trecho> <cenário> — o trecho NÃO aparece (a fonte
# que some é uma leitura: `grep -q` sob pipefail é o padrão que o repo proíbe).
exigir_ausente() {
  local caminho="$1" trecho="$2" cenario="$3"
  local obtido
  obtido="$(ler "$caminho")"
  if grep -qF "$trecho" <<<"$obtido"; then
    fail "$cenario: a leitura de $caminho ainda contém '$trecho'"
    echo "      leitura: $obtido"
    exit 1
  fi
  pass "$cenario ($caminho sem '$trecho')"
}

# ── mutar <alvo> <troca>: substituição LITERAL, cirúrgica ─────────────────
mutar() { # <alvo-texto> <troca-texto>: a cirurgia, o marcador e o checksum são da
  # régua COMPARTILHADA (`mutacao_aplicar`); aqui só o alvo e a sintaxe do guard.
  mutacao_aplicar "$GUARD" "$1" "$2" "$GUARD_SUM"
  mutacao_sintaxe_node "$GUARD"
}

# ── A testemunha unitária (âncoras) ───────────────────────────────────────
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

rodar_suite() {
  set +e
  (cd "$SCRIPT_DIR" && NO_COLOR=1 bun x vitest run --config vitest.config.unit.ts "$SUITE") \
    >"$TMP_DIR/suite.bruto" 2>&1
  SUITE_EXIT=$?
  set -e
  # ANSI FORA antes de julgar (o vitest colore mesmo com a saída redirecionada,
  # e uma sequência de escape no começo da linha esconderia o `FAIL`/`×`).
  sed -E $'s/\033\\[[0-9;]*[a-zA-Z]//g' "$TMP_DIR/suite.bruto" >"$TMP_DIR/suite.txt"
  FAIL_LINES="$(grep -E "^[[:space:]]*(FAIL|×)" "$TMP_DIR/suite.txt" || true)"
}

mostrar_suite() { grep -E "^[[:space:]]*(FAIL|×)|Tests " "$TMP_DIR/suite.txt" | sed 's/^/      /' | head -12; }

exigir_suite_verde() {
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado; a leitura por execução SEGUE medindo)"
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

# exigir_suite_vermelha <cenário> <âncora da metade mutada>
exigir_suite_vermelha() {
  local cenario="$1" ancora="$2"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada (vitest ausente, declarado)"
    return 0
  fi
  rodar_suite
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte ficou VERDE com o mecanismo desligado — ele não é load-bearing"
    mostrar_suite
    exit 1
  fi
  if ! grep -qF "$ancora" <<<"$FAIL_LINES"; then
    fail "$cenario: vermelho pelo motivo ERRADO — a âncora da metade mutada não caiu:"
    echo "      · $ancora"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERMELHA pela metade mutada"
}

# ── A âncora (o título como o vitest o reporta) ───────────────────────────
ANCORA_M1="o DECLARADO vence o container_name do compose"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — a ORDEM DECLARADA do container ($GUARD)"
echo "  ═════════════════════════════════════════════════════════════════"

pass "Backup do guard; checksum inicial $GUARD_SUM"

# ── CONTROLE: a leitura íntegra das três escadas ──────────────────────────
header "CONTROLE — a régua íntegra: a sonda vence, e a fonte sai dita"
rodar_driver_e_checar "CONTROLE"
exigir_igual "sonda.ok" "True" "a sonda declarada resolve"
exigir_igual "sonda.container" "sonda-do-ensaio" "o DECLARADO vence o container_name do compose"
exigir_igual "sonda.detail" "declarado por GITEA_RUNNER_CONTAINER" "e a FONTE do nome sai dita"
exigir_igual "sonda.docker" "0" "a declaração não chama docker nenhum para descobrir o nome"
exigir_igual "branco.container" "gitea-runner" "o declarado em BRANCO cai para o compose"
exigir_igual "branco.detail" "container_name do compose" "e a fonte é a do compose"
exigir_igual "porLabel.container" "gitea-runner-por-label" "sem nome no render, o service label responde"
exigir_igual "porLabel.detail" "service label do compose" "e a fonte é a do label"
exigir_igual "versao.state" "drift" "o veredito da versão mede o drift (reportado ≠ declarado)"
exigir_contem "versao.detail" "no container 'sonda-do-ensaio' (declarado por GITEA_RUNNER_CONTAINER)" \
  "e a FONTE desce ao veredito: medir a sonda não é medir a stack"
exigir_contem "versaoSemFonte.detail" "no container 'sonda-do-ensaio'" \
  "sem fonte, o nome ainda é dito (o par é o que a sonda acrescenta)"
exigir_suite_verde "CONTROLE"

# ── M1: a ORDEM DECLARADA ─────────────────────────────────────────────────
header "M1 — a ORDEM: a declaração deixa de ser lida (o compose volta a vencer a sonda)"
mutar '  if (nomeDeclarado !== "") {' \
  '  if (false /* MUTACAO M1: a declaracao perde a precedencia */) {'
rodar_driver_e_checar "M1"
exigir_igual "sonda.container" "gitea-runner" "M1: o compose VENCE a sonda declarada — ela é ignorada"
exigir_igual "sonda.detail" "container_name do compose" "M1: e a fonte passa a ser a derivada"
exigir_igual "sonda.docker" "0" "M1: a escada do compose responde antes de qualquer docker (a mutação é cirúrgica)"
exigir_igual "branco.container" "gitea-runner" "M1: o branco segue caindo para o compose (nada mudou nele)"
exigir_igual "porLabel.detail" "service label do compose" "M1: e o service label segue sendo a terceira escada"
exigir_ausente "versao.detail" "declarado por GITEA_RUNNER_CONTAINER" \
  "M1: o veredito da versão perde a fonte declarada — a sonda sai da medição"
exigir_contem "versao.detail" "no container 'gitea-runner' (container_name do compose)" \
  "M1: e passa a dizer que mediu o container DA STACK"
exigir_suite_vermelha "M1" "$ANCORA_M1"
restaurar_original

# ── Fecho ─────────────────────────────────────────────────────────────────
header "FECHO"
rodar_driver_e_checar "FECHO"
exigir_igual "sonda.container" "sonda-do-ensaio" "na árvore restaurada, a sonda volta a vencer"
exigir_contem "versao.detail" "(declarado por GITEA_RUNNER_CONTAINER)" "e a fonte volta ao veredito"
exigir_suite_verde "FECHO"
pass "a metade da ORDEM declarada foi detectada; o guard está restaurado e medindo"
echo ""
