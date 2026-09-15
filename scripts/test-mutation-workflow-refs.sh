#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-workflow-refs.sh — Mutation test do guard de refs
# (check-workflow-refs.mjs)
#
# Usage:
#   ./scripts/test-mutation-workflow-refs.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com alguma mutação) OU falha de infra/asserção ❌
#
# Prova que o scripts/check-workflow-refs.mjs REALMENTE pega os DOIS drifts de
# referência que ele existe para prevenir, rodando o guard REAL (node) contra
# um mini-repo git fixture:
#
#   Cenário 1 (par TRANSITIVO — workflow → entry → script): o workflow roda
#     `bun run bench:geo`, a entry EXISTE em package.json e invoca
#     `node scripts/run-benchmark.mjs` — DELETA o script alvo
#     (scripts/run-benchmark.mjs). O guard (modo default, scan de workflows)
#     deve FALHAR com exit 1 citando a ENTRY ('entry 'bench:geo' aponta para
#     scripts/run-benchmark.mjs que NÃO existe'). É o espelho do mapeamento
#     `bun run test:mutation-X` do check-mutation-jobs.mjs: uma entry que
#     aponta para um script deletado falharia no runtime do job mesmo
#     existindo a entry; o guard pega no review.
#   Cenário 2 (consistência INTERNA — modo --pkg-internal): adiciona uma
#     entry `local:tools` que invoca `bash scripts/helper.sh` SEM NENHUM
#     workflow referenciando (órfã — ex.: hook local/manual `bun run
#     local:tools`), e DELETA o script alvo. O guard DEFAULT deve PASSAR
#     (exit 0 — o scan workflow-only não enxerga entries órfãs de workflow:
#     prova que o modo --pkg-internal existe e é necessário); o guard
#     --pkg-internal deve FALHAR com exit 1 citando a entry ('entry
#     'local:tools' invoca scripts/helper.sh que NÃO existe (consistência
#     INTERNA — mesmo sem workflow referenciando)').
#
# Se o guard PASSAR com qualquer mutação (exit 0), ele está CEGO (a checagem
# transitiva ou interna foi removida/enfraquecida) — o script falha (exit 1),
# bloqueando o CI. É o espelho do test-mutation-mutation-jobs.sh para o guard
# de referências entre workflows/scripts/package.json.
#
# Fixture: o guard resolve scripts/, .github/workflows/ e package.json a
# partir de process.cwd() — um mini-repo mktemp com a estrutura mínima basta:
#   package.json                    — scripts: { "bench:geo": "node
#                                     scripts/run-benchmark.mjs ..." }
#   .github/workflows/pr-check.yml  — run: bun run bench:geo
#   scripts/run-benchmark.mjs       — o alvo referenciado pela entry
# O CONTROLE (fixture limpo) deve PASS (exit 0) — prova que a falha vem da
# mutação, não de um fixture quebrado. Não toca NENHUM arquivo do repo real.
#
# Pipeline:
#   1. Cria o mini-repo fixture (limpo) no mktemp
#   2. CONTROLE: guard contra o fixture limpo → deve PASS (exit 0)
#   3. MUTAÇÃO 1 (transitiva): DELETA scripts/run-benchmark.mjs (alvo da
#      entry referenciada pelo workflow)
#   4. Guard contra o fixture MUTADO → deve FALHAR (exit 1) pela asserção
#      transitiva, citando a ENTRY + o alvo ausente
#   5. Re-cria fixture limpo → MUTAÇÃO 2 (interna): adiciona a entry órfã
#      `local:tools` + DELETA scripts/helper.sh (seu alvo)
#   6. Guard DEFAULT contra o fixture → deve PASS (exit 0) — prova que o
#      modo --pkg-internal é necessário (workflow-only não vê órfãs)
#   7. Guard --pkg-internal contra o fixture → deve FALHAR (exit 1) pela
#      asserção interna, citando a ENTRY + a consistência INTERNA
#   8. Cleanup (trap EXIT — rm -rf do temp)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-workflow-refs.mjs"

