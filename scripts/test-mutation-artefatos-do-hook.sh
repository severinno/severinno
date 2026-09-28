#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-artefatos-do-hook.sh — Mutation test da DERIVAÇÃO dos
# artefatos do hook (`scripts/artefatos-do-hook.mjs`)
#
# Usage:
#   bash scripts/test-mutation-artefatos-do-hook.sh
#
# Exit codes:
#   0 — as TRÊS metades foram DETECTADAS (a lista derivada esvazia e, na
#       segunda, perde UM artefato — em ambas o FIXTURE fica VERMELHO, por
#       execução e pela suíte —; a terceira exige a RECUSA da troca SEM a
#       prova-de-aplicação) e o controle passou ✅
#   1 — uma metade NÃO sustentou o veredito (a mutação não mudou a leitura),
#       mutação não-cirúrgica, ou a restauração falhou ❌
#   2 — infra: a leitura por execução não pôde ser montada
#
# O QUE ISTO PROVA (e por que a suíte unitária sozinha não basta)
#
# A derivação deixou de ser uma LISTA À MÃO: `artefatosDoFixture()` responde quais
# arquivos do repositório o fixture do pre-commit MATERIALIZA a partir do que os
# guards do hook LEEM por execução. Só que a régua da derivação é ela mesma um
# mecanismo: se ela voltar a devolver uma lista VAZIA, ou a PERDER uma entrada (um
# filtro que come o item, uma coleta que para de registrar), o fixture deixa de
# materializar o artefato e o guard fail-closed lê INFRA na CÓPIA. O sintoma é o
# pior possível: o vermelho passa a ser do FIXTURE, não do defeito, e a lista à mão
# volta pela porta de trás sem ninguém editar uma linha de lista. Esta suíte desliga
# a derivação nas DUAS formas e exige que o veredito MUDE em cada uma.
#
# AS METADES (o que cada uma tira do lugar):
#
#   · M1 — o RETORNO da derivação passa a ser `[]`. Com isso o fixture não
#     materializa o `deploy/docker-compose.gitea.yml`, a guarda da tag do runner
#     não tem o que julgar e o hook cai em INFRA ("não existe em" / "sem o
#     artefato não há veredito a cunhar"), em vez de deixar passar um commit que
#     ele não conseguiu julgar.
#   · M2 — a COLETA para de registrar UM leitor: o compose da forja sai da lista
#     que a derivação monta. É o caso VIL, e é por isso que ele é uma metade
#     SEPARADA: a lista NÃO esvazia — os outros oito artefatos seguem lá, o
#     fixture materializa oito de nove e a derivação não acusa problema nenhum.
#     O artefato que sumiu é justamente o que a guarda lê, então o hook cai no
#     MESMO INFRA e o vermelho do fixture é o mesmo de M1. O que a metade prova é
#     que "um item a menos" NÃO passa como "uma lista menor": a lista à mão não
#     volta inteira, volta pela METADE, e quem a barra é o artefato que o fixture
#     PRECISA (fail-closed por dependência, não por tamanho de lista).
#   · M3 — a PROVA-DE-APLICAÇÃO do próprio harness: a troca SEM o marcador
#     `MUTACAO` no texto novo. O `mutar` não confia no replace — ele exige que a
#     mutação CARREGUE o marcador, que é o que PROVA que ela aplicou (o alvo pode
#     casar e a escrita falhar). Sem essa prova, uma mutação que não aplicasse
#     seria medida contra o guard ÍNTEGRO: o teste passaria por VÁCUO e o verde
#     da suíte não diria nada. É a metade que exige o VERMELHO da PRÓPRIA suíte, e
#     é de propósito: aqui quem é load-bearing é a guarda do harness, não o
#     veredito do fixture.
#
# DUAS TESTEMUNHAS INDEPENDENTES
#
#   (1) A LEITURA POR EXECUÇÃO — o driver importa a derivação E o fixture REAIS
#       deste checkout, materializa a cópia com a lista derivada e RODA O HOOK de
#       verdade no fixture (a guarda da tag em `passthrough`, o resto dublado).
#       O que se lê não é a intenção: é a lista derivada, a lista que o fixture
#       usa, o EXIT do hook e a saída dele. No CONTROLE o fixture fica VERDE
#       (exit 0, a guarda cunha o veredito do pin e o hook completa); com CADA
#       metade ele fica VERMELHO pela INFRA.
#   (2) A SUÍTE UNITÁRIA (`pre-commit-runner-tag-blocks.test.ts`) — a suíte do
#       FIXTURE, que roda em todo PR e que mede a materialização com a guarda
#       real. A âncora é o título do caso que exige o artefato na cópia, para o
#       vermelho não ser de outro caso. Sem `vitest` instalado a testemunha se
#       declara NÃO JULGÁVEL em voz alta.
#
# A CIRURGIA: a injeção casa exatamente 1 ocorrência (0 ou 2+ = a suíte PARA em
# vez de medir outra coisa), o guard mutado tem de continuar com sintaxe válida
# (`node --check`) e a restauração é conferida por CHECKSUM no trap EXIT — um
# `exit` no meio não deixa o guard mutado na árvore.
#
# LIMITES DECLARADOS (o que esta prova NÃO cobre):
#   · a derivação em si tem a sua própria suíte (`artefatos-do-hook.test.ts`),
#     que mede o artefato NOVO sem edição e o fail-closed do comando ausente; aqui
#     quem se mede é a CONSEQUÊNCIA da lista esvaziada no fixture, e a leitura por
#     execução importa a derivação real (não uma cópia);
#   · as duas metades tiram o MESMO artefato (o compose da forja) da lista — uma
#     esvaziando tudo, a outra sumindo com ele. A lista que perde um artefato que
#     NENHUM guard do hook lê não muda veredito nenhum, e não é mutada aqui: quem
#     a mede é a suíte da derivação e o `porComando` do `--json`;
#   · o dublê do hook: os irmãos de fase devolvem 0 por função, e só a guarda que
#     lê o artefato atravessa (`passthrough`). É a materialização que está em
#     julgamento, não a bateria inteira do hook.
#
# A LEITURA POR EXECUÇÃO É NODE-PURA (e é de propósito): o driver importa a
# derivação, o fixture e o simulador DESTE checkout (todos resolvem só caminhos
# relativos e `node:`) e roda o hook com o dublê, então ela mede no job node-puro
# da matriz mesmo sem `node_modules`. A testemunha de vitest é a SEGUNDA, e se
# declara não julgada quando a instalação não está lá.
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
  'M1|a LISTA DERIVADA esvaziada: o fixture perde os artefatos, o hook cai em INFRA na cópia e o vermelho deixa de falar do defeito (a lista à mão de novo)'
  'M2|a COLETA para de registrar UM leitor: a lista derivada perde o compose, os outros oito ficam e o hook cai no MESMO INFRA — a lista à mão voltando pela metade não passa como lista menor'
  'M3|a PROVA-DE-APLICAÇÃO — a troca SEM o marcador MUTACAO é RECUSADA pela suíte: sem ela a detecção de mutação poderia passar em VÁCUO (medindo o guard íntegro)'
)

