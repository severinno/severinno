#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-cut-stages.sh — Mutation test do prove-cut-stages
# (`scripts/prove-cut-stages.mjs`)
#
# Usage:
#   ./scripts/test-mutation-cut-stages.sh
#
# Exit codes:
#   0 — as TRÊS mutações foram DETECTADAS (o veredito do harness muda) e os
#       controles passaram ✅
#   1 — alguma invariante NÃO sustentou o veredito (a mutação não quebrou, ou o
#       harness ficou vermelho com a invariante desligada) ❌
#   2 — infra: a suíte não pôde medir (arquivo ausente, vitest ausente é DITO)
#
# O QUE ISTO PROVA (e por que não basta o harness passar hoje)
#
# O `prove-cut-stages` afirma que cada etapa de `docs/GITHUB_CUT.md` §3 é
# shippable: ele APLICA a etapa numa cópia da árvore rastreada e julga o efeito
# contra três invariantes DURAS — nenhuma etapa pode tocar a pipeline que decide
# o merge:
#
#   1. os GATES da forja DONA DO MERGE ficam idênticos (`forgeGatesForRuntime`,
#      a derivação do `doctor`);
#   2. os REQUIRED CHECKS da DONA DO MERGE ficam idênticos (o manifesto
#      `ci/required-checks.json` resolvido pelo `check-required-checks`);
#   3. o ESPELHO perde/ganha EXATAMENTE os gates que a etapa DECLARA (e nada
#      além disso).
#
# Um harness que roda e sai 0 prova que ele não acusou — não prova que ele
# MEDIU. Este script injeta, uma por vez, a mudança que CADA invariante existe
# para pegar, e exige que o veredito MUDE:
#
#   M1 — o passo a MAIS na pipeline da dona (um gate novo no job `guards`). O
#        efeito medido: `dona: 28 → 29 gates`, e a paridade segue em 0 — é a
#        invariante 1 sozinha que denuncia.
#   M2 — o job a MENOS no manifesto da dona (`required-checks.json`): os
#        contextos resolvidos da dona caem de 7 para 6.
#   M3 — o passo a MENOS no espelho (o gate do `check-e2e-counts.mjs` sai da
#        pipeline do GitHub) sem a etapa declarar a perda: o espelho cai de 56
#        para 55 gates.
#
# A DIREÇÃO é a do defeito real, não a do guard: a injeção é a mudança na
# ÁRVORE (o passo a mais, o job a menos, o gate perdido) e o que se exige é o
# VERMELHO — e, para provar que o vermelho veio daquela invariante, a SEGUNDA
# metade de cada bloco desliga a invariante e exige o VERDE com a MESMA injeção
# no lugar. Sem essa segunda metade, "ficou vermelho" poderia ser um crash.
#
# POR QUE A INJEÇÃO NÃO MORA NO FIXTURE (medido, e é o desenho): as invariantes
# comparam o ANTES e o DEPOIS do passo (`runStage` copia, aplica e mede; o
# `classifyStage` compara essa medição com a linha de base). Uma árvore de
# fixture JÁ quebrada aparece IGUAL na base e no depois — não muda veredito
# nenhum. O excesso tem de entrar DURANTE o passo, que é onde a transformação
# escreve: por isso a injeção é um statement na linha do `copyTree` do
# `runStage` (a cópia do passo), e o resto do harness fica intocado.
#
# A CIRURGIA: cada injeção quebra UMA invariante e só ela (a paridade medida é
# 0 nas três — o harness imprime o número, e o bloco confere). Um `sed` no
# arquivo do harness com 0 ou 2+ ocorrências não é cirúrgico: a suíte PARA em
# vez de medir outra coisa. Backup + restauração por CHECKSUM (trap EXIT): um
# `exit` no meio não deixa a árvore mutada.
#
# A SEGUNDA TESTEMUNHA (a suíte unitária). Além do veredito do CLI, cada metade
# exige a suíte `prove-cut-stages.test.ts` VERMELHA — a suíte é o que roda em
# todo PR, e é ela que tem de notar a regressão quando o harness for editado.
# Onde o vitest não está instalado o motivo é DITO (nunca silencioso): o exit
# code de uma suíte que não rodou não é veredito.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa.
METADES=(
  'M1|os GATES da dona do merge: um passo a mais na pipeline da dona → QUEBRA'
  'M2|os REQUIRED CHECKS da dona: um job a menos no manifesto → QUEBRA'
  'M3|o GATE DO ESPELHO: um passo a menos sem a etapa declarar → QUEBRA'
)