TMP_DIR="$(mktemp -d)"

# ── Mutações (bugs conhecidos) ────────────────────────────────────────────
# Entry referenciada por workflow (Cenário 1) + entry órfã (Cenário 2).
TRANSITIVE_ENTRY="bench:geo"
TRANSITIVE_TARGET="run-benchmark.mjs"
ORPHAN_ENTRY="local:tools"
ORPHAN_TARGET="helper.sh"

# Asserções que o guard DEVE emitir quando detecta a mutação. Fonte:
#   transitivo — checkWorkflowFile em scripts/check-workflow-refs.mjs:
#     entry '<ref>' aponta para scripts/<target> que NÃO existe
#   interno — checkPkgInternalTargets (modo --pkg-internal):
#     entry '<e>' invoca scripts/<t> que NÃO existe (consistência INTERNA —
#     mesmo sem workflow referenciando)
#
# ⚠️ Source-coupled: estas strings reproduzem o texto EXATO do guard. Se a
# mensagem for reformulada em scripts/check-workflow-refs.mjs, o mutation
# test falha com 'não pela asserção esperada' (não é guard cego — é o
# esperado por acoplamento; atualizar as duas juntas).
EXPECTED_FAILURE_TRANSITIVE="aponta para scripts/"
EXPECTED_FAILURE_INTERNAL="consistência INTERNA"

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
# limpo de novo, já que a MUTAÇÃO 1 deletou o script alvo).
build_fixture() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR/.github/workflows" "$TMP_DIR/scripts"

  # package.json com a entry referenciada pelo workflow (e, na MUTAÇÃO 2, a
  # entry órfã `local:tools`). O guard lê JSON.parse(pkg.scripts).
  cat > "$TMP_DIR/package.json" <<'EOF'
{
  "scripts": {
    "bench:geo": "node scripts/run-benchmark.mjs --type geo"
  }
}
EOF

  # Workflow com run: a entry via `bun run` — o gatilho do par TRANSITIVO
  # (entry EXISTE em package.json → o guard resolve o ALVO da entry).
  cat > "$TMP_DIR/.github/workflows/pr-check.yml" <<'EOF'
jobs:
  bench:
    runs-on: ubuntu-latest
    steps:
      - name: Geo bench
        run: bun run bench:geo
EOF

  # Alvo referenciado pela entry (existe de verdade no CONTROLE).
  printf '#!/usr/bin/env node\nconsole.log("ok")\n' > "$TMP_DIR/scripts/$TRANSITIVE_TARGET"
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-workflow-refs deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Cria o mini-repo limpo e valida o CONTROLE (deve PASS)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando mini-repo fixture em $TMP_DIR..."

build_fixture
pass "Fixture criado (package.json + pr-check.yml + scripts/$TRANSITIVE_TARGET)"

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
# STEP 3+4 — MUTAÇÃO 1 (transitiva): alvo de entry referenciada DELETADO
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação 1 (deletando scripts/$TRANSITIVE_TARGET — alvo da entry referenciada)..."

# Deleta o script alvo da entry `bench:geo` — o workflow `bun run bench:geo`
# agora apontaria para um arquivo inexistente no runtime. O par TRANSITIVO
# do guard deve acusar 'entry ... aponta para scripts/X que NÃO existe'.
rm -f "$TMP_DIR/scripts/$TRANSITIVE_TARGET"

# Fail-fast: verifica que a mutação realmente aplicou.
if [ ! -f "$TMP_DIR/scripts/$TRANSITIVE_TARGET" ]; then
  pass "Mutação 1 aplicada: scripts/$TRANSITIVE_TARGET deletado"
else
  fail "Mutação 1 não aplicou (rm falhou?)."
  exit 1
fi

info "STEP 4: Rodando guard contra o fixture MUTADO (transitivo)..."
set +e
GUARD_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
GUARD_EXIT=$?
set -e

echo "$GUARD_OUTPUT" | tail -12

