#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-hook-ci-parity.sh — Mutation test do guard de PARIDADE
# entre os hooks locais e o CI (scripts/check-hook-ci-parity.mjs)
#
# Usage:
#   ./scripts/test-mutation-hook-ci-parity.sh
#
# Exit codes:
#   0 — as OITO mutações DETECTADAS: cada uma deixa o guard VERMELHO pela
#       asserção da PRÓPRIA regra, com as regras irmãs seguindo de pé ✅
#   1 — guard CEGO (verde com alguma mutação) / falhou por outra regra / a
#       mutação não aplicou (não-cirúrgica) / a árvore não voltou ao estado
#       original / infra ❌
#
# POR QUE: o veredito LOCAL (o hook) e o do MERGE (o CI) são dados por dois
# conjuntos de comandos escritos em dois lugares. Enquanto essa duplicação for
# invisível, ela diverge em SILÊNCIO — e o sintoma é sempre o mesmo: "passou
# aqui e quebrou lá" (ou o inverso, "travou aqui e nem era o gate do CI":
# `.husky/pre-push` rodava `bunx tsc --noEmit` SEM o heap de 4GB que o script
# `typecheck` carrega — o mesmo commit estourava a memória no push e passava no
# merge, por uma régua que só o hook tinha). O guard existe para tornar essa
# diferença MEDIDA; este script prova que ele não pode ser cegado.
#
# AS SEIS REGRESSÕES (cada uma degrada em silêncio, por um caminho diferente):
#
#   A) A DIVERGÊNCIA REAL VOLTA. Os hooks trocam o comando canônico do CI por
#      uma SEGUNDA RÉGUA do mesmo instrumento (`bun run typecheck` → `bunx tsc
#      --noEmit`, nos DOIS hooks — é o estado exato que este repositório teve:
#      o heap de 4GB que o script `typecheck` carrega não existia no hook, e o
#      mesmo commit estourava a memória no push e passava no merge). Aqui a
#      detecção é DUPLA e independente: (1) o comando não é o do CI nem está
#      declarado; (2) o invariante `typecheck` do CORE deixa de rodar em
#      QUALQUER hook e não está em HOOK_NOT_RUN. Duas regras, um fato — a que
#      sobrar ainda pega.
#   B) COMANDO NOVO SEM DECISÃO. Um gate entra no hook (o que torna o veredito
#      local mais largo que o do CI) sem entrar em HOOK_DECLARED. Sem a regra,
#      o hook reprova (ou aprova) onde o merge faz o contrário.
#   C) RECORTE SEM RAZÃO ESCRITA. A declaração existe, mas o `why` some: o
#      hook mede OUTRA coisa que o CI e ninguém sabe por quê — a decisão de
#      escopo vira folclore.
#   D) DECLARAÇÃO QUE ENVELHECEU. O comando do hook muda de forma e a entrada
#      de HOOK_DECLARED continua lá, casando com nada: a decisão para de medir
#      o que ela dizia medir, e o arquivo segue parecendo auditado.
#   E) GATE DO CORE SUMIDO DA LISTA. Um invariante sai de HOOK_NOT_RUN sem
#      entrar no hook: ele passa a não rodar em lugar nenhum, em silêncio.
#   F) HOOK FANTASMA. HOOKS aponta para um arquivo que não existe: a categoria
#      inteira deixa de ser varrida e o guard sai verde sobre o que não leu.
#   G) SUB-GUARD DE UM RUNNER SEM DECISÃO LOCAL. Um runner que a pipeline chama
#      passa a executar um guard (o arquivo EXISTE): ele roda no contrato de
#      merge e o veredito local não o vê. Sem a regra 4, um gate entra por
#      dentro de um `.sh` — invisível para a conta dos comandos das pipelines.
#   H) A DESCIDA DO LADO LOCAL CEGA. A bateria local deixa de descer nos runners
#      que o hook chama: os guards que o `check-utf8.sh` executa por dentro
#      (o `check_utf8.py` e o `.mjs`) perdem a decisão local e passam a figurar
#      como ausência não declarada. Prova que a descida é LOAD-BEARING nas duas
#      metades — e não só que "medir o caminho do runner" é barato.
#
# COMO: mutações IN-PLACE nos arquivos REAIS (backup + trap de restauração —
# NUNCA `git checkout`), no mesmo desenho dos outros `test-mutation-*.sh` deste
# repositório. É IN-PLACE de propósito: o guard lê o worktree (é o objeto do
# veredito), e uma cópia em temp mediria outro repositório.
#
#   CONTROLE — árvore íntegra → guard VERDE (exit 0) e as 5 métricas base
#     (violações=0, linhas do relatório, HOOK_NOT_RUN, CORE sem cobertura);
#   MUTAÇÃO — guard VERMELHO (exit 1) com EXATAMENTE o número de violações
#     esperado, CADA uma nomeando o que a regra acusa, e as métricas irmãs
#     conferidas (as linhas do relatório NÃO podem encolher: um guard que
#     aborta cedo também "falha", só que por não ter medido).
#
# RESTAURAÇÃO PROVADA: cada arquivo tocado é restaurado no trap E conferido por
# `cksum` contra o hash capturado no início. Um mutation test que deixa a
# árvore suja (ou que se declara verde sem ter restaurado) é pior que nenhum.
#
#   I) A CLASSE DO ALVO NA DESCIDA. A injeção é da ÁRVORE: um runner de shell
#      SEM sufixo `.sh`, chamado pela pipeline, executando um guard sem decisão
#      local. Com a régua da CLASSE (a do `check-hook-commands`) ele entra no
#      julgamento e o sub-guard é NOMEADO; com a leitura por FORMA
#      (`alvo.endsWith(".sh")`) o MESMO defeito passa verde. As duas metades são
#      medidas na mesma rodada: a classe é o que sustenta o vermelho.
#
# ⚠️ Source-coupled: os sed ancoram em LINHAS dos arquivos reais e as mensagens
# reproduzem a saída do guard. Reformular a mensagem em
# scripts/check-hook-ci-parity.mjs exige atualizar as duas coisas juntas (o
# sintoma é "falhou, mas não pela asserção esperada" — não é guard cego).
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

