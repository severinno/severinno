#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-lint-guard.sh — Mutation test do LINT GUARD (prettier
# + eslint zero) — item #8 da auditoria
#
# Prova que os DOIS comandos do job lint-guard do pr-check.yml REALMENTE
# falham nas regressões que eles existem para bloquear:
#
#   Cenário A (PRETTIER):  arquivo TS mal formatado (spacing errado) — o
#                          `prettier --check` (mesmo bin e flags do job)
#                          DEVE FALHAR (exit 1) citando o arquivo.
#   Cenário B (ESLINT):    arquivo TS com warning (console.log) — o
#                          `eslint --max-warnings 0` (mesmo bin e flags do
#                          job) DEVE FALHAR (exit 1) citando o warning.
#
# E o CONTROLE: o mesmo fixture com arquivo formatado + sem warning passa nos
# DOIS comandos (exit 0) — provando que a falha vem da MUTAÇÃO, não de um
# fixture quebrado ou do bin ausente.
#
# DIFERENÇA vs mutation-seed-dev-e2e: aqui o fixture é criado do zero num
# mktemp e os bins de prettier/eslint são os do node_modules do repo (não
# instala nada). O script NÃO toca NENHUM arquivo do repositório real — o
# fixture tem a própria eslint.config.mjs mínima (flat config com uma regra
# warning) para o eslint rodar fora do repo.
#
# NOTA DE CONFIG: o fixture não tem .prettierrc — o CONTROLE valida os
# DEFAULTS do prettier (semi: true etc.), não o estilo configurado do repo.
# A mutação A (indentação errada) falha sob QUALQUER config, então a prova
# é robusta a essa diferença; se um dia o job lint-guard mudar as flags,
# atualize os comentários 'Job:' abaixo junto.
#
# Pipeline:
#   1. Cria temp dir com src/ok.ts (formatado, sem warning) + eslint.config.mjs
#   2. CONTROLE: prettier --check ok.ts + eslint --max-warnings 0 ok.ts → exit 0
#   3. MUTAÇÃO A: escreve src/bad-format.ts (spacing errado) → prettier --check
#      DEVE FALHAR (exit 1)
#   4. MUTAÇÃO B: escreve src/bad-lint.ts (console.log) → eslint --max-warnings 0
#      DEVE FALHAR (exit 1)
#   5. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-lint-guard.sh
#
# Exit codes:
#   0 — mutações DETECTADAS (prettier/eslint falharam pelas asserções) ✅
#   1 — guard CEGO (algum comando passou com a mutação) OU infra ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PRETTIER_BIN="$SCRIPT_DIR/node_modules/prettier/bin/prettier.cjs"
ESLINT_BIN="$SCRIPT_DIR/node_modules/eslint/bin/eslint.js"

TMP_DIR="$(mktemp -d)"

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

# ── setup_fixture: cria o esqueleto do fixture (eslint.config.mjs + ok.ts) ─
setup_fixture() {
  mkdir -p "$TMP_DIR/src"
  cat > "$TMP_DIR/eslint.config.mjs" <<'EOF'
export default [{ files: ["**/*.ts"], rules: { "no-console": "warn" } }]
EOF
  cat > "$TMP_DIR/src/ok.ts" <<'EOF'
const ok = 1;
export default ok;
EOF
}

# ── run_prettier: roda o MESMO bin/flags do job lint-guard no fixture ────
# Job: npx prettier --check --ignore-unknown 'src/**' ...
run_prettier() {
  set +e
  OUTPUT="$(cd "$TMP_DIR" && node "$PRETTIER_BIN" --check --ignore-unknown "src/**" 2>&1)"
  EXIT=$?
  set -e
}

# ── run_eslint: roda o MESMO bin/flags do job lint-guard no fixture ──────
# Job: npx eslint . --max-warnings 0
run_eslint() {
  set +e
  OUTPUT="$(cd "$TMP_DIR" && node "$ESLINT_BIN" . --max-warnings 0 2>&1)"
  EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (lint-guard deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture + CONTROLE (formatado + sem warning → exit 0 nos 2)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture em $TMP_DIR (eslint.config.mjs + src/ok.ts)..."
setup_fixture

info "STEP 2: Controle — ok.ts formatado e sem warning deve PASS (exit 0)..."

run_prettier
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU (prettier): arquivo FORMATADO foi rejeitado (exit $EXIT)."
  echo "$OUTPUT" | tail -6
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — prettier --check passa no arquivo formatado (exit 0)"

run_eslint
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU (eslint): arquivo SEM warning foi rejeitado (exit $EXIT)."
  echo "$OUTPUT" | tail -6
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — eslint --max-warnings 0 passa no arquivo limpo (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A (arquivo mal formatado): prettier DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — src/bad-format.ts com spacing errado..."
cat > "$TMP_DIR/src/bad-format.ts" <<'EOF'
const badly = 1;
export default badly;
  const extra = 2;
EOF

info "STEP 4: Rodando prettier --check contra a mutação A..."
run_prettier
echo "$OUTPUT" | tail -4

# Caso 1 — guard CEGO: prettier PASSOU com o arquivo mal formatado.
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (prettier): prettier --check passou com src/bad-format.ts"
  fail "mal formatado (exit 0). O --check de formatação está quebrado."
  exit 1
fi

# Caso 2 — falhou, mas NÃO citou o arquivo da mutação.
if ! echo "$OUTPUT" | grep -Fq "bad-format.ts"; then
  fail "prettier --check falhou (exit $EXIT) mas NÃO citou bad-format.ts."
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi
pass "Mutação A DETECTADA: prettier --check falhou citando bad-format.ts (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B (warning de lint): eslint DEVE FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — src/bad-lint.ts com console.log (warning)..."
cat > "$TMP_DIR/src/bad-lint.ts" <<'EOF'
console.log("lint warning")
EOF

info "STEP 6: Rodando eslint --max-warnings 0 contra a mutação B..."
run_eslint
echo "$OUTPUT" | tail -6

# Caso 1 — guard CEGO: eslint PASSOU com o warning.
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (eslint): eslint --max-warnings 0 passou com src/bad-lint.ts"
  fail "contendo warning (exit 0). O gate de warnings está quebrado."
  exit 1
fi

# Caso 2 — falhou, mas NÃO citou o warning da mutação.
if ! echo "$OUTPUT" | grep -Fq "bad-lint.ts"; then
  fail "eslint --max-warnings 0 falhou (exit $EXIT) mas NÃO citou bad-lint.ts."
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi
pass "Mutação B DETECTADA: eslint --max-warnings 0 falhou citando bad-lint.ts (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — lint-guard pega arquivo mal formatado (prettier)"
pass "e warning de lint (eslint --max-warnings 0), ambos exit 1"
exit 0
