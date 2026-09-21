#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-mirror-coverage.sh — Mutation test do
# `scripts/check-mirror-coverage.mjs` (a cobertura do RECORTE do commit,
# derivada das tabelas-fonte dos espelhos)
#
# Usage:
#   ./scripts/test-mutation-mirror-coverage.sh
#
# Exit codes:
#   0 — as TRÊS metades foram DETECTADAS (a leitura por execução muda de CEGO
#       para o lado do defeito E a suíte unitária fica vermelha pela metade
#       certa) e os controles passaram ✅
#   1 — uma metade NÃO sustentou o veredito (o guard seguiu verde com o
#       mecanismo desligado), mutação não-cirúrgica, âncora errada ou
#       restauração falhou ❌
#   2 — infra: o driver não pôde rodar (guard ausente/ilegível) — nunca um
#       verde por omissão
#
# O QUE ISTO PROVA (e por que o guard passar hoje não basta)
#
# O `check-mirror-coverage` mede, POR EXECUÇÃO, se o recorte do commit julga
# cada espelho declarado: muta o espelho (troca de valor e remoção da linha) num
# worktree temporário e roda os comandos `--staged` do hook. O veredito dele é
# um CONTRATO — e um contrato que passa não prova que as três réguas que o
# sustentam estão no lugar. Este script injeta, uma por vez, o defeito de cada
# régua, e exige que a LEITURA mude:
#
#   M1 — o CONTROLE. Antes de mutar, os comandos do recorte rodam na árvore
#        INTACTA; um comando que falha ali falha por AMBIENTE (dependência não
#        instalada, ferramenta fora do PATH) e sai da medição (`confiaveis`).
#        Sem esse filtro, ele é atribuído como detector de TODAS as mutações: a
#        cobertura sai VERDE por acidente de ambiente — o modo de falha que a
#        régua existe para impedir. Mutação: o filtro deixa de existir.
#   M2 — a SOMA POR TABELA. `resumoTabelas` responde a pergunta literal do
#        contrato: quantos espelhos cada tabela declara, quantos têm regra no
#        recorte e QUAIS ficam sem ela (nomeados). Mutação: todo espelho medível
#        passa a contar como "com regra" e a lista dos sem-regra fica VAZIA — a
#        tabela publica cobertura que não existe, e a lacuna some da conta.
#   M3 — a RECUSA DO PULO SEM MOTIVO. Uma mutação só pode ser ignorada com o
#        motivo ESCRITO (o placeholder de um segredo, por exemplo); um pulo sem
#        razão é a porta pela qual uma lacuna deixa de ser medida sem ninguém
#        decidir. Mutação: o pulo sem motivo passa como decidido.
#
# A DIREÇÃO é a do defeito, não a do guard: o que se exige é que o guard fique
# CEGO com o mecanismo desligado — e, para provar que a cegueira é daquela
# régua e não um acidente da bancada, cada metade tem por CONTROLE a leitura
# íntegra do MESMO driver, na MESMA bancada, ANTES da injeção.
#
# DUAS TESTEMUNHAS INDEPENDENTES
#
#   (1) A LEITURA POR EXECUÇÃO — um driver node importa o `check-mirror-coverage.mjs`
#       (o mutado, quando há mutação) e mede contra uma BANCADA: um repositório
#       git temporário FORA do projeto, com dois guards de mentira que se
#       distinguem pelo que pegam (um só a TROCA, outro só a REMOÇÃO), um
#       terceiro que falha SEMPRE (o caso "ambiente") e um espelho `KEY=` no
#       arquivo. O que se lê é o RESULTADO (o que o controle nomeia, o que é
#       atribuído a cada mutação, as violações do contrato e a soma por tabela),
#       nunca o texto do arquivo. É node-puro: roda no master mesmo sem
#       `node_modules`.
#   (2) A SUÍTE UNITÁRIA (`check-mirror-coverage.test.ts`) — o que roda em todo
#       PR. Cada metade exige o vermelho DELA, com as âncoras da metade certa e
#       as outras metades verdes: um vermelho vindo de outro mecanismo (ou de um
#       módulo que morreu) mediria outra coisa. Sem `vitest` instalado a
#       testemunha se declara NÃO JULGÁVEL em voz alta — nunca silenciosa.
#
# A BANCADA (por que ela, e não o repositório): a pergunta é sobre a RÉGUA, e o
# repositório real hoje não tem espelho com regra no recorte nem pulo sem
# motivo — medir ali daria "verde" nos dois estados e a suíte não mediria nada.
# A bancada é um diretório temporário cujos arquivos o guard nunca viu, e o
# repositório fica intocado (nenhum espelho real é trocado por esta suíte).
#
# A CIRURGIA: cada injeção casa exatamente 1 ocorrência (0 ou 2+ = a suíte PARA
# em vez de medir outra coisa), o arquivo mutado tem de continuar com sintaxe
# válida, e a restauração é conferida por CHECKSUM no trap EXIT — um `exit` no
# meio não deixa o guard mutado na árvore.
#
# LIMITES DECLARADOS (o que esta prova NÃO cobre):
#   · a precedência do exit 2 (INDETERMINADO) no CLI não é injetada: o CLI não
#     aceita `--root`, então ele mede a árvore real, onde nenhum comando do
#     recorte falha por ambiente. E a precedência é o ANÚNCIO do mesmo fato — o
#     guard imprime o `⚠️ INDETERMINADO` com ou sem ela; o que CEGA é o filtro,
#     que é justamente o que a M1 injeta.
#   · as outras recusas do contrato (espelho SEM DECISÃO, decisão envelhecida,
#     MEDÍVEL com as duas mutações puladas, tabela que não resolve a linha) têm
#     a suíte unitária como testemunha e são, cada uma, uma régua própria; esta
#     suíte mede as três que o guard NOMEIA no cabeçalho como metade da medição.
#   · a mutação roda NO LUGAR no repositório (é o arquivo que o driver importa):
#     por isso ela vive no master (matriz serial dentro de um job) e não num job
#     ao lado de outra prova de mutação.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|o CONTROLE: o comando que falha SEM mutação (ambiente) deixa de sair da medição e vira detector de tudo'
  'M2|a SOMA POR TABELA: todo espelho medível contado como "com regra" e a lista dos sem-regra esvaziada'
  'M3|a RECUSA DO PULO SEM MOTIVO: mutação ignorada com motivo vazio passa como decidida'
)

