#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-merge-latency.sh — Mutation test do gate da LATÊNCIA
#
# Usage:
#   ./scripts/test-mutation-merge-latency.sh
#
# Exit codes:
#   0 — as CINCO mutações DETECTADAS (o gate cega e/ou a suíte fica vermelha)
#   1 — gate/suíte CEGO (a mutação não foi vista) / mutação não-cirúrgica / infra
#
# POR QUE: o gate `--check` é o que impede a latência de merge PUBLICADA de
# encolher em silêncio — um job novo na pipeline do PR sem duração faz o
# denominador diminuir, e o número fica MENOR justamente quando ficou mais
# incompleto. Um gate que "sempre passa" daria exatamente a falsa segurança que
# ele existe para eliminar, então cada metade dele tem de ter testemunha.
#
# DUAS testemunhas independentes, e o teste exige a que a mutação atinge:
#   (1) o GATE por EXECUÇÃO — `node scripts/merge-latency.mjs --check --root
#       <fixture>` sobre um checkout SINTÉTICO com um job do PR sem duração
#       tem de sair 2 (INDETERMINADA). Não é leitura do arquivo: é o veredito.
#   (2) a SUÍTE unitária (`merge-latency.test.ts`), que julga as funções puras.
#
# UMA MUTAÇÃO POR METADE (a unidade é a metade, não o arquivo):
#   M1 — a DETECÇÃO da cobertura (`missing.push` do FALLBACK): o job sem
#        duração some da lista e o veredito fica PRONTA com um número
#        incompleto.
#   M2 — o EXIT CODE do `--check`: a medição continua certa e o CI passa assim
#        mesmo — o gate vira decoração.
#   M3 — o PAPEL do dono do merge: com o papel trocado, o veredito passa a
#        julgar a forja ERRADA (o espelho declara jobs sem medição de
#        propósito) e o gate trava, ou libera, quem não devia.
#   M4 — a RÉGUA do `if:` (a chave filha DIRETA do job): lendo qualquer `if:`
#        do corpo, o `if:` de um PASSO vira o do job — um job incondicional
#        passa a parecer condicional e o veredito fica indeterminado por causa
#        de um passo. Witness: o RELATÓRIO do espelho (execução) + a suíte.
#   M5 — a LIGAÇÃO do passo à FORMA versionada do benchmark (`from:`): com o
#        passo voltando a ter número PRÓPRIO (3870ms, o valor que o declarado
#        tinha, contra os 3897ms da forma), o mesmo passo passa a ter DOIS
#        números que divergem sem ninguém ver — que é o defeito que a ligação
#        elimina. Witness: o `--json` do espelho, que traz o ms do passo
#        derivado (execução: o modelo LEU o arquivo?) + a suíte.
#
# CADA mutação é CIRÚRGICA: o injetor recusa alvo ausente, e o arquivo mutado
# tem de continuar com sintaxe válida — aplicar no lugar errado mediria outra
# coisa, e o harness estaria mentindo ao se declarar detector.
#
# COMO: muta o guard IN-PLACE (backup + trap EXIT de restauração) e restaura
# entre as mutações, para cada uma ser medida contra a base íntegra.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'M1|a DETECÇÃO da cobertura: o job sem duração some da medição'
  'M2|o EXIT CODE do --check: a medição continua certa e o CI passa assim'
  'M3|o PAPEL do dono do merge: com o papel trocado o veredito muda'
  'M4|a RÉGUA do if: (a chave filha DIRETA do job): lendo qualquer if'
  'M5|a LIGAÇÃO do passo à forma versionada: com número próprio, dois números do mesmo passo'
)
cd "$SCRIPT_DIR"

GUARD="scripts/merge-latency.mjs"
SUITE="src/lib/__tests__/merge-latency.test.ts"

TMP_DIR="$(mktemp -d)"
BACKUP="$TMP_DIR/merge-latency.mjs.backup"
FIXTURE="$TMP_DIR/fixture"
RESULTS="$TMP_DIR/results.json"

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

