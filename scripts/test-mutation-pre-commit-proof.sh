#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-pre-commit-proof.sh — Mutation test da prova SEM DUBLÊ
# (`proveRealHookBlocks`, em `scripts/pre-commit-proof.mjs`)
#
# Usage:
#   ./scripts/test-mutation-pre-commit-proof.sh
#
# Exit codes:
#   0 — as TRÊS metades foram DETECTADAS (a leitura por execução muda E/OU a
#       suíte unitária fica vermelha pelas âncoras da metade) e os controles
#       passaram ✅
#   1 — uma metade NÃO sustentou o veredito (o guard seguiu verde com o
#       mecanismo desligado), mutação não-cirúrgica, âncora errada ou
#       restauração falhou ❌
#   2 — infra: driver não rodou / guard ausente — nunca um verde por omissão
#
# O QUE ISTO PROVA
#
# A prova SEM DUBLÊ é a que roda o hook REAL sobre uma CÓPIA do checkout, pelo
# `core.hooksPath`, e atribui a recusa do commit por EXIT CODE: o corpo `run:`
# quebrado no índice tem de ser recusado, os cinco guards de fase A e o gate têm
# de ser medidos direto sobre o MESMO índice, a fase B tem de recusar os defeitos
# de encoding/link com a DESCIDA do runner NOMEANDO o guard da classe, e cada
# CONTROLE (o mesmo arquivo fechado/remendado) tem de ENTRAR.
#
# O que a suíte dela NÃO diz é se as três réguas que sustentam esse veredito são
# load-bearing: hoje isso está medido por três casos que MUTAM A ENTRADA do
# fixture (o hook sem a fase B, o guard do encoding cego, o gate cego) e por
# nenhum que mute a RÉGUA. Aqui cada régua é desligada NO LUGAR e o que se exige
# é o vermelho:
#
#   M1 — a DECLARAÇÃO dos recusadores (`recusadoresEsperados.membros`): o
#        conjunto medido tem de ser igual ao declarado, nos dois sentidos. Sem a
#        comparação, a atribuição deixa de decidir qualquer coisa — um refutador
#        declarado que ficou verde, ou um vermelho que ninguém declarou, passam —
#        e a medição vira um RELATÓRIO (a razão de a declaração existir).
#   M2 — a DESCIDA do runner (`descidaDoEncodingRunner`): o runner do encoding
#        para no primeiro guard (`set -e`) e devolve UM exit code; quem diz QUAL
#        guard recusou é a descida, que lê os comandos declarados no próprio
#        runner e os roda um a um. Mutação: a descida para de NOMEAR o
#        recusador — o veredito do runner sozinho não diz de quem é a recusa.
#   M3 — o PREDICADO do CONTROLE (as duas cópias: fase A e fase B — status/HEAD
#        e conteúdo em HEAD): é a metade que separa "o hook recusou o defeito" de
#        "o ambiente não sabe commitar". Mutação: as quatro cláusulas do mesmo
#        predicado caem, e a prova passa a sair VERDE sobre um hook que recusa
#        até o commit correto (o falso verde que ela existe para não produzir).
#
# DUAS TESTEMUNHAS
#
#   (1) A LEITURA POR EXECUÇÃO — um driver node importa o módulo (mutado, quando
#       há mutação) e mede o que ele DEVOLVE. É node-puro e não depende de
#       `node_modules`: mede a M2 (a descida é uma função exportada) nos dois
#       jobs, inclusive no do espelho, que não instala dependências.
#   (2) A SUÍTE UNITÁRIA (`pre-commit-real-proof.test.ts`), com âncoras: o
#       vermelho tem de ser O caso da metade mutada, e as outras metades seguem
#       verdes. A testemunha da M3 é o caso novo — `um hook que recusa TAMBÉM o
#       commit do CONTROLE` —, que nasceu com esta suíte: sem ele o predicado do
#       controle não tinha fixture capaz de derrubá-lo (nenhum caso do fixture
#       fazia o commit do controle FALHAR), e a metade não teria como ficar
#       vermelha. Sem `vitest` instalado a testemunha (2) se declara NÃO JULGADA
#       em voz alta — nunca silenciosa.
#
# POR QUE A SUÍTE É UMA TESTEMUNHA FORTE (e não um teste de papel): ela COPIA um
# checkout, roda `git init`/`git commit` DE VERDADE com o hook REAL pelo
# `core.hooksPath` e mede o HEAD — os stubs substituem os guards, não a máquina
# sob teste. É o fixture que dá ao `proveRealHookBlocks` o que ele mede; por isso
# o driver daqui não o reimplementa (duas fixtures divergiriam no primeiro dia) e
# a M1/M3 são medidas pela suíte, com âncoras, e não por um segundo harness.
#
# A CIRURGIA: cada injeção casa exatamente 1 ocorrência (0 ou 2+ = a suíte PARA em
# vez de medir outra coisa), o arquivo mutado tem de continuar válido (`node
# --check`) e a restauração é conferida por CHECKSUM no trap EXIT (um `exit` no
# meio não deixa o guard mutado na árvore).
#
# LIMITES DECLARADOS (o que esta prova NÃO cobre):
#   · a M1 e a M3 não têm driver próprio: as duas vivem DENTRO de
#     `proveRealHookBlocks`, cujo único harness é o fixture da suíte. Montar um
#     segundo checkout sintético aqui seria a mesma fixture em dois lugares (a
#     classe de defeito que o `check-hook-ci-parity` existe para não deixar
#     voltar) — o que se declara é que a M1/M3 medem onde o vitest existe;
#   · no job do ESPELHO (`mutation-guards`, que não instala dependências) a
#     testemunha (2) se declara não julgada e só a M2 é medida por execução; na
#     forja dona do merge (job `guards`, que instala) as três medem;
#   · a mutação roda NO LUGAR no repositório: por isso ela vive no master (matriz
#     serial dentro de um job) e não num job ao lado de outra prova de mutação.
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
  'M1|a DECLARAÇÃO dos recusadores: o conjunto medido deixa de ser comparado com o declarado (a atribuição vira relatório)'
  'M2|a DESCIDA do runner: o recusador deixa de ser NOMEADO (o exit code do runner não diz qual guard recusou)'
  'M3|o PREDICADO do CONTROLE: as duas cópias (fase A e fase B, status/HEAD e conteúdo) deixam de separar "recusou" de "não sabe commitar"'
)

