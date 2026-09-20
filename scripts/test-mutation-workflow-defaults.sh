#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-workflow-defaults.sh — Mutation test da leitura de
# `defaults: run: shell:` nos guards que leem YAML de workflow
#
# Usage:
#   ./scripts/test-mutation-workflow-defaults.sh
#
# Exit codes:
#   0 — as SEIS mutações DETECTADAS (D desdobrada em D1/D2): cada uma deixa um
#       guard VERMELHO pela asserção da PRÓPRIA regra, com as regras irmãs
#       seguindo de pé ✅
#   1 — guard CEGO (verde com a mutação) / falhou por outra regra / a mutação
#       não aplicou (não-cirúrgica) / a árvore não voltou ao original / infra ❌
#
# POR QUE: `defaults:` declara o shell do escopo — e NÃO é um passo. A forma
# legal em bloco (`defaults:\n  run:\n    shell: bash`) é a única de onde o
# repositório troca a premissa do shell do runner numa linha, sem que nenhum
# passo mude no diff; a forma escalar (`defaults:\n  run: <comando>`) é o que um
# scanner de `run:` por regex lê como COMANDO. Sem uma leitura única disso, cada
# guard de workflow constrói o próprio passo FANTASMA — e o pior caso não é o
# ruído, é o gate FALSO:
#
#   `defaults:\n  run: node scripts/check-x.mjs` fazia o guard de paridade
#   achar que a pipeline rodava um gate que ela não roda, e o doctor aceitar a
#   DECLARAÇÃO de shell como o comando do job de merge (o veredito de
#   prontidão para bloquear o merge saindo de uma linha que nada executa).
#
# AS SEIS REGRESSÕES (cada uma degrada em silêncio, por um caminho diferente):
#
#   A) A LEITURA COMPARTILHADA PARA DE LER. `defaultsRunLines` devolve vazio: a
#      declaração volta a ser passo para TODOS os guards de uma vez — o
#      contrato de merge passa a ser satisfeito por uma declaração de shell.
#   B) A LEITURA EXISTE E O GUARD NÃO A CONSULTA. `runCommands`/`discoverGates`
#      voltam a ler todas as linhas de `run:`: a leitura certa num módulo não
#      protege um guard que não a chama.
#   C) O DOCTOR NÃO PULA A DECLARAÇÃO. `firstRunLine`/`gateRunLine` aceitam a
#      linha de `defaults.run` como o comando do job: o contrato "o job roda o
#      comando esperado" é satisfeito sem que o job rode nada.
#   D1) O GUARD DE REFS VOLTA A LER A DECLARAÇÃO. `extractScriptRefs` conta a
#       ref da declaração: validação de um script que a pipeline nunca executa.
#       O CONTROLE desta metade prova onde mora a imunidade do
#       `extractWorkflowRunRefs`: ele NÃO tem pulo próprio (a régua compartilhada
#       é que não reconhece declaração como passo), então remover o pulo do
#       vizinho não o contamina.
#   D2) A RÉGUA DE PASSO DEIXA DE EXIGIR ITEM DE LISTA. Mutar a régua em
#       `workflowRunBodies` faz a declaração virar passo para quem a consome —
#       e `extractWorkflowRunRefs` passa a contar a ref fantasma como COBERTURA
#       de mutation test. Era a única forma de medir essa metade depois que o
#       skip local do guard morreu na unificação.
#   E) A LEITURA SÓ VÊ O ESCOPO DO ARQUIVO. A declaração do JOB (`defaults:`
#      dentro do job) volta a virar passo — a metade que a leitura precisa
#      cobrir é a que opera a forja escreve.
#
# COMO: o julgamento é o CLI REAL do guard contra um FIXTURE (`--root`), como no
# test-mutation-pipefail-sigpipe.sh — não uma sondagem de função pura. O fixture
# é GERADO a partir das invariantes do CORE (`canonicalCommandOf`), de modo que a
# árvore de controle é VERDE de verdade: a única diferença entre o verde e o
# vermelho é a linha proibida e a mutação.
#
# A mutação é IN-PLACE nos arquivos REAIS (backup + trap de restauração — nunca
# `git checkout`), porque é o módulo real que os guards importam: um mutante
# numa cópia mediria outro guard.
#
# RESTAURAÇÃO PROVADA: cada arquivo tocado é restaurado no trap E conferido por
# `cksum` contra o hash capturado no início.
#
# ⚠️ Source-coupled: as mutações ancoram em LINHAS dos arquivos reais e as
# asserções reproduzem a saída dos guards. Reformular uma mensagem exige
# atualizar as duas coisas juntas (o sintoma é "falhou, mas não pela asserção
# esperada" — não é guard cego).
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

