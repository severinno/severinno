#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-seed-dev-e2e.sh — Mutation test do seed DEV
#
# Prova que o test-seed-dev-e2e.ts REALMENTE pega regressões no prisma/seed.ts:
# introduz um bug CONHECIDO (muta o email do admin no CREATE), roda o E2E
# completo e exige que ele FALHE pela asserção certa. Se o E2E passar com o
# seed mutado (exit 0), o guard está CEGO — uma asserção foi removida ou
# enfraquecida — e o script falha (exit 1), bloqueando o CI.
#
# Mutação aplicada (sed em prisma/seed.ts):
#   email: "admin@severinno.com"  →  email: "admin-mutated@severinno.com"
# O EXPECTED_EMAILS do E2E é HARDCODED no teste (scripts/test-seed-dev-e2e.ts),
# então o admin criado com email mutado não satisfaz:
#   ❌ 'admin@severinno.com' existe com role ADMIN
# Tudo o mais (counts, árvore, guard, cenários SEED_SPEC_PATCH) permanece
# intacto — a falha é EXATAMENTE a asserção do email, sem cascata.
#
# O script é PARAMETRIZÁVEL: troque MUTATION_OLD/MUTATION_NEW/EXPECTED_FAILURE
# para cobrir outra família de asserção (ex.: árvore de categorias, counts de
# services) — cada mutação prova a sensibilidade do guard para UM tipo de
# regressão.
#
# Pipeline:
#   1. Start PostGIS via docker-compose.test.yml (tmpfs — dados descartáveis)
#   2. Wait for container healthy
#   3. Push Prisma schema (cria as tabelas)
#   4. Backup prisma/seed.ts + aplicar mutação (sed) + verificar aplicada
#   5. Run scripts/test-seed-dev-e2e.ts contra o seed MUTADO (captura exit)
#   6. Verificar que o E2E FALHOU com a asserção esperada (mutation detected)
#   7. Restaurar prisma/seed.ts do backup (trap EXIT — cp, NUNCA git checkout)
#   8. Clean up (docker compose down -v)
#
# Usage:
#   ./scripts/test-mutation-seed-dev-e2e.sh               # Full pipeline
#   ./scripts/test-mutation-seed-dev-e2e.sh --skip-docker  # Skip container start (use existing)
#   ./scripts/test-mutation-seed-dev-e2e.sh --skip-cleanup # Keep containers running after
#
# Exit codes:
#   0 — mutação DETECTADA pelo guard (E2E falhou pela asserção esperada) ✅
#   1 — guard CEGO (E2E passou com seed mutado) OU falha de infra/asserção ❌
#
# Environment:
#   DATABASE_URL   Test DB URL (default: postgresql://severinno:severinno_test@localhost:5433/severinno_test)
#   SKIP_PRISMA_GENERATE=1  pula o prisma generate (CI: cache hit do client)
#   SKIP_DB_PUSH=1          pula o prisma db push (CI: schema já sincronizado)
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"
DATABASE_URL="${DATABASE_URL:-postgresql://severinno:severinno_test@localhost:5433/severinno_test}"

SEED_FILE="$SCRIPT_DIR/prisma/seed.ts"
BACKUP_FILE="$(mktemp)"

# ── Mutação (bug conhecido) ───────────────────────────────────────────────
# Padrões do sed. Atenção: o console.log final do seed também imprime o email
# admin, MAS sem o prefixo `email: ` — o sed abaixo só casa o CREATE (linha
# com `email: "admin@severinno.com"`), preservando o output de credenciais
# (que o E2E checa com "Login credentials").
MUTATION_OLD='email: "admin@severinno.com"'
MUTATION_NEW='email: "admin-mutated@severinno.com"'

# Asserção que o E2E DEVE emitir quando o guard detecta a mutação.
# Fonte: validateUsers() em scripts/test-seed-dev-e2e.ts (EXPECTED_EMAILS).
EXPECTED_FAILURE="'admin@severinno.com' existe com role ADMIN"

SKIP_DOCKER=false
SKIP_CLEANUP=false

for arg in "$@"; do
  case "$arg" in
    --skip-docker)  SKIP_DOCKER=true ;;
    --skip-cleanup) SKIP_CLEANUP=true ;;
  esac
done

# ── Restore handler (trap EXIT — SEMPRE restaura, mesmo com falha) ──────
# Usa cp do backup (nunca `git checkout --`) para não descartar edições
# locais não-commitadas do dev que rodar o script na própria máquina.
#
# Guard `-s` (não-vazio): o mktemp cria o arquivo VAZIO no topo do script e
# o trap é registrado ANTES do cp real do backup (STEP 3). Sem o guard, uma
# falha ANTES do backup (docker/prisma) copiaria o arquivo vazio por cima do
# seed — destruindo-o. O backup só é legítimo depois do cp, então o restore
# exige um arquivo com conteúdo (seed.ts nunca é vazio).
restore_seed() {
  if [ -s "$BACKUP_FILE" ] && [ -f "$SEED_FILE" ]; then
    cp "$BACKUP_FILE" "$SEED_FILE"
    echo "  ↻ prisma/seed.ts restaurado do backup"
  fi
  rm -f "$BACKUP_FILE"
}

