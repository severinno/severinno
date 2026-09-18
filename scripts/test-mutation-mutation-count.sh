#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-mutation-count.sh — Mutation test do COUNT GUARD
# (check-mutation-count.mjs — nº de sub-tests do master)
#
# Prova que o guard de drift de counts REALMENTE falha nas regressões que ele
# existe para bloquear. Duas classes, e a PRIMEIRA é a que acopla o contrato de
# merge:
#
#   Cenário F (A CLASSE):  o `check-required-checks` recusa um required check
#                           cujo `name:` carrega uma CONTAGEM — no job DIRETO e
#                           no job de um REUSABLE workflow (que é como o
#                           segundo caso real apareceu: ", 5 cenários").
#   CONTROLE F:             os mesmos jobs com `name:` COUNT-FREE → exit 0.
#   Cenário A (JOB NAME CARREGA O COUNT): o `name:` do job mutation-guards volta
#                           a dizer "Mutation guards master (13 node-pure
#                           mutation tests)". O nome de um job é o CONTEXTO do
#                           status check, e o branch protection exige esse
#                           contexto — então um número ali faz CADA bump de
#                           matriz reescrever o contrato de merge e a proteção
#                           da forja passar a exigir um check que não existe.
#                           O guard DEVE FALHAR (exit 1) citando o name.
#   CONTROLE E (BUMP LEGÍTIMO): matriz 14 com name COUNT-FREE + summary/README
#                           em 14 → o guard DEVE PASSAR (exit 0). É o defeito
#                           original virado do avesso: subir a matriz deixou de
#                           mexer no contexto protegido.
#   Cenário B (SUMMARY):    o summary fica "All 13..." com matriz 14 → DEVE
#                           FALHAR citando o summary.
#   Cenário C (README):     o README fica com "13 sub-tests" e a matriz vira
#                           14 → DEVE FALHAR citando README.md:linha.
#   Cenário D (HISTÓRICA):  ref histórica "era de 5 sub-tests" no README NÃO
#                           pode falhar o guard (a matriz segue 13) → CONTROLE.
#   CONTROLE:               fixture consistente (matriz 13 + refs 13) → exit 0.
#
# DIFERENÇA vs os demais mutation tests: aqui o guard é executado com --root
# contra um FIXTURE MINIMAL (não o repo real) — o guard lê só 3 arquivos
# (scripts/test-mutation-guards.sh, .github/workflows/pr-check.yml,
# README.md), então o fixture replica esses 3 com a matriz e as refs.
#
# Pipeline:
#   1. Cria fixture consistente (matriz 13 + refs 13 em pr-check/README)
#   2. CONTROLE: guard --root fixture → exit 0
#   3. MUTAÇÃO A: o name do job volta a carregar o count → DEVE FALHAR
#   4. CONTROLE E: matriz 14 com name COUNT-FREE + refs 14 → exit 0 (bump legítimo)
#   5. MUTAÇÃO B: matriz 14 (summary 13, resto 14) → guard DEVE FALHAR
#   6. MUTAÇÃO C: matriz 14 (README 13, resto 14) → guard DEVE FALHAR
#   7. CONTROLE D: ref histórica "era de 5" com matriz 13 → exit 0 (não-falso-positivo)
#   8. MUTAÇÃO F: required check com CONTAGEM no name (job direto + reusable) →
#      DEVE FALHAR citando CONTAGEM; CONTROLE F com os mesmos jobs count-free →
#      exit 0
#   9. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-mutation-count.sh
#
# Exit codes:
#   0 — mutações DETECTADAS + controles passam ✅
#   1 — guard CEGO (alguma mutação passou) OU controle falso-positivo ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="node $SCRIPT_DIR/scripts/check-mutation-count.mjs --root"
REQUIRED_GUARD="node $SCRIPT_DIR/scripts/check-required-checks.mjs --root"

