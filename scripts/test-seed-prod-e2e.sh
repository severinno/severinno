#!/usr/bin/env bash
# =============================================================================
# scripts/test-seed-prod-e2e.sh — Seed Prod E2E (PostGIS efêmero via docker)
#
# Executa o prisma/seed-prod.ts (seed de PRODUÇÃO) contra um PostGIS
# descartável e valida:
#   1. Guard recusa fora de produção
#   2. Árvore de categorias completa (27 = 3 + 7 + 17)
#   3. Settings presentes (9 keys)
#   4. ZERO usuários criados
#   5. Re-execução idempotente (mesmos counts)
#
# Pipeline:
#   1. Start PostGIS via docker-compose.test.yml (tmpfs — dados descartáveis)
#   2. Wait for container healthy
#   3. Push Prisma schema (cria as tabelas)
#   4. Run scripts/test-seed-prod-e2e.ts (validação real)
#   5. Clean up (docker compose down -v)
#
# Usage:
#   ./scripts/test-seed-prod-e2e.sh               # Full pipeline
#   ./scripts/test-seed-prod-e2e.sh --skip-docker  # Skip container start (use existing)
#   ./scripts/test-seed-prod-e2e.sh --skip-cleanup # Keep containers running after
#
# Exit codes:
#   0 — all E2E checks passed
#   1 — any step failed (containers, schema sync, validator)
#
# Environment:
#   DATABASE_URL   Test DB URL (default: postgresql://severinno:severinno_test@localhost:5433/severinno_test)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"
DATABASE_URL="${DATABASE_URL:-postgresql://severinno:severinno_test@localhost:5433/severinno_test}"

SKIP_DOCKER=false
SKIP_CLEANUP=false

for arg in "$@"; do
  case "$arg" in
    --skip-docker)  SKIP_DOCKER=true ;;
    --skip-cleanup) SKIP_CLEANUP=true ;;
  esac
done

# ── Cleanup handler ──────────────────────────────────────────────────────

cleanup() {
  local exit_code=$?

  echo ""
  echo "  ── Cleanup ────────────────────────────────────────────────────"

  if [ "$SKIP_CLEANUP" = false ] && [ "$SKIP_DOCKER" = false ]; then
    echo "  Stopping test containers..."
    docker compose -f "$COMPOSE_FILE" down -v --timeout 10 2>/dev/null || true
  fi

  if [ "$exit_code" -eq 0 ]; then
    echo "  ✅ Pipeline complete."
  else
    echo "  ❌ Pipeline failed (exit code $exit_code)."
  fi
}
trap cleanup EXIT

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ═════════════════════════════════════════════════════════════════════════
# STEP 1 — Start containers
# ═════════════════════════════════════════════════════════════════════════

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — SEED PROD E2E (PostGIS efêmero)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

if [ "$SKIP_DOCKER" = false ]; then
  info "STEP 1: Starting PostGIS container..."

  docker compose -f "$COMPOSE_FILE" up -d postgis

  # Wait for PostgreSQL to be healthy
  echo "  Waiting for PostgreSQL..."
  for i in $(seq 1 30); do
    if docker compose -f "$COMPOSE_FILE" ps postgis --format "{{.Status}}" 2>/dev/null \
      | grep -qi "healthy"; then
      pass "PostgreSQL healthy after ${i}s"
      break
    fi
    if [ "$i" -eq 30 ]; then
      fail "PostgreSQL did not become healthy"
      exit 1
    fi
    sleep 2
  done
else
  info "STEP 1: Skipping container start (--skip-docker)"
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 2 — Push Prisma schema
# ═════════════════════════════════════════════════════════════════════════

info "STEP 2: Syncing Prisma schema..."
cd "$SCRIPT_DIR"      # Ensure Prisma client is generated first (required for @prisma/client types).
      # SKIP_PRISMA_GENERATE=1 pula o generate quando o client já veio do cache
      # (CI: actions/cache keyed no schema.prisma — economia ~6s por job).
      if [ "${SKIP_PRISMA_GENERATE:-0}" != "1" ]; then
        DATABASE_URL="$DATABASE_URL" bunx prisma generate 2>&1 | tail -5
      else
        info "STEP 2: Skipping prisma generate (SKIP_PRISMA_GENERATE=1 — cache hit)"
      fi

      # SKIP_DB_PUSH=1 pula o push quando o schema já foi sincronizado pelo
      # E2E anterior no MESMO container (job mesclado seed-guards: o prod
      # faz o push, o dev reutiliza). O push é idempotente, mas evita ~9s.
      if [ "${SKIP_DB_PUSH:-0}" != "1" ]; then
        # A pipeline na condição do if: com set -euo pipefail, uma pipeline
        # solta que falha abortaria o script ANTES do if (branch de erro =
        # código morto). Em condição, o set -e não dispara e o else captura.
        if DATABASE_URL="$DATABASE_URL" bunx prisma db push --accept-data-loss --skip-generate 2>&1 \
          | tail -10; then
          pass "Schema synced"
        else
          fail "Schema sync failed"
          exit 1
        fi
      else
        info "STEP 2: Skipping prisma db push (SKIP_DB_PUSH=1 — schema já sincronizado)"
      fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 3 — Run seed-prod E2E validator
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Running seed-prod E2E validator..."

# Já estamos no SCRIPT_DIR (STEP 2 fez o cd) — sem cd redundante aqui.
# Captura a saída completa (não só o exit code) para validar o count real
# (📊 Resultados) contra a derivação (scripts/seed-e2e-count.ts).
set +e
E2E_OUTPUT="$(DATABASE_URL="$DATABASE_URL" bun scripts/test-seed-prod-e2e.ts 2>&1)"
exit_code=$?
set -e
echo "$E2E_OUTPUT"

# ── Count validation (derivação vs real) ────────────────────────────────
# O E2E imprime "📊 Resultados: N passed, ... (esperado X derivado)". A
# derivação (bun scripts/seed-e2e-count.ts prod) é a FONTE DA VERDADE: o
# count REAL impresso deve bater com ela — segunda camada além do runtime
# drift check interno do E2E (e o guard estático compara os comentários dos
# workflows com a MESMA derivação).
REAL_COUNT="$(echo "$E2E_OUTPUT" | sed -n 's/.*Resultados: \([0-9]*\) passed.*/\1/p' | head -1)"
DERIVED_COUNT="$(bun scripts/seed-e2e-count.ts prod)"
if [ -z "$REAL_COUNT" ]; then
  fail "Count validation: não foi possível extrair o count real do output do E2E"
  exit_code=1
elif [ "$REAL_COUNT" != "$DERIVED_COUNT" ]; then
  fail "Count validation: E2E imprimiu $REAL_COUNT checks, derivação espera $DERIVED_COUNT"
  exit_code=1
else
  pass "Count validation: $REAL_COUNT checks == derivação ($DERIVED_COUNT)"
fi

# ═════════════════════════════════════════════════════════════════════════
# Result
# ═════════════════════════════════════════════════════════════════════════

echo ""
if [ "$exit_code" -eq 0 ]; then
  pass "ALL SEED PROD E2E CHECKS PASSED"
else
  fail "Seed prod E2E failed (exit code $exit_code)"
fi

exit "$exit_code"
