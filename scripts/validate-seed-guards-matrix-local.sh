#!/usr/bin/env bash
# =============================================================================
# scripts/validate-seed-guards-matrix-local.sh — Local MATRIX 2×2 validation
#
# Espelha o job seed-guards do .github/workflows/seed-guards.yml LOCALMENTE:
# roda as 4 células (prod/dev × alpine/full) em SEQUÊNCIA contra containers
# PostGIS efêmeros — cada célula com seu próprio container + banco limpo +
# extensão postgis, exatamente como o CI faz por célula.
#
#   prod × alpine  (postgis/postgis:16-3.4-alpine)
#   prod × full    (postgis/postgis:16-3.4)
#   dev  × alpine  (postgis/postgis:16-3.4-alpine)
#   dev  × full    (postgis/postgis:16-3.4)
#
# Portas DEDICADAS no host (15432–15435) para não colidir com Postgres local
# (5432) nem com o docker-compose.test.yml (5433).
#
# Defense-in-depth: após cada célula, o output capturado é validado NÃO-VAZIO.
# Se o padrão de linha única `cell "..." out=$(...)` voltar, o `out=` vira
# argumento posicional → `out` fica vazio e `code` captura o exit do echo (0),
# reportando PASS sem o E2E ter rodado (falso positivo). Output vazio ⇒ célula
# falha (FAIL(empty-output)). Guard complementar: scripts/check-single-line-
# out-assign.sh (pre-commit + utf8-check.yml).
#
# Usage:
#   ./scripts/validate-seed-guards-matrix-local.sh
#
# Exit codes:
#   0 — todas as 4 células passaram (E2E exit 0 em cada)
#   1 — alguma célula falhou (container, health, postgis, schema ou E2E)
#
# Environment:
#   IMAGE_ALPINE  Override da imagem alpine (default postgis/postgis:16-3.4-alpine)
#   IMAGE_FULL    Override da imagem full   (default postgis/postgis:16-3.4)
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_ALPINE="${IMAGE_ALPINE:-postgis/postgis:16-3.4-alpine}"
IMAGE_FULL="${IMAGE_FULL:-postgis/postgis:16-3.4}"

DB_USER="severinno"
DB_PASS="severinno_dev"
DB_NAME="severinno"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
cell() { echo -e "  ${CYAN}▸${NC} $1"; }

# ── Resumo acumulado ───────────────────────────────────────────────────────
declare -A RESULT=(
  [prod:alpine]="-" [prod:full]="-" [dev:alpine]="-" [dev:full]="-"
)