PARITY="scripts/check-forge-parity.mjs"
WORKFLOWS="scripts/forge-workflows.mjs"
DOCTOR="scripts/forge-doctor.mjs"
# NÃO há backup de `check-mutation-jobs.mjs` aqui de propósito: desde a
# unificação ele não tem pulo próprio da declaração (a imunidade dele é a régua
# compartilhada), e é justamente isso que o CONTROLE da D1 prende. Um arquivo no
# backup que nunca é mutado faria a mensagem final mentir sobre o que foi tocado.
WORKFLOW_REFS="scripts/check-workflow-refs.mjs"

TMP_DIR="$(mktemp -d)"
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

TRACKED=("$PARITY" "$WORKFLOWS" "$DOCTOR" "$WORKFLOW_REFS")
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
}

verify_restored() {
  local i=0
  for f in "${TRACKED[@]}"; do
    if [ "$(cksum <"$f")" != "${ORIG_HASH[$i]}" ]; then
      return 1
    fi
    i=$((i + 1))
  done
  return 0
}

cleanup() {
  local code=$?
  restore
  if ! verify_restored; then
    echo -e "${RED}❌ RESTAURAÇÃO FALHOU — a árvore ficou suja. Restaure à mão a partir de $BACKUP${NC}"
    exit 1
  fi
  rm -rf "$TMP_DIR"
  exit "$code"
}
trap cleanup EXIT

# ── Ferramentas ───────────────────────────────────────────────────────────

# `mutar <arquivo> <alvo-literal> <substituto> [ocorrências]` — substituição
# LITERAL (sem regex), recusando alvo ausente ou com contagem diferente da
# esperada: mutação não-cirúrgica não mede nada. A contagem é EXPLÍCITA quando o
# mesmo literal vive em mais de um call site (ex.: `runCommands` E
# `discoverGates` consultam a leitura): mutar metade deixaria a outra metade
# protegendo o guard, e o caso passaria por cirurgia, não por leitura.
mutar() {
  MUT_FILE="$1" MUT_OLD="$2" MUT_NEW="$3" MUT_COUNT="${4:-1}" python3 - <<'PY'
import os
p = os.environ["MUT_FILE"]
old, new = os.environ["MUT_OLD"], os.environ["MUT_NEW"]
esperado = int(os.environ["MUT_COUNT"])
s = open(p).read()
n = s.count(old)
if n != esperado:
    raise SystemExit(f"mutacao nao-cirurgica em {p}: {n} ocorrencia(s) do alvo (esperado {esperado})")
open(p, "w").write(s.replace(old, new))
PY
  if ! grep -qF 'MUTACAO' "$1"; then
    fail "a mutação não aplicou em $1 (nada a medir)"
    exit 1
  fi
}

# `paridade <raiz-do-fixture> <saida>` → exit code do GUARD real contra o fixture.
paridade() {
  local root="$1" out="$2" code=0
  node "$PARITY" --root "$root" >"$out" 2>&1 || code=$?
  return "$code"
}

# `inventario <raiz> <saida>` → o que o guard ENXERGA (modo --gates).
inventario() {
  node "$PARITY" --root "$1" --gates >"$2" 2>&1
}

