#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-remedy-tty.sh — Mutation test da FONTE DA RESPOSTA do
# remédio do pre-commit (o TERMINAL DE CONTROLE)
#
# Usage:
#   ./scripts/test-mutation-remedy-tty.sh
#
# Exit codes:
#   0 — as DUAS mutações foram DETECTADAS pela suíte do pty (e os controles
#       passaram) ✅ — ou a testemunha se declarou NÃO JULGÁVEL (sem `pty`),
#       dito em voz alta
#   1 — suíte CEGA (verde com a mutação) / vermelha pelo motivo errado / controle
#       falso / a mutação não aplicou / infra ❌
#
# O QUE ISTO PROVA (e por que a suíte não basta)
#
# O remédio do pre-commit PERGUNTA antes de gravar. A pergunta só faz sentido se
# houver a quem perguntar: o stdin do hook NÃO é um terminal — o git o entrega
# em `/dev/null`, com 1 e 2 no terminal do operador —, então quem responde é o
# TERMINAL DE CONTROLE (`/dev/tty`), aberto por `openTerminal` e chamado por
# `remedy` (`confirm-prompt.mjs` e `pre-commit-remedy.mjs`).
#
# Essa travessia tem DUAS metades, e uma suíte verde não distingue "mediu" de
# "não havia o que medir":
#
#   M1 — A FONTE (`openTerminal`). Se ela deixar de abrir o terminal de controle
#        (a mutação: abrir SEMPRE falha ⇒ `null`), o remédio passa a cair no
#        caminho SEM TERMINAL — que BLOQUEIA o commit e devolve o caminho à mão.
#        O gate continua verde (fail-closed é o comportamento CERTO quando não
#        há a quem perguntar) e a direção INTERATIVA morre em silêncio: quem
#        commita deixaria de receber a oferta, e nada no CI acusaria.
#   M2 — O CALL SITE (`const tty = … ? openTty() : null`). Mutar a função e mutar
#        quem a chama são regressões DIFERENTES (uma quebra o mecanismo, a outra
#        o uso dele) e as duas têm de ser pegas: o remédio que nunca chama o
#        `openTty()` está tão morto quanto o que não consegue abri-lo.
#
# A TESTEMUNHA é a suíte do pty (`pre-commit-remedy-pty.test.ts`), que aloca um
# TERMINAL de verdade (nada de `isTTY` injetado) e roda o hook REAL dentro de um
# `git commit` e de um `git push` de fixture. A mutação é aplicada NO LUGAR, no
# arquivo do repositório, porque é dele que o fixture copia o fecho do hook: a
# cópia é feita na hora da suíte, então a mutação chega ao processo que pergunta.
#
# AS ÂNCORAS (o vermelho tem de ser O vermelho certo)
#
# "Suíte vermelha" sozinho não prova nada: um erro de sintaxe no arquivo mutado,
# um `node_modules` quebrado ou um host sem recursos deixam a suíte vermelha pelo
# motivo errado — e o script aprovaria uma medição que não aconteceu. Por isso o
# vermelho é julgado por FATO:
#   - os testes do FLUXO DO OPERADOR (o 'sim' no terminal faz o commit ENTRAR; o
#     'não' bloqueia; a FASE B reexecutada) TÊM de estar entre os que falharam;
#   - e o teste FAIL-CLOSED (sem terminal de controle a sessão NÃO pergunta e
#     BLOQUEIA) TÊM de continuar PASSOANDO — é ele que separa "o remédio ficou
#     sem a quem perguntar" de "a suíte explodiu inteira".
#
# AMBIENTE DECLARADO, NUNCA UM VERDE POR OMISSÃO
#
# O ensaio exige um interpretador com o módulo `pty` (POSIX) e o `vitest`
# instalado. Sem qualquer um dos dois a testemunha NÃO JULGA — e isso é DITO com
# o motivo nomeado (`ptyAvailability().reason`), em vez de virar um verde que
# ninguém mediu.
#
# Pipeline:
#   1. CONTROLE (a testemunha existe e mede): `pty` disponível + suíte do pty
#      VERDE sem mutação — o mesmo arquivo, com a mesma fixture
#   2. M1 (A FONTE): `openTerminal` deixa de abrir o `/dev/tty` ⇒ suíte VERMELHA
#      pelas âncoras do FLUXO DO OPERADOR, com o FAIL-CLOSED verde
#   3. M2 (O CALL SITE): o remédio deixa de chamar o `openTty()` ⇒ suíte
#      VERMELHA pelas mesmas âncoras
#   4. CONTROLE FINAL: restauradas as duas fontes (checksum conferido), a suíte
#      volta a ser VERDE — a árvore ficou como estava
#   5. Cleanup (trap EXIT — restaura as fontes e remove o temp, mesmo com falha)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

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
  'M1|A FONTE (openTerminal)'
  'M2|O CALL SITE (const tty = … ? openTty() : null)'
)
# A FONTE da resposta: quem abre o terminal de controle.
PROMPT="$SCRIPT_DIR/scripts/confirm-prompt.mjs"
# Quem a CHAMA: o remédio do pre-commit.
REMEDY="$SCRIPT_DIR/scripts/pre-commit-remedy.mjs"
# A testemunha: o ensaio sob um TERMINAL de verdade.
SUITE_ARQUIVO="src/lib/__tests__/pre-commit-remedy-pty.test.ts"

