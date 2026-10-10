#!/usr/bin/env bash
# =============================================================================
# scripts/glitchtip-setup.sh — GlitchTip Setup Helpers
#
# Usage:
#   ./scripts/glitchtip-setup.sh create-admin     ← Create first admin user
#   ./scripts/glitchtip-setup.sh create-project   ← Create a project + get DSN
#   ./scripts/glitchtip-setup.sh status           ← Check all services health
#   ./scripts/glitchtip-setup.sh logs             ← Tail GlitchTip logs
#
# Prerequisites:
#   - docker compose running (docker compose -f docker-compose.prod.yml
#     --profile glitchtip --env-file .env.glitchtip up -d)
#   - curl + jq installed
# =============================================================================

set -euo pipefail

# O GlitchTip roda como profile dentro do docker-compose.prod.yml principal.
# Nao existe mais docker-compose.glitchtip.yml separado.
COMPOSE_FILE="docker-compose.prod.yml"
COMPOSE_PROFILE="--profile glitchtip"
COMPOSE_ENV="--env-file .env.glitchtip"
GLITCHTIP_URL="${GLITCHTIP_URL:-http://localhost:8000}"
COMPOSE_CMD="docker compose -p glitchtip -f ${COMPOSE_FILE} ${COMPOSE_PROFILE} ${COMPOSE_ENV}"

# ── Colors ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ── Health check ───────────────────────────────────────────────────────────
health_check() {
  local max_retries=30
  local retry=0

  info "Waiting for GlitchTip to be ready..."
  until curl -sf "${GLITCHTIP_URL}/_health/" > /dev/null 2>&1 || curl -sf "${GLITCHTIP_URL}/api/0/internal/health" > /dev/null 2>&1; do
    retry=$((retry + 1))
    if [ "$retry" -ge "$max_retries" ]; then
      error "GlitchTip did not become healthy after ${max_retries}s"
      info "Check logs: ${COMPOSE_CMD} logs glitchtip-web"
      return 1
    fi
    sleep 2
  done
  ok "GlitchTip is healthy at ${GLITCHTIP_URL}"
}

# ── Status ─────────────────────────────────────────────────────────────────
cmd_status() {
  info "GlitchTip service status:"
  ${COMPOSE_CMD} ps

  echo ""
  info "Health endpoint:"
  curl -sf "${GLITCHTIP_URL}/api/0/internal/health" | python3 -m json.tool 2>/dev/null || curl -sf "${GLITCHTIP_URL}/_health/" 2>/dev/null || echo "  (not ready yet)"
}

# ── Logs ───────────────────────────────────────────────────────────────────
cmd_logs() {
  ${COMPOSE_CMD} logs --tail=100 -f
}

# ── Create Admin User ─────────────────────────────────────────────────────
cmd_create_admin() {
  health_check

  echo ""
  info "Creating admin user for GlitchTip..."
  echo ""

  read -r -p "Admin email: "  ADMIN_EMAIL
  read -r -s -p "Password: "   ADMIN_PASSWORD
  echo ""
  read -r -p "Name: "          ADMIN_NAME

  # Django createsuperuser with --noinput and DJANGO_SUPERUSER_PASSWORD
  ${COMPOSE_CMD} exec -e DJANGO_SUPERUSER_PASSWORD="${ADMIN_PASSWORD}" glitchtip-web \
    ./manage.py createsuperuser \
    --email "${ADMIN_EMAIL}" \
    --noinput 2>/dev/null || {

    # Fallback interactive
    info "Trying interactive method..."
    ${COMPOSE_CMD} exec glitchtip-web \
      ./manage.py createsuperuser \
      --email "${ADMIN_EMAIL}"
  }

  ok "Admin user created!"
  info "Login at ${GLITCHTIP_URL}"
}

