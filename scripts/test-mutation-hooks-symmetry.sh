#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-hooks-symmetry.sh — Mutation test do guard de simetria
# de hooks (check-hooks-symmetry.mjs)
#
# Prova que o scripts/check-hooks-symmetry.mjs REALMENTE pega os DOIS drifts
# de simetria entre os hooks e a tabela '## Git Hooks' do README:
#
#   Cenário 1 (FORWARD):  injeta um guard NOVO no .husky/pre-commit
#                         (node scripts/check-ghost-guard.mjs) — o forward
#                         do guard exige FALHA: guard invocado em pre-commit
#                         SEM linha na tabela.
#   Cenário 2 (REVERSE):  injeta uma linha STALE na tabela do README
#                         (| Ghost guard (`check-ghost-guard.mjs`) | ✅ | — |)
#                         sem o guard existir em NENHUM hook — o reverse do
#                         guard exige FALHA: linha sem guard real.
#
# Se o guard PASSAR com qualquer mutação (exit 0), ele está CEGO — uma
# direção da checagem foi removida/enfraquecida — e o script falha (exit 1),
# bloqueando o CI. É o espelho do test-mutation-bun-literal.sh para o guard
# de simetria.
#
# DIFERENÇA vs mutation-seed-dev-e2e: aqui o fixture é criado do zero num
# mktemp (o guard é node-puro, sem docker/prisma), e há um passo de CONTROLE
# (fixture limpo passa) — provando que a falha vem da mutação, não de um
# fixture quebrado. O script não toca NENHUM arquivo do repositório real.
#
# Pipeline:
#   1. Cria repo fixture temporário (README + .husky/pre-commit +
#      .husky/pre-push + scripts/run-encoding-guards.sh)
#   2. CONTROLE: fixture limpo → guard deve PASS (exit 0)
#   3. MUTAÇÃO 1 (forward): injeta guard novo no pre-commit
#   4. Guard contra o fixture MUTADO → deve FALHAR pela asserção forward
#   5. Re-cria fixture limpo → MUTAÇÃO 2 (reverse): injeta linha stale no README
#   6. Guard contra o fixture MUTADO → deve FALHAR pela asserção reverse
#   7. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-hooks-symmetry.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com alguma mutação) OU falha de infra/asserção ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-hooks-symmetry.mjs"

TMP_DIR="$(mktemp -d)"

# ── Mutações (bugs conhecidos) ────────────────────────────────────────────
# Guard fantasma injetado no pre-commit (Cenário 1) e na tabela (Cenário 2).
GHOST_GUARD="check-ghost-guard.mjs"

# Asserção que o guard DEVE emitir quando detecta a mutação. Fonte:
#   forward — checkSymmetry em scripts/check-hooks-symmetry.mjs:
#     guard '<key>' invocado em pre-commit SEM linha na tabela '## Git Hooks'
#   reverse — checkReverseSymmetry:
#     linha '<desc>' (guard '<key>') sem guard real em NENHUM hook
#
# ⚠️ Source-coupled: estas strings reproduzem a mensagem EXATA do guard. Se
# a mensagem for reformulada em scripts/check-hooks-symmetry.mjs, o mutation
# test falha com 'não pela asserção esperada' (não é guard cego — é o
# esperado por acoplamento; atualizar as duas juntas).
EXPECTED_FAILURE_FORWARD="guard '$GHOST_GUARD' invocado em pre-commit SEM linha na tabela '## Git Hooks' do README"
EXPECTED_FAILURE_REVERSE="sem guard real em NENHUM hook"

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
# limpo de novo, já que a MUTAÇÃO 1 sujou o pre-commit).
build_fixture() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR/.husky" "$TMP_DIR/scripts"

  # README com a tabela '## Git Hooks' — 4 linhas de guard + 1 descritiva
  # (Snapshots, ancorada no bloco condicional do pre-commit).
  cat > "$TMP_DIR/README.md" <<'EOF'
## Git Hooks — Pre-commit vs Pre-push (simetria)

| Validação                                                 | Pre-commit |   Pre-push    |
| :-------------------------------------------------------- | :--------: | :-----------: |
| UTF-8 (`check-utf8.sh`)                                   |     ✅     |      ✅       |
| Fonte única Bun (`check-bun-mirror.mjs`)                  |     ✅     |      ✅       |
| Bun staged diff (`check-bun-mirror.mjs --staged`)         |     ✅     |       —       |
| Testes unitários (`test:unit`)                            |     —      |      ✅       |
| Snapshots (quando .snap/snapshot tests alterados)         |  ✅ cond.  |       —       |
EOF

  # pre-commit — staged guard + runner + bloco condicional de snapshots
  # (âncora 'bun test:snapshots' da exceção descritiva do README).
  cat > "$TMP_DIR/.husky/pre-commit" <<'EOF'