# ── As âncoras (títulos dos testes, como o vitest os reporta) ─────────────
# O fluxo do operador: é AQUI que a resposta vem do `/dev/tty`.
ANCORA_SIM="por isso o 'sim' no TERMINAL faz o commit ENTRAR"
ANCORA_NAO="o 'não' no terminal BLOQUEIA o commit e não remenda nada"
ANCORA_FASE_B="a fase que passa na SEGUNDA medição deixa o commit ENTRAR"
# A âncora que tem de continuar VERDE: o fail-closed (sem terminal, bloqueia).
ANCORA_FAIL_CLOSED="SEM terminal de controle (sessão própria)"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"

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

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (a RESPOSTA do remédio vem do TTY)"
echo "  ═════════════════════════════════════════════════════════════════"
echo "  suíte (a testemunha): $SUITE_ARQUIVO"

# ── Backup das FONTES + restauração VERIFICADA (trap EXIT) ────────────────
# As mutações são aplicadas NO LUGAR, nos arquivos do repositório (é deles que
# o fixture do hook copia o fecho, na hora da suíte). O backup e a restauração
# entram no MESMO trap: um `exit` no meio do caminho não pode deixar a árvore
# mutada — e o checksum é quem prova que ela voltou.
prompt_backup="$TMP_DIR/confirm-prompt.original.mjs"
remedy_backup="$TMP_DIR/pre-commit-remedy.original.mjs"
cp "$PROMPT" "$prompt_backup"
cp "$REMEDY" "$remedy_backup"
prompt_sum="$(cksum "$PROMPT" | cut -d' ' -f1)"
remedy_sum="$(cksum "$REMEDY" | cut -d' ' -f1)"