cd "$SCRIPT_DIR"

GUARD="scripts/check-mirror-coverage.mjs"
SUITE="src/lib/__tests__/check-mirror-coverage.test.ts"

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

# ── montar_bancada: o repositório temporário com o espelho e os comandos ───
# Os três comandos do recorte são node-puro e têm vereditos SEPARADOS: sem essa
# separação a suíte não conseguiria dizer se a medição atribuiu a detecção ao
# comando certo (e a M1 ficaria indistinguível de uma bancada quebrada).
#   check-removal  — só morde a REMOÇÃO da linha
#   check-swap     — só morde a TROCA do valor
#   check-quebrado — falha SEMPRE (o caso "ambiente": sem o CONTROLE ele seria
#                    contado como detector de todas as mutações)
montar_bancada() {
  rm -rf "$BANCADA"
  mkdir -p "$BANCADA/scripts"
  cat >"$BANCADA/scripts/check-removal.mjs" <<'JS'
import { readFileSync } from 'node:fs'
const t = readFileSync('mirror.env', 'utf8')
if (!/^KEY=/m.test(t)) { console.error('linha ausente'); process.exit(1) }
JS
  cat >"$BANCADA/scripts/check-swap.mjs" <<'JS'
import { readFileSync } from 'node:fs'
const t = readFileSync('mirror.env', 'utf8')
const m = t.match(/^KEY=(.*)$/m)
if (m && m[1] !== '1.0') { console.error('valor trocado'); process.exit(1) }
JS
  cat >"$BANCADA/scripts/check-quebrado.mjs" <<'JS'
console.error('ambiente: dependencia ausente')
process.exit(1)
JS
  printf 'KEY=1.0\n' >"$BANCADA/mirror.env"
  git -C "$BANCADA" init -q
  git -C "$BANCADA" config user.email "mutation@test"
  git -C "$BANCADA" config user.name "mutation test"
  git -C "$BANCADA" config core.autocrlf false
  git -C "$BANCADA" add -A
  git -C "$BANCADA" commit -qm "bancada"
}