# `extratores <workflow> <fatia-de-job> <saida> [rotulo]` → o que os OUTROS guards
# veem, por EXECUÇÃO das funções que decidem (o CLI deles pede a árvore inteira).
# O rótulo é o que o doctor procura dentro do job (`gateRunLine`) — passa-se um
# que está NA declaração de propósito: é o par (controle = null, mutação = achado)
# que prova que a linha foi pulada, e não que o rótulo não existia.
extratores() {
  WF_PATH="$1" JOB_PATH="$2" GUARDS_DIR="$SCRIPT_DIR/scripts" LABEL="${4:-guardas}" node --input-type=module -e '
    import { readFileSync } from "node:fs"
    const S = process.env.GUARDS_DIR
    const wf = readFileSync(process.env.WF_PATH, "utf8")
    const job = readFileSync(process.env.JOB_PATH, "utf8")
    const { runCommands, discoverGates } = await import(`${S}/check-forge-parity.mjs`)
    const { extractScriptRefs, extractPkgScriptRefs } = await import(`${S}/check-workflow-refs.mjs`)
    const { extractWorkflowRunRefs } = await import(`${S}/check-mutation-jobs.mjs`)
    const { firstRunLine, gateRunLine } = await import(`${S}/forge-doctor.mjs`)
    const linhas = job.split(/\r?\n/)
    console.log(JSON.stringify({
      comandos: runCommands(wf),
      gates: discoverGates(wf),
      scriptRefs: extractScriptRefs(wf).map((r) => r.ref),
      pkgRefs: extractPkgScriptRefs(wf).map((r) => r.ref),
      mutationRefs: extractWorkflowRunRefs(wf, {}),
      primeiraRun: firstRunLine(linhas),
      runPorRotulo: gateRunLine(linhas, process.env.LABEL),
    }))
  ' >"$3"
}

# `gerar_fixture <raiz> <variante>` — pipeline VERDE por construção: um passo por
# invariante do CORE, com o comando CANÔNICO, nas duas pipelines.
#   variante `legal`  → `defaults: run: shell: bash` (bloco) no arquivo e no job
#   variante `hostil` → `defaults: run: node scripts/check-fantasma.mjs` no JOB
gerar_fixture() {
  local root="$1" variante="$2"
  rm -rf "$root"
  mkdir -p "$root/.github/workflows" "$root/.gitea/workflows"
  FIX_VARIANTE="$variante" FIX_ROOT="$root" GUARDS_DIR="$SCRIPT_DIR/scripts" \
    node --input-type=module -e '
    import { writeFileSync } from "node:fs"
    const S = process.env.GUARDS_DIR
    const { CORE_INVARIANTS, canonicalCommandOf } = await import(`${S}/check-forge-parity.mjs`)
    const cmds = CORE_INVARIANTS.map(canonicalCommandOf)
    const arquivo = process.env.FIX_VARIANTE === "legal"
      ? ["defaults:", "  run:", "    shell: bash"]
      : []
    const job = process.env.FIX_VARIANTE === "legal"
      ? ["    defaults:", "      run:", "        shell: bash"]
      : ["    defaults:", "      run: node scripts/check-fantasma.mjs"]
    const yaml = [
      "name: Fixture",
      "on: [push]",
      ...arquivo,
      "jobs:",
      "  guardas:",
      "    runs-on: ubuntu-latest",
      ...job,
      "    steps:",
      ...cmds.map((c) => `      - run: ${c}`),
      "",
    ].join("\n")
    writeFileSync(`${process.env.FIX_ROOT}/.github/workflows/pr-check.yml`, yaml)
    writeFileSync(`${process.env.FIX_ROOT}/.gitea/workflows/ci.yml`, yaml)
  '
}