cleanup() {
  cp -f "$prompt_backup" "$PROMPT" 2>/dev/null || true
  cp -f "$remedy_backup" "$REMEDY" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

restaurar_originais() {
  cp -f "$prompt_backup" "$PROMPT"
  cp -f "$remedy_backup" "$REMEDY"
  if [ "$(cksum "$PROMPT" | cut -d' ' -f1)" != "$prompt_sum" ] ||
    [ "$(cksum "$REMEDY" | cut -d' ' -f1)" != "$remedy_sum" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum diverge) — restaure a partir de $TMP_DIR"
    exit 1
  fi
}

# ── mutar_arquivo: a CIRURGIA, o MARCADOR e o CONTEÚDO são da régua ÚNICA ───
# (`mutacao_aplicar`): o alvo casa UM lugar (0 ou 2+ não é cirúrgico — a suíte
# PARA em vez de medir outra coisa), o payload carrega o marcador `MUTACAO` e o
# checksum confere que a escrita MUDOU o arquivo. O `<checksum>` é o do estado
# ANTERIOR, que o chamador já mede.
mutar_arquivo() { # <arquivo> <alvo> <novo> <checksum-antes>
  mutacao_aplicar "$1" "$2" "$3" "$4"
}

# ── A testemunha: o pty e a suíte ─────────────────────────────────────────
# O pty é FATO DECLARADO, não um verde por omissão: sem um interpretador com o
# módulo `pty` o ensaio não aloca terminal nenhum e os testes que interessam são
# PULADOS (a suíte sai verde sem ter perguntado nada). Julgar a mutação ali seria
# ler "não rodei" como "medi".
PTY_INFO="$(node --input-type=module -e "
import { ptyAvailability } from '$SCRIPT_DIR/scripts/pty-harness.mjs'
const p = ptyAvailability()
process.stdout.write((p.available ? 'SIM|' + p.command : 'NAO|' + p.reason))
" 2>/dev/null || echo "NAO|não consegui consultar o pty-harness")"
PTY_DISPONIVEL="${PTY_INFO%%|*}"
PTY_MOTIVO="${PTY_INFO#*|}"

suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

# A suíte pode julgar? (vitest instalado E um terminal de verdade disponível)
testemunha_julga() { suite_disponivel && [ "$PTY_DISPONIVEL" = "SIM" ]; }

mostrar_suite() { sed 's/^/      /' "$SUITE_SAIDA" | tail -12; }

rodar_suite() {
  SUITE_SAIDA="$TMP_DIR/suite.txt"
  set +e
  (cd "$SCRIPT_DIR" && bun x vitest run --config vitest.config.unit.ts "$SUITE_ARQUIVO") \
    > "$SUITE_SAIDA" 2>&1
  SUITE_EXIT=$?
  set -e
}

# ── exigir_suite_verde: o controle (a testemunha mede e não acusa) ────────
exigir_suite_verde() {
  local cenario="$1"
  rodar_suite
  if [ "$SUITE_EXIT" -ne 0 ]; then
    fail "$cenario: a suíte do pty ficou VERMELHA sem mutação — o vermelho seguinte não provaria nada (ambiente)"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte do pty VERDE (exit 0) — a testemunha mede, e o vermelho da mutação é dela"
}

# ── exigir_suite_vermelha: a mutação TEM de ser notada, PELO MOTIVO certo ──
exigir_suite_vermelha() {
  local cenario="$1"
  rodar_suite
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte do pty ficou VERDE com a fonte da resposta mutada — a leitura do terminal de controle não é load-bearing (regressão silenciosa)"
    mostrar_suite
    exit 1
  fi
  # As âncoras do FLUXO DO OPERADOR: o vermelho tem de ser ESTE vermelho.
  local faltando=""
  for a in "$ANCORA_SIM" "$ANCORA_NAO" "$ANCORA_FASE_B"; do
    if ! grep -qF "$a" "$SUITE_SAIDA"; then faltando="$faltando
      · $a"; fi
  done
  if [ -n "$faltando" ]; then
    fail "$cenario: a suíte ficou vermelha, mas NÃO pelas âncoras do fluxo do operador — o vermelho não é o desta regressão (mutação aplicada no lugar errado? suíte quebrada?):
$faltando"
    mostrar_suite
    exit 1
  fi
  # E a metade que tem de continuar verde: sem terminal de controle, o remédio
  # NÃO pergunta e BLOQUEIA. Se ela também caiu, o que se mediu foi a suíte
  # inteira quebrando — não a pergunta ficando sem a quem perguntar.
  # (A captura antes do `grep` NÃO é estilo: `grep … | grep -q` sob `pipefail` é a
  # própria classe que este repositório gateia — o `check-pipefail-sigpipe` pegou
  # esta linha na primeira rodada.
  local linhas_fail
  linhas_fail="$(grep -E "^ FAIL " "$SUITE_SAIDA" || true)"
  if grep -qF "$ANCORA_FAIL_CLOSED" <<< "$linhas_fail"; then
    fail "$cenario: o teste FAIL-CLOSED também caiu — o vermelho é da suíte inteira, não da fonte da resposta"
    mostrar_suite
    exit 1
  fi
  if ! grep -qF "$ANCORA_FAIL_CLOSED" "$SUITE_SAIDA"; then
    fail "$cenario: a âncora do FAIL-CLOSED não aparece no relatório — a suíte não rodou o caso que separa 'sem terminal' de 'suíte quebrada'"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte do pty VERMELHA pelo fluxo do operador (o 'sim' que não entra, o 'não' que não bloqueia, a FASE B que não reexecuta) — e o fail-closed segue verde"
}

# ── A testemunha pode julgar? Então o CONTROLE roda primeiro ──────────────
header "CONTROLE: a testemunha existe e MEDE (pty de verdade + vitest instalado)"
if ! suite_disponivel; then
  info "NÃO JULGÁVEL — node_modules/vitest ausente neste host (o motivo é este, declarado, nunca um verde por omissão)"
  exit 0
fi
if [ "$PTY_DISPONIVEL" != "SIM" ]; then
  info "NÃO JULGÁVEL — $PTY_MOTIVO"
  info "a suíte do pty pularia os testes do fluxo do operador e sairia verde SEM ter perguntado a terminal nenhum"
  exit 0
fi
pass "pty disponível ($PTY_MOTIVO) e vitest instalado: a testemunha pode julgar"
exigir_suite_verde "CONTROLE"

# ── M1: A FONTE — `openTerminal` deixa de abrir o terminal de controle ────
# A mutação: a abertura do `/dev/tty` para LEITURA passa a falhar sempre — o
# `catch` da própria função devolve `null`, que é a resposta honesta de quem não
# pôde abrir. O remédio cai no caminho SEM TERMINAL.
header 'M1 (A FONTE): `openTerminal` devolve null ⇒ a resposta não tem de onde vir'
mutar_arquivo "$PROMPT" '    fdIn = openSync(TTY_DEVICE, "r")' \
  '    throw new Error("MUTACAO M1: sem terminal de controle")' "$prompt_sum"
exigir_suite_vermelha "M1"
restaurar_originais

# ── M2: O CALL SITE — o remédio deixa de CHAMAR o `openTty()` ─────────────
# Mutar a função e mutar quem a chama são regressões diferentes: aqui a função
# está intacta e o remédio simplesmente nunca a usa. O veredito é o MESMO
# caminho (sem terminal ⇒ bloqueia), e é por isso que o call site também tem de
# ser provado — um remédio que abre o terminal e o descarta continuaria "certo"
# pelo comportamento, e morto pelo uso.
header 'M2 (O CALL SITE): o remédio deixa de CHAMAR o `openTty()` ⇒ mesma morte, outro mecanismo'
mutar_arquivo "$REMEDY" '  const tty = !isTTY && askFn === null && !noPrompt ? openTty() : null' \
  '  const tty = null // MUTACAO M2: o terminal existe e ninguém o abre' "$remedy_sum"
exigir_suite_vermelha "M2"
restaurar_originais

# ── CONTROLE FINAL: a árvore ficou como estava ────────────────────────────
header "CONTROLE FINAL: restauradas as fontes, a suíte volta a ser VERDE"
exigir_suite_verde "CONTROLE FINAL"

header "VEREDITO"
pass "MUTATION TEST PASSED — a resposta do remédio VEM do terminal de controle, e"
pass "as duas metades que a trazem (a função que abre e o ponto que a chama) são"
pass "load-bearing: forçar qualquer uma delas a null deixa a suíte do pty"
pass "VERMELHA nas âncoras do fluxo do operador — o 'sim' no terminal faz o"
pass "commit entrar, o 'não' bloqueia e a FASE B reexecuta —, com o fail-closed"
pass "(sem terminal, sem pergunta) seguindo VERDE, que é o que separa esta"
pass "regressão de uma suíte quebrada."
exit 0