# Caso 1 — guard CEGO: PASS com o alvo deletado. A checagem transitiva foi
# removida/enfraquecida (checkWorkflowFile sem o bloco ctx.pkgTargets?.get).
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (transitivo): check-workflow-refs passou com o alvo"
  fail "scripts/$TRANSITIVE_TARGET deletado (exit 0). Verifique se o par"
  fail "transitivo (pkgTargets) ainda existe em scripts/check-workflow-refs.mjs."
  exit 1
fi

# Caso 2 — EXIT CODE: a falha deve ser exit 1 (violação de referência), não
# exit 2+ (infra — ex.: diretório ilegível — que o grep da asserção 3 até
# pegaria, mas por acidente; o contrato é exit 1 de violação).
if [ "$GUARD_EXIT" -ne 1 ]; then
  fail "Guard falhou com exit $GUARD_EXIT (esperado: exit 1 EXATO de violação"
  fail "de referência). Exit diferente = falha de infra no fixture."
  exit 1
fi

# Caso 3 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
if ! grep -Fq "$EXPECTED_FAILURE_TRANSITIVE" <<< "$GUARD_OUTPUT"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO pela asserção transitiva esperada:"
  fail "  esperava:  $EXPECTED_FAILURE_TRANSITIVE"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

# Caso 4 — defensivo: a violação deve citar a ENTRY pelo nome (não outra
# ref do mesmo fixture).
if ! grep -Fq "$TRANSITIVE_ENTRY" <<< "$GUARD_OUTPUT"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO citou a entry mutada:"
  fail "  esperava:  linha contendo '$TRANSITIVE_ENTRY'"
  fail "A violação apontou outra ref — veja o output acima."
  exit 1
fi

# Caso 5 — defensivo (defense-in-depth, padrão do mutation-jobs: assertar a
# mensagem E o artefato mutado): a violação deve citar também o ALVO deletado
# pelo nome — prova que o guard resolveu a entry → alvo e apontou o script
# específico (não uma entry certa com o alvo errado).
if ! grep -Fq "$TRANSITIVE_TARGET" <<< "$GUARD_OUTPUT"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO citou o alvo deletado:"
  fail "  esperava:  linha contendo '$TRANSITIVE_TARGET'"
  fail "A violação citou a entry mas não o alvo — veja o output acima."
  exit 1
fi

pass "Mutação 1 DETECTADA: guard falhou (exit 1) com '❌ $EXPECTED_FAILURE_TRANSITIVE' citando a entry '$TRANSITIVE_ENTRY' → alvo '$TRANSITIVE_TARGET'"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6+7 — MUTAÇÃO 2 (interna --pkg-internal): entry órfã de workflow
# com alvo DELETADO — o modo default PASSA, o --pkg-internal FALHA
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Re-criando fixture limpo e aplicando mutação 2 (entry órfã + alvo deletado)..."
build_fixture

# Adiciona a entry órfã `local:tools` (NENHUM workflow a referencia — ex.:
# hook local/manual) + o script alvo dela. Em seguida DELETA o script: só o
# modo --pkg-internal enxerga (o scan workflow-only valida apenas entries
# REFERENCIADAS por um workflow).
#
# ⚠️ Sem node aqui de propósito: $TMP_DIR do mktemp do MSYS é um path
# estilo /tmp/... que o node do Windows resolve como C:\tmp\... (ENOENT).
# Heredoc + grep (como no resto do script) evitam a conversão de path.
cat > "$TMP_DIR/package.json" <<'EOF'
{
  "scripts": {
    "bench:geo": "node scripts/run-benchmark.mjs --type geo",
    "local:tools": "bash scripts/helper.sh --ci"
  }
}
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP_DIR/scripts/$ORPHAN_TARGET"
rm -f "$TMP_DIR/scripts/$ORPHAN_TARGET"

