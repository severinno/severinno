#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-utf8-scope.sh — Mutation test do guard de escopo UTF-8
# (check-utf8-scope.mjs)
#
# Prova que o scripts/check-utf8-scope.mjs REALMENTE pega o escopo REMOVIDO
# — o cenário exato que o guard existe para bloquear: um call site a
# check-utf8.sh sem o argumento `src/` (o Python passaria a varrer o
# diretório de trabalho INTEIRO, incluindo node_modules/ e .next/).
#
#   Cenário 1 (UTF8-CHECK.YML):  remove `src/` do call site
#                                `run: bash scripts/check-utf8.sh --ci src/`
#                                no .github/workflows/utf8-check.yml — o
#                                guard exige FALHA. (No YAML, o token `run:`
#                                vira o "argumento de diretório" quando
#                                `src/` some — o guard reporta 'trocado para
#                                run:' — ver nota source-coupled abaixo.)
#   Cenário 2 (RUNNER):          remove `src/` do call site
#                                `bash scripts/check-utf8.sh --dry-run --ci src/`
#                                no scripts/run-encoding-guards.sh — o guard
#                                exige FALHA pela asserção canônica
#                                'SEM argumento de diretório'.
#
# Se o guard PASSAR com qualquer mutação (exit 0), ele está CEGO — uma
# checagem foi removida/enfraquecida — e o script falha (exit 1), bloqueando
# o CI. É o espelho do test-mutation-readme-anchors.sh para o guard de escopo
# UTF-8 (e do mutation-hooks-symmetry para a simetria).
#
# DIFERENÇA vs mutation-seed-dev-e2e: aqui o fixture é criado do zero num
# mktemp (o guard é node-puro, sem docker/prisma), e há um passo de CONTROLE
# (fixture limpo passa) — provando que a falha vem da mutação, não de um
# fixture quebrado. O script não toca NENHUM arquivo do repositório real.
#
# Pipeline:
#   1. Cria repo fixture temporário (os 6 arquivos do UTF8_SCOPE_FILES com
#      call sites válidos apontando para src/)
#   2. CONTROLE: fixture limpo → guard deve PASS (exit 0)
#   3. MUTAÇÃO 1: remove `src/` do call site no .github/workflows/utf8-check.yml
#   4. Guard contra o fixture MUTADO → deve FALHAR (escopo removido/trocado)
#   5. Re-cria fixture limpo → MUTAÇÃO 2: remove `src/` do run-encoding-guards.sh
#   6. Guard contra o fixture MUTADO → deve FALHAR (SEM argumento de diretório)
#   7. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-utf8-scope.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com alguma mutação) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# O SCRATCH DAS FIXTURES É ESTÁVEL E FORA DO `/tmp`: o `/tmp` é limpo por FORA e a
# rodada LONGA perdia fixture no meio da medição (o motivo inteiro, com as duas
# medições, está no cabeçalho do master). A raiz é a MESMA em toda rodada e NÃO
# fica DENTRO do repositório: uma fixture dentro de um repo muda de semântica —
# `node_modules`, o prettier e o git do projeto passam a alcançá-la (medido).
MUT_SCRATCH="${MUT_SCRATCH:-${XDG_CACHE_HOME:-$HOME/.cache}/severinno-mutacao}"
mkdir -p "$MUT_SCRATCH" 2>/dev/null || {
  echo "❌ o scratch das fixtures não pôde ser criado: $MUT_SCRATCH (infra declarada)" >&2
  exit 2
}

# ── METADES DESTA SUÍTE (a fonte única: o master e a doc leem daqui) ───────
# Uma linha por metade: "id|o que ela tira do lugar". Acrescentar uma mutação
# SEM a linha aqui é o que o `check-mutation-count` recusa — a descrição do
# master e a prosa da doc são DERIVADAS deste bloco, não mantidas à mão.
METADES=(
  '1|o call site do utf8-check.yml sem src/'
  '2|o runner (run-encoding-guards.sh) sem src/'
)
GUARD="$SCRIPT_DIR/scripts/check-utf8-scope.mjs"

TMP_DIR="$(mktemp -d "$MUT_SCRATCH/mut-XXXXXX")"

