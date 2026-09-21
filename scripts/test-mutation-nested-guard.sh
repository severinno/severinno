#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-nested-guard.sh — Mutation test da defesa contra recursão
#
# Usage:
#   ./scripts/test-mutation-nested-guard.sh
#
# Exit codes:
#   0 — AS DUAS mutações DETECTADAS: o guard removido (e a metade do argv
#       neutralizada) fazem a suíte de recursão ficar VERMELHA
#   1 — suíte CEGA / a mutação não aplicou / infra ❌
#
# POR QUE: o doctor tem uma DEFESA EM PROFUNDIDADE contra recursão. O corte
# PRIMÁRIO é a dublagem (DOCTOR_SCRIPT); esta é a segunda camada, e ela é
# marcada por DOIS canais — a env var `FORGE_DOCTOR_NESTED` (o padrão da prova)
# e a flag `--proof-nested` (para quem reexecuta o doctor por linha de comando
# sem controlar o ambiente do filho). Se o guard cair, o ciclo
# bring-up → doctor → prova → bring-up recursa até exaustão de recursos.
#
# UMA MUTAÇÃO POR METADE (a unidade é o canal, não o arquivo): derrubar o bloco
# inteiro prova que a defesa tem testemunha; neutralizar SÓ o argv prova que a
# metade nova (a flag) também tem a sua — sem isso, a flag poderia deixar de
# funcionar em silêncio e o caminho sem env voltaria a recursar.
#
# A SUÍTE também testemunha o RELATÓRIO da recursão (o fato `nestedGuard` em
# stdout / `--json`): com o guard removido (mutação A), o doctor volta a
# processar a invocação aninhada e o relatório deixa de existir — então a
# metade do fato cai junto com a metade do corte.
#
# COMO: muta o guard IN-PLACE (backup + trap EXIT de restauração) e exige que a
# suíte filtrada por `NESTED_GUARD_ENV` fique VERMELHA em cada mutação.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  'A|o bloco do guard removido de main()'
  'B|a metade do argv do predicado neutralizada'
)
cd "$SCRIPT_DIR"

DOCTOR="scripts/forge-doctor.mjs"
SUITE="src/lib/__tests__/forge-doctor.test.ts"

TMP_DIR="$(mktemp -d)"
BACKUP="$TMP_DIR/forge-doctor.mjs.backup"
RESULTS="$TMP_DIR/results.json"