# Fail-fast: verifica que a mutação realmente aplicou (entry órfã no
# package.json + script alvo ausente em scripts/).
if grep -Fq "$ORPHAN_ENTRY" "$TMP_DIR/package.json" && [ ! -f "$TMP_DIR/scripts/$ORPHAN_TARGET" ]; then
  pass "Mutação 2 aplicada: entry órfã '$ORPHAN_ENTRY' sem o alvo scripts/$ORPHAN_TARGET"
else
  fail "Mutação 2 não aplicou (cat/printf falhou?)."
  exit 1
fi

info "STEP 6: Rodando guard DEFAULT contra o fixture — deve PASS (exit 0)..."
set +e
DEFAULT_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
DEFAULT_EXIT=$?
set -e

echo "$DEFAULT_OUTPUT" | tail -8

# O modo DEFAULT NÃO deve ver a entry órfã (workflow-only): a falha precisa
# vir do --pkg-internal, não do scan de workflows. Se o default falhar, o
# fixture (ou o guard) não reflete o contrato — o teste para com diagnóstico.
if [ "$DEFAULT_EXIT" -ne 0 ]; then
  fail "GUARD DEFAULT FALHOU (exit $DEFAULT_EXIT) com entry órfã — mas o"
  fail "scan workflow-only NÃO deveria enxergar '$ORPHAN_ENTRY' (órfã de"
  fail "workflow). O fixture/guard não reflete o contrato — veja o output."
  echo "$DEFAULT_OUTPUT" | tail -10
  exit 1
fi
pass "Guard default OK — entry órfã invisível ao workflow-only (exit 0): o modo --pkg-internal é necessário"

info "STEP 7: Rodando guard --pkg-internal contra o fixture — deve FALHAR..."
set +e
INTERNAL_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" --pkg-internal 2>&1)"
INTERNAL_EXIT=$?
set -e

echo "$INTERNAL_OUTPUT" | tail -12

# Caso 1 — guard CEGO: PASS com a entry órfã de alvo deletado. A consistência
# interna foi removida/enfraquecida (main() sem o bloco --pkg-internal ou
# checkPkgInternalTargets sem o loop).
if [ "$INTERNAL_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (interno): check-workflow-refs --pkg-internal passou com a"
  fail "entry órfã '$ORPHAN_ENTRY' invocando scripts/$ORPHAN_TARGET inexistente"
  fail "(exit 0). Verifique se o modo --pkg-internal ainda existe em"
  fail "scripts/check-workflow-refs.mjs."
  exit 1
fi

# Caso 2 — EXIT CODE EXATO: falha deve ser exit 1 (violação de referência).
if [ "$INTERNAL_EXIT" -ne 1 ]; then
  fail "Guard --pkg-internal falhou com exit $INTERNAL_EXIT (esperado: exit 1"
  fail "EXATO de violação). Exit diferente = falha de infra no fixture."
  exit 1
fi

# Caso 3 — falhou, mas NÃO pela asserção interna esperada.
if ! grep -Fq "$EXPECTED_FAILURE_INTERNAL" <<< "$INTERNAL_OUTPUT"; then
  fail "Guard --pkg-internal falhou (exit $INTERNAL_EXIT) mas NÃO pela asserção"
  fail "interna esperada:"
  fail "  esperava:  $EXPECTED_FAILURE_INTERNAL"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

# Caso 4 — defensivo: a violação deve citar a ENTRY órfã pelo nome.
if ! grep -Fq "$ORPHAN_ENTRY" <<< "$INTERNAL_OUTPUT"; then
  fail "Guard --pkg-internal falhou (exit $INTERNAL_EXIT) mas NÃO citou a entry"
  fail "órfã mutada:"
  fail "  esperava:  linha contendo '$ORPHAN_ENTRY'"
  fail "A violação apontou outra entry — veja o output acima."
  exit 1
fi

pass "Mutação 2 DETECTADA: guard --pkg-internal falhou (exit 1) com '❌ $EXPECTED_FAILURE_INTERNAL' citando a entry '$ORPHAN_ENTRY'"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de refs pega os DOIS drifts (transitivo workflow→entry→script + consistência interna --pkg-internal)"
exit 0