ALVO="$SCRIPT_DIR/scripts/prove-cut-stages.mjs"
SUITE_ARQUIVO="src/lib/__tests__/prove-cut-stages.test.ts"
# A etapa medida: a PRIMEIRA (as invariantes valem em todas, e o custo de cada
# rodada é uma cópia da árvore + a medição dos contratos — ~1s).
ETAPA="etapa-1"

TMP_DIR="$(mktemp -d)"

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
# As mutações são aplicadas NO LUGAR, no arquivo do repositório (é ele que o
# harness executa e que a suíte unitária importa).
alvo_backup="$TMP_DIR/prove-cut-stages.original.mjs"
cp "$ALVO" "$alvo_backup"
alvo_sum="$(cksum "$ALVO" | cut -d' ' -f1)"

cleanup() {
  cp -f "$alvo_backup" "$ALVO" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

restaurar_original() {
  cp -f "$alvo_backup" "$ALVO"
  if [ "$(cksum "$ALVO" | cut -d' ' -f1)" != "$alvo_sum" ]; then
    fail "RESTAURAÇÃO FALHOU (checksum do harness diverge) — restaure a partir de $alvo_backup"
    exit 1
  fi
}

# ── mutar: substituição CIRÚRGICA (exatamente 1 ocorrência) ───────────────
# Uma mutação que casa 0 ou 2+ vezes não é cirúrgica: o script para em vez de
# medir outra coisa. O marcador "MUTACAO M" no texto novo é o que prova que a
# mutação APLICOU (o alvo pode existir e a escrita falhar).
mutar() {
  ALVO="$ALVO" ANTES="$1" DEPOIS="$2" python3 - <<'PY'
import os
p = os.environ["ALVO"]
old, new = os.environ["ANTES"], os.environ["DEPOIS"]
s = open(p).read()
n = s.count(old)
if n != 1:
    raise SystemExit(f"mutacao nao-cirurgica no harness: {n} ocorrencia(s) do alvo (esperado 1)")
open(p, "w").write(s.replace(old, new))
PY
  if ! grep -qF 'MUTACAO M' "$ALVO"; then
    fail "a mutação não aplicou no harness (nada a medir)"
    exit 1
  fi
  if [ "$(cksum "$ALVO" | cut -d' ' -f1)" = "$alvo_sum" ]; then
    fail "a mutação não alterou o harness (checksum idêntico) — o alvo casou mas a escrita não"
    exit 1
  fi
}

# ── rodar: o harness REAL (o mesmo CLI de `bun run cut-stages:prove`) ─────
# Devolve exit e saída em HARNESS_EXIT / HARNESS_OUT (globais).
rodar() {
  set +e
  HARNESS_OUT="$(cd "$SCRIPT_DIR" && node "$ALVO" --only "$ETAPA" 2>&1)"
  HARNESS_EXIT=$?
  set -e
}

mostrar() { echo "$HARNESS_OUT" | tail -8 | sed 's/^/      /'; }

# ── exigir_verde: o harness declara o passo ───────────────────────────────
exigir_verde() {
  local cenario="$1"
  rodar
  if [ "$HARNESS_EXIT" -ne 0 ]; then
    fail "$cenario: esperava exit 0 (passo declarado) e veio $HARNESS_EXIT"
    mostrar
    exit 1
  fi
}

# ── exigir_quebrou: o harness REPROVA e NOMEIA a invariante ───────────────
# Não basta o exit 1: a mensagem tem de citar a invariante da vez — um vermelho
# vindo de outra regra (ou de um harness que morreu) não é a prova desta metade.
exigir_quebrou() {
  local cenario="$1" trecho="$2"
  rodar
  if [ "$HARNESS_EXIT" -ne 1 ]; then
    fail "$cenario: esperava exit 1 (quebra) e veio $HARNESS_EXIT — a invariante não denunciou"
    mostrar
    exit 1
  fi
  if ! grep -Fq "$trecho" <<<"$HARNESS_OUT"; then
    fail "$cenario: o harness reprovou, mas NÃO nomeou '${trecho}'"
    mostrar
    exit 1
  fi
}

# ── rodar_suite: a segunda testemunha (a suíte unitária do harness) ───────
suite_disponivel() { [ -d "$SCRIPT_DIR/node_modules/vitest" ]; }

rodar_suite() {
  set +e
  SUITE_OUT="$(cd "$SCRIPT_DIR" && bun x vitest run --config vitest.config.unit.ts "$SUITE_ARQUIVO" 2>&1 | tail -8)"
  SUITE_EXIT=$?
  set -e
}

exigir_suite_vermelha() {
  local cenario="$1"
  if ! suite_disponivel; then
    info "$cenario (suíte): NÃO julgada — node_modules/vitest ausente neste job (declarado, nunca silencioso)"
    return 0
  fi
  rodar_suite
  if [ "$SUITE_EXIT" -eq 0 ]; then
    fail "$cenario: a suíte unitária ficou VERDE com a invariante desligada — a regressão passaria no PR em silêncio"
    echo "$SUITE_OUT" | sed 's/^/      /'
    exit 1
  fi
  pass "$cenario: suíte unitária VERMELHA (exit $SUITE_EXIT) — a regressão não passa no PR"
}

# ── A LINHA da cópia do passo (a âncora ÚNICA das três injeções) ──────────
# É o ponto em que `runStage` copia a árvore para medir o passo: o mesmo lugar
# em que a transformação escreve. A injeção entra aqui como um statement, e o
# `throw` da âncora é fail-closed — se o texto casar 0 vezes, a metade FALHA
# nomeando o motivo em vez de medir um passo que não foi tocado.
ANCORA_COPIA='  const { arquivos, files } = copyTree(root, copy)'

# A pipeline da dona e a do espelho: as duas constantes do próprio harness (e
# a do espelho é a MESMA que ele usa para medir — não uma segunda declaração).
DONA_EXPR='PIPELINES.find((p) => p.mergeOwner).file'

echo -e "${CYAN}═══ Mutation test: as etapas do corte (prove-cut-stages) ═══${NC}"
echo "  harness: $ALVO"
echo "  suíte: $SUITE_ARQUIVO"

# ── 1. CONTROLE A: o harness está VERDE na árvore real ────────────────────
header "CONTROLE A: a árvore real fecha o passo sem quebra"
exigir_verde "CONTROLE A"
pass "CONTROLE A: a etapa 1 é declarada na árvore real (exit 0) — é este verde que a injeção tem de morder"

# ── 2. MUTAÇÃO M1: o GATE da dona do merge alterado ───────────────────────
# A injeção ACRESCENTA um passo de gate no job `guards` da pipeline da dona —
# um gate novo na pipeline que decide o merge. MEDIDO: os gates da dona vão de
# 28 para 29 e a paridade fica em 0 (a mudança é da invariante 1, e não do
# contrato de classificação): a direção da injeção é a do defeito real.
header "MUTAÇÃO M1: um passo de gate A MAIS na pipeline da dona do merge"
mutar "$ANCORA_COPIA" \
  "$ANCORA_COPIA; editText(join(copy, $DONA_EXPR), (t) => { const d = t.replace('      - name: Script header docs\n', '      - run: bun run check:hook-commands\n      - name: Script header docs\n'); if (d === t) throw new Error('MUTACAO M1: a ancora do passo da dona mudou'); return d }) /* MUTACAO M1 */"
exigir_quebrou "M1" "os gates da dona do merge"
pass "M1: o passo a MAIS na pipeline da dona é QUEBRA, nomeando a invariante (exit $HARNESS_EXIT)"
mostrar
mutar '  if (medido.dona.gates.join("|") !== base.dona.gates.join("|")) {' \
  '  if (false /* MUTACAO M1 */) {'
exigir_verde "M1 (invariante desligada)"
pass "M1: com a invariante desligada o MESMO excesso passa (CEGO) — o vermelho vinha dela, não de um crash"
exigir_suite_vermelha "M1"
restaurar_original

# ── 3. MUTAÇÃO M2: o REQUIRED CHECK da dona alterado ──────────────────────
# A injeção tira um job do manifesto da forja dona (`ci/required-checks.json`):
# a proteção da forja perde um contexto. MEDIDO: os contextos resolvidos da
# dona caem de 7 para 6, e a paridade fica em 0 — perder um required check é
# perder um portão, e é o que a invariante 2 existe para não deixar passar.
header "MUTAÇÃO M2: um required check A MENOS no manifesto da dona do merge"
mutar "$ANCORA_COPIA" \
  "$ANCORA_COPIA; editText(join(copy, 'ci/required-checks.json'), (t) => { const d = JSON.parse(t); d.forges.gitea.jobs.splice(d.forges.gitea.jobs.indexOf('lint'), 1); return JSON.stringify(d, null, 2) + '\n' }) /* MUTACAO M2 */"
exigir_quebrou "M2" "os required checks da dona do merge"
pass "M2: o required check a MENOS é QUEBRA, nomeando a invariante (exit $HARNESS_EXIT)"
mostrar
mutar '  if (ctxtMed !== ctxtBase) {' '  if (false /* MUTACAO M2 */) {'
exigir_verde "M2 (invariante desligada)"
pass "M2: com a invariante desligada o mesmo manifesto passa (CEGO) — a proteção da forja era o que denunciava"
exigir_suite_vermelha "M2"
restaurar_original

# ── 4. MUTAÇÃO M3: o gate do ESPELHO perdido sem declaração ───────────────
# A injeção remove o BLOCO de um passo do espelho (o gate do
# `check-e2e-counts.mjs`) numa etapa cuja declaração é `espelhoGates: null`
# (fica igual à anterior). MEDIDO: o espelho cai de 56 para 55 gates, e a
# paridade fica em 0 — o espelho perdendo inspeção sem a etapa declarar.
header "MUTAÇÃO M3: o espelho perde um gate que a etapa NÃO declara"
mutar "$ANCORA_COPIA" \
  "$ANCORA_COPIA; { const antes = readTextOrNull(join(copy, MIRROR_PIPELINE)); const d = removeStepBlocks(antes, (b) => b.includes('check-e2e-counts.mjs')).conteudo; if (d === antes) throw new Error('MUTACAO M3: o passo do espelho nao foi achado'); writeFileSync(join(copy, MIRROR_PIPELINE), d) } /* MUTACAO M3 */"
exigir_quebrou "M3" "o espelho perdeu/ganhou gates que o passo não declara"
pass "M3: o gate do espelho sem declaração é QUEBRA, nomeando o gate que saiu (exit $HARNESS_EXIT)"
mostrar
mutar '    if (medido.espelho.gates.join("|") !== anterior.espelho.gates.join("|")) {' \
  '    if (false /* MUTACAO M3 */) {'
exigir_verde "M3 (invariante desligada)"
pass "M3: com a invariante desligada o mesmo gate perdido passa (CEGO) — a declaração do passo era o que denunciava"
exigir_suite_vermelha "M3"
restaurar_original

# ── 5. CONTROLE FINAL: a árvore ficou como estava ─────────────────────────
header "CONTROLE FINAL: restauração verificada por checksum"
exigir_verde "CONTROLE FINAL"
pass "CONTROLE FINAL: o harness restaurado volta a declarar a etapa (exit 0)"

echo
echo -e "${GREEN}═══ MUTATION TEST PASSED — as 3 mutações foram detectadas (veredito e suíte) ═══${NC}"