cd "$SCRIPT_DIR"

GUARD="scripts/pre-commit-proof.mjs"
SUITE="src/lib/__tests__/pre-commit-real-proof.test.ts"

TMP_DIR="$(mktemp -d)"
BANCADA="$TMP_DIR/bancada"
F_DRIVER="$TMP_DIR/driver.json"
F_SUITE="$TMP_DIR/suite.txt"

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

# ── A BANCADA da descida (M2): um runner que declara dois comandos ────────
# A descida lê os comandos declarados no PRÓPRIO runner (`bash …`/`node …`) e os
# roda um a um: um que passa e um que falha — é o par que diz se a descida
# NOMEIA o recusador ou só devolve um código.
montar_bancada() {
  rm -rf "$BANCADA"
  mkdir -p "$BANCADA/scripts"
  cat >"$BANCADA/scripts/run-encoding-guards.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
bash scripts/ok.sh
bash scripts/falha.sh
SH
  printf '#!/usr/bin/env bash\nexit 0\n' >"$BANCADA/scripts/ok.sh"
  printf '#!/usr/bin/env bash\necho "❌ byte inválido (bancada)"\nexit 1\n' >"$BANCADA/scripts/falha.sh"
}

# ── O DRIVER: a descida medida por execução (node-puro) ───────────────────
rodar_driver() {
  set +e
  GUARD_URL="file://$SCRIPT_DIR/$GUARD" BANCADA="$BANCADA" \
    node --input-type=module -e '
const mod = await import(process.env.GUARD_URL)
const r = mod.descidaDoEncodingRunner(process.env.BANCADA)
process.stdout.write(
  JSON.stringify({
    comandos: r.comandos,
    recusadores: (r.recusadores ?? []).map((x) => ({ comando: x.comando, status: x.status })),
    indisponivel: r.indisponivel,
  }) + "\n",
)
' >"$F_DRIVER" 2>"$TMP_DIR/driver.err"
  DRIVER_EXIT=$?
  set -e
}

