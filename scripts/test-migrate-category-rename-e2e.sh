#!/usr/bin/env bash
# =============================================================================
# scripts/test-migrate-category-rename-e2e.sh — Category Rename E2E (PostGIS efêmero)
#
# Executa o scripts/migrate-category-rename.mjs contra um PostGIS descartável
# e valida o fluxo completo da renomeação SEGURA de categoria:
#   1. Guard recusa fora de produção (sem NODE_ENV/PROD_SEED_ALLOW_DEV)
#   2. Guard recusa com --from inexistente
#   3. Dry-run não escreve nada
#   4. Renomeia pai com filhos (Elétrica → Eletricidade): nova linha + filhos
#      re-apontados com slug corrigido + antiga desativada
#   5. Renomeia subcategoria com services (Desentupimento): re-aponta o service
#   6. Re-run da mesma migração falha (nome já igual — nada para renomear)
#   7. Colisão de slug: migrar outra categoria para um slug já ocupado recusa
#      ("Já existe uma categoria") sem corromper nada
#   8. Árvore resultante consistente com a regra canônica do seed-data
#   9. MOVE-ONLY (--move-to sem --to): Pintura → parent Reforma — nome
#      preservado, slug muda só pelo parent novo, filhos re-apontados SEM
#      mudar o slug (embutem o NOME do pai), antiga desativada (fix de
#      colisão falsa dos filhos)
#   10. MOVE + RENAME (--to + --move-to): Pisos → 'Pisos e revestimentos'
#      sob Reparos — slug novo embute o parent novo, filhos com slug novo
#   11. Guards --move-to: raiz não pode ser movida; parent inexistente;
#      ciclo (mover um pai para baixo do próprio filho)
#   12. SEED_SPEC_PATCH malformado no env NÃO interfere: a migração roda
#      normal (exit 0) e renomeia de verdade (linha nova + antiga desativada)
#

# Pipeline:
#   1. Start PostGIS via docker-compose.test.yml (tmpfs — dados descartáveis)
#   2. Wait for container healthy
#   3. Push Prisma schema
#   4. Seed dev (cria a árvore de categorias + services)
#   5. Run scripts/test-migrate-category-rename-e2e.ts (validação real)
#   6. Clean up (docker compose down -v)
#
# Usage:
#   ./scripts/test-migrate-category-rename-e2e.sh                # Full pipeline
#   ./scripts/test-migrate-category-rename-e2e.sh --skip-docker  # Skip container start
#   ./scripts/test-migrate-category-rename-e2e.sh --skip-cleanup # Keep containers running
#   ./scripts/test-migrate-category-rename-e2e.sh --skip-seed    # Skip dev seed — requer um
#                                                                # banco JÁ populado pelo seed
#                                                                # dev (ex.: container reusado do
#                                                                # job CI mesclado seed-guards)
#
# Exit codes:
#   0 — all E2E checks passed
#   1 — any step failed (containers, schema sync, seed, validator)
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
SKIP_SEED=false

for arg in "$@"; do
  case "$arg" in
    --skip-docker)  SKIP_DOCKER=true ;;
    --skip-cleanup) SKIP_CLEANUP=true ;;
    --skip-seed)    SKIP_SEED=true ;;
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
echo "   🧪 SEVERINNO — CATEGORY RENAME E2E (PostGIS efêmero)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

if [ "$SKIP_DOCKER" = false ]; then
  info "STEP 1: Starting PostGIS container..."

  docker compose -f "$COMPOSE_FILE" up -d postgis

  echo "  Waiting for PostgreSQL..."
  for i in $(seq 1 30); do
    if grep -qi "healthy" <<< "$(docker compose -f "$COMPOSE_FILE" ps postgis --format "{{.Status}}" 2>/dev/null)"; then
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
cd "$SCRIPT_DIR"
if [ "${SKIP_PRISMA_GENERATE:-0}" != "1" ]; then
  DATABASE_URL="$DATABASE_URL" bunx prisma generate 2>&1 | tail -3
else
  info "STEP 2: Skipping prisma generate (SKIP_PRISMA_GENERATE=1)"
fi

if [ "${SKIP_DB_PUSH:-0}" != "1" ]; then
  if DATABASE_URL="$DATABASE_URL" bunx prisma db push --accept-data-loss --skip-generate 2>&1 \
    | tail -8; then
    pass "Schema synced"
  else
    fail "Schema sync failed"
    exit 1
  fi
else
  info "STEP 2: Skipping prisma db push (SKIP_DB_PUSH=1)"
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 3 — Seed dev (cria árvore de categorias + services)
# ═════════════════════════════════════════════════════════════════════════

if [ "$SKIP_SEED" = false ]; then
  info "STEP 3: Seeding dev database..."
  if DATABASE_URL="$DATABASE_URL" NODE_ENV=development bun prisma/seed.ts 2>&1 | tail -5; then
    pass "Dev seed completed"
  else
    fail "Dev seed failed"
    exit 1
  fi
else
  info "STEP 3: Skipping dev seed (--skip-seed)"
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 4 — Run category rename E2E validator
# ═════════════════════════════════════════════════════════════════════════

info "STEP 4: Running category rename E2E validator..."

DATABASE_URL="$DATABASE_URL" PROD_SEED_ALLOW_DEV=1 NODE_ENV=development \
  bun scripts/test-migrate-category-rename-e2e.ts
exit_code=$?

# ═════════════════════════════════════════════════════════════════════════
# Result
# ═════════════════════════════════════════════════════════════════════════

echo ""
if [ "$exit_code" -eq 0 ]; then
  pass "ALL CATEGORY RENAME E2E CHECKS PASSED"
else
  fail "Category rename E2E failed (exit code $exit_code)"
fi

exit "$exit_code"
