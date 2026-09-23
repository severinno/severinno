#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-canal-fixers.sh — Mutation test da DESCOBERTA do registro
# do canal do PR (`scripts/pr-fixers.mjs` + `scripts/remedy-canal/`)
#
# Usage:
#   ./scripts/test-mutation-canal-fixers.sh
#
# Exit codes:
#   0 — as SEIS mutações foram DETECTADAS (pelo registro medido POR EXECUÇÃO
#       e/ou pela suíte unitária) e os controles passaram ✅
#   1 — descoberta CEGA (a mutação não foi vista) / mutação não-cirúrgica /
#       controle falso / infra ❌
#
# POR QUE ESTA SUÍTE EXISTE
#
# O `FIXERS` era um registro escrito à mão dentro do `pr-remedy-comment.mjs`.
# Enquanto ele viveu ali, um guard que já sabia consertar (`--fix`) e produzir o
# PATCH (`remedyPatch`) ficava FORA do canal até alguém editar aquele arquivo — e
# nada acusa essa regressão, porque um remédio que não publica é indistinguível
# de um defeito sem remédio. O registro agora é DESCOBERTO: as declarações de
# `scripts/remedy-canal/<id>.mjs` casam com as CLASSES de mesmo id em
# `scripts/remedy-classes/` (de onde saem o guard dono, o comando do `--fix` e a
# ordem), e um fixer novo entra no commit em que as duas existem.
#
# Uma descoberta dessas sem testemunha é uma promessa em prosa: mutar cada
# metade dela e continuar tudo verde é exatamente o modo de falha que o registro
# à mão tinha.
#
# DUAS TESTEMUNHAS INDEPENDENTES
#
#   (1) O REGISTRO MEDIDO POR EXECUÇÃO — um driver node importa o
#       `pr-fixers.mjs` (o mutado, quando há mutação) e chama `discoverFixers`
#       contra uma BANCADA: um repositório temporário fora do projeto com as
#       declarações e os donos. O que se lê é o REGISTRO (ids, ordem, marcador,
#       comando, se o medidor existe) e os PROBLEMAS nomeados — não o texto do
#       arquivo. É node-puro: roda no master mesmo sem `node_modules`.
#   (2) A SUÍTE UNITÁRIA (`canal-fixers-discovery.test.ts`), com âncoras: o
#       vermelho tem de ser O vermelho da metade mutada, e as outras metades
#       seguem verdes. Sem `vitest` instalado a testemunha se declara NÃO
#       JULGÁVEL em voz alta — nunca um verde por omissão.
#
# A BANCADA (por que ela, e não um arquivo de sonda no repositório): a pergunta
# é "um fixer novo entra SEM EDITAR O REGISTRO". Escrevê-lo no repositório real
# mediria o mesmo e sujaria a árvore de quem roda a suíte (e a de um job em
# paralelo). A bancada é um diretório temporário cujos arquivos o registro nunca
# viu — e os checksums do registro e do publicador são conferidos no fim para
# declarar, por medição, que nada foi editado para o fixer novo entrar.
#
# AS SEIS METADES (a unidade é a metade, não o arquivo):
#
#   M1 — o registro volta a ser uma LISTA (`ids` literais no lugar do
#        `idsDoCanal`). Mutação: o fixer da bancada DESAPARECE do canal —
#        é o registro à mão de volta, com o custo de sempre.
#   M2 — a exigência da CLASSE de mesmo id. Mutação: a declaração sem par some em
#        SILÊNCIO (nenhum problema nomeado), em vez de recusar a rodada.
#   M3 — a régua do DONO: o guard que não produz o patch (`remedyPatch`).
#        Mutação: o canal publica um fixer cujo medidor não existe.
#   M4 — a direção OPOSTA: o dono que SABE produzir o patch e não tem declaração
#        de canal. Mutação: ele fica fora do PR sem uma palavra.
#   M5 — o `default` ÚNICO. Mutação: dois fixers declaram `default: true` e a
#        rodada passa — o default passa a ser escolhido por ordem de arquivo.
#   M6 — o LEITOR folha com o diretório ILEGÍVEL devolvendo `[]`. Mutação: "não
#        consegui ler" vira "nenhuma declaração" e a cobertura da paridade fica
#        verde sobre um canal que não foi lido.
#
# CADA mutação é CIRÚRGICA: o injetor recusa alvo ausente (0 ou 2+ ocorrências) e
# o arquivo mutado tem de continuar com sintaxe válida. Restauração por checksum
# no mesmo trap.
#
# LIMITES DECLARADOS (o que esta prova NÃO cobre):
#   · o transporte da publicação (a API das duas forjas) é de outro assunto: aqui
#     se mede a DESCOBERTA do registro, não a publicação — quem mede o canal
#     ponta a ponta é o `prove-remedy-offer`/o pty do hook;
#   · a régua das CLASSES do pre-commit tem prova própria
#     (`remedy-classes-discovery.test.ts` + o master); esta suíte mede o PAR
#     canal × classe, e usa a classe só como a outra ponta;
#   · a mutação roda NO LUGAR no repositório: por isso ela vive no master (uma
#     matriz serial dentro de um job), e não num job ao lado de outra prova de
#     mutação — dois jobs do mesmo workflow rodariam em paralelo e um poderia ler
#     o guard mutado. A árvore é restaurada por checksum.
#
# Pipeline:
#   1. CONTROLE A: o registro do REPOSITÓRIO (sem bancada) = os arquivos
#      declarados, sem problema nenhum
#   2. CONTROLE B: a bancada com um fixer NOVO (declaração + classe + dono) entra
#      no registro SEM editar o registro — e o checksum do registro confirma
#   3. CONTROLE C: a suíte unitária está verde antes de mutar
#   4. M1..M6: cada mutação ⇒ CEGO/ACUSA medido POR EXECUÇÃO + âncoras da suíte
#   5. CONTROLE FINAL: restaurado (checksum), o registro volta e a suíte volta
#   6. Cleanup (trap EXIT — restaura os guardas e remove o temp, mesmo com falha)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|o registro volta a ser uma LISTA (ids literais no lugar do idsDoCanal)'
  'M2|a exigência da CLASSE de mesmo id (a declaração sem par some em silêncio)'
  'M3|a régua do DONO: o guard que não produz o patch (remedyPatch)'
  'M4|a direção OPOSTA: o dono que produz o patch e não tem declaração de canal'
  'M5|o `default` ÚNICO: dois fixers declarando `default: true`'
  'M6|o LEITOR folha: diretório ilegível devolvendo [] em vez de levantar'
)
cd "$SCRIPT_DIR"