# A linha do hook de onde os comandos do recorte são DERIVADOS (a forma real: o
# `&` no fim, que o parser remove, e um comando por `--staged`).
HOOK_SRC="$(printf '%s\n' \
  '#!/usr/bin/env bash' \
  'node scripts/check-removal.mjs --staged &' \
  'node scripts/check-swap.mjs --staged &' \
  'node scripts/check-quebrado.mjs --staged &')"

# ── O DRIVER: a leitura por execução ───────────────────────────────────────
# Importa o guard (mutado, quando há mutação) e mede a bancada. O stdout é o
# JSON da leitura; as asserções leem ARQUIVO (nunca `… | grep` sob pipefail).
rodar_driver() {
  set +e
  GUARD_URL="file://$SCRIPT_DIR/$GUARD" BANCADA="$BANCADA" HOOK_SRC="$HOOK_SRC" \
    node --input-type=module -e '
const mod = await import(process.env.GUARD_URL)
const regexDe = () => /^KEY=(.+)$/m
const espelho = {
  tabela: "fixture",
  variavel: "KEY",
  arquivo: "mirror.env",
  medivel: true,
  recorte: null,
  motivo: null,
}
const out = mod.medirCobertura({
  root: process.env.BANCADA,
  hookSource: process.env.HOOK_SRC,
  regexDe,
  espelhos: [espelho],
})
const m = out.medicoes[0] ?? { mutacoes: { swap: [], remocao: [] }, detectadoPor: [] }
const medicao = { espelho: { ...espelho, motivo: "x" }, detectadoPor: [], mutacoes: { swap: [], remocao: [] } }
// A declaração que DEPENDE do comando que falha por ambiente: ela não pode ser
// confirmada nem refutada ali, e o contrato tem de dizer isso.
const violacoesControle = mod.violacoesDeCobertura(
  out.medicoes,
  [{ ...espelho, recorte: { comando: "check-quebrado", regra: "o comando quebrado julga" } }],
  { regexDe, controle: out.controle },
)
const violacoesPulo = mod.violacoesDeCobertura(
  [medicao],
  [{ ...espelho, motivo: "x", mutacoesIgnoradas: { swap: "   " } }],
  { regexDe },
)
const violacoesVerdeVazio = mod.violacoesDeCobertura(
  [medicao],
  [{ ...espelho, motivo: "x", mutacoesIgnoradas: { swap: "nao e defeito", remocao: "idem" } }],
  { regexDe },
)
const resumo = mod.resumoTabelas([
  { ...espelho, recorte: { comando: "check-removal", regra: "recusa a remocao" } },
  espelho,
])[0] ?? {}
process.stdout.write(
  JSON.stringify({
    comandos: out.comandos.map((c) => c.nome),
    controle: out.controle,
    espelhoErro: m.erro ?? null,
    swap: m.mutacoes.swap,
    remocao: m.mutacoes.remocao,
    detectadoPor: m.detectadoPor,
    quebradoAtribuido: m.detectadoPor.includes("check-quebrado"),
    controleNomeado: violacoesControle.some((v) => v.includes("FALHA SEM MUTAÇÃO")),
    puloSemMotivo: violacoesPulo.some((v) => v.includes("IGNORADA sem motivo")),
    verdeVazio: violacoesVerdeVazio.some((v) => v.includes("não sobrou nada a medir")),
    resumoTotal: resumo.total ?? null,
    resumoComRegra: resumo.comRegra ?? null,
    resumoSemRegra: resumo.semRegra ?? [],
    resumoForaDoCommit: resumo.foraDoCommit ?? [],
  }) + "\n",
)
' >"$F_DRIVER" 2>"$TMP_DIR/driver.err"
  DRIVER_EXIT=$?
  set -e
}

