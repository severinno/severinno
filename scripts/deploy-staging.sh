#!/bin/bash
# =============================================================================
# deploy-staging.sh — Automated Staging Deployment
# =============================================================================
# Deploys the full staging environment with health checks and validation.
#
# Usage:
#   ./scripts/deploy-staging.sh                    # Deploy staging
#   ./scripts/deploy-staging.sh --rebuild          # Force rebuild
#   ./scripts/deploy-staging.sh --teardown         # Remove staging
#   ./scripts/deploy-staging.sh --status           # Show status
#
# Requirements:
#   - Docker + Docker Compose v2
#   - .env.staging configured
# =============================================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────

COMPOSE_FILE="docker-compose.staging.yml"
ENV_FILE=".env.staging"
HEALTH_URL="http://localhost:3001/api/health"
MAX_WAIT=120

# ── Colors ─────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Functions ──────────────────────────────────────────────────────────────

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_prerequisites() {
  log_info "Checking prerequisites..."
  
  if ! command -v docker &> /dev/null; then
    log_error "Docker not found. Please install Docker."
    exit 1
  fi
  
  if ! docker compose version &> /dev/null; then
    log_error "Docker Compose v2 not found."
    exit 1
  fi
  
  if [ ! -f "$ENV_FILE" ]; then
    log_warning ".env.staging not found. Creating from template..."
    if [ -f "deploy/staging.env.example" ]; then
      cp deploy/staging.env.example "$ENV_FILE"
      log_warning "Please edit $ENV_FILE with real values before deploying."
      exit 1
    else
      log_error "No staging env template found."
      exit 1
    fi
  fi
  
  log_success "Prerequisites OK"
}

deploy() {
  local rebuild="${1:-false}"
  
  log_info "Deploying staging environment..."
  
  # Build and start services
  if [ "$rebuild" = "true" ]; then
    log_info "Force rebuilding images..."
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --no-cache
  fi
  
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
  
  log_info "Waiting for services to be healthy..."
  wait_for_health
  
  log_success "Staging deployment complete!"
  show_status
}

wait_for_health() {
  local elapsed=0
  
  while [ $elapsed -lt $MAX_WAIT ]; do
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
      log_success "App is healthy!"
      return 0
    fi
    
    sleep 5
    elapsed=$((elapsed + 5))
    echo -n "."
  done
  
  echo ""
  log_warning "Health check timeout after ${MAX_WAIT}s. Checking individual services..."
  
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
  return 1
}

show_status() {
  echo ""
  log_info "=== Staging Environment Status ==="
  echo ""
  
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
  
  echo ""
  log_info "=== Endpoints ==="
  echo "  App:        http://localhost:3001"
  echo "  Health:     http://localhost:3001/api/health"
  echo "  Metrics:    http://localhost:3001/api/metrics/prometheus"
  echo "  PostgreSQL: localhost:5433"
  echo "  Redis:      localhost:6380"
  echo "  MinIO:      http://localhost:9003"
  echo ""
}

teardown() {
  log_info "Tearing down staging environment..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down -v
  log_success "Staging environment removed"
}

# ── Main ───────────────────────────────────────────────────────────────────

case "${1:-}" in
  --rebuild)
    check_prerequisites
    deploy true
    ;;
  --teardown)
    check_prerequisites
    teardown
    ;;
  --status)
    show_status
    ;;
  *)
    check_prerequisites
    deploy false
    ;;
esac