# A FATIA de job (o que `firstRunLine`/`gateRunLine` recebem no uso real): a
# declaração proibida no escopo do JOB + o comando que o job de fato roda.
FATIA_LEGAL="$TMP_DIR/fatia-legal.yml"
FATIA_HOSTIL="$TMP_DIR/fatia-hostil.yml"
cat >"$FATIA_LEGAL" <<'YAML'
  guardas:
    runs-on: ubuntu-latest
    defaults:
      run:
        shell: bash
    steps:
      - run: bun run test:run
YAML
cat >"$FATIA_HOSTIL" <<'YAML'
  guardas:
    runs-on: ubuntu-latest
    defaults:
      run: node scripts/check-fantasma.mjs
    steps:
      - run: bun run test:run
YAML

# Workflow cuja DECLARAÇÃO carrega uma ref de mutation test — o fixture que fala
# a língua do `check-mutation-jobs` (cujo escopo é `scripts/test-mutation-*.sh`).
WF_REFS_HOSTIL="$TMP_DIR/wf-refs-hostil.yml"
cat >"$WF_REFS_HOSTIL" <<'YAML'
name: x
on: [push]
jobs:
  guardas:
    runs-on: ubuntu-latest
    defaults:
      run: bash scripts/test-mutation-fantasma.sh
    steps:
      - run: echo nada
YAML

RAIZ_LEGAL="$TMP_DIR/legal"
RAIZ_HOSTIL="$TMP_DIR/hostil"
gerar_fixture "$RAIZ_LEGAL" legal
gerar_fixture "$RAIZ_HOSTIL" hostil

# ── CONTROLE 1: a declaração LEGAL é adotável ─────────────────────────────
#
# `defaults: run: shell: bash` no ARQUIVO e no JOB é o que o repositório
# escolheria para trocar a premissa do shell. Se ele pintasse os guards de
# vermelho, a adoção seria impossível — e o desenho preferiria não ter a
# declaração a tê-la medida.

header "CONTROLE 1: a árvore gerada (declaração LEGAL) é VERDE de verdade"
code=0
paridade "$RAIZ_LEGAL" "$TMP_DIR/ctrl1.txt" || code=$?
if [ "$code" -ne 0 ]; then
  fail "o fixture de controle não é verde (exit $code) — sem isso o vermelho da mutação não prova nada"
  cat "$TMP_DIR/ctrl1.txt"
  exit 1
fi
inventario "$RAIZ_LEGAL" "$TMP_DIR/ctrl1-gates.txt"
if grep -qF 'NAO CLASSIFICADO' "$TMP_DIR/ctrl1-gates.txt"; then
  fail "o inventário do fixture de controle tem gate não classificado"
  cat "$TMP_DIR/ctrl1-gates.txt"
  exit 1
fi
pass 'os invariantes do CORE do fixture nas 2 pipelines, com a declaração LEGAL presente (exit 0)'

# ── CONTROLE 2: a declaração no escopo do JOB não é passo ─────────────────

header 'CONTROLE 2: `defaults.run` (escopo do JOB) não é passo para NENHUM guard'
code=0
paridade "$RAIZ_HOSTIL" "$TMP_DIR/ctrl2.txt" || code=$?
if [ "$code" -ne 0 ]; then
  fail "o fixture com a declaração no JOB não é verde (exit $code)"
  cat "$TMP_DIR/ctrl2.txt"
  exit 1
fi
extratores "$RAIZ_HOSTIL/.gitea/workflows/ci.yml" "$FATIA_HOSTIL" "$TMP_DIR/ctrl2-extra.json" check-fantasma
if grep -qF 'check-fantasma' "$TMP_DIR/ctrl2-extra.json"; then
  fail "a declaração virou passo/ref/gate para algum guard"
  cat "$TMP_DIR/ctrl2-extra.json"
  exit 1
fi
if ! grep -qF '"primeiraRun":"bun run test:run"' "$TMP_DIR/ctrl2-extra.json"; then
  fail "o doctor não achou o comando do PASSO"
  cat "$TMP_DIR/ctrl2-extra.json"
  exit 1