# ── A PROVA-DE-APLICAÇÃO: a régua ÚNICA (`scripts/mutacao-prova.sh`) ────────
# As mutações desta suíte trocam código de arquivos da ÁRVORE (os hooks, o guard
# da paridade, o runner da pipeline e o workflow). A troca é da régua única, que
# traz juntas a CIRURGIA (o alvo casa UMA vez), o MARCADOR (`MUTACAO` no payload,
# a prova de que a escrita entrou) e o CONTEÚDO (o checksum mudou) — uma cópia
# privada que sumisse não deixava rastro, e a suíte seguiria verde medindo o
# arquivo ÍNTEGRO.
#
# O CAMINHO DECLARADO (`mutacao_aplicar_sem_marcador`) é o dos payloads que são
# uma linha de HOOK ou de YAML: o guard da paridade lê esse texto CRU, então um
# comentário de marcador entraria no comando MEDIDO. O mesmo motivo vai escrito
# na chamada e declarado em `SEM_MARCADOR` (master).
MOTIVO_SEM_MARCADOR='o payload é uma linha de HOOK/YAML lida CRUA pelo guard da paridade: um comentário de marcador entraria no texto medido'
# shellcheck disable=SC1091
. "$SCRIPT_DIR/scripts/mutacao-prova.sh"

# mutar <arquivo> <antes> <depois>: o caminho ESTRITO (o payload carrega o
# marcador) + a sintaxe do alvo — todos os alvos deste caminho são módulos `.mjs`.
mutar() {
  mutacao_aplicar "$1" "$2" "$3" "$(cksum <"$1" | cut -d' ' -f1)"
  mutacao_sintaxe_node "$1"
}

