#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-readme-anchors.sh — Mutation test do guard de âncoras
# do README (check-readme-anchors.mjs)
#
# Prova que o scripts/check-readme-anchors.mjs REALMENTE pega link interno
# quebrado — o cenário exato que o guard existe para bloquear: um heading
# renomeado sem atualizar o link no MESMO PR (docs stale).
#
#   Cenário 1 (FORWARD):  renomeia um heading no README do fixture
#                         (### CRLF Guard → ### Gate CRLF) sem atualizar o
#                         link [CRLF Guard](#crlf-guard) — o forward do
#                         guard exige FALHA: link interno que não resolve.
#   Cenário 2 (REVERSE):  aponta um link para um heading que RESOLVE mas é o
#                         SEMANTICAMENTE errado ([CRLF Guard](#normalizador))
#                         — o forward passa (contrato forward-only), mas com
#                         --reverse o guard exige FALHA: label corresponde a
#                         outro heading.
#
# Se o guard PASSAR com qualquer mutação (exit 0), ele está CEGO — uma
# checagem foi removida/enfraquecida — e o script falha (exit 1), bloqueando
# o CI. É o espelho do test-mutation-hooks-symmetry.sh para o guard de
# âncoras (e do mutation-bun-literal para o guard do Bun).
#
# DIFERENÇA vs mutation-seed-dev-e2e: aqui o fixture é criado do zero num
# mktemp (o guard é node-puro, sem docker/prisma), e há um passo de CONTROLE
# (fixture limpo passa) — provando que a falha vem da mutação, não de um
# fixture quebrado. O script não toca NENHUM arquivo do repositório real.
#
# Pipeline:
#   1. Cria repo fixture temporário (README.md com headings + links)
#   2. CONTROLE: fixture limpo → guard deve PASS (exit 0) — forward e reverse
#   3. MUTAÇÃO 1 (forward): renomeia o heading ### CRLF Guard → ### Gate CRLF
#   4. Guard contra o fixture MUTADO → deve FALHAR pela asserção forward
#   5. Re-cria fixture limpo → MUTAÇÃO 2 (reverse): link [CRLF Guard] → #normalizador
#   6. Forward passa (contrato forward-only preservado) → --reverse deve FALHAR
#   7. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-readme-anchors.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com alguma mutação) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-readme-anchors.mjs"

TMP_DIR="$(mktemp -d)"

# ── Mutações (bugs conhecidos) ────────────────────────────────────────────
# Cenário 1: heading renomeado (slug antigo vira link órfão).
# Cenário 2: label do link apontando para o heading SEMANTICAMENTE errado.
# Asserções que o guard DEVE emitir quando detecta as mutações. Fonte:
#   forward — main() em scripts/check-readme-anchors.mjs:
#     '<file>:<line> [forward] [<label>]: '#<slug>''
#   reverse — main():
#     '<file>:<line> [reverse] [<label>]: '#<slug>' ... aponta para o
#     heading errado?'
#
# ⚠️ Source-coupled: estas strings reproduzem a mensagem EXATA do guard. Se
# a mensagem for reformulada em scripts/check-readme-anchors.mjs, o mutation
# test falha com 'não pela asserção esperada' (não é guard cego — é o
# esperado por acoplamento; atualizar as duas juntas).
EXPECTED_FAILURE_FORWARD="[forward] [CRLF Guard]: '#crlf-guard'"
EXPECTED_FAILURE_REVERSE="[reverse] [CRLF Guard]: '#normalizador'"

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Cleanup (trap EXIT — SEMPRE remove o temp, mesmo com falha) ──────────
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── build_fixture: (re)cria o repo fixture limpo ─────────────────────────
# Idempotente — usado no CONTROLE e na MUTAÇÃO 2 (que parte de um fixture
# limpo de novo, já que a MUTAÇÃO 1 sujou o README).
build_fixture() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR"

  # README mínimo: 2 headings reais (com acento PT + pontuação, exercitando
  # o slugger) + 2 links internos que RESOLVEM.
  cat > "$TMP_DIR/README.md" <<'EOF'
## Encoding Guards