# ── Limpeza global (containers leftovers de runs anteriores) ───────────────
cleanup() {
  for c in sg-local-prod-alpine sg-local-prod-full sg-local-dev-alpine sg-local-dev-full; do
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# ═════════════════════════════════════════════════════════════════════════
# run_cell <seed> <image> <host_port> <name> <label>
# ═════════════════════════════════════════════════════════════════════════
run_cell() {
  local seed="$1" image="$2" port="$3" name="$4" label="$5"
  local url="postgresql://${DB_USER}:${DB_PASS}@localhost:${port}/${DB_NAME}"

  echo ""
  echo "  ────────────────────────────────────────────────────────────────"
  echo "   CELL: ${seed} × ${image}   (host port ${port})"
  echo "  ────────────────────────────────────────────────────────────────"

  # 1. Container efêmero com healthcheck (mesmo do CI)
  docker rm -f "$name" >/dev/null 2>&1 || true
  if ! docker run -d --name "$name" \
    -e POSTGRES_DB="$DB_NAME" -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASS" \
    -p "127.0.0.1:${port}:5432" \
    --health-cmd "pg_isready -U ${DB_USER} -d ${DB_NAME}" \
    --health-interval 3s --health-timeout 3s --health-retries 20 --health-start-period 10s \
    "$image" >/dev/null 2>&1; then
    fail "docker run falhou (imagem '${image}' — puxe com: docker pull ${image})"
    RESULT["$label"]="FAIL(container)"
    return 1
  fi

  # 2. Aguardar healthy (até ~90s)
  local st="" i
  for i in $(seq 1 45); do
    st=$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null)
    [ "$st" = "healthy" ] && break
    sleep 2
  done
  if [ "$st" != "healthy" ]; then
    fail "container não ficou healthy (status=$st)"
    docker logs "$name" 2>&1 | tail -15
    RESULT["$label"]="FAIL(health)"
    return 1
  fi
  pass "PostGIS healthy"

  # 3. Garantir a extensão postgis no DB — POLL por presença (mesmo do CI)
  # O docker-postgis (alpine E full) carrega a extensão no POSTGRES_DB
  # DEPOIS do servidor aceitar conexões ('Loading PostGIS extensions into
  # severinno') — o healthcheck passa antes. Um CREATE EXTENSION IF NOT EXISTS
  # nesse momento RACEIA com o load da imagem e falha esporadicamente com
  # duplicate key pg_extension_name_index. Solução: poll até a extensão
  # aparecer (a imagem SEMPRE carrega), com fallback de criação.
  local has=0 i
  for i in $(seq 1 30); do
    if docker exec "$name" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "SELECT 1 FROM pg_extension WHERE extname='postgis'" 2>/dev/null | grep -qx 1; then
      has=1
      break
    fi
    sleep 1
  done
  if [ "$has" != "1" ]; then
    # Fallback: imagem que não pré-carrega (hipotético) — cria com IF NOT
    # EXISTS (no-op se presente; tolera erro de race re-verificando depois).
    docker exec "$name" psql -U "$DB_USER" -d "$DB_NAME" \
      -c "CREATE EXTENSION IF NOT EXISTS postgis" >/dev/null 2>&1 || true
    if ! docker exec "$name" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "SELECT 1 FROM pg_extension WHERE extname='postgis'" 2>/dev/null | grep -qx 1; then
      fail "extensão postgis não disponível após espera/fallback"
      RESULT["$label"]="FAIL(postgis)"
      return 1
    fi
  fi
  pass "postgis disponível"

  # 4. E2E da célula (--skip-docker usa o container existente)
  local out code
  if [ "$seed" = "prod" ]; then
    cell "Rodando prod E2E (128 checks)..."
    out=$(cd "$SCRIPT_DIR" && DATABASE_URL="$url" bun run test:seed-prod-e2e --skip-docker 2>&1)
  else
    cell "Rodando dev E2E (162 checks)..."
    out=$(cd "$SCRIPT_DIR" && DATABASE_URL="$url" bun run test:seed-dev-e2e --skip-docker 2>&1)
  fi
  code=$?

  echo "$out" | tail -12

  # Defense-in-depth contra regressão do padrão de linha única (o guard
  # check-single-line-out-assign.sh impede o colapso `cell "..." out=$(...)`,
  # mas se ele voltar o `out=` vira ARGUMENTO POSICIONAL): `out` fica VAZIO e
  # `code` captura o exit do echo (0) → a célula reportaria PASS sem o E2E ter
  # rodado. Output vazio = falso positivo garantido — falha a célula.
  if [ -z "$out" ]; then
    fail "output da célula VAZIO — o E2E não rodou (possível regressão do padrão de linha única)"
    RESULT["$label"]="FAIL(empty-output)"
    return 1
  fi

  if [ "$code" -eq 0 ]; then
    pass "E2E passou (exit 0)"
    RESULT["$label"]="PASS"
  else
    fail "E2E falhou (exit $code)"
    RESULT["$label"]="FAIL(e2e:$code)"
  fi

  docker rm -f "$name" >/dev/null 2>&1
  return "$code"
}

# ═════════════════════════════════════════════════════════════════════════
# Matrix 2×2 — em sequência
# ═════════════════════════════════════════════════════════════════════════
echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🛡️  SEED-GUARDS MATRIX 2×2 — VALIDAÇÃO LOCAL (4 células)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""
echo "  Células: prod×alpine | prod×full | dev×alpine | dev×full"
echo "  Portas : 15432 | 15433 | 15434 | 15435 (dedicadas — sem conflito)"
echo ""

run_cell prod "$IMAGE_ALPINE" 15432 sg-local-prod-alpine "prod:alpine"
run_cell prod "$IMAGE_FULL"   15433 sg-local-prod-full   "prod:full"
run_cell dev  "$IMAGE_ALPINE" 15434 sg-local-dev-alpine  "dev:alpine"
run_cell dev  "$IMAGE_FULL"   15435 sg-local-dev-full    "dev:full"

# ═════════════════════════════════════════════════════════════════════════
# Resumo final
# ═════════════════════════════════════════════════════════════════════════
echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   RESULTADO — MATRIX 2×2"
echo "  ═════════════════════════════════════════════════════════════════"
printf "  | seed | variant | result |\n"
printf "  | prod | alpine  | %s |\n" "${RESULT[prod:alpine]}"
printf "  | prod | full    | %s |\n" "${RESULT[prod:full]}"
printf "  | dev  | alpine  | %s |\n" "${RESULT[dev:alpine]}"
printf "  | dev  | full    | %s |\n" "${RESULT[dev:full]}"
echo "  ═════════════════════════════════════════════════════════════════"

fails=0
for k in prod:alpine prod:full dev:alpine dev:full; do
  [ "${RESULT[$k]}" = "PASS" ] || fails=$((fails + 1))
done

if [ "$fails" -eq 0 ]; then
  echo -e "  ${GREEN}✅ TODAS AS 4 CÉLULAS PASSARAM — matrix pronta para o CI.${NC}"
  exit 0
else
  echo -e "  ${RED}❌ ${fails}/4 células falharam — veja os logs acima.${NC}"
  exit 1
fi