# sem_marcador <arquivo> <antes> <depois>: o caminho DECLARADO — as MESMAS provas
# de cirurgia e conteúdo, e a dispensa do marcador POR ESCRITO (o motivo acima).
sem_marcador() {
  mutacao_aplicar_sem_marcador "$1" "$2" "$3" "$(cksum <"$1" | cut -d' ' -f1)" \
    "$MOTIVO_SEM_MARCADOR"
}

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'A|a divergência REAL volta (segunda régua do typecheck)'
  'B|comando novo no hook sem decisão'
  'C|recorte sem razão escrita'
  'D|declaração que envelheceu'
  'E|gate do CORE fora do hook e fora de HOOK_NOT_RUN'
  'F|hook declarado que não existe (fail-closed)'
  'G|sub-guard de um runner sem decisão local'
  'H|a descida do lado LOCAL cega'
  'I|a CLASSE do alvo na descida (o runner SEM sufixo `.sh`)'
)
cd "$SCRIPT_DIR"

GUARD="scripts/check-hook-ci-parity.mjs"
PRE_COMMIT=".husky/pre-commit"
PRE_PUSH=".husky/pre-push"
MARKER_FILE="scripts/check-hook-ci-parity.mjs"
# Um runner que as DUAS pipelines chamam (a mutação G injeta um sub-guard dentro
# dele) e o arquivo-sonda que a mutação G faz existir (o guard só julga arquivo
# que existe: um caminho citado e ausente não é sub-guard, é typo).
RUNNER_PIPELINE="scripts/setup-bun-ci.sh"
SONDA="scripts/check-subguard-sonda.mjs"
# A metade I injeta o caso que a leitura por FORMA não via: um runner de shell
# SEM sufixo `.sh`, chamado pela pipeline, executando um guard sem decisão local.
PIPELINE_WORKFLOW=".github/workflows/pr-check.yml"
RUNNER_SEM_SUFIXO="scripts/runner-sem-sufixo"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"
BACKUP="$TMP_DIR/orig"
mkdir -p "$BACKUP"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }
header() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

# ── Backup + hash de origem (a restauração é PROVADA, não prometida) ──────

TRACKED=("$GUARD" "$PRE_COMMIT" "$PRE_PUSH" "$RUNNER_PIPELINE" "$PIPELINE_WORKFLOW")
declare -a ORIG_HASH=()

for f in "${TRACKED[@]}"; do
  mkdir -p "$BACKUP/$(dirname "$f")"
  cp -p "$f" "$BACKUP/$f"
  ORIG_HASH+=("$(cksum <"$f")")
done

restore() {
  for f in "${TRACKED[@]}"; do
    cp -p "$BACKUP/$f" "$f"
  done
  rm -f "$SONDA"
  rm -f "$RUNNER_SEM_SUFIXO"
}

verify_restored() {
  local i=0
  for f in "${TRACKED[@]}"; do
    if [ "$(cksum <"$f")" != "${ORIG_HASH[$i]}" ]; then
      return 1
    fi
    i=$((i + 1))
  done
  # A sonda da mutação G não pode sobreviver: um arquivo novo na árvore é
  # exatamente o tipo de lixo que um mutation test deixa e ninguém vê.
  if [ -e "$SONDA" ]; then
    return 1
  fi
  # Nem o runner sem sufixo da metade I (mesma classe de lixo).
  if [ -e "$RUNNER_SEM_SUFIXO" ]; then
    return 1
  fi
  return 0
}