rodar_driver_e_checar() { # <cenário>
  local cenario="$1"
  rodar_driver
  if [ "$DRIVER_EXIT" -ne 0 ]; then
    fail "$cenario: a LEITURA QUEBROU (driver exit $DRIVER_EXIT) — a mutação derrubou o módulo em vez de medir a régua"
    sed 's/^/      /' "$TMP_DIR/driver.err" | tail -6
    exit 1
  fi
}

exigir_no_driver() { # <trecho> <cenário>
  local trecho="$1" cenario="$2"
  if ! grep -qF "$trecho" "$F_DRIVER"; then
    fail "$cenario: a leitura NÃO tem '$trecho'"
    echo "      leitura: $(cat "$F_DRIVER")"
    exit 1
  fi
  pass "$cenario"
}

# ── mutar <alvo> <troca>: substituição LITERAL, cirúrgica ─────────────────
# A metade M3 tem QUATRO alvos (o mesmo predicado em duas fases): a função é
# chamada uma vez por alvo, e cada chamada confere a cirurgia sozinha.
mutar() { # <alvo-texto> <troca-texto>: a cirurgia, o marcador e o checksum são da
  # régua COMPARTILHADA (`mutacao_aplicar`); aqui só o alvo e a sintaxe do guard.
  mutacao_aplicar "$GUARD" "$1" "$2" "$GUARD_SUM"
  mutacao_sintaxe_node "$GUARD"
}

exigir_mutado() { # <cenário> — a régua COMPARTILHADA já provou que a injeção
  # entrou (o marcador e o checksum, dentro de cada `mutar`): aqui só se publica
  # o fato. A cópia privada da conferência do marcador vive em `mutacao_aplicar`,
  # e é lá que o gabarito a mede.
  pass "$1: injeção aplicada (a régua conferiu o marcador e o conteúdo)"
}

# ── A testemunha unitária (âncoras) ───────────────────────────────────────
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

rodar_suite() {
  set +e
  (cd "$SCRIPT_DIR" && NO_COLOR=1 bun x vitest run --config vitest.config.unit.ts "$SUITE") \
    >"$TMP_DIR/suite.bruto" 2>&1
  SUITE_EXIT=$?
  set -e
  # ANSI FORA antes de julgar (o vitest colore mesmo com a saída redirecionada).
  sed -E $'s/\033\\[[0-9;]*[a-zA-Z]//g' "$TMP_DIR/suite.bruto" >"$F_SUITE"
  FAIL_LINES="$(grep -E "^[[:space:]]*(FAIL|×)" "$F_SUITE" || true)"
}

mostrar_suite() { grep -E "^[[:space:]]*(FAIL|×)|Tests " "$F_SUITE" | sed 's/^/      /' | head -12; }

exigir_suite_verde() {
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado; a M2 SEGUE medida por execução)"
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
    fail "$cenario: a suíte ficou VERDE com o mecanismo desligado — ele não é load-bearing"
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
  pass "$cenario: suíte VERMELHA pelas âncoras da metade mutada — e as outras seguem verdes"
}

