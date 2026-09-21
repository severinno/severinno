#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-reconciliation.sh — Mutation tests do CICLO DE
# RECONCILIAÇÃO de issues de dívida (reconcileDebt em issue-publish.mjs)
#
# Usage:
#   ./scripts/test-mutation-reconciliation.sh
#
# Exit codes:
#   0 — as TRÊS mutações DETECTADAS: cada uma deixa o TESTE-ÂNCORA vermelho ✅
#   1 — suíte CEGA / âncora ausente (renomeada) / a testemunha NÃO RODOU (ambiente
#       sem dependências) / mutação não aplicou / infra ❌
#
# TRÊS mutações, cada uma provada por um teste específico:
#
#   1. FECHAR: remove `await backend.close(issue.number)` do loop.
#      O teste "veredito PRONTA com a issue ABERTA: comenta a prova e FECHA"
#      espera `state === 'closed'` → com a mutação, a issue fica "open" → FALHA.
#
#   2. ORDEM (prova→fechamento): inverte comment e close — o close acontece
#      ANTES do comment. A prova (comentário) nunca chega à issue (já fechada).
#      O teste "comenta a prova e fecha" espera que o comentário exista na
#      issue → com a mutação, o comentário sumiu → FALHA.
#
#   3. PROVA COMPARADA (stale-closure verification): remove o bloco
#      "VERIFICAÇÃO PÓS-FECHAMENTO" que re-lista issues abertas e detecta
#      fechamentos que não pegaram. Sem isso, um fechamento silencioso
#      (backend responde 200 mas issue continua aberta) passa despercebido.
#      O teste "stale-closure: fechamento que não pega é detectado" espera
#      stale.length > 0 → com a mutação, stale = [] → FALHA.
#
# COMO: cada mutação é aplicada IN-PLACE (backup + trap EXIT de restauração),
# o teste correspondente é rodado, e o resultado é verificado. As três
# rodam SEQUENCIALMENTE (cada uma restaura antes da próxima).
#
# A TESTEMUNHA É LIDA PELO JSON DO VITEST, NUNCA PELO EXIT CODE
#
# O exit code de um `vitest run` é não-zero por QUALQUER motivo: ambiente sem
# `node_modules`, `bun` fora do PATH, import quebrado, filtro que não casa teste
# nenhum. Ler "saiu != 0" como "mutação detectada" faz ESTE script passar verde
# num job sem dependências — provando nada. Foi MEDIDO: com `bun`/`bunx`
# indisponíveis, as três mutações saíam "DETECTADAS" e o script imprimia
# "MUTATION TEST PASSED" (exit 0) sem a suíte existir. O JSON diz QUAL teste
# rodou e com QUE status, e é isso que separa "vermelho POR CAUSA da mutação"
# de "vermelho por ambiente".
#
# CONTROLE:
#   - backup + trap de restauração (NUNCA deixa o repo sujo)
#   - validação de aplicação (o padrão precisa existir e sumir)
#   - validação de restauração (o padrão precisa voltar)
#   - TESTEMUNHA VIVA: cada ÂNCORA é rodada com a fonte ÍNTEGRA e tem de estar
#     PRESENTE (exatamente 1 teste casando) e PASSANDO. Sem esta metade, a
#     detecção abaixo seria vácuo — âncora renomeada ou ambiente quebrado dariam
#     "detectada" para as três mutações.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  '1|FECHAR: o close da issue removido do loop'
  '2|ORDEM (prova→fechamento): o close antes do comentário'
  '3|PROVA COMPARADA: a verificação pós-fechamento (stale-closure) removida'
)
REPO_ROOT="$SCRIPT_DIR"
TARGET="$REPO_ROOT/scripts/issue-publish.mjs"
TEST_FILE="$REPO_ROOT/src/lib/__tests__/forge-doctor-issue.test.ts"

# Os JSONs do vitest (a testemunha lida por status, não por exit code).
RESULTS_DIR="$(mktemp -d)"
RESULTS_CONTROL="$RESULTS_DIR/control.json"
RESULTS_MUTATION="$RESULTS_DIR/mutation.json"