cleanup() {
  restore
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── Harness ──────────────────────────────────────────────────────────────

JSON_OUT="$TMP_DIR/out.json"
VIOLATIONS="$TMP_DIR/violations.txt"
GUARD_EXIT=0

run_guard() {
  set +e
  node "$GUARD" --json >"$JSON_OUT" 2>"$TMP_DIR/err.txt"
  GUARD_EXIT=$?
  set -e
  node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    fs.writeFileSync(process.argv[2], j.violations.join("\n") + "\n")
    console.log(
      [j.violations.length, j.rows.length, j.notRun.length, j.missing.length].join("|"),
    )
  ' "$JSON_OUT" "$VIOLATIONS" >"$TMP_DIR/metrics.txt" 2>/dev/null || true
}

# summary <label>: ecoa "violacoes|linhas|notRun|missing"
summary() {
  local out
  out="$(cat "$TMP_DIR/metrics.txt")"
  echo "$out"
}

# violated <substring>: 0 se a violação estiver na lista
violated() {
  grep -Fq "$1" "$VIOLATIONS"
}

# assert_exit <esperado> <rótulo> — fail-fast com o output cru no diagnóstico
assert_exit() {
  if [ "$GUARD_EXIT" -ne "$1" ]; then
    fail "$2: exit=$GUARD_EXIT (esperado $1)"
    sed 's/^/      /' "$TMP_DIR/err.txt" | head -8
    exit 1
  fi
}

# assert_violations <n> <rótulo> — o número EXATO (cirurgia, não "qualquer vermelho")
assert_violations() {
  local n
  n="$(node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    console.log(j.violations.length)
  ' "$JSON_OUT")"
  if [ "$n" -ne "$1" ]; then
    fail "$2: $n violações (esperado $1)"
    sed 's/^/      /' "$VIOLATIONS" | head -8
    exit 1
  fi
}

# assert_intact_rows <n> <rótulo> — o relatório NÃO pode encolher (medir × abortar)
assert_intact_rows() {
  local rows
  rows="$(node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    console.log(j.rows.length)
  ' "$JSON_OUT")"
  if [ "$rows" -ne "$1" ]; then
    fail "$2: o relatório tem $rows linhas (esperado $1) — o guard parou de medir comandos"
    exit 1
  fi
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-hook-ci-parity deve ACENDER)"
echo "  ═════════════════════════════════════════════════════════════════"

# ═════════════════════════════════════════════════════════════════════════
# CONTROLE — a árvore íntegra é VERDE, e as métricas base são capturadas
# ═════════════════════════════════════════════════════════════════════════

header "CONTROLE: hooks + guard íntegros → verde (as métricas base)"

run_guard
assert_exit 0 "CONTROLE"
CONTROL_METRICS="$(summary)"
BASE_ROWS="$(node -e '
  const fs = require("node:fs")
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  console.log(j.rows.length)
' "$JSON_OUT")"
BASE_NOT_RUN="$(node -e '
  const fs = require("node:fs")
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  console.log(j.notRun.length)
' "$JSON_OUT")"
pass "controle verde (exit 0) — violações|linhas|notRun|missing = $CONTROL_METRICS"

# ── MUTAÇÃO A — a divergência REAL volta (segunda régua do typecheck) ────

header "MUTAÇÃO A: os hooks voltam a rodar \`bunx tsc --noEmit\` (segunda régua)"
# O alvo é a LINHA DE COMANDO (o comentário do hook que CITA `bun run typecheck`
# fica onde está: o guard ignora comentário, e ele não faz parte da paridade).
ANTES_TYPECHECK=$'\nbun run typecheck\n'
DEPOIS_TYPECHECK=$'\nbunx tsc --noEmit\n'
sem_marcador "$PRE_PUSH" "$ANTES_TYPECHECK" "$DEPOIS_TYPECHECK"
sem_marcador "$PRE_COMMIT" "$ANTES_TYPECHECK" "$DEPOIS_TYPECHECK"
run_guard
assert_exit 1 "MUTAÇÃO A"
assert_violations 2 "MUTAÇÃO A"
if ! violated 'bunx tsc --noEmit'; then
  fail "mutação A: o guard não nomeou o comando divergente"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
if ! violated "invariante do CORE 'typecheck' nao roda em nenhum hook"; then
  fail "mutação A: a segunda metade (o CORE perdeu o gate do hook) não acendeu"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO A"
pass "A DETECTADA (exit 1, 2 violações): comando divergente E o invariante 'typecheck' sem hook"
pass "  (as $BASE_ROWS linhas do relatório seguem: o guard mediu, não abortou)"
restore

# ── MUTAÇÃO B — comando novo no hook sem decisão ────────────────────────

header "MUTAÇÃO B: gate novo no pre-commit sem entrada em HOOK_DECLARED"
# O comando novo entra no FIM do hook: o `antes` é o rabo do arquivo, e a régua
# cobra que a troca entrou (o CONTEÚDO mudou) — o `>>` de antes não provava nada.
ANTES_FIM_PRECOMMIT=$'  bun test:snapshots\nfi\n'
sem_marcador "$PRE_COMMIT" "$ANTES_FIM_PRECOMMIT" \
  "$ANTES_FIM_PRECOMMIT"$'\nnode scripts/check-ghost-guard.mjs &\n'
run_guard
assert_exit 1 "MUTAÇÃO B"
assert_violations 1 "MUTAÇÃO B"
if ! violated 'check-ghost-guard.mjs'; then
  fail "mutação B: o guard não nomeou o comando novo"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
if ! violated 'NAO DECLARADO'; then
  fail "mutação B: o guard acusou outro motivo em vez de 'NAO DECLARADO'"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$((BASE_ROWS + 1))" "MUTAÇÃO B"
pass "B DETECTADA (exit 1, 1 violação): o comando novo é nomeado e exige decisão escrita"
restore

# ── MUTAÇÃO C — recorte sem razão escrita ───────────────────────────────

header "MUTAÇÃO C: recorte declarado com o 'why' esvaziado"
mutar "$GUARD" \
  '    why: "recorte --staged: a ARVORE de trabalho pode carregar WIP que NAO faz parte deste commit; o indice e o conteudo do commit. O CI roda o comando inteiro sobre o conteudo mergeado — a diferenca e de ESCOPO, e o comando (mesmo script, mesmos argumentos obrigatorios) e o do CI.",' \
  '    why: "curto", // MUTACAO C: o `why` do recorte esvaziado'
run_guard
assert_exit 1 "MUTAÇÃO C"
assert_violations 1 "MUTAÇÃO C"
if ! violated "SEM razao escrita"; then
  fail "mutação C: o guard não cobrou a razão escrita"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO C"
if ! node -e '
  const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
  const row = j.rows.find((r) => r.cmd.includes("check-bun-mirror.mjs --staged"))
  process.exit(row && row.status === "recorte" ? 0 : 1)
' "$JSON_OUT"; then
  fail "mutação C: a linha virou outro estado — a checagem de INSTRUMENTO (irmã) caiu junto"
  exit 1
fi
pass "C DETECTADA (exit 1, 1 violação): razão exigida, e o recorte segue reconhecido como"
pass "  o MESMO instrumento do canônico (a outra metade da regra não morreu)"
restore

# ── MUTAÇÃO D — declaração que envelheceu ───────────────────────────────

header "MUTAÇÃO D: entrada de HOOK_DECLARED que não casa com comando nenhum"
mutar "$GUARD" \
  '    match: /^bun run fuzz$/,' \
  '    match: /^bun run fuzz-que-nao-existe$/, // MUTACAO D: a declaração que envelheceu'
run_guard
assert_exit 1 "MUTAÇÃO D"
assert_violations 2 "MUTAÇÃO D"
if ! violated 'entrada de HOOK_DECLARED que NAO casa com nenhum comando'; then
  fail "mutação D: o guard não acusou a declaração stale"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
if ! violated 'bun run fuzz'; then
  fail "mutação D: o comando que perdeu a declaração não foi nomeado"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO D"
pass "D DETECTADA (exit 1, 2 violações): a declaração stale E o comando que ficou sem decisão"
restore

# ── MUTAÇÃO E — gate do CORE fora do hook e fora de HOOK_NOT_RUN ────────

header "MUTAÇÃO E: invariante do CORE removido de HOOK_NOT_RUN"
mutar "$GUARD" '    ids: ["merge-latency"],' \
  '    ids: [], // MUTACAO E: o gate do CORE fora de HOOK_NOT_RUN'
run_guard
assert_exit 1 "MUTAÇÃO E"
assert_violations 1 "MUTAÇÃO E"
if ! violated "invariante do CORE 'merge-latency' nao roda em nenhum hook"; then
  fail "mutação E: o gate sumido não foi nomeado"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
if [ "$(node -e '
  const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
  console.log(j.missing.join(","))
' "$JSON_OUT")" != "merge-latency" ]; then
  fail "mutação E: 'missing' não isolou o invariante removido"
  exit 1
fi
if [ "$(node -e '
  const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
  console.log(j.notRun.length)
' "$JSON_OUT")" -ne "$((BASE_NOT_RUN - 1))" ]; then
  fail "mutação E: a lista de HOOK_NOT_RUN não encolheu exatamente 1"
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO E"
pass "E DETECTADA (exit 1, 1 violação): um gate do contrato de merge não pode sumir sem decisão"
restore

# ── MUTAÇÃO F — hook declarado que não existe (fail-closed) ─────────────

header "MUTAÇÃO F: HOOKS aponta para um arquivo de hook inexistente"
mutar "$GUARD" \
  'export const HOOKS = [".husky/pre-commit", ".husky/pre-push"]' \
  'export const HOOKS = [".husky/pre-commit", ".husky/pre-push", ".husky/pre-ghost"] // MUTACAO F: o hook declarado que não existe'
run_guard
assert_exit 1 "MUTAÇÃO F"
assert_violations 1 "MUTAÇÃO F"
if ! violated 'hook declarado nao existe'; then
  fail "mutação F: o hook fantasma não foi acusado"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO F"
pass "F DETECTADA (exit 1, 1 violação): fail-closed — não se varre o que não se leu"
restore

# ── MUTAÇÃO G — sub-guard de um runner sem decisão local ────────────────

header "MUTAÇÃO G: um runner da pipeline passa a executar um guard sem decisão local"
# A sonda é um arquivo NOVO (criação não é troca: a régua exige alvo existente e
# não se aplica aqui); a chamada dela entra no runner pela régua, com o rabo do
# arquivo como `antes`. Comentário de marcador não cabe: o guard lê a linha CRUA.
printf '// sonda da mutação G: o guard existe para ser ALCANÇADO e ficar sem decisão\nprocess.exit(0)\n' >"$SONDA"
ANTES_FIM_RUNNER=$'echo "::endgroup::"\n\nadd_to_path\n'
sem_marcador "$RUNNER_PIPELINE" "$ANTES_FIM_RUNNER" \
  "$ANTES_FIM_RUNNER"$'\nnode scripts/check-subguard-sonda.mjs\n'
run_guard
assert_exit 1 "MUTAÇÃO G"
assert_violations 1 "MUTAÇÃO G"
if ! violated "scripts/check-subguard-sonda.mjs: SUB-GUARD do runner"; then
  fail "mutação G: o sub-guard não foi nomeado como SUB-GUARD de runner"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
if ! violated "scripts/setup-bun-ci.sh" || ! violated "bash scripts/setup-bun-ci.sh"; then
  fail "mutação G: a violação não nomeia o runner nem o comando do CI que o chama"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO G"
pass "G DETECTADA (exit 1, 1 violação): o sub-guard do runner exige DECISÃO LOCAL"
pass "  (e a violação diz de qual runner ele veio e qual comando do CI o executa)"
restore

# ── MUTAÇÃO H — a descida do lado LOCAL cega ───────────────────────────

header "MUTAÇÃO H: a bateria local deixa de descer nos runners que o hook chama"
mutar "$GUARD" '  const descida = descendScripts(root, [...new Set(raizes)])' \
  '  const descida = { alcancados: new Map(), limites: [] } // MUTACAO H: a descida do lado local cega'
run_guard
assert_exit 1 "MUTAÇÃO H"
assert_violations 2 "MUTAÇÃO H"
if ! violated "scripts/check_utf8.py: SUB-GUARD do runner" || ! violated "scripts/check_utf8.mjs: SUB-GUARD do runner"; then
  fail "mutação H: os dois sub-guards do check-utf8.sh não acenderam"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
# A prova da metade local, pelo DADO e não pela prosa: nenhuma decisão que venha
# da DESCIDA do hook sobrevive, e a bateria local deixou de listar os dois
# arquivos. As decisões "executado direto por .husky/pre-commit" NÃO dependem da
# descida (o hook executa aqueles três na linha) e por isso seguem de pé — é
# exatamente essa a metade que a mutação tira.
if [ "$(node -e '
  const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
  console.log(j.subguards.filter((s) => (s.decision ?? "").startsWith("pelo runner")).length)
' "$JSON_OUT")" -ne "0" ]; then
  fail "mutação H: ainda há sub-guard decidido PELA DESCIDA do hook — a mutação não cegou a descida"
  exit 1
fi
if [ "$(node -e '
  const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
  console.log(j.bateriaLocal.arquivos.filter((a) => a.startsWith("scripts/check_utf8.")).length)
' "$JSON_OUT")" -ne "0" ]; then
  fail "mutação H: a bateria local ainda alcanca os dois — o hook nao perdeu a decisao"
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO H"
pass "H DETECTADA (exit 1, 2 violações): a descida do lado local e LOAD-BEARING"
pass "  (sem ela o hook 'nao roda' o que ele roda de dentro — e o guard acusa os dois)"
restore

# ── MUTAÇÃO I — a CLASSE do alvo na descida (o runner SEM sufixo) ────────

header "MUTAÇÃO I: a CLASSE do alvo na descida (o runner SEM sufixo .sh)"

# A INJEÇÃO é da ÁRVORE, e não do guard: um runner de shell SEM sufixo `.sh`,
# chamado pela PIPELINE, executando um guard que não tem decisão local nenhuma.
# É o caso que a leitura por FORMA (`alvo.endsWith(".sh")`) não via — nem como
# runner, nem como limite, nem como sub-guard.
printf '#!/usr/bin/env bash\nset -eu\nnode scripts/check-subguard-sonda.mjs\n' >"$RUNNER_SEM_SUFIXO"
printf '// sonda da mutação I: o sub-guard que o runner SEM sufixo executa\nprocess.exit(0)\n' >"$SONDA"
# O passo entra no FIM do workflow pela régua (o YAML é lido CRU pelo guard, então
# o payload não comporta marcador — caminho declarado, como nos hooks).
ANTES_FIM_WORKFLOW=$'        run: echo "✅ Nenhum payload cross-user expõe credencial/PII; client do Prisma com fonte única; gate comprovadamente sensível a regressão."\n'
sem_marcador "$PIPELINE_WORKFLOW" "$ANTES_FIM_WORKFLOW" \
  "$ANTES_FIM_WORKFLOW"$'\n      - name: Runner sem sufixo (mutação I)\n        run: bash scripts/runner-sem-sufixo\n'
run_guard
assert_exit 1 "MUTAÇÃO I"
assert_violations 1 "MUTAÇÃO I"
if ! violated "scripts/check-subguard-sonda.mjs: SUB-GUARD do runner"; then
  fail "mutação I: o sub-guard do runner SEM sufixo não foi julgado"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
if ! violated 'scripts/runner-sem-sufixo'; then
  fail "mutação I: a violação não nomeia o runner sem sufixo"
  sed 's/^/      /' "$VIOLATIONS" | head -6
  exit 1
fi
assert_intact_rows "$BASE_ROWS" "MUTAÇÃO I"
pass "I DETECTADA (exit 1, 1 violação): o runner SEM sufixo entra no julgamento"
pass "  (a classe do alvo diz quem desce — o sufixo não)"
restore

# A METADE OPOSTA — a leitura por FORMA de volta no guard (o MESMO defeito na
# árvore): o runner sem sufixo sai da conta e o sub-guard que ele executa passa
# INVISÍVEL. O corte é cirúrgico (as duas linhas da classe viram o filtro de
# forma) e falha ALTO se não casar — uma mutação que não aplicou não mede nada.
printf '#!/usr/bin/env bash\nset -eu\nnode scripts/check-subguard-sonda.mjs\n' >"$RUNNER_SEM_SUFIXO"
printf '// sonda da metade oposta I: o sub-guard que o runner SEM sufixo executa\nprocess.exit(0)\n' >"$SONDA"
sem_marcador "$PIPELINE_WORKFLOW" "$ANTES_FIM_WORKFLOW" \
  "$ANTES_FIM_WORKFLOW"$'\n      - name: Runner sem sufixo (mutação I)\n        run: bash scripts/runner-sem-sufixo\n'
# O corte é cirúrgico e pela régua: as DUAS linhas da CLASSE viram o filtro de
# FORMA, com o marcador da metade no payload.
mutar "$GUARD" \
  '      const r = alvoDoLancador(comando)
      const provavel = r.ok ? alvosProvaveis(comando, vars) : { ok: false, motivo: r.motivo }' \
  '      if (!(comando.tokens[0] ?? "").endsWith(".sh")) continue // MUTACAO I: a leitura por FORMA de volta
      const provavel = alvosProvaveis(comando, vars)'
run_guard
assert_exit 0 "MUTAÇÃO I (leitura por forma)"
if violated "scripts/check-subguard-sonda.mjs"; then
  fail "mutação I (forma): o sub-guard foi acusado — a metade oposta não mediu o que devia"
  exit 1
fi
pass "I (metade oposta) com a leitura por FORMA o MESMO defeito passa VERDE: a CLASSE é LOAD-BEARING"
pass "  (o sub-guard do runner sem sufixo sai da conta e nenhum limite o substitui)"
restore

# ═════════════════════════════════════════════════════════════════════════
# RESTAURAÇÃO — hashes idênticos aos do início (a árvore volta limpa)
# ═════════════════════════════════════════════════════════════════════════

header "RESTAURAÇÃO"

if ! verify_restored; then
  fail "a árvore NÃO voltou ao estado original — mutation test deixou lixo"
  exit 1
fi
pass "os ${#TRACKED[@]} arquivos tocados voltaram ao hash de origem (cksum idêntico)"

run_guard
assert_exit 0 "PÓS-RESTAURAÇÃO"
pass "guard verde de novo (exit 0) — a mutação foi 100% do harness, não da árvore"

header "VEREDITO"
pass "MUTATION TEST PASSED — as 9 regressões do veredito local↔CI são detectadas:"
pass "  A) segunda régua no hook (detecção DUPLA: comando + cobertura do CORE)"
pass "  B) comando novo sem decisão   C) recorte sem razão escrita"
pass "  D) declaração que envelheceu   E) gate do CORE sumido da lista"
pass "  F) hook fantasma (fail-closed)"
pass "  G) sub-guard de um runner sem decisão local"
pass "  H) a descida do lado local cega (os sub-guards do check-utf8.sh acusam)"
pass "  I) a CLASSE do alvo na descida (a leitura por FORMA deixa o runner sem sufixo cego)"
echo ""
exit 0
