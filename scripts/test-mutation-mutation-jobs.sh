#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-mutation-jobs.sh — Mutation test do guard de cobertura
# de mutation tests (check-mutation-jobs.mjs)
#
# Prova que o scripts/check-mutation-jobs.mjs REALMENTE pega os TRÊS drifts
# de cobertura que ele existe para prevenir:
#
#   Cenário 1 (FORWARD — script órfão): adiciona um test-mutation-*.sh NOVO
#     em scripts/ SEM job correspondente (nem ref direta num workflow, nem na
#     matriz do master) — o guard exige FALHA: mutation test órfão.
#   Cenário 2 (REVERSE — matriz quebrada): a matriz SUBTESTS do master
#     referencia um script INEXISTENTE em scripts/ — o guard exige FALHA:
#     ref de matriz quebrada.
#   Cenário 3 (REVERSE — workflow quebrada): um run: DIRETO num workflow
#     referencia um script INEXISTENTE em scripts/ — o guard exige FALHA:
#     ref de workflow quebrada (par fechado com o forward nos dois lados).
#
# Se o guard PASSAR com qualquer mutação (exit 0), ele está CEGO (a checagem
# forward ou reverse foi removida/enfraquecida) — o script falha (exit 1),
# bloqueando o CI. É o espelho do test-mutation-hooks-symmetry.sh para o
# guard de cobertura transitiva.
#
# Fixture: o guard resolve scripts/, .github/workflows/ e package.json a
# partir de process.cwd() — um mini-repo mktemp com a estrutura mínima basta:
#   package.json                    — {} (o guard faz JSON.parse dos scripts)
#   .github/workflows/pr-check.yml  — run: bash scripts/test-mutation-guards.sh
#   scripts/test-mutation-guards.sh — matriz SUBTESTS=(... real ...)
#   scripts/test-mutation-real.sh   — a folha referenciada pela matriz
# O CONTROLE (fixture limpo) deve PASS (exit 0) — prova que a falha vem da
# mutação, não de um fixture quebrado. Não toca NENHUM arquivo do repo real.
#
# Pipeline:
#   1. Cria o mini-repo fixture (limpo) no mktemp
#   2. CONTROLE: guard contra o fixture limpo → deve PASS (exit 0)
#   3. MUTAÇÃO 1 (forward): adiciona scripts/test-mutation-ghost.sh órfão
#   4. Guard contra o fixture MUTADO → deve FALHAR pela asserção forward
#   5. Re-cria fixture limpo → MUTAÇÃO 2 (reverse): matriz referencia fantasma
#   6. Guard contra o fixture MUTADO → deve FALHAR pela asserção reverse
#   7. Re-cria fixture limpo → MUTAÇÃO 3 (reverse workflow): run: direto do
#      workflow referencia script fantasma
#   8. Guard contra o fixture MUTADO → deve FALHAR pela asserção reverse-
#      workflow
#   9. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-mutation-jobs.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com alguma mutação) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-mutation-jobs.mjs"

TMP_DIR="$(mktemp -d)"

# ── Mutações (bugs conhecidos) ────────────────────────────────────────────
# Script órfão (Cenário 1), ref de matriz quebrada (Cenário 2) e ref de
# workflow quebrada (Cenário 3).
ORPHAN_SCRIPT="test-mutation-ghost.sh"
GHOST_REF="test-mutation-fantasma.sh"

# Asserções que o guard DEVE emitir quando detecta a mutação. Fonte:
#   forward — checkMutationJobs em scripts/check-mutation-jobs.mjs:
#     mutation script '<s>' SEM job correspondente em NENHUM workflow ...
#   reverse matriz — checkMutationJobs:
#     matriz de '<orchestrator>' referencia '<r>' que NÃO existe em scripts/
#   reverse workflow — checkMutationJobs:
#     workflow referencia '<r>' que NÃO existe em scripts/
#
# ⚠️ Source-coupled: estas strings reproduzem o texto EXATO do guard. Se a
# mensagem for reformulada em scripts/check-mutation-jobs.mjs, o mutation
# test falha com 'não pela asserção esperada' (não é guard cego — é o
# esperado por acoplamento; atualizar as duas juntas).
EXPECTED_FAILURE_FORWARD="SEM job correspondente"
EXPECTED_FAILURE_REVERSE="NÃO existe em scripts/"
EXPECTED_FAILURE_REVERSE_WORKFLOW="workflow referencia"

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