fi
if ! grep -qF '"runPorRotulo":null' "$TMP_DIR/ctrl2-extra.json"; then
  fail "o doctor casou o rótulo DENTRO da declaração"
  cat "$TMP_DIR/ctrl2-extra.json"
  exit 1
fi
pass 'nenhum dos 5 guards viu a declaração como passo (e o comando do passo segue visível)'

# ── MUTAÇÃO A: a leitura compartilhada para de ler ────────────────────────

header 'MUTAÇÃO A: `defaultsRunLines` devolvendo vazio DEVE FALHAR o contrato de merge'
mutar "$WORKFLOWS" '  const out = new Set()
  for (const bloco of defaultsBlocks(content)) {' '  const out = new Set()
  return out // MUTACAO A
  for (const bloco of defaultsBlocks(content)) {'
code=0
paridade "$RAIZ_HOSTIL" "$TMP_DIR/mut-a.txt" || code=$?
if [ "$code" -ne 1 ]; then
  fail "guard CEGO: a leitura parou de ler e o contrato de merge passou (exit $code)"
  cat "$TMP_DIR/mut-a.txt"
  exit 1
fi
for agulha in "gate 'scripts/check-fantasma.mjs' NAO CLASSIFICADO" '.gitea/workflows/ci.yml (gitea, dona do merge)'; do
  if ! grep -qF -- "$agulha" "$TMP_DIR/mut-a.txt"; then
    fail "vermelho pelo motivo errado: falta '$agulha'"
    cat "$TMP_DIR/mut-a.txt"
    exit 1
  fi
done
inventario "$RAIZ_HOSTIL" "$TMP_DIR/mut-a-gates.txt"
if ! grep -qF '[NAO CLASSIFICADO] scripts/check-fantasma.mjs' "$TMP_DIR/mut-a-gates.txt"; then
  fail "o inventário não nomeia o gate fantasma"
  cat "$TMP_DIR/mut-a-gates.txt"
  exit 1
fi
pass 'a declaração virou GATE nas duas pipelines — o guard acusa pela própria regra (exit 1)'
restore

# ── MUTAÇÃO B: a leitura existe e o guard não a consulta ──────────────────

header 'MUTAÇÃO B: o guard de paridade deixa de CONSULTAR a leitura → DEVE FALHAR'
# A leitura e UM lugar `linhasExecutaveis` (o guard nao repete a exclusao em cada
# consumidor — a descoberta de gates, a regua de comando e o canal do remedio
# passam todos por ela). Por isso a mutacao tem UM alvo exato: mutar o corpo do
# helper cega os tres consumidores de uma vez, que e o que "o guard deixou de
# consultar a leitura" significa.
mutar "$PARITY" 'executableLines(content.split(/\r?\n/), defaultsRunLines(content))' 'executableLines(content.split(/\r?\n/)) // MUTACAO B' 1
code=0
paridade "$RAIZ_HOSTIL" "$TMP_DIR/mut-b.txt" || code=$?
if [ "$code" -ne 1 ]; then
  fail "guard CEGO: a leitura certa existe no módulo e o guard não a usa (exit $code)"
  cat "$TMP_DIR/mut-b.txt"
  exit 1
fi
if ! grep -qF "gate 'scripts/check-fantasma.mjs' NAO CLASSIFICADO" "$TMP_DIR/mut-b.txt"; then
  fail "vermelho pelo motivo errado"
  cat "$TMP_DIR/mut-b.txt"
  exit 1
fi
pass 'a leitura certa num módulo não protege um guard que não a chama (exit 1)'
restore

# ── MUTAÇÃO C: o doctor aceita a declaração como comando do job ───────────

header 'MUTAÇÃO C: o doctor deixa de pular a declaração → DEVE devolver o comando FALSO'
mutar "$DOCTOR" 'const defaults = defaultsRunLines(lines.join("\n"))' 'const defaults = new Set() // MUTACAO C' 2
mutar "$DOCTOR" 'const jobDefaults = defaultsRunLines(job)' 'const jobDefaults = new Set() // MUTACAO C'
extratores "$RAIZ_HOSTIL/.gitea/workflows/ci.yml" "$FATIA_HOSTIL" "$TMP_DIR/mut-c.json" check-fantasma
if ! grep -qF '"primeiraRun":"node scripts/check-fantasma.mjs"' "$TMP_DIR/mut-c.json"; then
  fail "o doctor NÃO aceitou a declaração como comando (a mutação não mede)"
  cat "$TMP_DIR/mut-c.json"
  exit 1
fi
if ! grep -qF '"runPorRotulo":"node scripts/check-fantasma.mjs"' "$TMP_DIR/mut-c.json"; then
  fail "o doctor não casou o rótulo na declaração (a mutação não mede a segunda regra)"
  cat "$TMP_DIR/mut-c.json"
  exit 1
fi
pass 'o contrato "o job RODA o comando esperado" seria satisfeito por uma declaração de shell'
restore

# ── MUTAÇÃO D: os guards de REF voltam a contar a declaração ──────────────
#
# DUAS metades INDEPENDENTES, porque as duas perguntas são diferentes:
#
#   D1 — o `check-workflow-refs` tem um PULO PRÓPRIO (`defaults.has(i + 1)`) em
#        quatro call sites. Mutá-lo mede a leitura daquele guard. O
#        `check-mutation-jobs` NÃO tem esse pulo: a imunidade dele vem da régua
#        compartilhada (`workflowRunBodies` só reconhece ITEM DE LISTA como
#        passo, e uma declaração não é um) — e é isso que o CONTROLE do D1
#        prende: com o pulo do vizinho removido, a cobertura de mutation test
#        segue LIMPA. Antes as duas mutações eram aplicadas juntas, e a metade do
#        `check-mutation-jobs` mutava uma linha que já não existia (o skip
#        local morreu na unificação) — o script parava em
#        "mutacao nao-cirurgica" em vez de medir.
#
#   D2 — a régua: mutar a detecção de PASSO faz a declaração virar passo para
#        TODOS os que a consomem, e a cobertura de mutation test conta a ref
#        fantasma. O `check-workflow-refs` (intacto aqui) continua pulando — o
#        que prova que as duas leituras são independentes de verdade.

header 'MUTAÇÃO D1: o pulo da declaração no guard de REFS volta → cobertura FALSA'
extratores "$WF_REFS_HOSTIL" "$FATIA_HOSTIL" "$TMP_DIR/mut-d-ctrl.json" check-fantasma
if grep -qF 'test-mutation-fantasma.sh' "$TMP_DIR/mut-d-ctrl.json"; then
  fail 'a ref da declaração já aparecia com os guards intactos'
  cat "$TMP_DIR/mut-d-ctrl.json"
  exit 1
fi
mutar "$WORKFLOW_REFS" 'if (defaults.has(i + 1)) continue' 'if (false) continue // MUTACAO D' 4
extratores "$WF_REFS_HOSTIL" "$FATIA_HOSTIL" "$TMP_DIR/mut-d1.json" check-fantasma
if ! grep -qF '"scriptRefs":["test-mutation-fantasma.sh"]' "$TMP_DIR/mut-d1.json"; then
  fail 'a mutação não mede: falta a ref de script do guard de refs'
  cat "$TMP_DIR/mut-d1.json"
  exit 1
fi
# A metade que prova ONDE mora a imunidade do vizinho: sem o pulo próprio, o
# guard de refs acusa; o de mutation test (que não tem pulo para perder)
# continua limpo porque quem pula a declaração é a RÉGUA.
if grep -qF '"mutationRefs":["test-mutation-fantasma.sh"]' "$TMP_DIR/mut-d1.json"; then
  fail 'o guard de mutation test passou a contar a declaração SEM ter sido mutado'
  fail '— ele tem um pulo próprio de novo (o skip local voltou)?'
  cat "$TMP_DIR/mut-d1.json"
  exit 1
fi
pass 'D1: a ref da declaração volta a contar no guard de REFS, e só nele (o pulo do vizinho é a régua)'
restore

header 'MUTAÇÃO D2: a régua deixa de exigir ITEM DE LISTA → a declaração vira passo'
mutar "$WORKFLOWS" '    const item = lines[i].match(/^(\s*)-\s/)' '    const item = lines[i].match(/^(\s*)(?:-\s|run:)/) // MUTACAO D'
extratores "$WF_REFS_HOSTIL" "$FATIA_HOSTIL" "$TMP_DIR/mut-d2.json" check-fantasma
if ! grep -qF '"mutationRefs":["test-mutation-fantasma.sh"]' "$TMP_DIR/mut-d2.json"; then
  fail 'a mutação não mede: falta a cobertura de mutation test da declaração'
  cat "$TMP_DIR/mut-d2.json"
  exit 1
fi
# O guard de refs NÃO foi mutado aqui: ele segue pulando pela própria régua de
# linha. Se ele passasse a acusar também, a mutação teria derrubado a árvore em
# vez de medir a cobertura falsa de um consumidor da régua de PASSO.
if grep -qF '"scriptRefs":["test-mutation-fantasma.sh"]' "$TMP_DIR/mut-d2.json"; then
  fail 'o guard de refs (intacto) passou a contar a declaração com a régua de passo mutada'
  cat "$TMP_DIR/mut-d2.json"
  exit 1
fi
# As regras IRMÃS seguem de pé: o guard de paridade (NÃO mutado) continua pulando
# a declaração — a mutação mediu a cobertura falsa, não derrubou a árvore.
if ! grep -qF '"comandos":["echo nada"]' "$TMP_DIR/mut-d2.json"; then
  fail 'o guard de paridade (intacto) deixou de pular a declaração'
  cat "$TMP_DIR/mut-d2.json"
  exit 1
fi
pass 'D2: mutar a régua de PASSO faz a declaração virar cobertura de mutation test (a leitura é compartilhada)'
restore

# ── MUTAÇÃO E: a leitura cega para o escopo do JOB ────────────────────────

header 'MUTAÇÃO E: a leitura só vendo o escopo do ARQUIVO → o `defaults:` do JOB vira passo'
mutar "$WORKFLOWS" '    const indent = indentOf(l)
    const escopo = indent === 0 ? "workflow" : "job"' '    if (indentOf(l) !== 0) continue // MUTACAO E
    const indent = indentOf(l)
    const escopo = indent === 0 ? "workflow" : "job"'
code=0
paridade "$RAIZ_HOSTIL" "$TMP_DIR/mut-e.txt" || code=$?
if [ "$code" -ne 1 ]; then
  fail "guard CEGO: a declaração do JOB virou passo e o contrato passou (exit $code)"
  cat "$TMP_DIR/mut-e.txt"
  exit 1
fi
if ! grep -qF "gate 'scripts/check-fantasma.mjs' NAO CLASSIFICADO" "$TMP_DIR/mut-e.txt"; then
  fail "vermelho pelo motivo errado"
  cat "$TMP_DIR/mut-e.txt"
  exit 1
fi
pass 'a metade do escopo do JOB é carga, não decoração (exit 1)'
restore

# ── RESTAURAÇÃO ───────────────────────────────────────────────────────────

header 'RESTAURAÇÃO provada (cksum por arquivo)'
if ! verify_restored; then
  fail "a árvore não voltou ao estado original"
  exit 1
fi
pass 'os 4 arquivos tocados voltaram byte a byte ao original'

echo
echo -e "${GREEN}✅ test-mutation-workflow-defaults: 6 mutações detectadas, 2 controles verdes, árvore restaurada${NC}"