cd "$SCRIPT_DIR"

GUARD="scripts/artefatos-do-hook.mjs"
SUITE="src/lib/__tests__/pre-commit-runner-tag-blocks.test.ts"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
F_DRIVER="$TMP_DIR/driver.json"
F_DRIVER_MJS="$TMP_DIR/driver.mjs"
F_SUITE_BRUTO="$TMP_DIR/suite.bruto"
F_SUITE_TXT="$TMP_DIR/suite.txt"

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

# ── O DRIVER: a derivação E o fixture, por execução ───────────────────────
# Importa a derivação e o fixture DESTE checkout (a mutação é no lugar, então o
# import a vê), materializa a cópia com a lista derivada e RODA O HOOK real no
# fixture. O JSON de saída é a única leitura: a lista derivada, a lista que o
# fixture usa, o exit do hook e a saída dele.
cat >"$F_DRIVER_MJS" <<'JS'
const raiz = process.env.RAIZ
const der = await import(`file://${raiz}/scripts/artefatos-do-hook.mjs`)
const pre = await import(`file://${raiz}/scripts/pre-commit-proof.mjs`)
const sim = await import(`file://${raiz}/scripts/hook-simulator.mjs`)

const { artefatos, problemas } = der.artefatosDoHook({ root: raiz })
const doFixture = pre.artefatosDoFixture()

