#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-nested-guard.sh — Mutation test do NESTED_GUARD_ENV
#
# Usage:
#   ./scripts/test-mutation-nested-guard.sh
#
# Exit codes:
#   0 — mutação DETECTADA: o guard removido faz o teste de recursão ficar VERMELHO
#   1 — suíte CEGA / a mutação não aplicou / infra ❌
#
# POR QUE: o doctor tem uma DEFESA EM PROFUNDIDADE contra recursão:
# FORGE_DOCTOR_NESTED impede que o doctor rode DENTRO da própria prova.
# Cortar esse guard e a dublagem (DOCTOR_SCRIPT) é o ÚNICO corte — se ela
# falhar, o ciclo bring-up → doctor → prova → bring-up recursa infinitamente.
#
# COMO: muta o guard IN-PLACE (backup + trap EXIT de restauração) e prova
# que o teste de recursão fica VERMELHO.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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

# ── Restore ──────────────────────────────────────────────────────────────
restore() {
  if [ -f "$BACKUP" ]; then
    cp "$BACKUP" "$DOCTOR"
    echo "  ↻ $DOCTOR restaurado do backup"
  fi
  rm -rf "$TMP_DIR"
}
trap restore EXIT

# ── Backup ───────────────────────────────────────────────────────────────
cp "$DOCTOR" "$BACKUP"
pass "Backup: $DOCTOR"

# ── CONTROLE: suite VERDE ─────────────────────────────────────────────────
info "CONTROLE — suite deve ficar VERDE..."
set +e
bun x vitest run --config vitest.config.unit.ts --reporter=json --outputFile="$RESULTS" \
  "$SUITE" -t "NESTED_GUARD_ENV" 2>&1 | tail -5
CTRL_EXIT=$?
set -e

if [ "$CTRL_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: a suíte do doctor não ficou verde no estado íntegro."
  exit 1
fi
pass "Controle OK — suíte verde com o guard intacto"

# ── MUTAÇÃO: remove o guard (regex preciso no bloco) ──────────────────────
info "MUTAÇÃO — removendo o NESTED_GUARD_ENV guard de forge-doctor.mjs..."
python3 -c "
import re, sys
src = open('$DOCTOR').read()
pat = re.compile(
    r'\n\s*// DEFESA EM PROFUNDIDADE[\s\S]*?if \(process\.env\[NESTED_GUARD_ENV\]\) \{[\s\S]*?process\.exit\(3\)\s*\}\n',
    re.MULTILINE,
)
if not pat.search(src):
    print('MUTACAO NAO APLICOU: padrao nao encontrado', file=sys.stderr)
    sys.exit(1)
src = pat.sub('\n  // MUTATION-NESTED-GUARD: guard desativado\n', src)
open('$DOCTOR', 'w').write(src)
"

# Verifica que o guard sumiu e o arquivo é válido
if grep -qF "DETECTADO RECURSAO" "$DOCTOR"; then
  fail "MUTAÇÃO NÃO APLICOU: 'DETECTADO RECURSAO' ainda existe em $DOCTOR"
  exit 1
fi
if ! node --check "$DOCTOR" >/dev/null 2>&1; then
  fail "MUTAÇÃO NÃO-CIRÚRGICA: o arquivo mutado não é válido sintaticamente."
  exit 1
fi
pass "Guard removido (sintaxe válida)"

# ── MUTAÇÃO: suíte VERMELHA ──────────────────────────────────────────────
info "MUTAÇÃO — suíte deve ficar VERMELHA (o teste de recursão agora falha)..."
rm -f "$RESULTS"
set +e
bun x vitest run --config vitest.config.unit.ts --reporter=json --outputFile="$RESULTS" \
  "$SUITE" -t "NESTED_GUARD_ENV" 2>&1 | tail -5
MUT_EXIT=$?
set -e

if [ "$MUT_EXIT" -eq 0 ]; then
  fail "SUÍTE CEGA: passou (exit 0) com o guard MUTADO."
  fail "A remoção voltaria em silêncio — a defesa em profundidade não seria exercitada."
  exit 1
fi

pass "Mutação DETECTADA: o NESTED_GUARD_ENV guard removido faz o doctor aceitar"
pass "  a recursão — o teste de defesa em profundidade ficou VERMELHO."

# ═════════════════════════════════════════════════════════════════════════
# Result (restore roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o NESTED_GUARD_ENV (defesa em profundidade contra recursão)"
pass "  tem testemunha: a suíte fica VERMELHA quando o guard é removido."
pass "  • controle: suíte verde com o guard intacto"
pass "  • mutação: guard removido → teste de recursão FALHA"
exit 0