# ── Mutações (bugs conhecidos) ────────────────────────────────────────────
# Ambos removem o argumento `src/` de um call site — o escopo INTENCIONAL.
# Asserções que o guard DEVE emitir quando detecta as mutações. Fonte:
#   checkUtf8Scope em scripts/check-utf8-scope.mjs:
#     dir === null → '<file>:<line>: chamada 'check-utf8' SEM argumento de
#                    diretório — o escopo UTF-8 deve ser 'src/' ...'
#     dir !== src  → '<file>:<line>: escopo UTF-8 trocado para '<dir>' —
#                    deve ser 'src/' ...'
#
# ⚠️ Source-coupled: estas strings reproduzem a mensagem EXATA do guard. Se
# a mensagem for reformulada em scripts/check-utf8-scope.mjs, o mutation
# test falha com 'não pela asserção esperada' (não é guard cego — é o
# esperado por acoplamento; atualizar as duas juntas).
#
# Nota (Cenário 1): no YAML, `run: bash scripts/check-utf8.sh --ci` sem `src/`
# faz o token `run:` (a chave do step) ser interpretado como argumento de
# diretório pelo tokenizer do guard — a mensagem é 'escopo UTF-8 trocado
# para run:' e NÃO 'SEM argumento'. É o comportamento REAL do guard com o
# call site mutado; o teste trava a mensagem como ela é emitida.
EXPECTED_FAILURE_YML="escopo UTF-8 trocado para 'run:'"
EXPECTED_FAILURE_RUNNER="chamada 'check-utf8' SEM argumento de diretório"
# Arquivos que as mutações DEVEM acusar (junto da mensagem) — garante que a
# falha veio do call site mutado certo, não de outro invariante do fixture.
EXPECTED_FILE_YML=".github/workflows/utf8-check.yml"
EXPECTED_FILE_RUNNER="scripts/run-encoding-guards.sh"

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
# limpo de novo, já que a MUTAÇÃO 1 sujou o utf8-check.yml).
#
# O guard valida EXATAMENTE os 6 arquivos de UTF8_SCOPE_FILES — o fixture
# precisa de TODOS eles (falta de arquivo = infra error exit 2). Cada um com
# call site válido apontando para src/ (ou o default search_dir="src" no py).
build_fixture() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR/scripts" "$TMP_DIR/.github/workflows"

  # 1. scripts/check-utf8.sh — wrapper shell (a chamada ao py vai por $@).
  cat > "$TMP_DIR/scripts/check-utf8.sh" <<'EOF'
#!/usr/bin/env bash
# Wrapper do check_utf8.py — escopo travado por check-utf8-scope.mjs.
exec "$(dirname "$0")/check_utf8.py" "$@"
EOF

  # 2. scripts/check_utf8.py — default search_dir = "src" (linha 0 do guard).
  cat > "$TMP_DIR/scripts/check_utf8.py" <<'EOF'
import os
search_dir = "src"
if len(os.sys.argv) > 1:
    search_dir = os.sys.argv[1]
EOF

  # 3. scripts/run-encoding-guards.sh — call site com src/.
  cat > "$TMP_DIR/scripts/run-encoding-guards.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
bash scripts/check-utf8.sh --dry-run --ci src/
EOF

  # 4. .github/workflows/utf8-check.yml — call site com src/.
  cat > "$TMP_DIR/.github/workflows/utf8-check.yml" <<'EOF'
name: UTF-8 Check
on:
  workflow_call:
jobs:
  utf8-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash scripts/check-utf8.sh --ci src/
EOF

  # 5. .github/workflows/utf8-auto-fix.yml — call site com src/.
  cat > "$TMP_DIR/.github/workflows/utf8-auto-fix.yml" <<'EOF'
name: UTF-8 Auto-Fix
on:
  workflow_call:
jobs:
  utf8-auto-fix:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/check-utf8.sh --ci src/
EOF

  # 6. .github/workflows/pr-check.yml — call site com src/.
  cat > "$TMP_DIR/.github/workflows/pr-check.yml" <<'EOF'
name: PR Check
on:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/check-utf8.sh --ci src/
EOF
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-utf8-scope deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Cria o fixture limpo e valida o CONTROLE (deve PASS)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando repo fixture temporário em $TMP_DIR..."

build_fixture
pass "Fixture criado (6 arquivos do UTF8_SCOPE_FILES com call sites src/)"

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
# STEP 3+4 — MUTAÇÃO 1 (utf8-check.yml): remover src/ deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação 1 (remove src/ do call site no utf8-check.yml)..."