// A guarda que LÊ o artefato atravessa o dublê (`passthrough`): é ela que
// denuncia a cópia sem o compose. O resto do hook fica dublado.
const dir = pre.novoRepo({ passthrough: [pre.RUNNER_TAG_GUARD], prefix: "artefatos-mut-" })
let hookStatus = null
let hookOutput = ""
try {
  const res = pre.runHook(dir, pre.hookSource())
  hookStatus = res.status
  hookOutput = res.output ?? ""
} finally {
  sim.cleanupFixtures()
}

process.stdout.write(
  JSON.stringify({ artefatos, problemas, doFixture, hookStatus, hookOutput }) + "\n",
)
JS

rodar_driver() {
  set +e
  RAIZ="$SCRIPT_DIR" node "$F_DRIVER_MJS" >"$F_DRIVER" 2>"$TMP_DIR/driver.err"
  DRIVER_EXIT=$?
  set -e
}

rodar_driver_e_checar() { # <cenário>
  local cenario="$1"
  rodar_driver
  if [ "$DRIVER_EXIT" -ne 0 ] ||
    ! python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$F_DRIVER" \
      >/dev/null 2>&1; then
    fail "$cenario: a LEITURA QUEBROU (driver exit $DRIVER_EXIT, JSON ilegível) — o instrumento não mediu o fixture"
    sed 's/^/      /' "$TMP_DIR/driver.err" | tail -8
    exit 2
  fi
}

# O campo de um JSON: listas saem separadas por espaço, booleanos como
# `true`/`false`, ausentes como `null`.
ler_campo() { # <campo>
  python3 - "$F_DRIVER" "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
v = d.get(sys.argv[2])
if isinstance(v, list):
    print(" ".join(str(x) for x in v))
elif isinstance(v, bool):
    print("true" if v else "false")
elif v is None:
    print("null")
else:
    print(v)
PY
}

contagem() { # <campo> — o nº de itens de uma lista (-1 se não for lista)
  python3 - "$F_DRIVER" "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
v = d.get(sys.argv[2])
print(len(v) if isinstance(v, list) else -1)
PY
}

saida_contem() { # <trecho> — a saída do hook contém? (0/1)
  python3 - "$F_DRIVER" "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
raise SystemExit(0 if sys.argv[2] in (d.get("hookOutput") or "") else 1)
PY
}

exigir_contagem() { # <campo> <esperado> <cenário>
  local campo="$1" esperado="$2" cenario="$3" obtido
  obtido="$(contagem "$campo")"
  if [ "$obtido" != "$esperado" ]; then
    fail "$cenario: $campo tem $obtido item(ns) e devia ter $esperado"
    exit 1
  fi
  pass "$cenario ($campo = $esperado)"
}

exigir_igual() { # <campo> <esperado> <cenário>
  local campo="$1" esperado="$2" cenario="$3" obtido
  obtido="$(ler_campo "$campo")"
  if [ "$obtido" != "$esperado" ]; then
    fail "$cenario: $campo é '$obtido' e devia ser '$esperado'"
    exit 1
  fi
  pass "$cenario ($campo = $esperado)"
}