set -euo pipefail

node scripts/check-bun-mirror.mjs --staged
bash scripts/run-encoding-guards.sh

STAGED_SNAP=$(git diff --cached --name-only | grep -E '\.snap$' || true)
if [ -n "$STAGED_SNAP" ]; then
  bun test:snapshots
fi
EOF

  # pre-push — runner + testes.
  cat > "$TMP_DIR/.husky/pre-push" <<'EOF'
set -euo pipefail

bash scripts/run-encoding-guards.sh

if [ "$SHOULD_RUN_TESTS" = true ]; then
  bun run test:unit
fi
EOF

  # runner compartilhado — 2 guards (check-utf8.sh + check-bun-mirror.mjs).
  cat > "$TMP_DIR/scripts/run-encoding-guards.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
bash scripts/check-utf8.sh
node scripts/check-bun-mirror.mjs
EOF
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-hooks-symmetry deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Cria o fixture limpo e valida o CONTROLE (deve PASS)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando repo fixture temporário em $TMP_DIR..."

build_fixture
pass "Fixture criado (README + pre-commit + pre-push + runner)"

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
# STEP 3+4 — MUTAÇÃO 1 (forward): guard novo no pre-commit deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação 1 (guard novo injetado no pre-commit)..."

# Injeta um guard FANTASMA no pre-commit — o forward do guard deve acusar
# 'guard <key> invocado em pre-commit SEM linha na tabela'.
printf '\nnode scripts/%s\n' "$GHOST_GUARD" >> "$TMP_DIR/.husky/pre-commit"

# Fail-fast: verifica que a mutação realmente aplicou.
if grep -Fq "node scripts/$GHOST_GUARD" "$TMP_DIR/.husky/pre-commit"; then
  pass "Mutação 1 aplicada: node scripts/$GHOST_GUARD no pre-commit"
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
# enfraquecido (checkSymmetry). Este é o cenário que o mutation test
# existe para BLOQUEAR.
if [ "$GUARD_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (forward): check-hooks-symmetry passou com guard novo no"
  fail "pre-commit (exit 0). Verifique se checkSymmetry ainda acusa 'SEM"
  fail "linha na tabela' em scripts/check-hooks-symmetry.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
if ! grep -Fq "$EXPECTED_FAILURE_FORWARD" <<<"$GUARD_OUTPUT"; then
  fail "Guard falhou (exit $GUARD_EXIT) mas NÃO pela asserção forward esperada:"
  fail "  esperava:  $EXPECTED_FAILURE_FORWARD"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

pass "Mutação 1 DETECTADA: guard falhou com '❌ $EXPECTED_FAILURE_FORWARD' (exit $GUARD_EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO 2 (reverse): linha stale na tabela deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Re-criando fixture limpo e aplicando mutação 2 (linha stale)..."

build_fixture

# Injeta uma linha STALE na tabela — o reverse do guard deve acusar
# 'sem guard real em NENHUM hook — linha stale'.
printf '| Ghost guard (`%s`)                                        |     ✅     |       —       |\n' "$GHOST_GUARD" >> "$TMP_DIR/README.md"

if grep -Fq "Ghost guard (\`$GHOST_GUARD\`)" "$TMP_DIR/README.md"; then
  pass "Mutação 2 aplicada: linha stale do $GHOST_GUARD na tabela"
else
  fail "Mutação 2 não aplicou (printf falhou?)."
  exit 1
fi

info "STEP 6: Rodando guard contra o fixture MUTADO (reverse)..."
set +e
REVERSE_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" 2>&1)"
REVERSE_EXIT=$?
set -e

echo "$REVERSE_OUTPUT" | tail -12

# Caso 1 — guard CEGO: PASS com a linha stale. O reverse foi removido/
# enfraquecido (checkReverseSymmetry). BLOQUEIA.
if [ "$REVERSE_EXIT" -eq 0 ]; then
  fail "GUARD CEGO (reverse): check-hooks-symmetry passou com linha stale na"
  fail "tabela (exit 0). Verifique se checkReverseSymmetry ainda acusa"
  fail "'sem guard real em NENHUM hook' em scripts/check-hooks-symmetry.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada.
if ! grep -Fq "$EXPECTED_FAILURE_REVERSE" <<<"$REVERSE_OUTPUT"; then
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
pass "MUTATION TEST PASSED — o guard de simetria pega os dois drifts (forward + reverse)"
exit 0
