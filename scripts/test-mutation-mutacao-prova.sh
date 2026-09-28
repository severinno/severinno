#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-mutacao-prova.sh — Mutation test da PROVA-DE-APLICAÇÃO
# (`scripts/mutacao-prova.sh`)
#
# Usage:
#   bash scripts/test-mutation-mutacao-prova.sh
#
# Exit codes:
#   0 — as TRÊS metades foram DETECTADAS (a prova do MARCADOR, a prova do
#       CONTEÚDO e a CIRURGIA saem do lugar, uma por vez, e o veredito vira
#       ACEITO onde ele recusava) e os controles passaram ✅
#   1 — uma metade NÃO sustentou o veredito (desligar a prova não mudou a
#       recusa), mutação não-cirúrgica, ou a restauração falhou ❌
#   2 — infra: a biblioteca não está na árvore / não é bash válido
#
# O QUE ISTO PROVA (e por que uma suíte POR BIBLIOTECA, e não por suíte)
#
# A `mutacao-prova.sh` é a régua ÚNICA de "a mutação APLICOU": cirurgia (o alvo
# casa UM lugar), MARCADOR (o texto novo carrega `MUTACAO` — a prova de que a
# escrita entrou) e CONTEÚDO (o checksum mudou). Uma suíte de mutação que medisse
# sobre um alvo ÍNTEGRO passaria em VÁCUO: o verde seria sobre uma árvore que
# ninguém mutou. Até 27/09/2026 essa checagem vivia COPIADA em cada suíte, e uma
# cópia que sumisse não deixava rastro — a suíte continuava verde.
#
# Aqui ela é UMA, e é ela que esta suíte mede: cada PROVA é desligada no sítio
# dela, e o que se exige é que a recusa VIRE ACEITE — o único veredito que prova
# que a prova é load-bearing. Desligar a prova e a recusa continuar é a metade
# NÃO detectada (o vermelho viria de outro lugar).
#
# AS METADES (o que cada uma tira do lugar):
#
#   · M1 — a prova do MARCADOR (`mutacao_carregou_marcador`): desligada, uma
#     troca que NÃO carrega o marcador deixa de ser recusada — é o vácuo exato
#     que a prova existe para fechar.
#   · M2 — a prova do CONTEÚDO (`mutacao_mudou_conteudo`): desligada, a troca que
#     NÃO muda byte nenhum (o `depois` é igual ao `antes`, e o alvo já carrega o
#     marcador) passa a ser aceita.
#   · M3 — a CIRURGIA (`conta`, o sítio do python): desligada, um alvo AMBÍGUO
#     (duas ocorrências com `esperado = 1`) passa a ser aceito — a suíte mediria
#     os dois lugares sem dizer que o alvo deixou de ser cirúrgico.
#
# O QUE NÃO ESTÁ AQUI: a checagem de sintaxe (`mutacao_sintaxe_node`) é um
# wrapper de uma linha sobre o `node --check`; quem a mede são as metades das
# suítes que a chamam (um alvo mutado que não parseia derruba a medição delas).
#
# A CIRURGIA DESTA SUÍTE: as mutações da biblioteca são aplicadas pela PRÓPRIA
# biblioteca (`mutacao_aplicar` sobre o arquivo dela), com a prova de que a
# escrita entrou — o instrumento que mede é o mesmo que se mede, e a suíte não
# reimplementa o replace. A biblioteca é restaurada por CHECKSUM entre as
# metades (trap EXIT), então um `exit` no meio não deixa o instrumento mutado na
# árvore.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
METADES=(
  'M1|a prova do MARCADOR: desligada, a troca que NÃO carrega MUTACAO deixa de ser recusada (o vácuo que ela fecha)'
  'M2|a prova do CONTEÚDO: desligada, a troca que não muda byte nenhum (o depois é igual ao antes) passa a ser aceita'
  'M3|a CIRURGIA (a contagem do alvo): desligada, um alvo AMBÍGUO com duas ocorrências passa a ser aceito'
)

BIB="$SCRIPT_DIR/scripts/mutacao-prova.sh"
if [ ! -f "$BIB" ]; then
  echo "test-mutation-mutacao-prova: ❌ $BIB não existe (infra)" >&2
  exit 2
fi
if ! bash -n "$BIB" >/dev/null 2>&1; then
  echo "test-mutation-mutacao-prova: ❌ $BIB não é bash válido (infra)" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
BIB_BACKUP="$TMP_DIR/mutacao-prova.original.sh"
cp "$BIB" "$BIB_BACKUP"
BIB_SUM="$(cksum "$BIB" | cut -d' ' -f1)"

ALVO_A="$TMP_DIR/alvo-a.txt"
ALVO_B="$TMP_DIR/alvo-b.txt"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