# ── Colors ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Restore (trap EXIT — SEMPRE restaura, mesmo com falha) ────────────────
restore() {
  if [ -f "$BACKUP" ]; then
    cp "$BACKUP" "$DOCTOR"
    echo "  ↻ $DOCTOR restaurado do backup"
  fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT

# ── Helpers ───────────────────────────────────────────────────────────────
# run_suite: roda a suíte filtrada e devolve o exit code do vitest.
run_suite() {
  rm -f "$RESULTS"
  local code=0
  set +e
  bun x vitest run --config vitest.config.unit.ts --reporter=json \
    --outputFile="$RESULTS" "$SUITE" -t "NESTED_GUARD_ENV" 2>&1 | tail -5
  code=$?
  set -e
  return "$code"
}

# expect_red <rótulo>: a suíte filtrada tem de ficar VERMELHA (mutação vista).
expect_red() {
  local label="$1" code=0
  info "MUTAÇÃO $label — suíte deve ficar VERMELHA..."
  run_suite || code=$?
  if [ "$code" -eq 0 ]; then
    fail "SUÍTE CEGA: passou (exit 0) com a mutação '$label' aplicada."
    fail "A defesa em profundidade não seria exercitada — a regressão passa no CI."
    return 1
  fi
  pass "Mutação $label DETECTADA (suíte vermelha, exit $code)"
  return 0
}

cp "$DOCTOR" "$BACKUP"
pass "Backup: $DOCTOR"

# ── CONTROLE — suíte VERDE com o guard íntegro ────────────────────────────
info "CONTROLE — suíte deve ficar VERDE..."
if ! run_suite; then
  fail "CONTROLE FALHOU: a suíte do doctor não ficou verde no estado íntegro."
  fail "O mutation test não pode prosseguir (fixture base inválido)."
  exit 1
fi
pass "Controle OK — suíte verde com o guard intacto"

# ── MUTAÇÃO A — remove o bloco do guard em main() ─────────────────────────
info "MUTAÇÃO A — removendo o bloco do guard em main()..."
python3 -c "
import re, sys
src = open('$DOCTOR').read()
pat = re.compile(
    r'\n\s*// DEFESA EM PROFUNDIDADE[\s\S]*?if \(isNestedDoctorInvocation\(\)\) \{[\s\S]*?process\.exit\((?:NESTED_GUARD_EXIT|3)\)\s*\}\n',
    re.MULTILINE,
)
if not pat.search(src):
    print('MUTACAO A NAO APLICOU: padrao nao encontrado', file=sys.stderr)
    sys.exit(1)
src = pat.sub('\n  // MUTATION-NESTED-GUARD: guard desativado\n', src)
open('$DOCTOR', 'w').write(src)
"

if grep -qF "DETECTADO RECURSAO" "$DOCTOR"; then
  fail "MUTAÇÃO A NÃO APLICOU: 'DETECTADO RECURSAO' ainda existe em $DOCTOR"
  exit 1
fi
if ! node --check "$DOCTOR" >/dev/null 2>&1; then
  fail "MUTAÇÃO A NÃO-CIRÚRGICA: o arquivo mutado não é válido sintaticamente."
  exit 1
fi
pass "Bloco do guard removido (sintaxe válida)"

expect_red "A (bloco removido)" || exit 1

cp "$BACKUP" "$DOCTOR"
pass "Guard restaurado — base íntegra para a mutação B"

# ── MUTAÇÃO B — neutraliza SÓ a metade do argv do predicado ───────────────
# A defesa tem dois canais. Derrubar o bloco inteiro (A) não prova que a
# METADE nova (a flag) tem testemunha própria: se `argv.includes(...)` sumisse
# da condição, o caminho sem env voltaria a recursar — e a suíte precisa
# acender mesmo assim.
info "MUTAÇÃO B — removendo a metade do argv de isNestedDoctorInvocation..."
python3 -c "
import re, sys
src = open('$DOCTOR').read()
pat = re.compile(
    r'return Boolean\(env\[NESTED_GUARD_ENV\]\) \|\| argv\.includes\(NESTED_GUARD_FLAG\)'
)
if not pat.search(src):
    print('MUTACAO B NAO APLICOU: padrao nao encontrado', file=sys.stderr)
    sys.exit(1)
src = pat.sub('return Boolean(env[NESTED_GUARD_ENV]) // MUTATION-NESTED-ARGV', src)
open('$DOCTOR', 'w').write(src)
"

# A verificação olha o PREDICADO mutado (não a presença da substring no
# arquivo): `nestedGuardReport` também consulta o argv para NOMEAR o canal no
# relatório, e essa consulta é reporting, não defesa — ela deve continuar lá.
if ! grep -qF "return Boolean(env[NESTED_GUARD_ENV]) // MUTATION-NESTED-ARGV" "$DOCTOR"; then
  fail "MUTAÇÃO B NÃO APLICOU: o predicado mutado não está em $DOCTOR"
  exit 1
fi
if ! node --check "$DOCTOR" >/dev/null 2>&1; then
  fail "MUTAÇÃO B NÃO-CIRÚRGICA: o arquivo mutado não é válido sintaticamente."
  exit 1
fi
pass "Metade do argv removida do predicado (sintaxe válida)"

expect_red "B (argv neutralizado)" || exit 1

# ═════════════════════════════════════════════════════════════════════════
# Result (o restore roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — a defesa contra recursão tem testemunha nas DUAS"
pass "  metades: o bloco do guard E o canal do argv (--proof-nested)."
pass "  • controle: suíte verde com o guard intacto"
pass "  • mutação A: guard removido → teste de recursão FALHA"
pass "  • mutação B: só a flag neutralizada → teste da flag FALHA"
exit 0
