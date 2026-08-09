#!/usr/bin/env bash
# ===========================================================================
# pgbouncer-stress-test.sh - PgBouncer Stress Test Wrapper
# ===========================================================================
#
# Uso:
#   bash scripts/pgbouncer-stress-test.sh                    # Menu interativo
#   bash scripts/pgbouncer-stress-test.sh --check            # Verificar ambiente
#   bash scripts/pgbouncer-stress-test.sh --ramp             # Apenas ramp test
#   bash scripts/pgbouncer-stress-test.sh --all              # Tudo
#
# Pre-requisitos:
#   - pgBouncer rodando (docker compose -f docker-compose.prod.yml up -d pgbouncer)
#   - bun instalado (para rodar o script TypeScript)
#   - psql instalado (PostgreSQL client)
#   - Variaveis de ambiente: PGHOST, PGPORT, PGUSER, PGPASSWORD
#
# ===========================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TS_SCRIPT="$PROJECT_DIR/scripts/pgbouncer-stress-test.ts"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"

# -- Colors -----------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# -- Helpers ----------------------------------------------------------------
info()  { echo -e "${CYAN}  [i]${NC} $1"; }
ok()    { echo -e "${GREEN}  [OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}  [!]${NC} $1"; }
err()   { echo -e "${RED}  [X]${NC} $1"; }

# -- Header -----------------------------------------------------------------
print_header() {
  echo ""
  echo "  +==============================================================+"
  echo "  |   PgBouncer Stress Test - Severinno Marketplace             |"
  echo "  +==============================================================+"
  echo ""
}

# -- Check dependencies -----------------------------------------------------
check_deps() {
  local ok=true

  # Check bun
  if command -v bun &>/dev/null; then
    ok "bun $(bun --version)"
  else
    err "bun not found. Install: curl -fsSL https://bun.sh/install | bash"
    ok=false
  fi

  # Check psql
  if command -v psql &>/dev/null; then
    local pg_version
    pg_version=$(psql --version 2>&1 | head -1)
    ok "$pg_version"
  else
    err "psql not found. Install: sudo apt install postgresql-client"
    ok=false
  fi

  # Check TS script
  if [[ -f "$TS_SCRIPT" ]]; then
    ok "Stress test script found"
  else
    err "Stress test script not found at $TS_SCRIPT"
    ok=false
  fi

  $ok
}

# -- Auto-detect PgBouncer -------------------------------------------------
auto_detect_pgbouncer() {
  # If env vars are already set, skip detection
  if [[ -n "${PGHOST:-}" && -n "${PGPORT:-}" && -n "${PGUSER:-}" ]]; then
    info "Using env vars: PGHOST=$PGHOST PGPORT=$PGPORT PGUSER=$PGUSER"
    return 0
  fi

  # Try Docker Compose
  if [[ -f "$COMPOSE_FILE" ]]; then
    local pgbouncer_status
    pgbouncer_status=$(docker compose -f "$COMPOSE_FILE" ps --status running pgbouncer 2>/dev/null || true)

    if echo "$pgbouncer_status" | grep -q "Up\|running"; then
      export PGHOST="localhost"
      export PGPORT="6432"
      info "PgBouncer found via Docker Compose (localhost:6432)"

      # Try to extract user/pass from docker-compose env
      local pg_user
      pg_user=$(docker compose -f "$COMPOSE_FILE" exec -T pgbouncer printenv PGBOUNCER_DEFAULT_USER 2>/dev/null || echo "severinno")
      export PGUSER="${PGUSER:-$pg_user}"

      # If password not set, try to extract from a running app container or ask
      if [[ -z "${PGPASSWORD:-}" ]]; then
        warn "PGPASSWORD not set. Trying to detect from Docker..."
        local pg_pass
        pg_pass=$(docker compose -f "$COMPOSE_FILE" exec -T postgres printenv POSTGRES_PASSWORD 2>/dev/null || echo "")
        if [[ -n "$pg_pass" ]]; then
          export PGPASSWORD="$pg_pass"
          ok "PGPASSWORD auto-detected from Postgres container"
        fi
      fi

      return 0
    fi
  fi

  # Try localhost directly
  if command -v psql &>/dev/null; then
    if PGHOST=localhost PGPORT=6432 PGUSER=severinno PGPASSWORD=severinno PGDATABASE=pgbouncer \
      psql -At -c "SHOW POOLS;" 2>/dev/null | head -1 | grep -q .; then
      export PGHOST="localhost"
      export PGPORT="6432"
      export PGUSER="severinno"
      export PGPASSWORD="${PGPASSWORD:-severinno}"
      ok "PgBouncer found at localhost:6432 (default credentials)"
      return 0
    fi
  fi

  warn "Could not auto-detect PgBouncer."
  warn "Set env vars and try again:"
  warn "  export PGHOST=localhost PGPORT=6432 PGUSER=severinno PGPASSWORD=senha"
  return 1
}