# ── As âncoras (títulos como o vitest os reporta) ─────────────────────────
ANCORA_GATE_E_CONTROLE="o GATE recusa o corpo quebrado, os seis irmãos aprovam e o controle ENTRA"
ANCORA_CONTROLE_FASEAA="um hook que recusa TAMBÉM o commit do CONTROLE"
ANCORA_ENCODING="o defeito de ENCODING é recusado e a recusa é atribuída ao guard NOMEADO"
ANCORA_LINK="o defeito de LINK é recusado e a recusa é atribuída ao guard NOMEADO"
ANCORA_DECLARADO_VERDE="um refutador DECLARADO que fica verde (com o commit ainda recusado): INDETERMINADO nomeando o guard"
ANCORA_NAO_DECLARADO="um refutador NÃO declarado: INDETERMINADO nomeando o guard de mais"
ANCORA_CONTROLE_B="CONTROLE do fixture: sem defeito, a fase B inteira passa (o vermelho é do defeito)"
ANCORA_IRMAO_VERMELHO="um IRMÃO vermelho NÃO deixa a prova verde"
ANCORA_GATE_CEGO="com um GATE CEGO o defeito ENTRA"
# As réguas que nenhuma das três metades pode derrubar (senão mediu-se a suíte
# quebrando, não a régua da vez): a medida do HEAD, o argv do recorte, a
# atribuição pura do texto, os fail-closed de premissa e o handler de exceção.
ANCORAS_BASE="o SHA do HEAD — a medida que substitui a contagem de objetos|o guard de fase A é rodado com o RECORTE do índice|conta os ✅ e separa os ❌ do gate dos ❌ dos outros|hook SEM o bit de execução|o arquivo do defeito JÁ existindo no checkout|sem um dos guards de fase A|o runner sem os comandos declarados"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — a prova SEM DUBLÊ do pre-commit ($GUARD)"
echo "  ═════════════════════════════════════════════════════════════════"

pass "Backup do guard; checksum inicial $(printf '%s' "$GUARD_SUM")"
montar_bancada
pass "Bancada montada (runner com um comando que passa e um que FALHA)"

# ── CONTROLE A — a leitura íntegra da descida: ela NOMEIA o recusador ─────
header "CONTROLE A — a descida íntegra: o comando que falha sai NOMEADO"
rodar_driver_e_checar "CONTROLE A"
exigir_no_driver '"comandos":["bash scripts/ok.sh","bash scripts/falha.sh"]' \
  "CONTROLE A: os dois comandos declarados no runner foram lidos"
exigir_no_driver '"recusadores":[{"comando":"bash scripts/falha.sh","status":1}]' \
  "CONTROLE A: o recusador é NOMEADO (e o que passa não aparece)"
exigir_no_driver '"indisponivel":null' \
  "CONTROLE A: a descida foi medível (nada de 'não consegui medir')"

# ── CONTROLE B — a suíte unitária mede no estado íntegro ──────────────────
header "CONTROLE B — a suíte unitária está verde antes de mutar"
exigir_suite_verde "CONTROLE B"

# ── M1 — a DECLARAÇÃO dos recusadores ────────────────────────────────────
# A comparação entre o conjunto de membros vermelhos MEDIDO e o DECLARADO é o
# que impede a medição de virar relatório: sem ela, um refutador declarado que
# ficou verde (o guard parou de pegar a classe) e um vermelho NÃO declarado (outro
# guard passou a recusar) passariam — que é exatamente o que os dois casos de
# fixture medem.
header "MUTAÇÃO M1 — a declaração dos recusadores deixa de ser conferida"
mutar '      if (medidos.join("|") !== esperados.join("|")) {' \
  '      if (false /* MUTACAO M1 */) {'
exigir_mutado "M1"
exigir_suite_vermelha "M1" "$ANCORA_DECLARADO_VERDE|$ANCORA_NAO_DECLARADO" \
  "$ANCORAS_BASE|$ANCORA_GATE_E_CONTROLE|$ANCORA_CONTROLE_FASEAA|$ANCORA_ENCODING|$ANCORA_LINK|$ANCORA_CONTROLE_B|$ANCORA_IRMAO_VERMELHO|$ANCORA_GATE_CEGO"
restaurar_original

