#!/bin/bash
# ==============================================================================
# Severinno Marketplace — Dead-Letter Queue Monitor (RabbitMQ)
# ==============================================================================
#
# Monitora filas de mensagens mortas (DLQ) e alerta se houver acúmulo.
# Ideal para rodar como cron job a cada 5 minutos.
#
# Uso:
#   ./scripts/dlq-monitor.sh                  # Verifica e mostra status
#   ./scripts/dlq-monitor.sh --alert=N         # Alerta se N+ mensagens na DLQ
#   ./scripts/dlq-monitor.sh --prom-metrics    # Saída no formato Prometheus
#   ./scripts/dlq-monitor.sh --purge           # Limpa todas as DLQs (CUIDADO!)
#   ./scripts/dlq-monitor.sh --watch           # Monitora em tempo real
#   ./scripts/dlq-monitor.sh --webhook=URL     # Envia alerta via webhook
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Config ─────────────────────────────────────────────────────────────────
RABBITMQ_HOST="${RABBITMQ_HOST:-localhost}"
RABBITMQ_PORT="${RABBITMQ_PORT:-15672}"
RABBITMQ_USER="${RABBITMQ_USER:-severinno}"
RABBITMQ_PASS="${RABBITMQ_PASS:-severinno_dev}"
RABBITMQ_API="http://$RABBITMQ_HOST:$RABBITMQ_PORT/api"
DLQ_SUFFIX=".dlq"
ALERT_THRESHOLD=10
PURGE_MODE=false
WATCH_MODE=false
PROM_MODE=false
WEBHOOK_URL=""
DO_ALERT=false

for arg in "$@"; do
  case "$arg" in
    --alert=*) ALERT_THRESHOLD="${arg#*=}"; DO_ALERT=true ;;
    --purge) PURGE_MODE=true ;;
    --watch) WATCH_MODE=true ;;
    --prom-metrics) PROM_MODE=true ;;
    --webhook=*) WEBHOOK_URL="${arg#*=}" ;;
  esac
done

# ── Colors ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()   { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()  { echo -e "${RED}[ERR]${NC} $*" >&2; }
info()   { echo -e "${CYAN}[..]${NC} $*"; }

# ── Check dependencies ────────────────────────────────────────────────────
if ! command -v curl &>/dev/null; then
  error "curl não disponível"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  warn "jq não disponível — instalando... (requer sudo)"
  # Intenta instalar jq (funciona em Alpine, Debian, macOS)
  if command -v apk &>/dev/null; then
    apk add --no-cache jq 2>/dev/null || true
  elif command -v apt-get &>/dev/null; then
    sudo apt-get install -y -qq jq 2>/dev/null || true
  elif command -v brew &>/dev/null; then
    brew install jq 2>/dev/null || true
  fi

  if ! command -v jq &>/dev/null; then
    error "jq é necessário — instale manualmente (apt install jq / brew install jq)"
    exit 1
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# FUNCTIONS
# ═════════════════════════════════════════════════════════════════════════════

check_rabbitmq() {
  local status
  status=$(curl -sf -u "$RABBITMQ_USER:$RABBITMQ_PASS" "$RABBITMQ_API/overview" 2>/dev/null)
  if [ -z "$status" ]; then
    error "RabbitMQ não está respondendo em $RABBITMQ_HOST:$RABBITMQ_PORT"
    return 1
  fi
  local version
  version=$(echo "$status" | jq -r '.rabbitmq_version // "unknown"')
  local queue_count
  queue_count=$(curl -sf -u "$RABBITMQ_USER:$RABBITMQ_PASS" "$RABBITMQ_API/queues" 2>/dev/null | jq length)
  info "RabbitMQ $version — $queue_count filas no total"
  return 0
}

list_dlqs() {
  curl -sf -u "$RABBITMQ_USER:$RABBITMQ_PASS" "$RABBITMQ_API/queues" 2>/dev/null | \
    jq -r '.[] | select(.name | endswith("'"$DLQ_SUFFIX"'")) | "\(.name)|\(.messages_ready // 0)|\(.messages_unacknowledged // 0)|\(.consumers // 0)"'
}

prometheus_metrics() {
  local dlqs
  dlqs=$(list_dlqs)
  echo "# HELP severinno_rabbitmq_dlq_messages Messages in dead-letter queues"
  echo "# TYPE severinno_rabbitmq_dlq_messages gauge"
  echo ""
  while IFS='|' read -r name ready unacked consumers; do
    [ -z "$name" ] && continue
    local total=$((ready + unacked))
    # Sanitize queue name for Prometheus label
    local label
    label=$(echo "$name" | sed 's/[^a-zA-Z0-9_]/_/g')
    echo "severinno_rabbitmq_dlq_messages{queue=\"$label\",original=\"$name\"} $total"
  done <<< "$dlqs"
  echo ""
  echo "# HELP severinno_rabbitmq_dlq_consumers Consumers attached to DLQs"
  echo "# TYPE severinno_rabbitmq_dlq_consumers gauge"
  while IFS='|' read -r name ready unacked consumers; do
    [ -z "$name" ] && continue
    local label
    label=$(echo "$name" | sed 's/[^a-zA-Z0-9_]/_/g')
    echo "severinno_rabbitmq_dlq_consumers{queue=\"$label\",original=\"$name\"} ${consumers:-0}"
  done <<< "$dlqs"
}

