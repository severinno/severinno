#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-merge-latency.sh — Mutation test do gate da LATÊNCIA
#
# Usage:
#   ./scripts/test-mutation-merge-latency.sh
#
# Exit codes:
#   0 — as TRÊS mutações DETECTADAS (o gate cega e/ou a suíte fica vermelha)
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
#   M1 — a DETECÇÃO da cobertura (`missing.push`): o job sem duração some da
#        lista e o veredito fica PRONTA com um número incompleto.
#   M2 — o EXIT CODE do `--check`: a medição continua certa e o CI passa assim
#        mesmo — o gate vira decoração.
#   M3 — o PAPEL do dono do merge: com o papel trocado, o veredito passa a
#        julgar a forja ERRADA (o espelho declara jobs sem medição de
#        propósito) e o gate trava, ou libera, quem não devia.
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

  cat >"$FIXTURE/.gitea/workflows/ci.yml" <<'YAML'
name: ci
on:
  pull_request:
jobs:
  guards:
    steps:
      - run: node scripts/check-bun-mirror.mjs
  algo-novo:
    steps:
      - run: bun run algo-que-ninguem-mede
YAML

  cat >"$FIXTURE/.github/workflows/pr-check.yml" <<'YAML'
name: pr-check
on:
  pull_request:
jobs:
  espelho:
    steps:
      - run: node scripts/check-bun-mirror.mjs
YAML

  # O benchmark não conhece nenhum dos comandos: nada é derivado.
  echo '{"guards": [], "rulers": {}}' >"$FIXTURE/docs/benchmarks/guard-timing-latest.json"

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
    "gitea": { "guards": { "ms": 1000, "provenance": "declarado", "source": "fixture", "date": "2026-09-16" } },
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

# ── MUTAÇÃO M1 — a DETECÇÃO da cobertura ──────────────────────────────────
# `missing.push(job.name)` é o que transforma "não medido" em veredito. Sem
# ele, o job sem duração some da lista e o estado fica PRONTA: o número
# publicado passa a medir menos pipeline do que existe — e fica MENOR.
header "MUTAÇÃO M1 — a detecção da cobertura (missing.push)"
info "Removendo a entrada do job sem duração da lista de pendências..."
mutar '    missing.push(job.name)' '    void job // MUTACAO M1: o job sem duracao some da lista'
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
echo -e "   ${GREEN}✅ MUTATION TEST PASSOU${NC} — as TRÊS metades são LOAD-BEARING:"
echo "      • a DETECÇÃO da cobertura (missing) → mutá-la cega o gate"
echo "      • o EXIT CODE do --check → fixá-lo em 0 desliga o bloqueio do CI"
echo "      • o PAPEL do dono do merge → trocá-lo julga a forja errada"
echo "      e cada mutação é CIRÚRGICA: restaurada entre as medições, com o"
echo "      gate mordendo de novo no controle final."
echo "  ═════════════════════════════════════════════════════════════════"
echo ""