# ── build_fixture: (re)cria o mini-repo limpo ─────────────────────────────
# Idempotente — usado no CONTROLE e na MUTAÇÃO 2 (que parte de um fixture
# limpo de novo, já que a MUTAÇÃO 1 adicionou um script órfão).
build_fixture() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR/.github/workflows" "$TMP_DIR/scripts"

  # package.json mínimo — o guard lê os scripts (JSON.parse) para mapear
  # `bun run test:mutation-X`; `{}` (sem scripts) é suficiente.
  printf '{}\n' > "$TMP_DIR/package.json"

  # Workflow com ref DIRETA ao master (run: single-line — o formato real).
  cat > "$TMP_DIR/.github/workflows/pr-check.yml" <<'EOF'
jobs:
  mutation-guards:
    runs-on: ubuntu-latest
    steps:
      - name: Mutation tests
        run: bash scripts/test-mutation-guards.sh
EOF

  # Master com matriz SUBTESTS referenciando a folha real.
  cat > "$TMP_DIR/scripts/test-mutation-guards.sh" <<'EOF'
#!/usr/bin/env bash
SUBTESTS=(
  "real|Real — folha coberta|scripts/test-mutation-real.sh"
)
EOF

  # Folha existente referenciada pela matriz (existe de verdade).
  printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP_DIR/scripts/test-mutation-real.sh"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-mutation-jobs deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Cria o mini-repo limpo e valida o CONTROLE (deve PASS)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando mini-repo fixture em $TMP_DIR..."

build_fixture
pass "Fixture criado (package.json + pr-check.yml + master + folha real)"

info "STEP 2: Controle — fixture limpo → guard deve PASS (exit 0)..."

set +e
CONTROL_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
CONTROL_EXIT=$?
set -e