exigir_nao_igual() { # <campo> <proibido> <cenário>
  local campo="$1" proibido="$2" cenario="$3" obtido
  obtido="$(ler_campo "$campo")"
  if [ "$obtido" = "$proibido" ]; then
    fail "$cenario: $campo é '$obtido' e NÃO podia ser"
    exit 1
  fi
  pass "$cenario ($campo ≠ $proibido)"
}

exigir_iguais() { # <campoA> <campoB> <cenário> — os dois campos leem o MESMO valor
  local campoA="$1" campoB="$2" cenario="$3" a b
  a="$(ler_campo "$campoA")"
  b="$(ler_campo "$campoB")"
  if [ "$a" != "$b" ]; then
    fail "$cenario: $campoA ('$a') ≠ $campoB ('$b')"
    exit 1
  fi
  pass "$cenario ($campoA = $campoB)"
}

exigir_perdeu_exatamente() { # <campo> <removido> <referência> <cenário>
  # A lista lida tem de ser a REFERÊNCIA menos UM item — e o item é nomeado. Uma
  # mutação que perdesse dois artefatos, ou que trocasse a lista por outra coisa do
  # mesmo tamanho, seria uma mutação DIFERENTE da declarada (e o veredito dela não
  # prova o que a metade diz).
  local campo="$1" removido="$2" referencia="$3" cenario="$4" obtido esperado
  obtido="$(ler_campo "$campo")"
  # A ORDEM tem de ser a MESMA do driver: a lista sai do JSON ordenada por code
  # unit (`Array.sort()`), e o `sort` do shell com locale ordenaria diferente
  # (`.` antes de `d`? depende do locale) — `LC_ALL=C` é a régua certa.
  esperado="$(tr ' ' '\n' <<<"$referencia" | grep -vxF -- "$removido" | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')"
  if [ "$obtido" != "$esperado" ]; then
    fail "$cenario: a lista não é o CONTROLE menos '$removido' — obtido: '$obtido' · esperado: '$esperado'"
    exit 1
  fi
  pass "$cenario (o CONTROLE menos '$removido')"
}

exigir_contem() { # <campo> <trecho> <cenário>
  local campo="$1" trecho="$2" cenario="$3" obtido
  obtido="$(ler_campo "$campo")"
  if ! grep -qF -- "$trecho" <<<"$obtido"; then
    fail "$cenario: $campo não contém '$trecho' (leitura: $obtido)"
    exit 1
  fi
  pass "$cenario ($campo contém '$trecho')"
}

exigir_saida_tem() { # <trecho> <cenário>
  local trecho="$1" cenario="$2"
  if ! saida_contem "$trecho"; then
    fail "$cenario: a saída do hook não contém '$trecho'"
    exit 1
  fi
  pass "$cenario (a saída contém '$trecho')"
}

exigir_saida_sem() { # <trecho> <cenário>
  local trecho="$1" cenario="$2"
  if saida_contem "$trecho"; then
    fail "$cenario: a saída do hook contém '$trecho' e NÃO devia"
    exit 1
  fi
  pass "$cenario (a saída sem '$trecho')"
}

# ── mutar <alvo> <troca>: substituição LITERAL, cirúrgica ─────────────────
mutar() { # <alvo-texto> <troca-texto>: a cirurgia, o marcador e o checksum são da
  # régua COMPARTILHADA (`mutacao_aplicar`); aqui só o alvo e a sintaxe do guard.
  mutacao_aplicar "$GUARD" "$1" "$2" "$GUARD_SUM"
  mutacao_sintaxe_node "$GUARD"
}

# ── A testemunha unitária (o FIXTURE) ─────────────────────────────────────
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

