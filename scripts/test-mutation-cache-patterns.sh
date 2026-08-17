#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-cache-patterns.sh — Mutation test do guard de
# consistência do CACHE_PATTERNS (scripts/check-cache-patterns.mjs)
#
# Prova que o guard REALMENTE detecta a regressão que ele existe para
# bloquear: um cache de catálogo novo em src/ esquecido do CACHE_PATTERNS do
# seed (a janela de stale volta a existir), ou um padrão órfão no seed
# prometendo invalidação que não existe. Sem o guard, a lista deriva do
# código silenciosamente.
#
#   CONTROLE:      fixture limpo (todo prefixo classificado) → guard exit 0
#   MUTAÇÃO A:     prefixo NOVO em src/ (favorites:count:) sem padrão no
#                  CACHE_PATTERNS nem ALLOWLIST → guard DEVE FALHAR (forward)
#   MUTAÇÃO B:     padrão órfão NOVO no seed (ghost:prefix:*) sem uso em
#                  src/ → guard DEVE FALHAR (reverse)
#   MUTAÇÃO C:     allowlist cobre o prefixo (user:active:) → guard DEVE
#                  PASSAR (não-catálogo não pode virar falso positivo)
#
# O script NÃO toca NENHUM arquivo do repo: o guard roda com --root num
# fixture temporário com prisma/seed.ts + src/ fake.
#
# Usage:
#   ./scripts/test-mutation-cache-patterns.sh
#
# Exit codes:
#   0 — mutações DETECTADAS (ou cobertas) pelo guard ✅
#   1 — guard CEGO (passou com a mutação que deveria falhar) OU infra ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-cache-patterns.mjs"

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

# ── build_fixture: seed com 6 padrões + src/ com call sites para cada um ──
build_fixture() {
  mkdir -p "$TMP_DIR/prisma" "$TMP_DIR/src/lib" "$TMP_DIR/src/app/api/services" \
    "$TMP_DIR/src/app/api/reviews/recent"

  cat > "$TMP_DIR/prisma/seed.ts" <<'EOF'
const CACHE_PATTERNS: readonly string[] = [
  "services:*",
  "providers:count:*",
  "proximity:*",
  "categories:*",
  "cat:desc:*",
  "reviews:recent:*",
]
EOF

  cat > "$TMP_DIR/src/app/api/services/route.ts" <<'EOF'
import { withCache } from "@/lib/redis"
export async function GET() {
  return withCache(`services:all:all:''`, async () => ({}), 30)
}
EOF

  cat > "$TMP_DIR/src/lib/radius-expansion.ts" <<'EOF'
import { withCache } from "@/lib/redis"
export function radiusCountCacheKey(lat: number): string {
  return `providers:count:${lat.toFixed(3)}:all`
}
EOF

  cat > "$TMP_DIR/src/lib/postgis.ts" <<'EOF'
import { withCache } from "@/lib/redis"
function proximityCacheKey(lat: number): string {
  return `proximity:${lat.toFixed(3)}:10`
}
export async function near() {
  return withCache(proximityCacheKey(-23.5), async () => [], 60)
}
EOF

  cat > "$TMP_DIR/src/lib/categories.ts" <<'EOF'
import { cacheInvalidate } from "@/lib/redis"
export async function invalidateAll() { await cacheInvalidate("categories:*") }
export async function invalidateDesc() { await cacheInvalidate("cat:desc:*") }
EOF

  cat > "$TMP_DIR/src/app/api/reviews/recent/route.ts" <<'EOF'
import { withCache } from "@/lib/redis"
export async function GET() {
  return withCache(`reviews:recent:5`, async () => [], 60)
}
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
echo "   🧪 SEVERINNO — MUTATION TEST (check-cache-patterns deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture base + CONTROLE (tudo classificado → exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture limpo (6 padrões + call sites)..."
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
# STEP 3+4 — MUTAÇÃO A: prefixo novo esquecido do CACHE_PATTERNS (forward)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — favorites:count: novo em src/ sem padrão..."
cat > "$TMP_DIR/src/lib/favorites.ts" <<'EOF'
import { withCache } from "@/lib/redis"
export async function count(userId: string) {
  return withCache(`favorites:count:${userId}`, async () => 0, 60)
}
EOF

info "STEP 4: Rodando guard contra a mutação A (prefixo esquecido)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (forward): passou com favorites:count: sem padrão no seed."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'favorites:count:'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou o prefixo — veja acima."
  exit 1
fi
pass "Mutação A DETECTADA: guard citou 'favorites:count:' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B: padrão órfão no seed (reverse)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — ghost:prefix:* no seed sem uso em src/..."
rm "$TMP_DIR/src/lib/favorites.ts"
cat > "$TMP_DIR/prisma/seed.ts" <<'EOF'
const CACHE_PATTERNS: readonly string[] = [
  "services:*",
  "providers:count:*",
  "proximity:*",
  "categories:*",
  "cat:desc:*",
  "reviews:recent:*",
  "ghost:prefix:*",
]
EOF

info "STEP 6: Rodando guard contra a mutação B (padrão órfão)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (reverse): passou com ghost:prefix:* sem uso em src/."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq 'ghost:prefix:*'; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou o padrão órfão — veja acima."
  exit 1
fi
pass "Mutação B DETECTADA: guard citou 'ghost:prefix:*' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — MUTAÇÃO C: allowlist cobre prefixo não-catálogo (sem falso +
#           positivo) — user:active: é estado de sessão, deve PASSAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: Aplicando mutação C — user:active: (allowlist) novo em src/..."
cat > "$TMP_DIR/prisma/seed.ts" <<'EOF'
const CACHE_PATTERNS: readonly string[] = [
  "services:*",
  "providers:count:*",
  "proximity:*",
  "categories:*",
  "cat:desc:*",
  "reviews:recent:*",
]
EOF
cat > "$TMP_DIR/src/lib/session.ts" <<'EOF'
import { cacheInvalidate } from "@/lib/redis"
export async function deactivate(userId: string) {
  await cacheInvalidate(`user:active:${userId}`)
}
EOF

info "STEP 8: Rodando guard contra a mutação C (prefixo de allowlist)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -ne 0 ]; then
  fail "GUARD FALSO POSITIVO: rejeitou user:active: (allowlist) — exit $EXIT."
  echo "$OUTPUT" | tail -10
  exit 1
fi
pass "Mutação C COBERTA: guard aceitou user:active: via ALLOWLIST (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard pega prefixo de catálogo esquecido"
pass "(forward, exit 1), padrão órfão no seed (reverse, exit 1) e NÃO"
pass "cria falso positivo para prefixo de allowlist (user:active:, exit 0)"
pass "— o CACHE_PATTERNS nunca deriva do código."
exit 0