if [ "$CONTROL_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $CONTROL_EXIT)."
  echo "$CONTROL_OUTPUT" | tail -15
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — fixture limpo passa no guard (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO 1 (forward): script órfão deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação 1 (script órfão adicionado a scripts/)..."

# Adiciona um test-mutation-*.sh SEM cobertura — nem ref direta num
# workflow, nem na matriz do master. O forward do guard deve acusar
# 'mutation script <s> SEM job correspondente'.
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP_DIR/scripts/$ORPHAN_SCRIPT"

# Fail-fast: verifica que a mutação realmente aplicou.
if [ -f "$TMP_DIR/scripts/$ORPHAN_SCRIPT" ]; then
  pass "Mutação 1 aplicada: scripts/$ORPHAN_SCRIPT órfão criado"
else
  fail "Mutação 1 não aplicou (printf falhou?)."
  exit 1
fi

info "STEP 4: Rodando guard contra o fixture MUTADO (forward)..."
set +e
GUARD_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
GUARD_EXIT=$?
set -e

echo "$GUARD_OUTPUT" | tail -12

# Caso 1 — guard CEGO: PASS com a mutação. O forward foi removido/
# enfraquecido (checkMutationJobs sem o loop de uncovered).
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (forward): check-mutation-jobs passou com script órfão"
  fail "($ORPHAN_SCRIPT) em scripts/ (exit 0). Verifique se a checagem"
  fail "forward ainda existe em scripts/check-mutation-jobs.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
if ! echo "$GUARD_OUTPUT" | grep -Fq "$EXPECTED_FAILURE_FORWARD"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO pela asserção forward esperada:"
  fail "  esperava:  $EXPECTED_FAILURE_FORWARD"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

# Caso 3 — defensivo: a violação deve citar o SCRIPT mutado pelo nome (não
# outra violação de cobertura do mesmo fixture).
if ! echo "$GUARD_OUTPUT" | grep -Fq "$ORPHAN_SCRIPT"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO citou o script órfão:"
  fail "  esperava:  linha contendo '$ORPHAN_SCRIPT'"
  fail "A violação apontou outro script — veja o output acima."
  exit 1
fi

pass "Mutação 1 DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE_FORWARD' citando '$ORPHAN_SCRIPT' (exit $GUARD_EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO 2 (reverse): matriz quebrada deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Re-criando fixture limpo e aplicando mutação 2 (matriz quebrada)..."

build_fixture

# Quebra a matriz: adiciona uma ref a um script INEXISTENTE em scripts/. O
# reverse do guard deve acusar 'matriz de ... referencia <r> que NÃO existe'.
cat > "$TMP_DIR/scripts/test-mutation-guards.sh" <<'EOF'
#!/usr/bin/env bash
SUBTESTS=(
  "real|Real — folha coberta|scripts/test-mutation-real.sh"
  "fantasma|Fantasma — ref quebrada|scripts/test-mutation-fantasma.sh"
)
EOF

if grep -Fq "$GHOST_REF" "$TMP_DIR/scripts/test-mutation-guards.sh"; then
  pass "Mutação 2 aplicada: matriz referencia scripts/$GHOST_REF inexistente"
else
  fail "Mutação 2 não aplicou (cat falhou?)."
  exit 1
fi

info "STEP 6: Rodando guard contra o fixture MUTADO (reverse)..."
set +e
REVERSE_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
REVERSE_EXIT=$?
set -e

echo "$REVERSE_OUTPUT" | tail -12

# Caso 1 — guard CEGO: PASS com a ref quebrada. O reverse foi removido/
# enfraquecido (checkMutationJobs sem o loop de scriptSet).
if [ "$REVERSE_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (reverse): check-mutation-jobs passou com matriz quebrada"
  fail "(ref a scripts/$GHOST_REF inexistente). Verifique se a checagem"
  fail "reverse ainda existe em scripts/check-mutation-jobs.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada.
if ! echo "$REVERSE_OUTPUT" | grep -Fq "$EXPECTED_FAILURE_REVERSE"; then
  fail "Guard falhou (exit $REVERSE_EXIT) mas NÃO pela asserção reverse esperada:"
  fail "  esperava:  $EXPECTED_FAILURE_REVERSE"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

# Caso 3 — defensivo: a violação deve citar a REF QUEBRADA pelo nome (não
# outra violação de cobertura do mesmo fixture).
if ! echo "$REVERSE_OUTPUT" | grep -Fq "$GHOST_REF"; then
  fail "Guard falhou (exit $REVERSE_EXIT) mas NÃO citou a ref quebrada:"
  fail "  esperava:  linha contendo '$GHOST_REF'"
  fail "A violação apontou outro script — veja o output acima."
  exit 1
fi

pass "Mutação 2 DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE_REVERSE' citando '$GHOST_REF' (exit $REVERSE_EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — MUTAÇÃO 3 (reverse — workflow): run: direto referencia fantasma
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: Re-criando fixture limpo e aplicando mutação 3 (workflow com ref quebrada)..."

build_fixture

# Adiciona um run: DIRETO no workflow referenciando um test-mutation-*.sh
# INEXISTENTE em scripts/ (arquivo fantasma). O reverse-workflow do guard
# deve acusar 'workflow referencia <r> que NÃO existe em scripts/'.
cat > "$TMP_DIR/.github/workflows/pr-check.yml" <<'EOF'
jobs:
  mutation-guards:
    runs-on: ubuntu-latest
    steps:
      - name: Mutation tests
        run: bash scripts/test-mutation-guards.sh
      - name: Workflow ref quebrada (fantasma)
        run: bash scripts/test-mutation-fantasma.sh
EOF

if grep -Fq "$GHOST_REF" "$TMP_DIR/.github/workflows/pr-check.yml"; then
  pass "Mutação 3 aplicada: workflow referencia scripts/$GHOST_REF inexistente"
else
  fail "Mutação 3 não aplicou (cat falhou?)."
  exit 1
fi

info "STEP 8: Rodando guard contra o fixture MUTADO (reverse — workflow)..."
set +e
WF_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
WF_EXIT=$?
set -e

echo "$WF_OUTPUT" | tail -12

# Caso 1 — guard CEGO: PASS com a ref de workflow quebrada. O reverse-workflow
# foi removido/enfraquecido (checkMutationJobs sem o loop de directRefs).
if [ "$WF_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (reverse-workflow): check-mutation-jobs passou com workflow"
  fail "referenciando scripts/$GHOST_REF inexistente. Verifique se a checagem"
  fail "reverse de directRefs ainda existe em scripts/check-mutation-jobs.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada.
if ! echo "$WF_OUTPUT" | grep -Fq "$EXPECTED_FAILURE_REVERSE_WORKFLOW"; then
  fail "Guard falhou (exit $WF_EXIT) mas NÃO pela asserção reverse-workflow:"
  fail "  esperava:  $EXPECTED_FAILURE_REVERSE_WORKFLOW"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

# Caso 3 — defensivo: a violação deve citar a REF QUEBRADA pelo nome.
if ! echo "$WF_OUTPUT" | grep -Fq "$GHOST_REF"; then
  fail "Guard falhou (exit $WF_EXIT) mas NÃO citou a ref quebrada de workflow:"
  fail "  esperava:  linha contendo '$GHOST_REF'"
  fail "A violação apontou outra ref — veja o output acima."
  exit 1
fi

pass "Mutação 3 DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE_REVERSE_WORKFLOW' citando '$GHOST_REF' (exit $WF_EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de cobertura pega os TRÊS drifts (forward + reverse matriz + reverse workflow)"
exit 0