# As ÂNCORAS: a substring que identifica o teste de cada mutação.
#   1) cobre as mutações 1 (fechar) e 2 (ordem) — o teste do fechamento com a prova;
#   2) cobre a mutação 3 — a verificação pós-fechamento (stale-closure).
ANCHOR_CLOSE="veredito PRONTA com a issue ABERTA"
ANCHOR_STALE="stale-closure: fechamento que não pega é detectado"

# ── Colors ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Backup + restore ─────────────────────────────────────────────────────
BACKUP="${TARGET}.mutation-backup"
cp "$TARGET" "$BACKUP"
trap 'cp "$BACKUP" "$TARGET"; rm -f "$BACKUP"; rm -rf "$RESULTS_DIR"' EXIT

# ── Helpers ───────────────────────────────────────────────────────────────

# apply_mutation: troca uma string por outra, valida que aplicou.
apply_mutation() {
  local from="$1" to="$2" label="$3"
  if ! grep -qF "$from" "$TARGET"; then
    fail "MUTAÇÃO NÃO APLICOU ($label): padrão não encontrado em issue-publish.mjs"
    exit 1
  fi
  sed -i "s|$(printf '%s' "$from" | sed 's|[&/]|\\&|g')|$(printf '%s' "$to" | sed 's|[&/]|\\&|g')|g" "$TARGET"
  if grep -qF "$from" "$TARGET"; then
    fail "MUTAÇÃO NÃO APLICOU ($label): o sed não trocou a linha"
    exit 1
  fi
  if ! node --check "$TARGET" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA ($label): o arquivo mutado não é válido sintaticamente"
    exit 1
  fi
  pass "Mutação aplicada ($label)"
}

# restore_file: restaura o arquivo do backup.
restore_file() {
  cp "$BACKUP" "$TARGET"
}

# ── A TESTEMUNHA: o vitest lido pelo JSON (ver o cabeçalho) ────────────────

# run_vitest <json> <filtro>: roda o arquivo de teste com o reporter JSON.
# Devolve o exit code em VITEST_EXIT e o log em VITEST_LOG.
run_vitest() {
  local results="$1" filter="$2"
  rm -f "$results"
  cd "$REPO_ROOT"
  set +e
  VITEST_LOG="$(timeout 180 bun x vitest run \
    --config vitest.config.unit.ts \
    --reporter=json \
    --outputFile="$results" \
    -t "$filter" \
    "$TEST_FILE" 2>&1)"
  VITEST_EXIT=$?
  set -e
}

# anchor_status <json> <substring>: imprime "N|status1,status2" dos testes cujo
# fullName contém a substring. O `N` é o que impede uma âncora AMBÍGUA (uma
# substring que casa dois testes) de medir o fato errado em silêncio.
anchor_status() {
  node -e '
    const fs = require("node:fs")
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const hits = (j.testResults ?? [])
      .flatMap((f) => f.assertionResults ?? [])
      .filter((r) => (r.fullName ?? "").includes(process.argv[2]))
    process.stdout.write(
      hits.length === 0 ? "0|absent" : `${hits.length}|${hits.map((h) => h.status).join(",")}`,
    )
  ' "$1" "$2"
}

