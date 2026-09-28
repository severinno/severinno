#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-runner-tag.sh — Mutation test da RÉGUA DO PIN da imagem
# do act_runner (`scripts/check-runner-tag.mjs`)
#
# Usage:
#   bash scripts/test-mutation-runner-tag.sh
#
# Exit codes:
#   0 — a metade foi DETECTADA (o `latest` volta a passar como versão E a suíte
#       unitária fica vermelha pela âncora certa) e o controle passou ✅
#   1 — a metade NÃO sustentou o veredito (o guard mutado não mudou de leitura),
#       mutação não-cirúrgica, ou a restauração falhou ❌
#   2 — infra: a leitura por execução não pôde ser montada
#
# O QUE ISTO PROVA (e por que o guard passar hoje não basta)
#
# O `check-runner-tag.mjs` passou a RECUSAR uma tag que não declara versão — e o
# valor de um guard é a REGRA dele, não o veredito do arquivo de hoje. A metade
# desta suíte desliga a régua do pin (`if (!isVersionTag(tag))` nunca abre) e
# exige que o comportamento MUDE: com a tag deixando de ser julgada,
# `gitea/act_runner:latest` volta a sair `proven` — ou seja, a classe que a
# guarda existe para impedir (o compose voltar a flutuar, medido em 22/09/2026)
# passaria no CI em SILÊNCIO. Sem esta prova, "a tag tem de pinar" seria uma
# afirmação sobre a implementação de hoje, não sobre a regra.
#
# DUAS TESTEMUNHAS INDEPENDENTES
#
#   (1) A LEITURA POR EXECUÇÃO — o driver importa o guard (mutado, quando há
#       mutação) e chama `checkRunnerTag`/`judgeDeclaration` sobre TEXTOS de
#       compose sintéticos: nenhum docker, nenhum registry e nenhuma escrita no
#       repositório entram na medição. O que se lê é o RESULTADO (o estado, o
#       exit code e o texto do remédio).
#   (2) A SUÍTE UNITÁRIA (`check-runner-tag.test.ts`) — o que roda em todo PR. A
#       âncora é o título da metade mutada ("UMA TAG QUE NÃO É VERSÃO É
#       VIOLAÇÃO"), para o vermelho não ser de outro caso. Sem `vitest` instalado
#       a testemunha se declara NÃO JULGÁVEL em voz alta.
#
# A CIRURGIA: a injeção casa exatamente 1 ocorrência (0 ou 2+ = a suíte PARA em
# vez de medir outra coisa), o guard mutado tem de continuar com sintaxe válida,
# e a restauração é conferida por CHECKSUM no trap EXIT — um `exit` no meio não
# deixa o guard mutado na árvore.
#
# LIMITES DECLARADOS (o que esta prova NÃO cobre):
#   · o DIGEST aceito como pin (o `judgeDeclaration` o julga ANTES desta régua),
#     o valor interpolado e o serviço sem imagem têm as suas próprias metades na
#     suíte unitária; esta suíte mede a régua da TAG, e é só ela que declara;
#   · a comparação com o que a tag SERVE no registry é do `check-runner-base`
#     (`--require-registry`) e a comparação com o binário NO AR é do
#     `runner-labels:check` — nenhuma das duas é desta prova.
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
  'M1|a RÉGUA do pin: a tag deixa de ser julgada e o latest volta a passar como versão (a classe do compose flutuante passa no CI)'
)

cd "$SCRIPT_DIR"