cleanup() {
  local exit_code=$?

  echo ""
  echo "  ── Cleanup ────────────────────────────────────────────────────"
  restore_seed

  if [ "$SKIP_CLEANUP" = false ] && [ "$SKIP_DOCKER" = false ]; then
    echo "  Stopping test containers..."
    docker compose -f "$COMPOSE_FILE" down -v --timeout 10 2>/dev/null || true
  fi

  if [ "$exit_code" -eq 0 ]; then
    echo "  ✅ Pipeline complete (mutação detectada pelo guard)."
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
echo "   🧪 SEVERINNO — MUTATION TEST (seed dev E2E deve FALHAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

if [ "$SKIP_DOCKER" = false ]; then
  info "STEP 1: Starting PostGIS container..."

  docker compose -f "$COMPOSE_FILE" up -d postgis

  # Wait for PostgreSQL to be healthy
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
# SKIP_PRISMA_GENERATE=1 pula o generate quando o client já veio do cache
# (CI: actions/cache keyed no schema.prisma — economia ~6s por job).
if [ "${SKIP_PRISMA_GENERATE:-0}" != "1" ]; then
  DATABASE_URL="$DATABASE_URL" bunx prisma generate 2>&1 | tail -5
else
  info "STEP 2: Skipping prisma generate (SKIP_PRISMA_GENERATE=1 — cache hit)"
fi

# SKIP_DB_PUSH=1 pula o push quando o schema já foi sincronizado por um E2E
# ANTERIOR no MESMO container (job mesclado seed-guards: o prod faz o push,
# os demais reutilizam). O push é idempotente, mas evita ~9s por job.
if [ "${SKIP_DB_PUSH:-0}" != "1" ]; then
  # Pipeline na condição do if: com set -euo pipefail, uma pipeline solta
  # que falha abortaria o script ANTES do if (branch de erro = código morto).
  # Em condição, o set -e não dispara e o else captura.
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
# STEP 3 — Backup + mutação do seed (bug CONHECIDO)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação em prisma/seed.ts..."

# Backup ANTES da mutação (cp para temp — restauração segura em trap).
cp "$SEED_FILE" "$BACKUP_FILE"

# Fail-fast: se o padrão não existir (seed refatorado), o sed viraria um
# no-op silencioso → o E2E passaria e o script acusaria "guard cego" sendo
# que o problema é o padrão do mutation test. Pare com mensagem clara.
if ! grep -Fq "$MUTATION_OLD" "$SEED_FILE"; then
  fail "Padrão de mutação não encontrado em prisma/seed.ts: $MUTATION_OLD"
  fail "O seed mudou? Atualize MUTATION_OLD/MUTATION_NEW neste script."
  exit 1
fi

sed -i "s/$MUTATION_OLD/$MUTATION_NEW/" "$SEED_FILE"

# Verifica que a mutação realmente aplicou (novo presente + antigo ausente).
if grep -Fq "$MUTATION_NEW" "$SEED_FILE" && ! grep -Fq "$MUTATION_OLD" "$SEED_FILE"; then
  pass "Mutação aplicada: $MUTATION_OLD → $MUTATION_NEW"
else
  fail "Mutação não aplicou corretamente (sed falhou?)."
  exit 1
fi

# ═════════════════════════════════════════════════════════════════════════
# STEP 4 — Run seed-dev E2E contra o seed MUTADO
# ═════════════════════════════════════════════════════════════════════════

info "STEP 4: Running seed-dev E2E contra o seed MUTADO..."

# Captura output + exit code (set +e: a FALHA é o resultado esperado aqui).
set +e
E2E_OUTPUT="$(DATABASE_URL="$DATABASE_URL" bun scripts/test-seed-dev-e2e.ts 2>&1)"
E2E_EXIT=$?
set -e

echo "$E2E_OUTPUT" | tail -15

# ═════════════════════════════════════════════════════════════════════════
# STEP 5 — Verificar que o guard DETECTOU a mutação
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Verificando que o guard detectou a mutação..."

# Caso 1 — guard CEGO: o E2E PASSOU com o seed mutado. Uma asserção foi
# removida/enfraquecida em scripts/test-seed-dev-e2e.ts. Este é o cenário
# que o mutation test existe para BLOQUEAR.
if [ "$E2E_EXIT" -eq 0 ]; then
  fail "GUARD CEGO: o seed-dev E2E passou com o seed MUTADO (exit 0)."
  fail "A mutação (email do admin) não foi detectada — verifique se uma"
  fail "asserção foi removida/enfraquecida em scripts/test-seed-dev-e2e.ts"
  fail "(validateUsers / EXPECTED_EMAILS)."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (infra/schema/quebra
# diferente da mutação). Não dá para confirmar que o guard pega ESTA
# regressão → falha com diagnóstico claro.
if ! grep -Fq "$EXPECTED_FAILURE" <<< "$E2E_OUTPUT"; then
  fail "E2E falhou (exit $E2E_EXIT) mas NÃO pela asserção esperada:"
  fail "  esperava:  $EXPECTED_FAILURE"
  fail "Falha pode ser infra/schema — veja o output acima."
  exit 1
fi

# Caso 3 — ✅ mutação detectada: E2E falhou com a asserção do email.
pass "Mutação DETECTADA: E2E falhou com '❌ $EXPECTED_FAILURE' (exit $E2E_EXIT)"
pass "O guard do seed dev está sensível a regressões."

# ═════════════════════════════════════════════════════════════════════════
# Result (restore roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard do seed dev pega regressões"
exit 0