# exigir_ancora <json> <estado> <substring> <rótulo>: a âncora tem de existir
# UMA vez e estar no estado pedido — "passed" no CONTROLE, "failed" na mutação.
# Sem JSON não há veredito: o exit code não distingue ambiente de detecção.
exigir_ancora() {
  local json="$1" esperado="$2" sub="$3" label="$4" report count statuses
  if [ ! -f "$json" ]; then
    fail "TESTEMUNHA NÃO RODOU ($label): o vitest não produziu o JSON de resultados."
    fail "Ambiente sem dependências ou sem \`bun\`? O exit code ($VITEST_EXIT) NÃO é"
    fail "  veredito: ele é não-zero por ambiente, por import quebrado e por filtro"
    fail "  sem teste. A mutação só é DETECTADA quando a âncora fica 'failed' no JSON."
    exit 1
  fi
  report="$(anchor_status "$json" "$sub")"
  count="${report%%|*}"
  statuses="${report#*|}"
  if [ "$count" != "1" ] || [ "$statuses" != "$esperado" ]; then
    fail "ÂNCORA FORA DO ESTADO ESPERADO ($label): \"$sub\""
    fail "  → $count teste(s) casaram, status '$statuses' (esperado 1 casando, '$esperado')."
    if [ "$count" = "0" ]; then
      fail "Renomeou/removeu o teste-âncora? A detecção aqui seria VÁCUA — atualize a"
      fail "  âncora DESTE script (e o sub-test do master)."
    fi
    exit 1
  fi
}

# controle_testemunha: cada âncora VIVA (presente e passando) com a fonte
# ÍNTEGRA — a metade que separa "mutação detectada" de "ambiente quebrado".
controle_testemunha() {
  local par label sub
  for par in "fechar (mutações 1 e 2)|$ANCHOR_CLOSE" "stale-closure (mutação 3)|$ANCHOR_STALE"; do
    label="${par%%|*}"
    sub="${par#*|}"
    info "CONTROLE — âncora de $label deve estar VIVA (presente e PASSANDO)..."
    run_vitest "$RESULTS_CONTROL" "$sub"
    exigir_ancora "$RESULTS_CONTROL" "passed" "$sub" "$label"
    pass "Controle OK — \"$sub\" presente (1 teste) e PASSANDO com a fonte íntegra"
  done
}

# ══════════════════════════════════════════════════════════════════════════
# MUTAÇÃO 1: FECHAR — remove backend.close()
# ══════════════════════════════════════════════════════════════════════════

mutation_close() {
  info "═══ MUTAÇÃO 1/3 — FECHAR (remove backend.close()) ═══"

  local FROM='    await backend.close(issue.number)'
  local TO='    // [mutation-test] await backend.close(issue.number)'

  apply_mutation "$FROM" "$TO" "fechar"

  info "Rodando teste de reconciliação..."
  run_vitest "$RESULTS_MUTATION" "$ANCHOR_CLOSE"
  if [ "$VITEST_EXIT" -eq 0 ]; then
    fail "SUÍTE CEGA (fechar): a âncora PASSOU COM a mutação — o close não é exercitado"
    restore_file
    exit 1
  fi
  exigir_ancora "$RESULTS_MUTATION" "failed" "$ANCHOR_CLOSE" "fechar"
  pass "Mutação 1 DETECTADA: sem backend.close(), a âncora da issue fica VERMELHA (JSON: 'failed')"

  restore_file
  pass "Restaurado"
}

# ══════════════════════════════════════════════════════════════════════════
# MUTAÇÃO 2: ORDEM — inverte comment e close
# ══════════════════════════════════════════════════════════════════════════

mutation_order() {
  info "═══ MUTAÇÃO 2/3 — ORDEM (close antes de comment) ═══"

  # O bloco original:
  #   await backend.comment(...)
  #   await backend.close(...)
  # Mutado para:
  #   await backend.close(...)
  #   await backend.comment(...)
  local FROM='    await backend.comment(\n      issue.number,\n      typeof resolutionBody === "function" ? resolutionBody(issue) : resolutionBody,\n    )\n    await backend.close(issue.number)'
  local TO='    await backend.close(issue.number)\n    await backend.comment(\n      issue.number,\n      typeof resolutionBody === "function" ? resolutionBody(issue) : resolutionBody,\n    )'

  # Usamos python para trocar o bloco multiline com precisão
  python3 -c "
import sys
src = open('$TARGET').read()
old = '''    await backend.comment(
      issue.number,
      typeof resolutionBody === \"function\" ? resolutionBody(issue) : resolutionBody,
    )
    await backend.close(issue.number)'''
new = '''    await backend.close(issue.number)
    await backend.comment(
      issue.number,
      typeof resolutionBody === \"function\" ? resolutionBody(issue) : resolutionBody,
    )'''
if old not in src:
    print('MUTACAO NAO APLICOU (ordem): padrao nao encontrado', file=sys.stderr)
    sys.exit(1)
src = src.replace(old, new, 1)
open('$TARGET', 'w').write(src)
"

  if ! node --check "$TARGET" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA (ordem): sintaxe inválida"
    restore_file
    exit 1
  fi
  pass "Mutação aplicada (ordem)"

  info "Rodando teste de reconciliação..."
  run_vitest "$RESULTS_MUTATION" "$ANCHOR_CLOSE"
  if [ "$VITEST_EXIT" -eq 0 ]; then
    fail "SUÍTE CEGA (ordem): a âncora PASSOU COM a mutação"
    restore_file
    exit 1
  fi
  exigir_ancora "$RESULTS_MUTATION" "failed" "$ANCHOR_CLOSE" "ordem"
  pass "Mutação 2 DETECTADA: close antes de comment → a âncora fica VERMELHA (JSON: 'failed')"

  restore_file
  pass "Restaurado"
}