# -- Menu interativo --------------------------------------------------------
show_menu() {
  print_header

  echo "  PgBouncer config (current):"
  echo "    $(psql -h ${PGHOST:-localhost} -p ${PGPORT:-6432} -U ${PGUSER:-severinno} \
        -d pgbouncer -At -c \"SHOW POOLS;\" 2>/dev/null | \
        awk -F'\t' '{print \"Pool: \"$1\" | cl_active: \"$2\" cl_waiting: \"$3\" sv_active: \"$4\" sv_idle: \"$5}')"
  echo ""

  echo "  Select test:"
  echo ""
  echo "    ${CYAN}1${NC})  Quick check    - Verify environment + baseline"
  echo "    ${CYAN}2${NC})  Ramp test      - Gradually increase to ${1:-80} connections"
  echo "    ${CYAN}3${NC})  Burst test     - Sudden spike of ${2:-60} connections"
  echo "    ${CYAN}4${NC})  Sustain test   - Hold ${3:-20} connections for ${4:-30}s"
  echo "    ${CYAN}5${NC})  Full battery   - Ramp -> Burst -> Sustain + report"
  echo "    ${CYAN}6${NC})  Show stats     - Current PgBouncer pool stats"
  echo "    ${CYAN}q${NC})  Quit"
  echo ""
  read -r -p "  Choice [1-6/q]: " choice

  case "$choice" in
    1) bun run "$TS_SCRIPT" --check ;;
    2) bun run "$TS_SCRIPT" --ramp --max-conns="${1:-80}" ;;
    3) bun run "$TS_SCRIPT" --burst --burst-conns="${2:-60}" ;;
    4) bun run "$TS_SCRIPT" --sustain --sustain-conns="${3:-20}" --sustain-duration="${4:-30}" ;;
    5) bun run "$TS_SCRIPT" --all --max-conns="${1:-80}" --burst-conns="${2:-60}" ;;
    6) bun run "$TS_SCRIPT" --stats ;;
    q|Q) echo ""; exit 0 ;;
    *) warn "Invalid choice" && show_menu "$@" ;;
  esac
}

# -- Main -------------------------------------------------------------------
main() {
  print_header

  # Check deps
  info "Checking dependencies..."
  check_deps || {
    err "Missing dependencies. Install them and try again."
    exit 1
  }

  # Auto-detect PgBouncer
  auto_detect_pgbouncer || {
    warn "Set env vars manually:"
    warn "  export PGHOST=localhost PGPORT=6432 PGUSER=severinno PGPASSWORD=senha"
    warn "  bash scripts/pgbouncer-stress-test.sh"
    exit 1
  }

  # Export for bun/TS script
  export PGHOST PGPORT PGUSER PGPASSWORD

  # If args passed, run directly
  if [[ $# -gt 0 ]]; then
    bun run "$TS_SCRIPT" "$@"
    exit $?
  fi

  # Interactive menu with sensible defaults
  # Increase ramp max based on default_pool_size if detectable
  local pool_size=25
  local pool_info
  pool_info=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d pgbouncer -At -c "SHOW CONFIG;" 2>/dev/null | grep "^default_pool_size" | head -1 || true)
  if [[ -n "$pool_info" ]]; then
    pool_size=$(echo "$pool_info" | cut -f2)
  fi

  local max_conns=$((pool_size * 3 + 10))   # ~85 for default 25
  local burst_conns=$((pool_size * 2 + 10)) # ~60 for default 25
  local sustain_conns=$((pool_size * 1))    # 25 for default 25

  show_menu "$max_conns" "$burst_conns" "$sustain_conns" "30"
}

main "$@"