purge_dlqs() {
  local dlqs
  dlqs=$(list_dlqs)
  local purged=0
  while IFS='|' read -r name ready unacked _; do
    [ -z "$name" ] && continue
    local total=$((ready + unacked))
    if [ "$total" -gt 0 ]; then
      local encoded
      encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$name', safe=''))" 2>/dev/null || echo "$name")
      if curl -sf -u "$RABBITMQ_USER:$RABBITMQ_PASS" -X DELETE "$RABBITMQ_API/queues/%2F/$encoded/contents" >/dev/null 2>&1; then
        log "DLQ '$name' limpa ($total mensagens removidas)"
        purged=$((purged + 1))
      else
        error "Falha ao limpar DLQ '$name'"
      fi
    fi
  done <<< "$dlqs"
  log "Total: $purged filas limpas."
}

send_alert() {
  local subject="$1"
  local body="$2"

  # Log to stderr (captured by log aggregator)
  echo "[ALERT] $subject — $body" >&2

  # Webhook (Slack / Discord / custom)
  if [ -n "$WEBHOOK_URL" ]; then
    local payload
    payload=$(jq -n --arg text "⚠️ *Severinno DLQ Alert*: $subject\n\`\`\`$body\`\`\`" '{text: $text}')
    curl -sf -X POST -H "Content-Type: application/json" -d "$payload" "$WEBHOOK_URL" 2>/dev/null || \
      warn "Falha ao enviar webhook para $WEBHOOK_URL"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════

# ── Purge mode ─────────────────────────────────────────────────────────────
if [ "$PURGE_MODE" = true ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║     ⚠️  LIMPAR TODAS AS FILAS DLQ                     ║"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""
  echo -n "Digite 'PURGE' para confirmar: "
  read -r CONFIRM
  if [ "$CONFIRM" = "PURGE" ]; then
    purge_dlqs
  else
    info "Operação cancelada."
  fi
  exit 0
fi

# ── Watch mode ─────────────────────────────────────────────────────────────
if [ "$WATCH_MODE" = true ]; then
  info "Monitorando DLQs (Ctrl+C para sair)..."
  echo ""
  while true; do
    clear 2>/dev/null || true
    echo "=== Severinno DLQ Monitor === $(date '+%Y-%m-%d %H:%M:%S') ==="
    echo ""
    local dlqs
    dlqs=$(list_dlqs)
    local has_data=false
    while IFS='|' read -r name ready unacked consumers; do
      [ -z "$name" ] && continue
      local total=$((ready + unacked))
      if [ "$total" -gt "${ALERT_THRESHOLD}" ]; then
        printf "  ${RED}%-50s %5d messages${NC}\n" "$name" "$total"
      elif [ "$total" -gt 0 ]; then
        printf "  ${YELLOW}%-50s %5d messages${NC}\n" "$name" "$total"
      else
        printf "  ${GREEN}%-50s %5d messages${NC}\n" "$name" "$total"
      fi
      has_data=true
    done <<< "$dlqs"
    if [ "$has_data" = false ]; then
      echo "  (nenhuma DLQ encontrada)"
    fi
    sleep 5
  done
  exit 0
fi

# ── Prometheus metrics ─────────────────────────────────────────────────────
if [ "$PROM_MODE" = true ]; then
  prometheus_metrics
  exit 0
fi

# ── Standard check ─────────────────────────────────────────────────────────
echo "=== Severinno Marketplace — DLQ Monitor ==="
echo "  RabbitMQ: $RABBITMQ_HOST:$RABBITMQ_PORT"
echo "  Threshold: $ALERT_THRESHOLD mensagens"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Check RabbitMQ connectivity
check_rabbitmq || exit 1

echo ""

# List all DLQs
local dlqs
dlqs=$(list_dlqs)
local total_messages=0
local alert_count=0
local alert_details=""

while IFS='|' read -r name ready unacked consumers; do
  [ -z "$name" ] && continue
  local total=$((ready + unacked))
  total_messages=$((total_messages + total))

  if [ "$total" -gt "${ALERT_THRESHOLD}" ]; then
    error "$name — $total mensagens (threshold: $ALERT_THRESHOLD)"
    alert_count=$((alert_count + 1))
    alert_details="${alert_details}DLQ: $name — $total mensagens\n"
  elif [ "$total" -gt 0 ]; then
    warn "$name — $total mensagens (abaixo do threshold)"
  else
    log "$name — vazia"
  fi
done <<< "$dlqs"

echo ""
echo "Resumo: $total_messages mensagens em $(echo "$dlqs" | grep -c . || echo 0) filas DLQ"

# Alert if threshold exceeded
if [ "$alert_count" -gt 0 ] && [ "$DO_ALERT" = true ]; then
  send_alert \
    "$alert_count fila(s) DLQ acima do threshold ($ALERT_THRESHOLD)" \
    "$alert_details"
fi

# Exit with code for cron monitoring
if [ "$alert_count" -gt 0 ]; then
  exit 2
fi

exit 0