restore_bib() {
  cp -f "$BIB_BACKUP" "$BIB" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap restore_bib EXIT

restaurar_biblioteca() {
  cp -f "$BIB_BACKUP" "$BIB"
  if [ "$(cksum "$BIB" | cut -d' ' -f1)" != "$BIB_SUM" ]; then
    fail "RESTAURAÇÃO FALHOU (o checksum da biblioteca diverge) — restaure a partir de $BIB_BACKUP"
    exit 1
  fi
  pass "biblioteca restaurada (checksum confere)"
}

# ── OS ALVOS de mentira ───────────────────────────────────────────────────
# O A NÃO carrega marcador nenhum (é ele que mede a prova do MARCADOR) e tem a
# linha REPETIDA que mede a CIRURGIA. O B carrega o marcador na linha que a
# troca vai reescrever com ela mesma (é ele que mede a prova do CONTEÚDO: o
# marcador está lá, e o conteúdo não muda).
cria_alvo_a() {
  cat >"$ALVO_A" <<'EOF'
// o alvo de mentira da prova-de-aplicação (SEM marcador)
const artefatos = ["alfa", "beta"]
const repetida = 1
const repetida = 1
EOF
}

cria_alvo_b() {
  cat >"$ALVO_B" <<'EOF'
// o alvo de mentira da prova do conteúdo (a linha JÁ carrega o marcador)
const artefatos = ["alfa", "beta"] // MUTACAO M0: alvo que já carrega o marcador
EOF
}

ALVO_UNICO='const artefatos = ["alfa", "beta"]'
TROCA_MARCADA='const artefatos = [] // MUTACAO M1: a lista derivada esvaziada'
TROCA_SEM_MARCADOR='const artefatos = []'
ALVO_REPETIDO='const repetida = 1'
TROCA_REPETIDA='const repetida = 2 // MUTACAO M3: o alvo ambíguo mutado'
ALVO_AUSENTE='const naoExiste = 1'
LINHA_JA_MARCADA='const artefatos = ["alfa", "beta"] // MUTACAO M0: alvo que já carrega o marcador'

# ── roda_aplicar: a biblioteca do ARQUIVO (não a carregada) julga a chamada ─
# O subshell RE-SOURCEIA a biblioteca: é isso que faz a suíte medir o ARQUIVO —
# mutado ou não —, e não a cópia que este shell carregou no topo.
roda_aplicar() { # <arquivo> <antes> <depois> [<contagem>]
  local arquivo="$1" antes="$2" depois="$3" contagem="${4:-1}" sum
  sum="$(cksum "$arquivo" | cut -d' ' -f1)"
  set +e
  (
    # shellcheck disable=SC1090
    . "$BIB"
    fail() { :; }
    mutacao_aplicar "$arquivo" "$antes" "$depois" "$sum" "$contagem"
  ) >/dev/null 2>&1
  APLICAR_EXIT=$?
  set -e
}

# exige <exit esperado> <cenário> <arquivo> <antes> <depois> [<contagem>]
exige() {
  local esperado="$1" cenario="$2" arquivo="$3" antes="$4" depois="$5" contagem="${6:-1}"
  roda_aplicar "$arquivo" "$antes" "$depois" "$contagem"
  if [ "$APLICAR_EXIT" -ne "$esperado" ]; then
    fail "$cenario: exit $APLICAR_EXIT (esperado $esperado)"
    exit 1
  fi
  pass "$cenario (exit $APLICAR_EXIT)"
}

# mutar_biblioteca <alvo> <troca>: a mutação da PRÓPRIA biblioteca, aplicada por
# ela (a prova de que a escrita entrou é a mesma das suítes), com o `bash -n` do
# instrumento mutado.
mutar_biblioteca() {
  mutacao_aplicar "$BIB" "$1" "$2" "$BIB_SUM"
  if ! bash -n "$BIB" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: a biblioteca mutada não é bash válido."
    exit 1
  fi
  pass "biblioteca mutada (a escrita entrou e o bash segue válido)"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — a PROVA-DE-APLICAÇÃO das suítes de mutação ($BIB)"
echo "  ═════════════════════════════════════════════════════════════════"

# A biblioteca ÍNTEGRA, carregada UMA vez: é esta cópia (não a do arquivo) que
# aplica as mutações abaixo. O subshell do `roda_aplicar` é quem lê o ARQUIVO.
# shellcheck disable=SC1090
. "$BIB"

pass "biblioteca sob medição; checksum inicial $BIB_SUM"

# ── CONTROLE — a biblioteca ÍNTEGRA recusa as três classes e aceita a troca boa ─
header "CONTROLE — a biblioteca íntegra: a troca boa entra e as três classes saem recusadas"
cria_alvo_a
exige 0 "CONTROLE: a troca COM o marcador sobre um alvo único é ACEITA" \
  "$ALVO_A" "$ALVO_UNICO" "$TROCA_MARCADA"
if ! grep -qF 'const artefatos = []' "$ALVO_A"; then
  fail "CONTROLE: a troca foi aceita mas o alvo NÃO mudou — a escrita não entrou"
  exit 1
fi
pass "CONTROLE: e o alvo mudou de verdade (a troca está no arquivo)"

cria_alvo_a
exige 1 "CONTROLE: a troca SEM o marcador é RECUSADA (a prova do MARCADOR)" \
  "$ALVO_A" "$ALVO_UNICO" "$TROCA_SEM_MARCADOR"

cria_alvo_b
exige 1 "CONTROLE: a troca que NÃO muda o conteúdo é RECUSADA (a prova do CONTEÚDO)" \
  "$ALVO_B" "$LINHA_JA_MARCADA" "$LINHA_JA_MARCADA"

cria_alvo_a
exige 1 "CONTROLE: o alvo AMBÍGUO (duas ocorrências) é RECUSADO (a CIRURGIA)" \
  "$ALVO_A" "$ALVO_REPETIDO" "$TROCA_REPETIDA"

cria_alvo_a
exige 1 "CONTROLE: o alvo que NÃO casa (zero ocorrências) é RECUSADO" \
  "$ALVO_A" "$ALVO_AUSENTE" "$TROCA_SEM_MARCADOR"

# ── M1 — a prova do MARCADOR ──────────────────────────────────────────────
header "M1 — a prova do MARCADOR: desligada, a troca sem MUTACAO passa a ser ACEITA"
mutar_biblioteca '  if ! mutacao_carregou_marcador "$arquivo"; then' \
  '  if false; then # MUTACAO M1: a prova de aplicação desligada'
cria_alvo_a
roda_aplicar "$ALVO_A" "$ALVO_UNICO" "$TROCA_SEM_MARCADOR"
if [ "$APLICAR_EXIT" -ne 0 ]; then
  fail "M1 NÃO DETECTADA: com a prova do marcador desligada, a troca SEM marcador continuou RECUSADA (exit $APLICAR_EXIT) — a metade não moveu o veredito"
  exit 1
fi
pass "M1 DETECTADA: sem a prova do marcador, a troca SEM marcador passa a ser ACEITA (a detecção seria VÁCUA)"
restaurar_biblioteca

# ── M2 — a prova do CONTEÚDO ──────────────────────────────────────────────
header "M2 — a prova do CONTEÚDO: desligada, a troca que não muda nada passa a ser ACEITA"
mutar_biblioteca '  if ! mutacao_mudou_conteudo "$arquivo" "$checksum"; then' \
  '  if false; then # MUTACAO M2: a prova do conteúdo desligada'
cria_alvo_b
roda_aplicar "$ALVO_B" "$LINHA_JA_MARCADA" "$LINHA_JA_MARCADA"
if [ "$APLICAR_EXIT" -ne 0 ]; then
  fail "M2 NÃO DETECTADA: com a prova do conteúdo desligada, a troca que não muda byte nenhum continuou RECUSADA (exit $APLICAR_EXIT)"
  exit 1
fi
pass "M2 DETECTADA: sem a prova do conteúdo, a troca que não muda nada passa a ser ACEITA"
restaurar_biblioteca

# ── M3 — a CIRURGIA (a contagem do alvo) ──────────────────────────────────
header "M3 — a CIRURGIA: desligada, o alvo AMBÍGUO (duas ocorrências) passa a ser ACEITO"
mutar_biblioteca '    if n != esperado:' \
  '    if False:  # MUTACAO M3: a cirurgia (a contagem do alvo) desligada'
cria_alvo_a
roda_aplicar "$ALVO_A" "$ALVO_REPETIDO" "$TROCA_REPETIDA"
if [ "$APLICAR_EXIT" -ne 0 ]; then
  fail "M3 NÃO DETECTADA: com a cirurgia desligada, o alvo ambíguo continuou RECUSADO (exit $APLICAR_EXIT)"
  exit 1
fi
pass "M3 DETECTADA: sem a cirurgia, o alvo AMBÍGUO passa a ser ACEITO"
restaurar_biblioteca

# ── FECHO ─────────────────────────────────────────────────────────────────
header "FECHO"
if [ "$(cksum "$BIB" | cut -d' ' -f1)" != "$BIB_SUM" ]; then
  fail "FECHO: a biblioteca não voltou ao conteúdo original"
  exit 1
fi
cria_alvo_a
exige 0 "FECHO: a troca COM o marcador volta a ser ACEITA na biblioteca restaurada" \
  "$ALVO_A" "$ALVO_UNICO" "$TROCA_MARCADA"
cria_alvo_a
exige 1 "FECHO: e a troca SEM o marcador volta a ser RECUSADA" \
  "$ALVO_A" "$ALVO_UNICO" "$TROCA_SEM_MARCADOR"
pass "as metades M1 (a prova do MARCADOR), M2 (a do CONTEÚDO) e M3 (a CIRURGIA) foram detectadas — desligar cada uma faz a recusa virar ACEITE; a biblioteca está restaurada e medindo"
echo ""