- [CRLF Guard](#crlf-guard)
- [Auditoria histórica](#auditoria-histórica)

### CRLF Guard

### Auditoria histórica
EOF
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-readme-anchors deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Cria o fixture limpo e valida o CONTROLE (deve PASS)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando repo fixture temporário em $TMP_DIR..."

build_fixture
pass "Fixture criado (README.md com headings + links)"

info "STEP 2: Controle — fixture limpo → guard deve PASS (exit 0), forward e --reverse..."

set +e
CONTROL_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
CONTROL_EXIT=$?
REVERSE_CONTROL_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" --reverse 2>&1)"
REVERSE_CONTROL_EXIT=$?
set -e

if [ "$CONTROL_EXIT" -ne 0 ] || [ "$REVERSE_CONTROL_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (forward exit $CONTROL_EXIT, reverse exit $REVERSE_CONTROL_EXIT)."
  echo "$CONTROL_OUTPUT" | tail -8
  echo "$REVERSE_CONTROL_OUTPUT" | tail -8
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — fixture limpo passa no guard, forward e --reverse (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO 1 (forward): heading renomeado deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação 1 (renomeia ### CRLF Guard → ### Gate CRLF)..."

# Renomeia o heading SEM atualizar o link — o forward do guard deve acusar
# '[forward] [CRLF Guard]: '#crlf-guard'' (link órfão + heading mais próximo).
sed -i 's/^### CRLF Guard$/### Gate CRLF/' "$TMP_DIR/README.md"

# Fail-fast: verifica que a mutação realmente aplicou (o heading antigo
# sumiu e o novo existe).
if grep -Fq "### Gate CRLF" "$TMP_DIR/README.md" && ! grep -Fq "### CRLF Guard" "$TMP_DIR/README.md"; then
  pass "Mutação 1 aplicada: ### CRLF Guard → ### Gate CRLF"
else
  fail "Mutação 1 não aplicou (sed falhou?)."
  exit 1
fi

info "STEP 4: Rodando guard contra o fixture MUTADO (forward)..."
set +e
GUARD_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
GUARD_EXIT=$?
set -e

echo "$GUARD_OUTPUT" | tail -12

# Caso 1 — guard CEGO: PASS com a mutação. O forward foi removido/
# enfraquecido (checkAnchors). Este é o cenário que o mutation test
# existe para BLOQUEAR.
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (forward): check-readme-anchors passou com heading renomeado"
  fail "e link órfão (exit 0). Verifique se checkAnchors ainda acusa link"
  fail "que não resolve em scripts/check-readme-anchors.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
if ! grep -Fq "$EXPECTED_FAILURE_FORWARD" <<< "$GUARD_OUTPUT"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO pela asserção forward esperada:"
  fail "  esperava:  $EXPECTED_FAILURE_FORWARD"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

pass "Mutação 1 DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE_FORWARD' (exit $GUARD_EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO 2 (reverse): label apontando para heading errado
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Re-criando fixture limpo e aplicando mutação 2 (label errado)..."

build_fixture

# Aponta o link [CRLF Guard] para #normalizador — um heading que RESOLVE
# mas é o SEMANTICAMENTE errado. O forward passa; o --reverse deve acusar.
sed -i 's/(#crlf-guard)/(#normalizador)/' "$TMP_DIR/README.md"
printf '\n### Normalizador\n' >> "$TMP_DIR/README.md"

# Fail-fast: verifica que a mutação realmente aplicou.
if grep -Fq "#normalizador" "$TMP_DIR/README.md"; then
  pass "Mutação 2 aplicada: [CRLF Guard](#normalizador) + heading Normalizador"
else
  fail "Mutação 2 não aplicou (sed/printf falhou?)."
  exit 1
fi

info "STEP 6: Contrato forward-only — SEM --reverse deve PASS (exit 0)..."
set +e
FORWARD_ONLY_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
FORWARD_ONLY_EXIT=$?
set -e

if [ "$FORWARD_ONLY_EXIT" -ne 0 ]; then
  fail "FORWARD-ONLY QUEBROU: o guard SEM --reverse falhou com o link que"
  fail "resolve (exit $FORWARD_ONLY_EXIT). O contrato forward-only foi"
  fail "alterado — verifique se o reverse virou default em check-readme-anchors.mjs."
  exit 1
fi
pass "Forward-only OK — link que resolve passa sem a flag (exit 0)"

info "STEP 7: Rodando guard --reverse contra o fixture MUTADO..."
set +e
REVERSE_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" --reverse 2>&1)"
REVERSE_EXIT=$?
set -e

echo "$REVERSE_OUTPUT" | tail -12

# Caso 1 — guard CEGO (reverse): PASS com o label errado. A checagem
# semântica foi removida/enfraquecida (checkAnchorSemantics). BLOQUEIA.
if [ "$REVERSE_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (reverse): check-readme-anchors --reverse passou com"
  fail "[CRLF Guard](#normalizador) (exit 0). Verifique se checkAnchorSemantics"
  fail "ainda acusa label que corresponde a outro heading."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada.
if ! grep -Fq "$EXPECTED_FAILURE_REVERSE" <<< "$REVERSE_OUTPUT"; then
  fail "Guard falhou (exit $REVERSE_EXIT) mas NÃO pela asserção reverse esperada:"
  fail "  esperava:  $EXPECTED_FAILURE_REVERSE"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

pass "Mutação 2 DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE_REVERSE' (exit $REVERSE_EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de âncoras pega heading renomeado (forward)"
pass "e label semanticamente errado (reverse)"
exit 0