rodar_driver_e_checar() { # <cenário> — o driver rodou e produziu leitura
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

exigir_ausente_do_driver() { # <trecho> <cenário>
  local trecho="$1" cenario="$2"
  if grep -qF "$trecho" "$F_DRIVER"; then
    fail "$cenario: a leitura AINDA tem '$trecho' — a régua mutada não é load-bearing"
    echo "      leitura: $(cat "$F_DRIVER")"
    exit 1
  fi
  pass "$cenario"
}

# ── mutar <alvo> <troca>: substituição LITERAL, cirúrgica ─────────────────
mutar() {
  local alvo="$1" troca="$2"
  ARQUIVO="$GUARD" ALVO="$alvo" NOVO="$troca" python3 - <<'PY'
import os
p = os.environ["ARQUIVO"]
s = open(p, encoding="utf-8").read()
n = s.count(os.environ["ALVO"])
if n != 1:
    raise SystemExit(
        f"mutacao nao-cirurgica no guard: {n} ocorrencia(s) do alvo (esperado 1)"
    )
open(p, "w", encoding="utf-8").write(s.replace(os.environ["ALVO"], os.environ["NOVO"]))
PY
  if ! grep -qF 'MUTACAO M' "$GUARD"; then
    fail "a mutação não aplicou no guard (nada a medir)"
    exit 1
  fi
  if [ "$(cksum "$GUARD" | cut -d' ' -f1)" = "$GUARD_SUM" ]; then
    fail "a mutação não alterou o guard (checksum idêntico) — o alvo casou e a escrita não"
    exit 1
  fi
  if ! node --check "$GUARD" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o guard mutado não é válido sintaticamente."
    exit 1
  fi
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
  sed -E $'s/\033\\[[0-9;]*[a-zA-Z]//g' "$TMP_DIR/suite.bruto" >"$F_SUITE"
  FAIL_LINES="$(grep -E "^[[:space:]]*(FAIL|×)" "$F_SUITE" || true)"
}

mostrar_suite() { grep -E "^[[:space:]]*(FAIL|×)|Tests " "$F_SUITE" | sed 's/^/      /' | head -12; }

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
  pass "$cenario: suíte VERMELHA pela metade mutada — e as outras metades seguem verdes"
}

# ── As âncoras (títulos como o vitest os reporta) ─────────────────────────
ANCORA_CONTROLE="um comando que falha SEM MUTAÇÃO (ambiente) sai da medição e é medido como INDETERMINADO"
ANCORA_RESUMO="nomeia, por tabela, os espelhos sem regra no recorte e os fora do commit"
ANCORA_RESUMO_TEXTO="o relatório em texto publica o resumo por tabela com os nomes"
ANCORA_PULO="mutação IGNORADA sem motivo é violação (um pulo silencioso esconde a lacuna)"
# As réguas que a mutação da vez NÃO pode derrubar (senão mediu-se a suíte toda,
# não esta metade): a bancada por execução, o indecidido, a decisão envelhecida e
# o verde-por-vazio.
ANCORAS_BASE="o recorte derivado do hook roda de verdade e cada mutação cai no guard certo|espelho SEM DECISÃO (nem regra, nem motivo) é violação|declarar uma regra do recorte que a medição NÃO confirma é violação (decisão envelhecida)|MEDÍVEL com as duas mutações puladas é violação (verde por vazio)"
# …mais as OUTRAS duas metades, que a mutação da vez também não pode tocar.
ANCORAS_SEM_CONTROLE="$ANCORA_RESUMO|$ANCORA_RESUMO_TEXTO|$ANCORA_PULO"
ANCORAS_SEM_RESUMO="$ANCORA_CONTROLE|$ANCORA_PULO"
ANCORAS_SEM_PULO="$ANCORA_CONTROLE|$ANCORA_RESUMO|$ANCORA_RESUMO_TEXTO"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — a cobertura do recorte ($GUARD)"
echo "  ═════════════════════════════════════════════════════════════════"

