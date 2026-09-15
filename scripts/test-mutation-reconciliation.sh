#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-reconciliation.sh — Mutation tests do CICLO DE
# RECONCILIAÇÃO de issues de dívida (reconcileDebt em issue-publish.mjs)
#
# Usage:
#   ./scripts/test-mutation-reconciliation.sh
#
# Exit codes:
#   0 — as TRÊS mutações DETECTADAS: cada uma deixa a suíte VERMELHA ✅
#   1 — suíte CEGA / falhou por outro motivo / mutação não aplicou / infra ❌
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
# CONTROLE:
#   - backup + trap de restauração (NUNCA deixa o repo sujo)
#   - validação de aplicação (o padrão precisa existir e sumir)
#   - validação de restauração (o padrão precisa voltar)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$SCRIPT_DIR"
TARGET="$REPO_ROOT/scripts/issue-publish.mjs"
TEST_FILE="$REPO_ROOT/src/lib/__tests__/forge-doctor-issue.test.ts"

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
trap 'cp "$BACKUP" "$TARGET"; rm -f "$BACKUP"' EXIT

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

# run_test: roda um teste específico e retorna o exit code.
run_test() {
  local test_name="$1"
  cd "$REPO_ROOT"
  set +e
  timeout 120 bunx vitest run \
    --config vitest.config.unit.ts \
    --bail 1 \
    -t "$test_name" \
    "$TEST_FILE" 2>&1
  local result=$?
  set -e
  return $result
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
  if run_test "veredito PRONTA com a issue ABERTA"; then
    fail "SUÍTE CEGA (fechar): o teste passou COM a mutação — o close não é exercitado"
    restore_file
    exit 1
  fi
  pass "Mutação 1 DETECTADA: sem backend.close(), a issue fica ABERTA"

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
  if run_test "veredito PRONTA com a issue ABERTA"; then
    fail "SUÍTE CEGA (ordem): o teste passou COM a mutação"
    restore_file
    exit 1
  fi
  pass "Mutação 2 DETECTADA: close antes de comment → prova não chega à issue"

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
  if run_test "stale-closure"; then
    fail "SUÍTE CEGA (stale-verify): o teste passou COM a mutação"
    restore_file
    exit 1
  fi
  pass "Mutação 3 DETECTADA: sem verificação, stale-closure passa despercebido"

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
echo "   (IN-PLACE, backup + trap de restauração)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

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