# ══════════════════════════════════════════════════════════════════════════
# MUTAÇÃO 3: PROVA COMPARADA — remove verificação pós-fechamento
# ══════════════════════════════════════════════════════════════════════════

mutation_stale_verify() {
  info "═══ MUTAÇÃO 3/3 — PROVA COMPARADA (remove stale-closure verification) ═══"

  # Remove o bloco VERIFICAÇÃO PÓS-FECHAMENTO inteiro
  python3 -c "
import re, sys
src = open('$TARGET').read()
# Encontra o bloco desde o comentário até o return
pat = re.compile(
    r'\n  // VERIFICAÇÃO PÓS-FECHAMENTO:.*?return \{ closed, stale,',
    re.DOTALL,
)
m = pat.search(src)
if not m:
    print('MUTACAO NAO APLICOU (stale-verify): padrao nao encontrado', file=sys.stderr)
    sys.exit(1)
# Substitui por return direto (sem stale verification)
src = src[:m.start()] + '\n  return { closed, stale,' + src[m.end():]
open('$TARGET', 'w').write(src)
"

  if ! node --check "$TARGET" >/dev/null 2>&1; then
    fail "MUTAÇÃO NÃO-CIRÚRGICA (stale-verify): sintaxe inválida"
    restore_file
    exit 1
  fi
  pass "Mutação aplicada (stale-verify)"

  info "Rodando teste de stale-closure..."
  run_vitest "$RESULTS_MUTATION" "$ANCHOR_STALE"
  if [ "$VITEST_EXIT" -eq 0 ]; then
    fail "SUÍTE CEGA (stale-verify): a âncora PASSOU COM a mutação"
    restore_file
    exit 1
  fi
  exigir_ancora "$RESULTS_MUTATION" "failed" "$ANCHOR_STALE" "stale-verify"
  pass "Mutação 3 DETECTADA: sem verificação, a âncora do stale-closure fica VERMELHA (JSON: 'failed')"

  restore_file
  pass "Restaurado"
}

# ══════════════════════════════════════════════════════════════════════════
# Bootstrap
# ══════════════════════════════════════════════════════════════════════════

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (reconciliação de issues, 3 mutações)"
echo "   1. fechar (backend.close) · 2. ordem (close antes de comment)"
echo "   3. prova comparada (stale-closure verification)"
echo "   (IN-PLACE, backup + trap de restauração; veredito pelo JSON do vitest)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

controle_testemunha

mutation_close
mutation_order
mutation_stale_verify

# ═════════════════════════════════════════════════════════════════════════
# Result (restore roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — as TRÊS mutações do ciclo de reconciliação"
pass "  de issues de dívida são detectadas:"
pass "  • 1. fechar: sem backend.close() → issue fica ABERTA"
pass "  • 2. ordem: close antes de comment → prova não chega à issue"
pass "  • 3. prova comparada: sem verificação → stale-closure passa despercebido"
exit 0