pass "Backup do guard; checksum inicial $(printf '%s' "$GUARD_SUM")"
montar_bancada
pass "Bancada montada (repo git temporário: mirror.env + os dois guards separados + o quebrado)"

# ── CONTROLE A — a leitura íntegra: o ambiente NÃO é detector ─────────────
# É este estado (e não a mutação) que dá sentido às três metades: a bancada
# DISTINGUE as duas mutações, o comando que só falha por ambiente fica FORA da
# atribuição e NOMEADO no controle, o pulo sem motivo é violação, e a tabela
# nomeia o espelho sem regra.
header "CONTROLE A — a leitura íntegra: o ambiente sai da medição e a tabela nomeia"
rodar_driver_e_checar "CONTROLE A"
exigir_no_driver '"comandos":["check-removal","check-swap","check-quebrado"]' \
  "CONTROLE A: os três comandos do recorte foram derivados do hook"
exigir_no_driver '"swap":["check-swap"]' \
  "CONTROLE A: a TROCA do valor cai no guard do valor"
exigir_no_driver '"remocao":["check-removal"]' \
  "CONTROLE A: a REMOÇÃO da linha cai no guard da existência (a bancada distingue)"
exigir_no_driver '"detectadoPor":["check-swap","check-removal"]' \
  "CONTROLE A: o comando que falha SEM mutação NÃO é atribuído"
exigir_no_driver '"controle":["check-quebrado"]' \
  "CONTROLE A: ele é NOMEADO no controle (a medição sabe quem falhou por ambiente)"
exigir_no_driver '"controleNomeado":true' \
  "CONTROLE A: a declaração que depende dele sai violada (FALHA SEM MUTAÇÃO)"
exigir_no_driver '"puloSemMotivo":true' \
  "CONTROLE A: o pulo SEM MOTIVO é violação"
exigir_no_driver '"verdeVazio":true' \
  "CONTROLE A: as duas mutações ignoradas também (verde por vazio)"
exigir_no_driver '"resumoComRegra":1' \
  "CONTROLE A: a tabela conta 1 espelho com regra no recorte"
exigir_no_driver '"resumoSemRegra":["KEY@mirror.env"]' \
  "CONTROLE A: e NOMEIA o que ficou sem ela"

# ── CONTROLE B — a suíte unitária mede no estado íntegro ──────────────────
header "CONTROLE B — a suíte unitária está verde antes de mutar"
exigir_suite_verde "CONTROLE B"

# ── M1 — o CONTROLE (o filtro do ambiente) ────────────────────────────────
# O `confiaveis` (os comandos que a medição CONFIA) deixa de excluir o que falha
# na árvore intacta: o guard que só falha por ambiente passa a contar como
# detector de TODAS as mutações — cobertura verde por acidente de ambiente.
header "MUTAÇÃO M1 — o CONTROLE deixa de excluir o comando que falha SEM mutação"
mutar 'const confiaveis = comandos.filter((c) => !controle.includes(c.nome))' \
  'const confiaveis = comandos /* MUTACAO M1 */'
pass "M1: injeção aplicada (o filtro do CONTROLE não existe mais)"
rodar_driver_e_checar "M1"
exigir_no_driver '"quebradoAtribuido":true' \
  "M1: CEGO — o comando que só falha por ambiente passou a ser ATRIBUÍDO como detector"
exigir_no_driver '"detectadoPor":["check-swap","check-quebrado","check-removal"]' \
  "M1: a cegueira está na leitura (o quebrado entrou no lugar do guard do defeito)"
exigir_no_driver '"controle":["check-quebrado"]' \
  "M1: o CONTROLE continua nomeando o comando — a mutação matou a exclusão, não a medição"
exigir_suite_vermelha "M1" "$ANCORA_CONTROLE" "$ANCORAS_BASE|$ANCORAS_SEM_CONTROLE"
restaurar_original