restore() {
  if [ -f "$BACKUP" ]; then
    cp "$BACKUP" "$GUARD"
  fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT

# ── Fixture — um checkout SINTÉTICO com o defeito que o gate existe p/ pegar ─
# A pipeline do dono do merge tem DOIS jobs no PR; o modelo cobre só um. O
# outro (`algo-novo`) não está no modelo e o benchmark não o conhece.
make_fixture() {
  mkdir -p "$FIXTURE/.gitea/workflows" "$FIXTURE/.github/workflows" \
    "$FIXTURE/ci" "$FIXTURE/docs/benchmarks"

  # O job `count` do dono do merge é o job DECLARADO POR PASSOS: o segundo passo
  # não tem número próprio no modelo, ele se LIGA à forma `mutation-count` do
  # benchmark da fixture. É a testemunha de execução da mutação M5 (o `--json` do
  # dono traz o ms do passo derivado, então dá para ver se o modelo LEU o arquivo
  # ou repetiu um número). Ele fica na forja DONA do merge (e não no espelho) para
  # o espelho seguir com UM job e um `if:` de PASSO — que é o par exato da
  # mutação M4.
  cat >"$FIXTURE/.gitea/workflows/ci.yml" <<'YAML'
name: ci
on:
  pull_request:
jobs:
  guards:
    steps:
      - run: node scripts/check-bun-mirror.mjs
  count:
    steps:
      - run: bun install --frozen-lockfile
      - run: bash scripts/test-mutation-mutation-count.sh
  algo-novo:
    steps:
      - run: bun run algo-que-ninguem-mede
YAML

  # O `espelho` tem um `if:` — mas no PASSO (`steps.…`), não no job: é o par
  # exato que a mutação M4 explora, e o controle exige que ele NÃO seja lido
  # como se fosse do job (o job roda em todo PR).
  cat >"$FIXTURE/.github/workflows/pr-check.yml" <<'YAML'
name: pr-check
on:
  pull_request:
jobs:
  espelho:
    steps:
      - run: node scripts/check-bun-mirror.mjs
        if: steps.changes.outputs.changed == 'true'
YAML

  # O benchmark da fixture: nenhum GUARD (nada é confrontado por comando), mas a
  # forma `mutation-count` da família `mutations` EXISTE — é ela que o passo do
  # job `count` lê.
  cat >"$FIXTURE/docs/benchmarks/guard-timing-latest.json" <<'JSON'
{
  "meta": { "commit": "fixture0", "families": { "mutations": { "commit": "fixture0" } } },
  "guards": [],
  "rulers": {},
  "mutations": {
    "measured": true,
    "cmd": "bash scripts/test-mutation-guards.sh --json",
    "forms": [
      { "role": "mutation-count", "label": "mutation-count", "ms": 3897, "exit": 0, "ok": true, "runs": [{ "ms": 3897, "ok": true }] }
    ]
  }
}
JSON

  # O modelo cobre TODOS os jobs do espelho e SÓ UM do dono do merge: assim o
  # defeito é do dono do merge, e o espelho fica PRONTA. É isso que faz a
  # mutação M3 (o PAPEL) ser vista pelo GATE: com o papel trocado, o `--check`
  # passa a julgar o espelho — que está coberto — e deixa de recusar.
  cat >"$FIXTURE/ci/merge-latency.json" <<'JSON'
{
  "meta": { "tool": "merge-latency", "version": 1, "date": "2026-09-16" },
  "overhead": { "perJobMs": 0 },
  "concurrency": {
    "gitea": { "runners": 1, "source": "fixture" },
    "github": { "runners": 1, "source": "fixture" }
  },
  "jobs": {
    "gitea": {
      "guards": { "ms": 1000, "provenance": "declarado", "source": "fixture", "date": "2026-09-16" },
      "count": {
        "provenance": "declarado + derivado (benchmark)",
        "date": "2026-09-16",
        "source": "fixture: o passo da suíte LÊ a forma mutation-count do benchmark",
        "steps": [
          { "run": "bun install --frozen-lockfile", "ms": 62, "date": "2026-09-16", "source": "fixture" },
          { "run": "bash scripts/test-mutation-mutation-count.sh", "from": { "family": "mutations", "form": "mutation-count" } }
        ]
      }
    },
    "github": { "espelho": { "ms": 900, "provenance": "declarado", "source": "fixture", "date": "2026-09-16" } }
  }
}
JSON
}

# run_gate: o veredito do GATE por EXECUÇÃO (exit code do `--check`).
run_gate() {
  local code=0
  node "$GUARD" --check --root "$FIXTURE" >"$TMP_DIR/gate.out" 2>&1 || code=$?
  return "$code"
}

# run_mirror: o RELATÓRIO do espelho por execução (`--forge github`). É a
# testemunha de execução da régua do `if:`: o job `espelho` tem um `if:` de
# PASSO, e o veredito do espelho só fica PRONTA se esse `if:` NÃO for lido como
# o do job.
run_mirror() {
  local code=0
  node "$GUARD" --forge github --root "$FIXTURE" >"$TMP_DIR/mirror.out" 2>&1 || code=$?
  return "$code"
}

# run_suite: a testemunha unitária. Devolve o exit code do vitest.
run_suite() {
  rm -f "$RESULTS"
  local code=0
  # `|| code=$?` em vez de `set +e`: a função roda sob `set -e` do script, e um
  # `set -e` interno aqui reativaria o errexit no CHAMADOR (o escopo é global),
  # abortando a chamada antes de a suíte ser lida.
  bun x vitest run --config vitest.config.unit.ts --reporter=json \
    --outputFile="$RESULTS" "$SUITE" 2>&1 | tail -3 || code=$?
  return "$code"
}

# mutar <alvo> <troca>: substituição LITERAL, com o arquivo relido para provar
# que aplicou e que a sintaxe continua válida.
mutar() {
  local alvo="$1" troca="$2"
  python3 - "$GUARD" "$alvo" "$troca" <<'PY'
import sys
path, alvo, troca = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path, encoding="utf-8").read()
if src.count(alvo) != 1:
    print(f"MUTACAO NAO-CIRURGICA: '{alvo}' aparece {src.count(alvo)}x (esperado 1)", file=sys.stderr)
    sys.exit(1)
open(path, "w", encoding="utf-8").write(src.replace(alvo, troca))
PY
  if ! node --check "$GUARD" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA: o arquivo mutado não é válido sintaticamente."
    exit 1
  fi
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   MUTATION TEST — gate da latência de merge ($GUARD)"
echo "  ═════════════════════════════════════════════════════════════════"

cp "$GUARD" "$BACKUP"
make_fixture
pass "Backup do guard + fixture sintética em $FIXTURE"

# ── CONTROLE — o gate MORDE com o guard íntegro ───────────────────────────
# Sem este passo, um gate que falhasse "de qualquer jeito" (fixture quebrada,
# guard que não roda) passaria como detector.
header "CONTROLE — o gate tem de RECUSAR o job sem duração"
GATE_EXIT=0
run_gate || GATE_EXIT=$?
if [ "$GATE_EXIT" -ne 2 ]; then
  fail "CONTROLE FALHOU: --check saiu $GATE_EXIT (esperado 2 = INDETERMINADA)."
  echo "----- saída do gate -----"
  cat "$TMP_DIR/gate.out"
  exit 1
fi
if ! grep -q "algo-novo" "$TMP_DIR/gate.out"; then
  fail "CONTROLE FALHOU: o gate recusou, mas NÃO nomeou o job sem duração."
  exit 1
fi
pass "Controle OK — o gate recusa (exit 2) e NOMEIA 'algo-novo'"

if ! run_suite; then
  fail "CONTROLE FALHOU: a suíte unitária não ficou verde no estado íntegro."
  exit 1
fi
pass "Controle OK — suíte unitária verde com o guard intacto"

# O controle do ESPELHO: o `if:` de PASSO do job `espelho` não pode fazer o job
# parecer condicional. Sem esta asserção, a mutação M4 não teria testemunha de
# execução (o gate do dono já sai 2 por outro job, então ele não distingue).
MIRROR_EXIT=0
run_mirror || MIRROR_EXIT=$?
if [ "$MIRROR_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: o espelho saiu $MIRROR_EXIT — o \`if:\` de um PASSO foi lido como o do job."
  echo "----- saída do relatório -----"
  cat "$TMP_DIR/mirror.out"
  exit 1
fi
if grep -q "não dá para classificar" "$TMP_DIR/mirror.out"; then
  fail "CONTROLE FALHOU: o espelho acusou \`if:\` não classificável num job sem \`if:\` de job."
  exit 1
fi
pass "Controle OK — o \`if:\` do PASSO não é lido como o \`if:\` do job (espelho PRONTA)"

# ── MUTAÇÃO M1 — a DETECÇÃO da cobertura ──────────────────────────────────
# `missing.push(job.name)` é o que transforma "não medido" em veredito. Sem
# ele, o job sem duração some da lista e o estado fica PRONTA: o número
# publicado passa a medir menos pipeline do que existe — e fica MENOR.
#
# O ALVO carrega CONTEXTO porque a cobertura deixou de ter um push só: a régua
# da idade (`bench-freshness.mjs`) fez o `ms` sem data própria entrar na MESMA
# lista, e a mutação nomeia o push do FALLBACK — o job que não tem duração de
# jeito nenhum, que é o que este fixture sintético exercita. Um alvo de uma
# linha só passaria a casar nos dois (o injetor recusa alvo ambíguo).
header "MUTAÇÃO M1 — a detecção da cobertura (missing.push)"
info "Removendo a entrada do job sem duração da lista de pendências..."
mutar '    missing.push(job.name)
    byJob.set(job.name, {
      ms: null,
      provenance: null,' '    void job // MUTACAO M1: o job sem duracao some da lista
    byJob.set(job.name, {
      ms: null,
      provenance: null,'
pass "Mutação M1 aplicada (sintaxe válida)"

GATE_EXIT=0
run_gate || GATE_EXIT=$?
if [ "$GATE_EXIT" -ne 0 ]; then
  fail "M1 NÃO DETECTADA: o gate ainda recusou (exit $GATE_EXIT) — a mutação não cegou o detector."
  exit 1
fi
pass "M1 DETECTADA pelo GATE por execução: o gate saiu 0 (CEGO) com um job sem duração"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M1 NÃO DETECTADA pela suíte: a segunda testemunha passou com a detecção removida."
  exit 1
fi
pass "M1 DETECTADA também pela suíte unitária (exit $SUITE_EXIT)"

cp "$BACKUP" "$GUARD"
pass "Guard restaurado — base íntegra para a mutação M2"

# ── MUTAÇÃO M2 — o EXIT CODE do gate ──────────────────────────────────────
# A medição continua CERTA (o relatório diz INDETERMINADA, o job é nomeado) e
# o CI passa assim mesmo: o gate vira decoração. É a metade que o `run:` do
# pipeline realmente consome — um exit 0 fixo desliga o bloqueio.
header "MUTAÇÃO M2 — o exit code do --check"
info "Fixando o retorno do perfil --check em 0..."
mutar '    return owner.state === STATE.READY ? 0 : 2' \
  '    return 0 // MUTACAO M2: o gate nunca bloqueia'
pass "Mutação M2 aplicada (sintaxe válida)"

GATE_EXIT=0
run_gate || GATE_EXIT=$?
if [ "$GATE_EXIT" -ne 0 ]; then
  fail "M2 NÃO DETECTADA: o gate ainda saiu $GATE_EXIT — o exit code não é o que o CI consome."
  exit 1
fi
pass "M2 DETECTADA: exit 0 fixo faz o gate do PR passar com o veredito INDETERMINADA"

cp "$BACKUP" "$GUARD"
pass "Guard restaurado — base íntegra para a mutação M3"

# ── MUTAÇÃO M3 — o PAPEL do dono do merge ─────────────────────────────────
# Com o papel trocado, `--check` passa a julgar a forja ERRADA. Na fixture o
# espelho tem um job sem medição: o gate passaria a recusar quem não decide o
# merge — e, no repositório real, deixaria de recusar quem decide.
header "MUTAÇÃO M3 — o papel do dono do merge"
info "Trocando o papel do dono do merge..."
mutar 'export const MERGE_OWNER_ROLE = "dona do merge"' \
  'export const MERGE_OWNER_ROLE = "espelho" // MUTACAO M3: julga a forja errada'
pass "Mutação M3 aplicada (sintaxe válida)"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M3 NÃO DETECTADA: a suíte passou com o dono do merge trocado."
  fail "Sem esta testemunha, o gate julgaria a forja errada em silêncio."
  exit 1
fi
pass "M3 DETECTADA pela suíte unitária (exit $SUITE_EXIT)"

GATE_EXIT=0
run_gate || GATE_EXIT=$?
if [ "$GATE_EXIT" -ne 0 ]; then
  fail "M3 NÃO DETECTADA pelo gate: com o papel trocado o gate ainda recusou — o papel não é lido."
  exit 1
fi
pass "M3 DETECTADA pelo GATE: com o dono trocado, o gate deixou de recusar quem mergeia"

cp "$BACKUP" "$GUARD"
pass "Guard restaurado — base íntegra para a mutação M4"

# ── MUTAÇÃO M4 — a RÉGUA do `if:` (chave filha DIRETA) ────────────────────
# Lendo qualquer `if:` do corpo do job (a régua antiga), o `if:` de um PASSO
# vira o do job: `espelho` passa a "poder ou não rodar" e o veredito fica
# INDETERMINADO por causa de um passo. A testemunha de execução é o RELATÓRIO do
# espelho (o gate do dono não distingue: ele já sai 2 por outro job).
header "MUTAÇÃO M4 — a régua do \`if:\` (filho DIRETO do job)"
info "Fazendo o leitor aceitar \`if:\` de QUALQUER profundidade..."
mutar '  const idx = yamlChildKey(lines, headerIdx, jobIndent, key)' \
  '  const idx = lines.findIndex((l, k) => k > headerIdx && /^\s*if:/.test(l)) // MUTACAO M4: qualquer profundidade'
pass "Mutação M4 aplicada (sintaxe válida)"

MIRROR_EXIT=0
run_mirror || MIRROR_EXIT=$?
if [ "$MIRROR_EXIT" -eq 0 ]; then
  fail "M4 NÃO DETECTADA: o espelho ainda ficou PRONTA com o \`if:\` do PASSO lido como o do job."
  exit 1
fi
if ! grep -q "não dá para classificar" "$TMP_DIR/mirror.out"; then
  fail "M4 DETECTADA parcialmente: o espelho recusou, mas não NOMEOU o \`if:\` que não entende."
  exit 1
fi
pass "M4 DETECTADA pelo RELATÓRIO do espelho (exit $MIRROR_EXIT, com o \`if:\` nomeado)"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M4 NÃO DETECTADA pela suíte: o \`if:\` de passo como o do job passou em silêncio."
  exit 1
fi
pass "M4 DETECTADA também pela suíte unitária (exit $SUITE_EXIT)"

cp "$BACKUP" "$GUARD"
pass "Guard restaurado — base íntegra para a mutação M5"

# ── MUTAÇÃO M5 — a LIGAÇÃO do passo à FORMA versionada ────────────────────
# O passo do job `count` deixa de LER a forma `mutation-count` e volta a ter um
# número PRÓPRIO: os 3870ms que o declarado antigo tinha, contra os 3897ms que a
# baseline publica. É o defeito exato que a ligação elimina — dois números do
# MESMO passo, 27ms de diferença de contexto que ninguém veria, porque nenhum dos
# dois era derivado do outro. A testemunha de execução é o `--json` do espelho:
# o ms do passo derivado tem de sair da BASELINE, e com o número próprio ele sai
# do modelo.
header "MUTAÇÃO M5 — a ligação do passo à forma versionada (from:)"
info "Dando ao passo um número próprio (3870ms) no lugar da forma (3897ms)..."
mutar '      const res = resolveFrom(step.from, index)' \
  '      const res = { ms: 3870, commit: null, label: "mutation-count", source: null, error: null } // MUTACAO M5: o passo volta a ter numero proprio'
pass "Mutação M5 aplicada (sintaxe válida)"

MEDIDO="$TMP_DIR/m5.json"
node "$GUARD" --forge gitea --root "$FIXTURE" --json >"$MEDIDO" 2>/dev/null || true
LIDO="$(python3 - "$MEDIDO" <<'PY'
import json, sys
r = json.load(open(sys.argv[1], encoding="utf-8"))
s = r["sections"][0]
j = [x for x in s["jobs"] if x["name"] == "count"][0]
derivados = [p["ms"] for p in (j.get("steps") or []) if p["derived"]]
print("%s|%s" % (j["ms"], derivados[0] if derivados else "?"))
PY
)"
TOTAL="${LIDO%%|*}"
PASSO="${LIDO##*|}"
if [ "$PASSO" = "3897" ]; then
  fail "M5 NÃO DETECTADA: o passo ainda leu a forma (3897ms) — a ligação não alimenta o número."
  exit 1
fi
pass "M5 DETECTADA pelo RELATÓRIO do dono do merge: o passo mede ${PASSO}ms (número próprio) e o job fecha em ${TOTAL}ms, não nos 3959ms da soma com a forma"

SUITE_EXIT=0
run_suite || SUITE_EXIT=$?
if [ "$SUITE_EXIT" -eq 0 ]; then
  fail "M5 NÃO DETECTADA pela suíte: o passo com número próprio passou em silêncio."
  fail "Sem esta testemunha, o passo do job voltaria a divergir da baseline sem ninguém ver."
  exit 1
fi
pass "M5 DETECTADA também pela suíte unitária (exit $SUITE_EXIT)"

cp "$BACKUP" "$GUARD"
pass "Guard RESTAURADO (checksum conferido abaixo)"

# ── CONTROLE FINAL — a árvore voltou ao comportamento original ────────────
header "CONTROLE FINAL — o guard restaurado volta a RECUSAR o job sem duração"
if ! cmp -s "$BACKUP" "$GUARD"; then
  fail "O guard NÃO voltou ao estado original (backup ≠ atual)."
  exit 1
fi
GATE_EXIT=0
run_gate || GATE_EXIT=$?
if [ "$GATE_EXIT" -ne 2 ]; then
  fail "CONTROLE FINAL FALHOU: o guard restaurado saiu $GATE_EXIT (esperado 2)."
  exit 1
fi
pass "Controle final OK — o guard restaurado recusa de novo (exit 2)"

# ── Veredito ──────────────────────────────────────────────────────────────
echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo -e "   ${GREEN}✅ MUTATION TEST PASSOU${NC} — as CINCO metades são LOAD-BEARING:"
echo "      • a DETECÇÃO da cobertura (missing) → mutá-la cega o gate"
echo "      • o EXIT CODE do --check → fixá-lo em 0 desliga o bloqueio do CI"
echo "      • o PAPEL do dono do merge → trocá-lo julga a forja errada"
echo "      • a RÉGUA do \`if:\` (filho direto) → ler o de um PASSO indetermina à toa"
echo "      • a LIGAÇÃO do passo à forma versionada → com número próprio, o"
echo "        mesmo passo volta a ter dois números que divergem sem ninguém ver"
echo "      e cada mutação é CIRÚRGICA: restaurada entre as medições, com o"
echo "      gate mordendo de novo no controle final."
echo "  ═════════════════════════════════════════════════════════════════"
echo ""