# ── Create Project + Get DSN ────────────────────────────────────────────
cmd_create_project() {
  health_check

  echo ""
  read -r -p "Auth token (create via ${GLITCHTIP_URL}/settings/): " AUTH_TOKEN
  read -r -p "Project name (default: severinno): " PROJECT_NAME
  PROJECT_NAME="${PROJECT_NAME:-severinno}"

  # GlitchTip API: create a project
  # (uses the same API as Sentry)
  echo ""
  info "Creating project '${PROJECT_NAME}'..."

  RESPONSE=$(curl -sf -X POST "${GLITCHTIP_URL}/api/0/teams/glitchtip/projects/" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${PROJECT_NAME}\"}" 2>&1) || {
    error "Failed to create project"
    info "Make sure you created an auth token first: ${GLITCHTIP_URL}/settings/auth-tokens/"
    info ""
    info "Alternative: create the project manually in the UI"
    info "  1. Login at ${GLITCHTIP_URL}"
    info "  2. Create a project → choose 'Next.js'"
    info "  3. Copy the DSN from the project settings"
    return 1
  }

  # Extract project slug from response, then fetch the DSN via project keys
  PROJECT_SLUG=$(echo "${RESPONSE}" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('slug', ''))
except: pass
" 2>/dev/null)
  PROJECT_SLUG="${PROJECT_SLUG:-${PROJECT_NAME}}"

  # Fetch the DSN from project keys (this is where Sentry API stores it)
  info "Fetching DSN for project '${PROJECT_SLUG}'..."
  
  # First try common org slugs, then fall back to the project slug itself
  for ORG in "glitchtip" "${PROJECT_SLUG}" "default"; do
    KEYS=$(curl -sf -H "Authorization: Bearer ${AUTH_TOKEN}" \
      "${GLITCHTIP_URL}/api/0/projects/${ORG}/${PROJECT_SLUG}/keys/" 2>/dev/null) && break
  done

  DSN=""
  if [ -n "${KEYS}" ]; then
    DSN=$(echo "${KEYS}" | python3 -c "
import sys, json
try:
    keys = json.load(sys.stdin)
    if keys:
        # Prefer the 'public' DSN (client-side)
        dsn = keys[0].get('dsn', {})
        print(dsn.get('public', dsn.get('secret', '')))
except: pass
" 2>/dev/null)
  fi

  if [ -n "${DSN}" ]; then
    echo ""
    ok "Project created!"
    echo ""
    echo "─────────────────────────────────────────────────────────────"
    echo "  Add these to your .env file:"
    echo ""
    echo "  SENTRY_DSN=${DSN}"
    echo "  NEXT_PUBLIC_SENTRY_DSN=${DSN}"
    echo "─────────────────────────────────────────────────────────────"
    echo ""
  else
    echo ""
    warn "Project created, but couldn't extract DSN automatically."
    info "Find the DSN at: ${GLITCHTIP_URL}/settings/${PROJECT_SLUG}/keys/"
    echo ""
    echo "  Manual DSN format:"
    echo "  SENTRY_DSN=https://<key>@glitchtip.severinno.com.br/<id>"
    echo "  NEXT_PUBLIC_SENTRY_DSN=https://<key>@glitchtip.severinno.com.br/<id>"
  fi
}

# ── Main ───────────────────────────────────────────────────────────────────
case "${1:-help}" in
  status)
    cmd_status
    ;;
  logs)
    cmd_logs
    ;;
  create-admin)
    cmd_create_admin
    ;;
  create-project)
    cmd_create_project
    ;;
  health)
    health_check
    ;;
  help|*)
    echo "GlitchTip Setup Helpers"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  status          Show service status"
    echo "  logs            Tail GlitchTip logs"
    echo "  health          Wait for GlitchTip to be healthy"
    echo "  create-admin    Create first admin user"
    echo "  create-project  Create a project and get the DSN"
    echo ""
    echo "Environment:"
    echo "  GLITCHTIP_URL   GlitchTip URL (default: http://localhost:8000)"
    echo "  COMPOSE_FILE    Docker Compose file (default: docker-compose.prod.yml)"
    echo "  COMPOSE_PROFILE Docker Compose profile (default: --profile glitchtip)"
    echo "  COMPOSE_ENV     Env file (default: --env-file .env.glitchtip)"
    ;;
esac