GUARD="scripts/pr-fixers.mjs"
LEITOR="scripts/remedy-canal.mjs"
PUBLICADOR="scripts/pr-remedy-comment.mjs"
SUITE="src/lib/__tests__/canal-fixers-discovery.test.ts"

TMP_DIR="$(mktemp -d)"
BACKUP="$TMP_DIR/guard.backup"
BACKUP_LEITOR="$TMP_DIR/leitor.backup"
BANCADA="$TMP_DIR/bancada"
F_REGISTRO="$TMP_DIR/registro.json"
F_SUITE="$TMP_DIR/suite.txt"
export F_REGISTRO

restore() {
  if [ -f "$BACKUP" ]; then cp "$BACKUP" "$GUARD"; fi
  if [ -f "$BACKUP_LEITOR" ]; then cp "$BACKUP_LEITOR" "$LEITOR"; fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT

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

# ── A BANCADA: um repo temporário com os DOIS diretórios de declaração ────
# `outra` é o par VÁLIDO que acompanha todas as variantes: sem ele, uma variante
# que derruba a única declaração faria o canal ficar VAZIO, e a mensagem medida
# seria a do "nenhuma declaração" — que é outra regra. Com `outra` no lugar, a
# mensagem que aparece é a da metade sob teste.
#
# O dono `dono-ok.mjs` é um módulo JS com `--fix` no texto e o produtor do patch;
# o `dono-sem-patch.mjs` tem `--fix` e NÃO exporta `remedyPatch` — é o par que a
# M3 usa (a régua do dono).
montar_bancada() { # $1 = variante
  local variante="$1"
  rm -rf "$BANCADA"
  mkdir -p "$BANCADA/scripts/remedy-canal" "$BANCADA/scripts/remedy-classes"

  cat >"$BANCADA/scripts/dono-ok.mjs" <<'JS'
// o guard dono da bancada: declara --fix e produz o patch
export async function remedyPatch() {
  return null
}
JS

  cat >"$BANCADA/scripts/dono-sem-patch.mjs" <<'JS'
// o guard dono da bancada: declara --fix e NÃO produz o patch
export const FIXER = "--fix"
JS

  # `outra`: o par válido que acompanha todas as variantes (é o default do canal).
  cat >"$BANCADA/scripts/remedy-classes/outra.mjs" <<'JS'
export default {
  id: "outra",
  ordem: 10,
  script: "dono-ok.mjs",
  label: "defeito de fixture",
  verde: "o defeito sumiu",
  vermelho: "o defeito continua",
  estagio: "add",
  fixer: "node scripts/dono-ok.mjs --fix",
  sugere: () => [],
  aplicavel: () => null,
  detectar: () => ({ offenders: [], relatorio: "", violacoes: 0 }),
  aplicar: () => ({ relatorio: "" }),
}
JS
  cat >"$BANCADA/scripts/remedy-canal/outra.mjs" <<'JS'
export default {
  id: "outra",
  default: true,
  marker: "<!-- outra-remedy -->",
  gateJob: "Gate da outra",
  titulo: "outra",
  achado: (n) => `outra: ${n}`,
  naoCobre: "o resto",
  rodape: "> confira o diff",
}
JS

  # A SONDA (`sonda`): a declaração do fixer NOVO, na variante pedida.
  local dono="dono-ok.mjs"
  if [ "$variante" = "dono-sem-patch" ]; then dono="dono-sem-patch.mjs"; fi
  if [ "$variante" != "sem-classe-sonda" ]; then
    cat >"$BANCADA/scripts/remedy-classes/sonda.mjs" <<JS
export default {
  id: "sonda",
  ordem: 900,
  script: "$dono",
  label: "defeito de fixture",
  verde: "o defeito sumiu",
  vermelho: "o defeito continua",
  estagio: "add",
  fixer: "node scripts/$dono --fix",
  sugere: () => [],
  aplicavel: () => null,
  detectar: () => ({ offenders: [], relatorio: "", violacoes: 0 }),
  aplicar: () => ({ relatorio: "" }),
}
JS
  fi
  if [ "$variante" != "sem-canal-sonda" ]; then
    local padrao="false"
    if [ "$variante" = "dois-defaults" ]; then padrao="true"; fi
    cat >"$BANCADA/scripts/remedy-canal/sonda.mjs" <<JS
export default {
  id: "sonda",
  default: $padrao,
  marker: "<!-- sonda-remedy -->",
  gateJob: "Gate da sonda",
  titulo: "sonda",
  achado: (n) => \`sonda: \${n}\`,
  naoCobre: "o resto",
  rodape: "> confira o diff",
}
JS
  fi
}

# ── O DRIVER: o registro medido POR EXECUÇÃO ─────────────────────────────
# Importa o `pr-fixers.mjs` (mutado, quando há mutação) e chama `discoverFixers`
# contra a bancada. `BANCADA_JSON=null` mede o REPOSITÓRIO (sem diretórios
# injetados). O stdout é o JSON do registro — o `grep` das asserções lê ARQUIVO,
# nunca `… | grep` sob `set -o pipefail` (a classe de SIGPIPE que o repositório
# gateia).
rodar_driver() { # $1 = 1 mede a bancada, 0 mede o repositório
  local usar_bancada="$1" cfg="null"
  if [ "$usar_bancada" = "1" ]; then
    cfg="{\"canalDir\":\"$BANCADA/scripts/remedy-canal\",\"classesDir\":\"$BANCADA/scripts/remedy-classes\",\"scriptsDir\":\"$BANCADA/scripts\"}"
  fi
  GUARD_URL="file://$SCRIPT_DIR/$GUARD" BANCADA_JSON="$cfg" node --input-type=module -e '
const mod = await import(process.env.GUARD_URL)
const cfg = JSON.parse(process.env.BANCADA_JSON)
const r = await mod.discoverFixers(cfg === null ? {} : cfg)
const out = {
  ids: r.fixers.map((f) => f.id),
  ordem: r.fixers.map((f) => f.ordem),
  markers: r.fixers.map((f) => f.marker),
  comandos: r.fixers.map((f) => f.comandoFix),
  medidores: r.fixers.map((f) => typeof f.medir),
  defaults: r.fixers.filter((f) => f.default === true).map((f) => f.id),
  problemas: r.problemas,
}
process.stdout.write(JSON.stringify(out) + "\n")
' >"$F_REGISTRO" 2>"$TMP_DIR/driver.err"
}

# rodar_driver_e_checar <1|0 mede a bancada|o repositório> <trecho que TEM de estar lá>
rodar_driver_e_checar() {
  local usar="$1" trecho="$2" code=0
  rodar_driver "$usar" || code=$?
  if [ "$code" -ne 0 ]; then
    fail "a descoberta QUEBROU (exit $code) — a mutação não mediu a metade, ela derrubou o módulo"
    sed 's/^/      /' "$TMP_DIR/driver.err" | tail -5
    exit 1
  fi
  if ! grep -qF "$trecho" "$F_REGISTRO"; then
    fail "o registro medido NÃO tem '$trecho'"
    echo "      registro: $(cat "$F_REGISTRO")"
    exit 1
  fi
  pass "o registro medido tem '$trecho'"
}

# exigir_no_registro <trecho> — lê o ÚLTIMO registro medido (o driver roda uma
# vez por cenário; as asserções seguintes leem o mesmo arquivo).
exigir_no_registro() {
  local trecho="$1"
  if ! grep -qF "$trecho" "$F_REGISTRO"; then
    fail "o registro medido NÃO tem '$trecho'"
    echo "      registro: $(cat "$F_REGISTRO")"
    exit 1
  fi
  pass "'$trecho' está no registro"
}

exigir_ausente() { # <trecho> <cenário> — o registro NÃO deve conter o trecho
  local trecho="$1" cenario="$2"
  if grep -qF "$trecho" "$F_REGISTRO"; then
    fail "$cenario: o registro CONTINUA com '$trecho' — a metade mutada não é load-bearing"
    echo "      registro: $(cat "$F_REGISTRO")"
    exit 1
  fi
  pass "$cenario: '$trecho' NÃO está no registro"
}

exigir_problema() { # <trecho> <cenário>
  local trecho="$1" cenario="$2"
  if ! grep -qF "$trecho" "$F_REGISTRO"; then
    fail "$cenario: NENHUM problema com '$trecho' — a causa não foi nomeada"
    echo "      registro: $(cat "$F_REGISTRO")"
    exit 1
  fi
  pass "$cenario: o problema nomeia '$trecho'"
}

exigir_sem_problema() { # <cenário>
  local cenario="$1"
  if ! grep -qF '"problemas":[]' "$F_REGISTRO"; then
    fail "$cenario: a rodada tem PROBLEMA sem mutação — o vermelho seguinte não provaria nada"
    echo "      registro: $(cat "$F_REGISTRO")"
    exit 1
  fi
  pass "$cenario: rodada sem problema (problemas == [])"
}

# ── mutar <alvo> <troca>: substituição LITERAL, cirúrgica ─────────────────
mutar() {
  local arquivo="$1" alvo="$2" troca="$3"
  ARQUIVO="$arquivo" ALVO="$alvo" NOVO="$troca" python3 - <<'PY'
import os
p = os.environ["ARQUIVO"]
s = open(p, encoding="utf-8").read()
n = s.count(os.environ["ALVO"])
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica: {n} ocorrencia(s) do alvo (esperado 1)")
open(p, "w", encoding="utf-8").write(s.replace(os.environ["ALVO"], os.environ["NOVO"]))
PY
  if ! node --check "$arquivo" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o arquivo mutado não é válido sintaticamente."
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
  # ANSI FORA antes de julgar (o vitest colore mesmo com a saída redirecionada, e
  # uma sequência de escape no começo da linha esconderia o `FAIL`/`×`).
  sed -E $'s/\033\[[0-9;]*[a-zA-Z]//g' "$TMP_DIR/suite.bruto" >"$F_SUITE"
  FAIL_LINES="$(grep -E "^[[:space:]]*(FAIL|×)" "$F_SUITE" || true)"
}

mostrar_suite() { grep -E "^[[:space:]]*(FAIL|×)|Tests " "$F_SUITE" | sed 's/^/      /' | head -12; }

exigir_suite_verde() {
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado; o registro por execução SEGUE medindo)"
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
ANCORA_BANCADA="declaração + classe + dono na bancada: o registro o publica"
ANCORA_SEM_CLASSE="sem a CLASSE de mesmo id: fica FORA do canal e NOMEADA"
ANCORA_SEM_PATCH="a classe aponta para um dono sem \`remedyPatch\`"
ANCORA_REVERSA="o dono que SABE produzir o patch e não tem declaração de canal não some calado"
ANCORA_DOIS_DEFAULTS="DOIS \`default: true\` recusam a rodada"
ANCORA_ILEGIVEL="diretório do canal VAZIO (ou ilegível) recusa a rodada"
ANCORA_UM_DEFAULT="exatamente UM fixer declara \`default: true\`"
ANCORA_COBERTURA="a COBERTURA que o \`check-forge-parity\` lê é a mesma do registro montado"

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — a DESCOBERTA do registro do canal ($GUARD)"
echo "  ═════════════════════════════════════════════════════════════════"

cp "$GUARD" "$BACKUP"
cp "$LEITOR" "$BACKUP_LEITOR"
SOMA_INICIAL="$(cat "$GUARD" "$PUBLICADOR" "$LEITOR" | md5sum)"
pass "Backup do registro e do leitor; checksums do registro/publicador/leitor guardados"

# ── CONTROLE A — o registro do REPOSITÓRIO é o dos arquivos declarados ────
header "CONTROLE A — o repositório: o registro é o dos ARQUIVOS declarados"
declare -a IDS_DECLARADOS
for arquivo in scripts/remedy-canal/*.mjs; do
  IDS_DECLARADOS+=("$(basename "$arquivo" .mjs)")
done
rodar_driver_e_checar 0 "\"${IDS_DECLARADOS[0]}\""
exigir_sem_problema "CONTROLE A"
for id in "${IDS_DECLARADOS[@]}"; do
  exigir_no_registro "\"$id\""
done
if ! grep -qF '"defaults":["run-syntax"]' "$F_REGISTRO"; then
  fail "CONTROLE A: o default do repositório não é o esperado"
  echo "      registro: $(cat "$F_REGISTRO")"
  exit 1
fi
pass "CONTROLE A: o default é o da DECLARAÇÃO (run-syntax)"

# ── CONTROLE B — um fixer NOVO entra no canal SEM editar o registro ───────
# O coração da suíte: a bancada é um repo temporário cujo fixer o registro nunca
# viu, e ele entra com id, ordem, comando e marcador — isto é, o registro é
# DESCOBERTO, não editado.
header "CONTROLE B — o fixer NOVO da bancada entra sem editar o registro"
montar_bancada normal
rodar_driver_e_checar 1 '"sonda"'
exigir_sem_problema "CONTROLE B"
exigir_no_registro '"<!-- sonda-remedy -->"'
exigir_no_registro '"node scripts/dono-ok.mjs --fix"'
exigir_no_registro '"ordem":[10,900]'
exigir_no_registro '"medidores":["function","function"]'
pass "CONTROLE B: id, marcador, comando, ordem e medidor vêm das DECLARAÇÕES da bancada"

# ── CONTROLE C — a suíte unitária mede (verde no estado íntegro) ──────────
header "CONTROLE C — a suíte unitária está verde antes de mutar"
exigir_suite_verde "CONTROLE C"

# ── M1 — o registro volta a ser uma LISTA ────────────────────────────────
# O `idsDoCanal` (a varredura do diretório) é trocado por ids literais — o
# registro à mão, com o custo de sempre: o fixer novo da bancada DESAPARECE.
#
# A LISTA LITERAL É A DOS FIXERS REAIS DE HOJE (e é isto que mantém a mutação
# CIRÚRGICA): os literais têm de casar com o que a descoberta mediria no
# repositório — senão a mutação também apaga um fixer real, a COBERTURA da
# paridade e a consistência com o leitor folha ficam vermelhas junto, e a metade
# deixa de medir a bancada (medido: com `doc-hashes` de fora, a M1 acusou
# "a mutação derrubou TAMBÉM as outras metades"). Um fixer REAL novo entra aqui
# no mesmo commit em que entra no registro — e a suíte falha em voz alta quando
# alguém esquece, que é o que se quer.
header "M1 — o registro volta a ser uma LISTA (ids literais)"
mutar "$GUARD" 'ids = idsDoCanal({ dir: canalDir })' 'ids = ["run-syntax", "pipefail-sigpipe", "doc-hashes"] // MUTACAO M1'
pass "Mutação M1 aplicada (sintaxe válida)"
montar_bancada normal
rodar_driver 1 || { fail "M1: o driver não mediu a bancada"; exit 1; }
exigir_ausente '"sonda"' "M1 (CEGO)"
info "CEGO: o fixer novo existe no diretório e NÃO entra no canal — é o registro à mão de volta"
exigir_suite_vermelha "M1" "$ANCORA_BANCADA" "$ANCORA_UM_DEFAULT|$ANCORA_COBERTURA"
cp "$BACKUP" "$GUARD"
pass "Registro restaurado — base íntegra para a M2"

# ── M2 — a exigência da CLASSE de mesmo id ───────────────────────────────
# A declaração sem par (sem a classe que declara o dono e o comando) some em
# SILÊNCIO: nenhum problema nomeado e nenhum fixer publicado.
header "M2 — a exigência da CLASSE de mesmo id"
mutar "$GUARD" '    const classe = porId.get(id) ?? null' '    const classe = porId.get(id) ?? null
    if (!classe) continue // MUTACAO M2'
pass "Mutação M2 aplicada (sintaxe válida)"
montar_bancada sem-classe-sonda
rodar_driver 1 || { fail "M2: o driver não mediu a bancada"; exit 1; }
exigir_sem_problema "M2 (CEGO)"
exigir_ausente '"sonda"' "M2 (CEGO)"
info "CEGO: a declaração órfã não entra no canal e a rodada passa SEM nomear o que faltou"
exigir_suite_vermelha "M2" "$ANCORA_SEM_CLASSE" "$ANCORA_COBERTURA"
cp "$BACKUP" "$GUARD"
pass "Registro restaurado — base íntegra para a M3"

# ── M3 — a régua do DONO (o produtor do patch) ───────────────────────────
# O canal publica o MESMO patch que o `--fix` do dono. Sem a régua, um fixer cujo
# dono não exporta `remedyPatch` entra no registro com o medidor indefinido — e
# o comentário do PR sairia sem remendo.
header "M3 — a régua do DONO: o guard que não produz o patch"
mutar "$GUARD" '  if (classe != null && !donoProduzPatch) {' '  if (false) { // MUTACAO M3'
pass "Mutação M3 aplicada (sintaxe válida)"
montar_bancada dono-sem-patch
rodar_driver_e_checar 1 '"sonda"'
exigir_sem_problema "M3 (CEGO)"
exigir_no_registro '"medidores":["function","undefined"]'
info "CEGO: o fixer entrou no canal com o MEDIDOR indefinido (o dono não produz o patch)"
exigir_suite_vermelha "M3" "$ANCORA_SEM_PATCH" "$ANCORA_COBERTURA"
cp "$BACKUP" "$GUARD"
pass "Registro restaurado — base íntegra para a M4"

# ── M4 — a direção OPOSTA: o dono sem declaração de canal ────────────────
# O guard dono que SABE produzir o patch e não tem declaração de canal fica FORA
# do PR — e é essa a regressão que o registro à mão produzia em silêncio.
header "M4 — a direção OPOSTA: o dono que produz o patch e não tem declaração"
mutar "$GUARD" '    if (!entrada.importavel || typeof entrada.dono?.[PRODUTOR_DO_PATCH] !== "function") continue' '    if (true) continue // MUTACAO M4'
pass "Mutação M4 aplicada (sintaxe válida)"
montar_bancada sem-canal-sonda
rodar_driver 1 || { fail "M4: o driver não mediu a bancada"; exit 1; }
exigir_sem_problema "M4 (CEGO)"
exigir_ausente '"sonda"' "M4 (CEGO)"
info "CEGO: o remendo que o repositório sabe publicar ficou fora do canal sem uma palavra"
exigir_suite_vermelha "M4" "$ANCORA_REVERSA" "$ANCORA_COBERTURA"
cp "$BACKUP" "$GUARD"
pass "Registro restaurado — base íntegra para a M5"

# ── M5 — o `default` ÚNICO ───────────────────────────────────────────────
# Dois fixers declarando `default: true`: o `fixerOf()` sem argumento passaria a
# ser escolhido por ordem de arquivo (que muda entre hosts).
header "M5 — o \`default\` ÚNICO"
mutar "$GUARD" '  if (fixers.length > 0 && defaults.length !== 1) {' '  if (false) { // MUTACAO M5'
pass "Mutação M5 aplicada (sintaxe válida)"
montar_bancada dois-defaults
rodar_driver_e_checar 1 '"defaults":["outra","sonda"]'
exigir_sem_problema "M5 (CEGO)"
info "CEGO: dois fixers são o default e a rodada passa — a escolha virou ordem de arquivo"
exigir_suite_vermelha "M5" "$ANCORA_DOIS_DEFAULTS" "$ANCORA_COBERTURA"
cp "$BACKUP" "$GUARD"
pass "Registro restaurado — base íntegra para a M6"

# ── M6 — o LEITOR folha: diretório ilegível ≠ nenhuma declaração ─────────
# O `arquivosDoCanal` devolve `[]` (em vez de `null`) quando o diretório não pôde
# ser lido: o `idsDoCanal` deixa de levantar e a cobertura da paridade fica verde
# sobre um canal que NÃO FOI LIDO.
header "M6 — o LEITOR folha: diretório ilegível devolvendo []"
mutar "$LEITOR" '    return null // NÃO é []: "não consegui ler" não é "nenhuma declaração"' '    return [] // MUTACAO M6'
pass "Mutação M6 aplicada (sintaxe válida)"
set +e
LEITOR_URL="file://$SCRIPT_DIR/$LEITOR" DIR_ILEGIVEL="$SCRIPT_DIR/nao-existe" node --input-type=module -e '
const m = await import(process.env.LEITOR_URL)
const v = m.idsDoCanal({ dir: process.env.DIR_ILEGIVEL })
process.stdout.write(JSON.stringify(v) + "\n")
' >"$TMP_DIR/leitor.out" 2>&1
LEITOR_EXIT=$?
set -e
if [ "$LEITOR_EXIT" -ne 0 ]; then
  fail "M6: o leitor CONTINUA levantando com a metade mutada — a mutação não atingiu o alvo"
  sed 's/^/      /' "$TMP_DIR/leitor.out" | tail -3
  exit 1
fi
pass "M6 (CEGO, medido): o leitor devolveu '$(cat "$TMP_DIR/leitor.out")' para um diretório ILEGÍVEL — 'não consegui ler' virou 'nenhuma declaração'"
info "CEGO: quem acusa a metade é o vermelho da suíte (a cobertura da paridade passaria verde sobre um canal não lido)"
exigir_suite_vermelha "M6" "$ANCORA_ILEGIVEL" "$ANCORA_COBERTURA"
cp "$BACKUP_LEITOR" "$LEITOR"
pass "Leitor restaurado (checksum conferido abaixo)"

# ── CONTROLE FINAL — a árvore voltou ao comportamento original ────────────
header "CONTROLE FINAL — o registro restaurado volta a medir"
if ! cmp -s "$BACKUP" "$GUARD" || ! cmp -s "$BACKUP_LEITOR" "$LEITOR"; then
  fail "O registro/leitor NÃO voltou ao estado original (backup ≠ atual)."
  exit 1
fi
montar_bancada normal
rodar_driver_e_checar 1 '"sonda"'
exigir_sem_problema "CONTROLE FINAL (bancada)"
rodar_driver_e_checar 0 '"run-syntax"'
exigir_sem_problema "CONTROLE FINAL (repositório)"
if [ "$(cat "$GUARD" "$PUBLICADOR" "$LEITOR" | md5sum)" != "$SOMA_INICIAL" ]; then
  fail "o registro ou o publicador MUDOU durante a suíte — o fixer novo entrou POR EDIÇÃO, e não pela descoberta."
  exit 1
fi
pass "o registro, o publicador e o leitor estão BYTE A BYTE como começaram (o fixer novo entrou sem edição)"
exigir_suite_verde "CONTROLE FINAL"

# ── Veredito ──────────────────────────────────────────────────────────────
echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo -e "   ${GREEN}✅ MUTATION TEST PASSOU${NC} — as SEIS metades são LOAD-BEARING:"
echo "      • a VARREDURA do diretório (ids literais ⇒ o fixer novo desaparece)"
echo "      • a exigência da CLASSE de mesmo id (sem ela, a órfã some calada)"
echo "      • a régua do DONO (sem ela, publica-se um fixer sem medidor)"
echo "      • a direção OPOSTA (o dono com patch e sem declaração não some calado)"
echo "      • o \`default\` ÚNICO (sem ele, o default vira ordem de arquivo)"
echo "      • o LEITOR folha (ilegível ≠ nenhuma declaração)"
echo "      e o registro medido não foi PRODUZIDO por edição: os checksums do"
echo "      registro, do publicador e do leitor estão como começaram."
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

exit 0