# Remove o argumento de diretório — `run: bash scripts/check-utf8.sh --ci`
# (sem src/). No YAML, o token 'run:' vira o dir reportado pelo guard.
sed -i 's/--ci src\//--ci/' "$TMP_DIR/.github/workflows/utf8-check.yml"

# Fail-fast: verifica que a mutação realmente aplicou (src/ sumiu).
# `-e` força o padrão literal — `--ci` começa com `--` e viraria opção do grep.
if ! grep -Fqe "--ci src/" "$TMP_DIR/.github/workflows/utf8-check.yml" && grep -Fqe "--ci" "$TMP_DIR/.github/workflows/utf8-check.yml"; then
  pass "Mutação 1 aplicada: utf8-check.yml sem src/"
else
  fail "Mutação 1 não aplicou (sed falhou?)."
  exit 1
fi

info "STEP 4: Rodando guard contra o fixture MUTADO (utf8-check.yml)..."
set +e
GUARD_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
GUARD_EXIT=$?
set -e

echo "$GUARD_OUTPUT" | tail -12

# Caso 1 — guard CEGO: PASS com a mutação. O checkUtf8Scope foi removido/
# enfraquecido. Este é o cenário que o mutation test existe para BLOQUEAR.
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (utf8-check.yml): check-utf8-scope passou com call site sem"
  fail "src/ (exit 0). Verifique se checkUtf8Scope ainda acusa escopo"
  fail "removido/trocado em scripts/check-utf8-scope.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
# Exige a MENSAGEM (escopo trocado/removido) E o ARQUIVO mutado no output.
if ! grep -Fq "$EXPECTED_FAILURE_YML" <<< "$GUARD_OUTPUT" || ! grep -Fq "$EXPECTED_FILE_YML" <<< "$GUARD_OUTPUT"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO pela asserção esperada:"
  fail "  esperava (mensagem): $EXPECTED_FAILURE_YML"
  fail "  esperava (arquivo):  $EXPECTED_FILE_YML"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

pass "Mutação 1 DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE_YML' (exit $GUARD_EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO 2 (runner): remover src/ do runner deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Re-criando fixture limpo e aplicando mutação 2 (runner sem src/)..."

build_fixture

# Remove o argumento de diretório do runner — `bash scripts/check-utf8.sh
# --dry-run --ci` (sem src/) — a asserção canônica 'SEM argumento'.
sed -i 's/--ci src\//--ci/' "$TMP_DIR/scripts/run-encoding-guards.sh"

# Fail-fast: verifica que a mutação realmente aplicou.
# `-e` força o padrão literal — `--ci` começa com `--` e viraria opção do grep.
if ! grep -Fqe "--ci src/" "$TMP_DIR/scripts/run-encoding-guards.sh" && grep -Fqe "--ci" "$TMP_DIR/scripts/run-encoding-guards.sh"; then
  pass "Mutação 2 aplicada: run-encoding-guards.sh sem src/"
else
  fail "Mutação 2 não aplicou (sed falhou?)."
  exit 1
fi

info "STEP 6: Rodando guard contra o fixture MUTADO (runner)..."
set +e
RUNNER_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
RUNNER_EXIT=$?
set -e

echo "$RUNNER_OUTPUT" | tail -12

# Caso 1 — guard CEGO (runner): PASS com a mutação. BLOQUEIA.
if [ "$RUNNER_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (runner): check-utf8-scope passou com runner sem src/"
  fail "(exit 0). Verifique se checkUtf8Scope ainda acusa 'SEM argumento de"
  fail "diretório' quando o dir é null."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada.
# Exige a MENSAGEM (SEM argumento) E o ARQUIVO mutado no output.
if ! grep -Fq "$EXPECTED_FAILURE_RUNNER" <<< "$RUNNER_OUTPUT" || ! grep -Fq "$EXPECTED_FILE_RUNNER" <<< "$RUNNER_OUTPUT"; then
  fail "Guard falhou (exit $RUNNER_EXIT) mas NÃO pela asserção esperada:"
  fail "  esperava (mensagem): $EXPECTED_FAILURE_RUNNER"
  fail "  esperava (arquivo):  $EXPECTED_FILE_RUNNER"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

pass "Mutação 2 DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE_RUNNER' (exit $RUNNER_EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de escopo UTF-8 pega call site sem src/"
pass "(utf8-check.yml + runner, ambas as mensagens de violação)"
exit 0
