#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-no-npx-playwright.sh — Mutation test do guard de runner
# oficial (check-no-npx-playwright.mjs)
#
# Prova que o scripts/check-no-npx-playwright.mjs REALMENTE detecta a
# regressão que ele existe para bloquear: a reintrodução de `npx playwright`
# em docs/scripts/package.json. Runner oficial é `bunx playwright` (ou
# `bun run e2e`) — no Windows o npx resolve instância DIFERENTE de
# @playwright/test no grafo de módulos e TODOS os specs falham com
# 'did not expect test.describe() to be called here'.
#
#   CONTROLE:      fixture limpo (tudo bunx) → guard exit 0
#   MUTAÇÃO A:     scripts/run.sh com `npx playwright test` → guard DEVE
#                  FALHAR (exit 1) citando run.sh
#   MUTAÇÃO B:     docs/README.md com `npx playwright install` em bloco →
#                  guard DEVE FALHAR (exit 1) citando README.md
#   MUTAÇÃO C:     package.json com script `npx playwright test` → guard DEVE
#                  FALHAR (exit 1) citando package.json
#   PROSA EXENTA:  docs com "Troubleshooting — `npx playwright` quebra" →
#                  guard DEVE PASSAR (exit 0) — menção documental não é comando
#
# O script NÃO toca NENHUM arquivo do repo: o guard roda com --root num
# fixture temporário. (O próprio test-mutation-*.sh contém o padrão — o guard
# exclui test-mutation-* do scan de scripts/ de propósito; ver o docstring do
# check-no-npx-playwright.mjs.)
#
# Usage:
#   ./scripts/test-mutation-no-npx-playwright.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com a mutação) OU infra ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-no-npx-playwright.mjs"

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

# ── build_fixture: fixture limpo (tudo bunx) ──────────────────────────────
build_fixture() {
  mkdir -p "$TMP_DIR/docs" "$TMP_DIR/scripts"
  cat > "$TMP_DIR/package.json" <<'EOF'
{ "scripts": { "e2e": "bun run e2e" } }
EOF
  cat > "$TMP_DIR/docs/README.md" <<'EOF'
# Fixture

Runner oficial: `bunx playwright test`.
EOF
  cat > "$TMP_DIR/scripts/run.sh" <<'EOF'
#!/usr/bin/env bash
bunx playwright test e2e/x.spec.ts
EOF
}

# ── run_guard: roda o guard no fixture (--root) ───────────────────────────
run_guard() {
  set +e
  OUTPUT="$(node "$GUARD" --root "$TMP_DIR" 2>&1)"
  EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-no-npx-playwright deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture base + CONTROLE (tudo bunx → exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture limpo (bunx em tudo)..."
build_fixture

info "STEP 2: Controle — fixture limpo; guard deve PASS (exit 0)..."
run_guard
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $EXIT)."
  echo "$OUTPUT" | tail -10
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — fixture limpo passa no guard (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A (.sh): 'npx playwright test' em scripts/run.sh
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — scripts/run.sh com 'npx playwright test'..."
cat > "$TMP_DIR/scripts/run.sh" <<'EOF'
#!/usr/bin/env bash
npx playwright test e2e/x.spec.ts
EOF

info "STEP 4: Rodando guard contra a mutação A (.sh)..."
run_guard
echo "$OUTPUT" | tail -6

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (.sh): check-no-npx-playwright passou com 'npx playwright'"
  fail "em scripts/run.sh (exit 0). O guard não varre scripts/."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "run.sh"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou scripts/run.sh — veja o output acima."
  exit 1
fi
pass "Mutação A DETECTADA: guard falhou citando run.sh (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B (docs): 'npx playwright install' em bloco no README
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — docs/README.md com 'npx playwright install'..."
cat > "$TMP_DIR/docs/README.md" <<'EOF'
# Fixture

```sh
npx playwright install
```
EOF

info "STEP 6: Rodando guard contra a mutação B (docs)..."
run_guard
echo "$OUTPUT" | tail -6

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (docs): check-no-npx-playwright passou com 'npx playwright'"
  fail "em comando no docs/README.md (exit 0)."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "README.md"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou README.md — veja o output acima."
  exit 1
fi
pass "Mutação B DETECTADA: guard falhou citando README.md (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — MUTAÇÃO C (package.json): script 'npx playwright test'
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: Aplicando mutação C — package.json com script 'npx playwright test'..."
cat > "$TMP_DIR/package.json" <<'EOF'
{ "scripts": { "e2e": "npx playwright test" } }
EOF

info "STEP 8: Rodando guard contra a mutação C (package.json)..."
run_guard
echo "$OUTPUT" | tail -6

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (package.json): passou com 'npx playwright' no script e2e (exit 0)."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "package.json"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou package.json — veja o output acima."
  exit 1
fi
pass "Mutação C DETECTADA: guard falhou citando package.json (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 9+10 — PROSA EXENTA (docs): menção documental NÃO é comando
# ═════════════════════════════════════════════════════════════════════════

info "STEP 9: Resetando fixture para limpo (as mutações A/C ainda estavam ativas) e"
info "        aplicando a prosa do Troubleshooting — menção documental não é comando..."
build_fixture
cat > "$TMP_DIR/docs/README.md" <<'EOF'
# Fixture

### Troubleshooting — `npx playwright` quebra no Windows

> Sempre que um comando deste doc mostrar `npx playwright`, substitua por
> `bunx playwright`.
EOF

info "STEP 10: Rodando guard contra a prosa exenta..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -ne 0 ]; then
  fail "PROSA EXENTA FALHOU: guard rejeitou menção documental (exit $EXIT)."
  fail "O Troubleshooting do README documenta a regressão — prosa não é comando."
  echo "$OUTPUT" | tail -10
  exit 1
fi
pass "Prosa exenta OK: menção documental passa (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard pega 'npx playwright' em .sh (exit 1),"
pass "docs (exit 1), package.json (exit 1) e passa com prosa documental (exit 0)"
exit 0