# rodar_suite [filtro] — sem filtro roda o arquivo INTEIRO (a suíte do fixture);
# com filtro, o recorte declarado da âncora.
rodar_suite() {
  local filtro="${1:-}"
  local args=(run --config vitest.config.unit.ts "$SUITE")
  if [ -n "$filtro" ]; then args+=(-t "$filtro"); fi
  set +e
  (cd "$SCRIPT_DIR" && NO_COLOR=1 bun x vitest "${args[@]}") >"$F_SUITE_BRUTO" 2>&1
  SUITE_EXIT=$?
  set -e
  # ANSI FORA antes de julgar (o vitest colore mesmo com a saída redirecionada,
  # e uma sequência de escape no começo da linha esconderia o `FAIL`/`×`).
  sed -E $'s/\033\\[[0-9;]*[a-zA-Z]//g' "$F_SUITE_BRUTO" >"$F_SUITE_TXT"
  FAIL_LINES="$(grep -E "^[[:space:]]*(FAIL|×)" "$F_SUITE_TXT" || true)"
  # O recorte RODADO = passados + falhados da linha `Tests ` (o verde pode ser 0
  # passados quando o vermelho é o que se mede). A linha dos ARQUIVOS não serve:
  # `Test Files 1 passed` casaria um `1 passed` que não é teste nenhum.
  local linha_tests passados falhados
  linha_tests="$(grep -E '^[[:space:]]*Tests ' "$F_SUITE_TXT" | head -1)"
  passados="$(grep -oE '[0-9]+ passed' <<<"$linha_tests" | grep -oE '[0-9]+' || true)"
  falhados="$(grep -oE '[0-9]+ failed' <<<"$linha_tests" | grep -oE '[0-9]+' || true)"
  RODADOS=$(( ${passados:-0} + ${falhados:-0} ))
  # O PISO do recorte: um filtro que não casa NADA também sai 0 — e aí o verde
  # seria de uma suíte que não rodou. Nunca julgar sem ter rodado.
  if [ "$RODADOS" -eq 0 ]; then
    fail "a suíte NÃO rodou nenhum teste (recorte '${filtro:-<arquivo inteiro>}') — um recorte vazio daria verde para qualquer mutação"
    grep -E "^[[:space:]]*(Test Files|Tests) " "$F_SUITE_TXT" | sed 's/^/      /' | head -4
    exit 1
  fi
}

mostrar_suite() { grep -E "^[[:space:]]*(FAIL|×)|Tests " "$F_SUITE_TXT" | sed 's/^/      /' | head -12; }

exigir_suite_verde() { # <cenário>
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
  pass "$cenario: suíte VERDE ($RODADOS teste(s)) — a testemunha mede"
}

# exigir_suite_vermelha <cenário> <âncora da metade mutada>
exigir_suite_vermelha() {
  local cenario="$1" ancora="$2"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada (vitest ausente, declarado)"
    return 0
  fi
  rodar_suite "$ancora"
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte ficou VERDE com o mecanismo desligado — ele não é load-bearing"
    mostrar_suite
    exit 1
  fi
  if ! grep -qF -- "$ancora" <<<"$FAIL_LINES"; then
    fail "$cenario: vermelho pelo motivo ERRADO — a âncora da metade mutada não caiu:"
    echo "      · $ancora"
    mostrar_suite
    exit 1
  fi
  pass "$cenario: suíte VERMELHA pela metade mutada"
}

# ── A âncora (o título como o vitest o reporta) ───────────────────────────
ANCORA_M1="o fixture MATERIALIZA o artefato que a guarda lê"
# M2 derruba o fixture pela MESMA materialização (é o mesmo caso que exige o
# artefato na cópia): a âncora da testemunha unitária é a mesma, e o que difere
# entre as metades é o CAMINHO pelo qual o artefato sai da lista derivada.
ANCORA_M2="$ANCORA_M1"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — a DERIVAÇÃO dos artefatos do hook ($GUARD)"
echo "  ═════════════════════════════════════════════════════════════════"

pass "Backup do guard; checksum inicial $GUARD_SUM"