# ── M2 — a SOMA POR TABELA ────────────────────────────────────────────────
# `resumoTabelas` responde "quais espelhos de cada tabela o commit não julga".
# Com a decisão trocada por um incremento incondicional, TODO espelho medível
# conta como "com regra" e a lista dos sem-regra fica vazia: a tabela publica
# cobertura que não existe e a lacuna some da conta (sem nenhuma violação, que
# é o pior dos mundos).
header "MUTAÇÃO M2 — a SOMA POR TABELA passa a contar todo espelho como coberto"
mutar '      if (e.recorte !== null) t.comRegra += 1
      else t.semRegra.push(nome)' \
  '      t.comRegra += 1 /* MUTACAO M2 */'
pass "M2: injeção aplicada (a soma por tabela perdeu a decisão do recorte)"
rodar_driver_e_checar "M2"
exigir_no_driver '"resumoComRegra":2' \
  "M2: CEGO — os DOIS espelhos contados como cobertos (o sem regra virou com regra)"
exigir_no_driver '"resumoSemRegra":[]' \
  "M2: CEGO — nenhum sem-regra nomeado: a lacuna saiu da conta em silêncio"
exigir_no_driver '"resumoTotal":2' \
  "M2: o total segue o mesmo — a mutação mente na soma por cobertura, não no tamanho da tabela"
exigir_suite_vermelha "M2" "$ANCORA_RESUMO|$ANCORA_RESUMO_TEXTO" "$ANCORAS_BASE|$ANCORAS_SEM_RESUMO"
restaurar_original

# ── M3 — a RECUSA DO PULO SEM MOTIVO ──────────────────────────────────────
# Uma mutação ignorada sem motivo escrito é a porta pela qual uma lacuna deixa
# de ser medida sem ninguém decidir. Com a recusa fora, o pulo vazio passa como
# decisão — e o verde por vazio (as duas ignoradas) continua sendo recusado, o
# que prova que a mutação mediu ESTA régua e não o contrato inteiro.
header "MUTAÇÃO M3 — o pulo de mutação SEM MOTIVO deixa de ser violação"
mutar 'if (!String(motivo ?? "").trim()) {' \
  'if (false /* MUTACAO M3 */) {'
pass "M3: injeção aplicada (a recusa do pulo sem motivo não existe mais)"
rodar_driver_e_checar "M3"
exigir_no_driver '"puloSemMotivo":false' \
  "M3: CEGO — o pulo sem razão passou como decisão (violação nenhuma)"
exigir_no_driver '"verdeVazio":true' \
  "M3: a OUTRA recusa do pulo (as duas mutações ignoradas) segue de pé — a régua é só esta"
exigir_no_driver '"controleNomeado":true' \
  "M3: o resto do contrato segue medindo (o vermelho da suíte é desta metade)"
exigir_suite_vermelha "M3" "$ANCORA_PULO" "$ANCORAS_BASE|$ANCORAS_SEM_PULO"
restaurar_original

# ── CONTROLE FINAL — a árvore voltou e a leitura também ───────────────────
header "CONTROLE FINAL — restauração conferida (checksum) e leitura íntegra de volta"
if [ "$(cksum "$GUARD" | cut -d' ' -f1)" != "$GUARD_SUM" ]; then
  fail "CONTROLE FINAL: o guard não voltou ao estado original (checksum diverge)"
  exit 1
fi
pass "CONTROLE FINAL: checksum do guard idêntico ao inicial"
rodar_driver_e_checar "CONTROLE FINAL"
exigir_no_driver '"quebradoAtribuido":false' \
  "CONTROLE FINAL: o comando que falha por ambiente voltou a sair da medição"
exigir_no_driver '"resumoSemRegra":["KEY@mirror.env"]' \
  "CONTROLE FINAL: a tabela voltou a nomear o espelho sem regra"
exigir_suite_verde "CONTROLE FINAL"

echo ""
echo -e "${GREEN}═══ MUTATION TEST PASSED — as 3 metades foram detectadas (leitura por execução + suíte unitária) ═══${NC}"