GUARD="scripts/check-runner-tag.mjs"
SUITE="src/lib/__tests__/check-runner-tag.test.ts"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
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
# Importa o guard (mutado, quando há mutação) e julga CINCO declarações sobre
# textos de compose sintéticos: o veredito, o exit code e o remédio saem daqui.
rodar_driver() {
  set +e
  GUARD_URL="file://$SCRIPT_DIR/$GUARD" node --input-type=module -e '
const mod = await import(process.env.GUARD_URL)

const compose = (img) => ["services:", "  runner:", "    image: " + img, ""].join("\n")
const julgar = (img) => {
  const r = mod.checkRunnerTag({ text: compose(img) })
  return {
    state: r.state,
    veredito: r.info.verdict,
    exit: mod.exitCodeFor(r),
    primeiro: r.violations[0] ?? (r.warnings[0] ?? r.detail),
  }
}

process.stdout.write(
  JSON.stringify({
    versao: julgar("gitea/act_runner:0.6.1"),
    latest: julgar("gitea/act_runner:latest"),
    semTag: julgar("gitea/act_runner"),
    digest: julgar("gitea/act_runner@sha256:" + "c".repeat(64)),
    interpolado: julgar("gitea/act_runner:" + "${ACT_RUNNER_VERSION}"),
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
ANCORA_M1="UMA TAG QUE NÃO É VERSÃO É VIOLAÇÃO"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — a RÉGUA DO PIN da imagem do runner ($GUARD)"
echo "  ═════════════════════════════════════════════════════════════════"

pass "Backup do guard; checksum inicial $GUARD_SUM"

# ── CONTROLE: a leitura íntegra da régua ──────────────────────────────────
header "CONTROLE — a régua íntegra: a versão passa, o flutuante é violação"
rodar_driver_e_checar "CONTROLE"
exigir_igual "versao.state" "proven" "a tag de versão é aceita"
exigir_igual "versao.exit" "0" "e sai 0 (o contrato da CLI)"
exigir_igual "latest.state" "violated" "a tag 'latest' é VIOLAÇÃO (a classe medida)"
exigir_igual "latest.exit" "1" "e sai 1 — bloqueia o PR"
exigir_contem "latest.primeiro" "gitea-up.sh --re-register" "o remédio sai na violação"
exigir_contem "latest.primeiro" "docker compose pull" "e o PORQUÊ (o pull troca o que roda)"
exigir_igual "semTag.state" "violated" "a imagem SEM tag cai no 'latest' implícito"
exigir_igual "digest.state" "proven" "o DIGEST passa: pin imutável"
exigir_contem "digest.primeiro" "runner-labels:check" "e o aviso diz quem julga a versão no ar"
exigir_igual "interpolado.state" "violated" "o valor interpolado é violação (o pin sairia do repo)"
exigir_suite_verde "CONTROLE"

# ── M1: a RÉGUA DO PIN ────────────────────────────────────────────────────
header "M1 — o PIN: a tag deixa de ser julgada (o 'latest' volta a passar)"
mutar '  if (!isVersionTag(tag))' \
  '  if (false /* MUTACAO M1: a tag deixa de ser julgada */)'
rodar_driver_e_checar "M1"
exigir_igual "latest.state" "proven" "M1: o 'latest' PASSA como versão — o defeito entra em silêncio"
exigir_igual "latest.veredito" "proven" "M1: e o veredito publicado diz 'proven'"
exigir_igual "latest.exit" "0" "M1: o CI ficaria VERDE com o compose flutuante (é a classe)"
exigir_igual "semTag.state" "violated" "M1: o sem-tag segue violação (a mutação é cirúrgica: ela desliga a FORMA, não a ausência)"
exigir_igual "digest.state" "proven" "M1: o digest segue passando (nada mudou nele)"
exigir_igual "interpolado.state" "violated" "M1: e o interpolado segue violação"
exigir_suite_vermelha "M1" "$ANCORA_M1"
restaurar_original

# ── FECHO ─────────────────────────────────────────────────────────────────
header "FECHO"
rodar_driver_e_checar "FECHO"
exigir_igual "latest.state" "violated" "na árvore restaurada, o 'latest' volta a ser violação"
exigir_igual "versao.state" "proven" "e a tag de versão segue aceita"
exigir_suite_verde "FECHO"
pass "a metade M1 (a régua do pin) foi detectada; o guard está restaurado e medindo"
echo ""