# ── CONTROLE: a derivação íntegra — o fixture verde, com o artefato na cópia ──
header "CONTROLE — a derivação íntegra: o fixture materializa e o hook fica VERDE"
rodar_driver_e_checar "CONTROLE"
exigir_igual "problemas" "" "a derivação fecha (nenhum problema)"
exigir_nao_igual "artefatos" "" "a lista derivada NÃO é vazia"
exigir_contem "artefatos" "deploy/docker-compose.gitea.yml" "o compose entra na lista (a guarda da tag o lê)"
exigir_iguais "artefatos" "doFixture" "o fixture usa EXATAMENTE a lista derivada"
exigir_igual "hookStatus" "0" "com o artefato na cópia o hook sai 0 (fixture VERDE)"
exigir_saida_tem "PINA uma versão" "e a guarda da tag RODOU, cunhando o veredito do pin"
exigir_saida_tem "HOOK_COMPLETOU" "e o hook atravessa tudo"
exigir_suite_verde "CONTROLE"

# A REFERÊNCIA do controle: M2 é julgada CONTRA ela (a lista menos um item, e mais
# nada). Sem esta captura a metade compararia com um número fixo, e um artefato
# novo no repositório faria a metade medir a contagem, não a PERDA.
CONTROLE_ARTEFATOS="$(ler_campo artefatos)"
N_CONTROLE="$(contagem artefatos)"

# ── M1: a LISTA DERIVADA esvaziada ────────────────────────────────────────
header "M1 — a LISTA: a derivação devolve vazio (o fixture perde os artefatos e o hook cai em INFRA)"
mutar '      artefatos: todos.filter((rel) => !fora.has(rel)),' \
  '      artefatos: [], // MUTACAO M1: a lista derivada esvaziada'
rodar_driver_e_checar "M1"
exigir_contagem "artefatos" "0" "M1: a derivação devolve lista VAZIA"
exigir_contagem "doFixture" "0" "M1: e o fixture não materializa artefato nenhum"
exigir_nao_igual "hookStatus" "0" "M1: o hook no fixture fica VERMELHO (o artefato sumiu da cópia)"
exigir_saida_tem "não existe em" "M1: e a recusa é o INFRA do artefato ausente (fail-closed)"
exigir_saida_tem "sem o artefato não há veredito a cunhar" "M1: o motivo é o artefato, não o defeito medido"
exigir_saida_sem "PINA uma versão" "M1: a guarda não cunha veredito nenhum na cópia"
exigir_saida_sem "HOOK_COMPLETOU" "M1: o hook NÃO atravessa (a cópia é insegura por construção)"
exigir_suite_vermelha "M1" "$ANCORA_M1"
restaurar_original

# ── M2: a LISTA DERIVADA perde UM artefato (a coleta para de registrar o leitor) ──
header "M2 — a COLETA: um leitor a menos (os outros oito ficam e o hook cai no MESMO INFRA)"
mutar '        lidos.add(rel)' \
  '        if (rel !== "deploy/docker-compose.gitea.yml") lidos.add(rel) // MUTACAO M2: a coleta para de registrar UM leitor (o compose da forja)'
rodar_driver_e_checar "M2"
exigir_igual "problemas" "" "M2: a derivação 'fecha' (nenhum problema) — a perda é SILENCIOSA"
exigir_nao_igual "artefatos" "" "M2: a lista NÃO esvazia (é o caso vil: um item a menos, não zero)"
exigir_contagem "artefatos" "$((N_CONTROLE - 1))" "M2: a lista derivada tem UM artefato a menos que o CONTROLE"
exigir_perdeu_exatamente "artefatos" "deploy/docker-compose.gitea.yml" "$CONTROLE_ARTEFATOS" "M2: e o que saiu é exatamente o artefato que a guarda da tag lê"
exigir_iguais "artefatos" "doFixture" "M2: o fixture usa EXATAMENTE a lista derivada (a parcial chega à cópia)"
exigir_nao_igual "hookStatus" "0" "M2: o hook no fixture fica VERMELHO (o artefato que sumiu é o que a guarda lê)"
exigir_saida_tem "não existe em" "M2: e a recusa é o MESMO INFRA do artefato ausente (fail-closed)"
exigir_saida_tem "sem o artefato não há veredito a cunhar" "M2: o motivo nomeia o artefato, não o defeito medido"
exigir_saida_sem "PINA uma versão" "M2: a guarda não cunha veredito nenhum na cópia"
exigir_saida_sem "HOOK_COMPLETOU" "M2: o hook NÃO atravessa (a cópia é insegura por construção)"
exigir_suite_vermelha "M2" "$ANCORA_M2"
restaurar_original