TMP_DIR="$(mktemp -d)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Cleanup (trap EXIT) ────────────────────────────────────────────────────
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── make_fixture: cria os 3 arquivos que o guard lê ───────────────────────
# $1 = count da matriz | $2 = SUFIXO do name do job (default: "" — count-free)
# $3 = count do summary | $4 = count do README
# $5 = (opcional) ref histórica extra no README
make_fixture() {
  local matrix_count="$1" job_suffix="${2:-}" summary="$3" readme_count="$4"
  local historical="${5:-}"

  rm -rf "$TMP_DIR/scripts" "$TMP_DIR/.github" "$TMP_DIR/README.md"
  mkdir -p "$TMP_DIR/scripts" "$TMP_DIR/.github/workflows"

  # master com a matriz
  {
    echo '#!/usr/bin/env bash'
    echo "# Roda os $matrix_count mutation tests node-puro dos guards de CI num ÚNICO script"
    echo 'SUBTESTS=('
    for i in $(seq 1 "$matrix_count"); do
      echo "  \"sub-$i|Desc $i|scripts/test-mutation-sub-$i.sh\""
    done
    echo ')'
  } > "$TMP_DIR/scripts/test-mutation-guards.sh"

  # pr-check.yml com o job mutation-guards (name COUNT-FREE por default — é o
  # CONTEXTO do required check, e não pode carregar o tamanho da matriz)
  {
    echo "# Roda os $matrix_count mutation tests node-puro dos guards de CI num JOB SÓ via"
    echo 'jobs:'
    echo '  mutation-guards:'
    echo "    name: Mutation guards master$job_suffix"
    echo '    steps:'
    echo '      - run: bash scripts/test-mutation-guards.sh'
    echo '      - name: Summary'
    echo "        run: echo \"✅ All $summary node-pure mutation tests passed (...).\""
  } > "$TMP_DIR/.github/workflows/pr-check.yml"

  # README.md
  {
    echo "# Repo"
    echo "**$readme_count sub-tests node-puro** via \`scripts/test-mutation-guards.sh\`"
    echo "| master \`mutation-guards\` ($readme_count sub-tests) | x |"
    if [ -n "$historical" ]; then
      echo "era de $historical sub-tests e o timing-budget foi adicionado após a medição de $historical."
    fi
  } > "$TMP_DIR/README.md"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-mutation-count deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture consistente (matriz 13 + refs 13) → CONTROLE exit 0
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture consistente (matriz 13 + name count-free + refs 13)..."
make_fixture 13 "" 13 13

info "STEP 2: Controle — guard contra fixture consistente deve PASS (exit 0)..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU (exit $EXIT): fixture consistente foi rejeitado."
  echo "$OUTPUT" | tail -5
  exit 1
fi
pass "Controle OK — fixture consistente passa (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A (count no NAME): o contexto do required check volta a
# depender do tamanho da matriz → DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: MUTAÇÃO A — o name do job volta a carregar o count (13)..."
make_fixture 13 " (13 node-pure mutation tests)" 13 13

info "STEP 4: Rodando o guard contra a mutação A..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (name): o count de volta no name do job passou (exit 0) — o"
  fail "CONTEXTO do required check voltaria a mudar a cada bump de matriz."
  exit 1
fi
if ! grep -Fq "name do job" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO citou o name do job."
  exit 1
fi
if ! grep -Fq "required check" <<<"$OUTPUT"; then
  fail "O guard citou o name mas NÃO nomeou o acoplamento ao required check."
  exit 1
fi
pass "Mutação A DETECTADA: guard falhou citando o name e o required check (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — CONTROLE E (bump legítimo): matriz 14 com name count-free e refs
# 14 → exit 0. Subir a matriz deixou de mexer no contrato de merge.
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: CONTROLE E — matriz 14, name COUNT-FREE, summary/README 14..."
make_fixture 14 "" 14 14

info "STEP 6: Guard contra o bump legítimo de matriz..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e

if [ "$EXIT" -ne 0 ]; then
  fail "FALSO POSITIVO: um bump de matriz que NÃO toca o name do job fez o guard"
  fail "falhar (exit $EXIT) — o contrato de merge não pode depender da matriz."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Controle E OK — bump de matriz passa sem tocar o contexto do required check"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — MUTAÇÃO B (summary stale): matriz 14, summary 13 (resto 14) →
# DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: MUTAÇÃO B — matriz 14 com summary 13 (name count-free, README 14)..."
make_fixture 14 "" 13 14

info "STEP 8: Rodando o guard contra a mutação B..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (summary): matriz 14 com summary 13 passou (exit 0)."
  exit 1
fi
if ! grep -Fq "summary" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO citou o summary."
  exit 1
fi
pass "Mutação B DETECTADA: guard falhou citando o summary (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 9+10 — MUTAÇÃO C (README stale): matriz 14, README 13 (resto 14) →
# DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 9: MUTAÇÃO C — matriz 14 com README 13 (name count-free, summary 14)..."
make_fixture 14 "" 14 13

info "STEP 10: Rodando o guard contra a mutação C..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (README): matriz 14 com README 13 passou (exit 0)."
  exit 1
fi
if ! grep -Fq "README.md:" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO citou o README.md com linha."
  exit 1
fi
pass "Mutação C DETECTADA: guard falhou citando README.md:linha (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 11+12 — CONTROLE D (ref histórica): "era de 5" com matriz 13 → exit 0
# ═════════════════════════════════════════════════════════════════════════

info "STEP 11: CONTROLE D — ref HISTÓRICA 'era de 5 sub-tests' com matriz 13..."
make_fixture 13 "" 13 13 "5"

info "STEP 12: Guard contra o fixture com ref histórica..."
set +e
OUTPUT=$($GUARD "$TMP_DIR" 2>&1)
EXIT=$?
set -e

if [ "$EXIT" -ne 0 ]; then
  fail "FALSO POSITIVO: ref histórica 'era de 5 sub-tests' fez o guard falhar"
  fail "(exit $EXIT) com matriz 13 consistente."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Controle D OK — ref histórica é ignorada (exit 0, sem falso positivo)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

# ═════════════════════════════════════════════════════════════════════════
# STEP 13+14+15 — MUTAÇÃO F (a CLASSE): o `check-required-checks` recusa um
# required check cujo `name:` carrega CONTAGEM — no job direto E no job de um
# REUSABLE workflow (o caminho pelo qual o segundo caso real apareceu).
# ═════════════════════════════════════════════════════════════════════════

# ── Fixture do manifesto: jobs/direct + reusable, com name parametrizável ──
# $1 = name do job direto | $2 = name do job do reusable
make_required_fixture() {
  local direct_name="$1" reusable_name="$2"
  rm -rf "$TMP_DIR/rc"
  mkdir -p "$TMP_DIR/rc/ci" "$TMP_DIR/rc/.github/workflows"

  {
    echo '{'
    echo '  "version": 1,'
    echo '  "branches": ["main"],'
    echo '  "forges": {'
    echo '    "github": {'
    echo '      "workflow": ".github/workflows/pr.yml",'
    echo '      "jobs": ["master", "seed"]'
    echo '    }'
    echo '  }'
    echo '}'
  } > "$TMP_DIR/rc/ci/required-checks.json"

  # A DECLARAÇÃO da reaplicação EM SINCRONIA com os nomes deste fixture: o
  # guard compara os contextos DERIVADOS com a proteção APLICADA, e sem esta
  # metade ele falha por falha-closed — os dois cenários desta mutação medem o
  # COUNT, e uma segunda causa de vermelho tornaria a leitura ambígua.
  {
    echo '{'
    echo '  "version": 1,'
    echo '  "appliedAt": "2026-01-01",'
    echo '  "forges": {'
    echo '    "github": {'
    echo '      "workflow": ".github/workflows/pr.yml",'
    echo '      "branches": ["main"],'
    echo "      \"contexts\": [\"$direct_name\", \"$reusable_name\"]"
    echo '    }'
    echo '  }'
    echo '}'
  } > "$TMP_DIR/rc/ci/required-checks-applied.json"

  {
    echo 'name: Fixture'
    echo 'jobs:'
    echo '  master:'
    echo "    name: $direct_name"
    echo '    runs-on: self-hosted'
    echo '    steps:'
    echo '      - run: echo ok'
    echo '  seed:'
    echo '    uses: ./.github/workflows/reusable.yml'
  } > "$TMP_DIR/rc/.github/workflows/pr.yml"

  {
    echo 'name: Reusable'
    echo 'on:'
    echo '  workflow_call:'
    echo 'jobs:'
    echo '  coord:'
    echo "    name: $reusable_name"
    echo '    runs-on: self-hosted'
    echo '    steps:'
    echo '      - run: echo ok'
  } > "$TMP_DIR/rc/.github/workflows/reusable.yml"
}

info "STEP 13: CONTROLE F — os mesmos required checks com name COUNT-FREE..."
make_required_fixture "Mutation guards master" "Mutation Test (contrato coordenado — doc↔anchor↔código)"
set +e
OUTPUT=$($REQUIRED_GUARD "$TMP_DIR/rc" 2>&1)
EXIT=$?
set -e
if [ "$EXIT" -ne 0 ]; then
  fail "FALSO POSITIVO: required checks count-free foram rejeitados (exit $EXIT)."
  echo "$OUTPUT" | tail -4
  exit 1
fi
pass "Controle F OK — contextos count-free passam (exit 0)"

info "STEP 14: MUTAÇÃO F — CONTAGEM no name do job DIRETO e do REUSABLE..."
make_required_fixture "Mutation guards master (27 node-pure mutation tests)" \
  "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)"
set +e
OUTPUT=$($REQUIRED_GUARD "$TMP_DIR/rc" 2>&1)
EXIT=$?
set -e
echo "$OUTPUT" | grep -E '^   - ' | head -3

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (classe): um required check com CONTAGEM no name passou (exit 0)."
  fail "O contexto protegido voltaria a mudar quando o número mudasse."
  exit 1
fi
for alvo in "Mutation guards master (27 node-pure mutation tests)" \
  "Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)"; do
  if ! grep -Fq "$alvo" <<<"$OUTPUT"; then
    fail "O guard falhou (exit $EXIT) mas NÃO acusou o contexto '$alvo'"
    fail "(o caminho do reusable tem de ser coberto como o do job direto)."
    exit 1
  fi
done
if ! grep -Fq "CONTAGEM" <<<"$OUTPUT"; then
  fail "O guard falhou (exit $EXIT) mas NÃO nomeou a CONTAGEM como o defeito."
  exit 1
fi
pass "Mutação F DETECTADA: os DOIS contextos com contagem falham, nomeando CONTAGEM (exit $EXIT)"

echo ""
pass "MUTATION TEST PASSED — check-mutation-count pega o count de volta no NAME"
pass "do job (o contexto do required check não pode depender da matriz), no"
pass "summary e no README; check-required-checks recusa a CONTAGEM no name de"
pass "um required check (job direto E reusable); e nenhum dos dois falso-positiva."
exit 0