# ── M2 — a DESCIDA do runner ─────────────────────────────────────────────
# O runner do encoding para no primeiro guard e devolve UM exit code: sem a
# descida, a recusa do commit é da fase B, mas QUAL guard da classe a produziu
# fica indeterminado. A injeção tira a NOMEAÇÃO (o push do recusador).
header "MUTAÇÃO M2 — a descida para de NOMEAR o guard que recusou"
mutar '    if (status !== 0) recusadores.push({ comando, status })' \
  '    if (false /* MUTACAO M2 */) recusadores.push({ comando, status })'
exigir_mutado "M2"
rodar_driver_e_checar "M2"
exigir_no_driver '"recusadores":[]' \
  "M2: CEGO — a descida devolve 'nenhum recusador' com o comando que FALHOU no runner"
exigir_no_driver '"comandos":["bash scripts/ok.sh","bash scripts/falha.sh"]' \
  "M2: os comandos seguem LIDOS — a mutação cegou a nomeação, não a leitura do runner"
exigir_suite_vermelha "M2" "$ANCORA_ENCODING|$ANCORA_LINK|$ANCORA_GATE_E_CONTROLE" \
  "$ANCORAS_BASE|$ANCORA_CONTROLE_FASEAA|$ANCORA_DECLARADO_VERDE|$ANCORA_NAO_DECLARADO|$ANCORA_CONTROLE_B|$ANCORA_IRMAO_VERMELHO|$ANCORA_GATE_CEGO"
restaurar_original

# ── M3 — o PREDICADO do CONTROLE ─────────────────────────────────────────
# O predicado é UM (o CONTROLE entrou?) em TRÊS lugares: a metade 3 (o corpo
# fechado da fase A), o status/HEAD e o conteúdo de HEAD, e o CONTROLE de cada
# defeito da fase B. Desligar só uma das cópias deixaria a outra pegar — e a
# prova NÃO ficaria cega —, então a metade desliga as QUATRO cláusulas da mesma
# régua: com elas fora, a prova sai VERDE sobre um hook que recusa até o commit
# correto (o caso novo da suíte é a testemunha).
header "MUTAÇÃO M3 — o predicado do CONTROLE cai nas duas fases"
mutar '    if (controle.status !== 0 || headControle === headBase) {' \
  '    if (false /* MUTACAO M3 */) {'
mutar '    if (gravado !== REAL_WORKFLOW_VALIDO) {' \
  '    if (false /* MUTACAO M3 */) {'
mutar '      if (controleB.status !== 0 || headControleB === headDepoisB) {' \
  '      if (false /* MUTACAO M3 */) {'
mutar '      if (gravadoB !== defeito.remendo) {' \
  '      if (false /* MUTACAO M3 */) {'
exigir_mutado "M3"
exigir_suite_vermelha "M3" "$ANCORA_CONTROLE_FASEAA" \
  "$ANCORAS_BASE|$ANCORA_GATE_E_CONTROLE|$ANCORA_ENCODING|$ANCORA_LINK|$ANCORA_DECLARADO_VERDE|$ANCORA_NAO_DECLARADO|$ANCORA_CONTROLE_B|$ANCORA_IRMAO_VERMELHO|$ANCORA_GATE_CEGO"
restaurar_original

# ── CONTROLE FINAL — a árvore voltou e a leitura também ───────────────────
header "CONTROLE FINAL — restauração conferida (checksum) e leitura íntegra de volta"
if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$GUARD_SUM" ]; then
  fail "CONTROLE FINAL: o guard não voltou ao estado original (checksum diverge)"
  exit 1
fi
pass "CONTROLE FINAL: checksum do guard idêntico ao inicial"
rodar_driver_e_checar "CONTROLE FINAL"
exigir_no_driver '"recusadores":[{"comando":"bash scripts/falha.sh","status":1}]' \
  "CONTROLE FINAL: a descida voltou a NOMEAR o recusador"

echo ""
echo -e "${GREEN}═══ MUTATION TEST PASSED — as 3 metades foram detectadas (descida por execução + suíte unitária) ═══${NC}"