# ── M3 — a PROVA-DE-APLICAÇÃO: a troca SEM o marcador MUTACAO é RECUSADA ────
# O marcador `MUTACAO M` no texto NOVO é o que prova que a mutação APLICOU — o
# alvo pode casar e a escrita falhar, e uma mutação que não aplicou seria medida
# contra o guard ÍNTEGRO (a suíte passaria em VÁCUO, dando verde sobre uma árvore
# que ninguém mutou). Aqui a troca é a MESMA da M1 (o retorno da derivação
# esvaziado), SÓ SEM o marcador: o `mutar` tem de RECUSAR e a suíte, por
# consequência, sair VERMELHA. É o ÚNICO ponto da matriz em que se exige o vermelho
# da PRÓPRIA suíte — e é de propósito: quem é load-bearing aqui é a guarda do
# harness, não o veredito do fixture. O MOTIVO da recusa é conferido na saída: um
# vermelho por outra causa (a troca não-cirúrgica, por exemplo) não é a prova
# desta metade. Note que o `mutar` ESCREVE o guard antes de conferir o marcador —
# a recusa não é "a escrita falhou", é "a escrita não se provou".
header "M3 — a PROVA-DE-APLICAÇÃO: a troca SEM o marcador MUTACAO é recusada"
set +e
M3_SAIDA="$( ( mutar '      artefatos: todos.filter((rel) => !fora.has(rel)),' '      artefatos: []' ) 2>&1 )"
M3_EXIT=$?
set -e
if [ "$M3_EXIT" -eq 0 ]; then
  fail "M3: a suíte ACEITOU uma mutação SEM a prova-de-aplicação — o marcador MUTACAO não é load-bearing e a detecção poderia ser VÁCUA"
  echo "$M3_SAIDA" | sed 's/^/      /'
  exit 1
fi
if ! grep -qF "a mutação não aplicou em" <<<"$M3_SAIDA"; then
  fail "M3: o vermelho veio de OUTRO motivo, não da guarda do marcador — o que se mede é a PROVA-DE-APLICAÇÃO:"
  echo "$M3_SAIDA" | sed 's/^/      /'
  exit 1
fi
pass "M3: a suíte RECUSOU a troca sem o marcador MUTACAO (exit $M3_EXIT) — a prova-de-aplicação é load-bearing"
restaurar_original

# ── FECHO ─────────────────────────────────────────────────────────────────
header "FECHO"
rodar_driver_e_checar "FECHO"
exigir_nao_igual "artefatos" "" "na árvore restaurada, a lista derivada volta a ter os artefatos"
exigir_contagem "artefatos" "$N_CONTROLE" "e o TAMANHO dela volta ao do CONTROLE"
exigir_contem "artefatos" "deploy/docker-compose.gitea.yml" "e o artefato que as DUAS metades tiraram está de volta na lista"
exigir_igual "hookStatus" "0" "e o fixture volta a ficar verde"
exigir_suite_verde "FECHO"
pass "as metades M1 (a lista derivada esvaziada) e M2 (a lista derivada com UM artefato a menos) foram detectadas (o fixture fica VERMELHO nas duas) e a M3 (a troca SEM a prova-de-aplicação) foi RECUSADA — a guarda do harness é load-bearing; o guard está restaurado e medindo"
echo ""
