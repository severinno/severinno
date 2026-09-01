#!/bin/bash
# =============================================================================
# scripts/health-alert.sh — Health Check + Telegram Alerts
# =============================================================================
# Verifica o health do app e envia alerta no Telegram se algo falhar.
#
# Usage:
#   bash scripts/health-alert.sh
#   # Via cron: */5 * * * * /home/severinno/severinno/scripts/health-alert.sh
#
# Environment:
#   TELEGRAM_BOT_TOKEN — Token do bot Telegram (obtido via @BotFather)
#   TELEGRAM_CHAT_ID   — ID do chat/grupo pra enviar alertas
#   APP_URL            — URL do health check (default: http://localhost:3000)
#
# Exit codes:
#   0 — success
#   1 — failure
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
APP_URL="${APP_URL:-http://localhost:3000}"
HEALTH_URL="${APP_URL}/api/health"
STATE_FILE="/tmp/severinno-health-state"
LOG_FILE="/home/severinno/severinno/logs/health-alert.log"

# Telegram (set via environment or .env)
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# ── Functions ───────────────────────────────────────────────────────────────
log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"; }

send_telegram() {
    local message="$1"
    if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
        log "⚠️  Telegram not configured — skipping notification"
        return 0
    fi
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TELEGRAM_CHAT_ID}" \
        -d "text=${message}" \
        -d "parse_mode=HTML" \
        -o /dev/null 2>/dev/null || log "❌ Failed to send Telegram message"
}

# ── Main ────────────────────────────────────────────────────────────────────
mkdir -p "$(dirname "$LOG_FILE")"

# Load .env if exists
[ -f /home/severinno/severinno/.env ] && source <(grep -E "^(TELEGRAM_|APP_URL)" /home/severinno/severinno/.env 2>/dev/null || true)

# Previous state
PREV_STATUS="ok"
[ -f "$STATE_FILE" ] && PREV_STATUS=$(cat "$STATE_FILE")

# Check health
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    CURRENT_STATUS="ok"
    # Recovery alert
    if [ "$PREV_STATUS" != "ok" ]; then
        log "✅ RECOVERED — health check returned 200"
        send_telegram "✅ <b>Severinno RECUPERADO</b>%0AHealth check retornou HTTP 200.%0ATempo: $(date +'%d/%m/%Y %H:%M:%S')"
    fi
else
    CURRENT_STATUS="error"
    # New error alert
    if [ "$PREV_STATUS" = "ok" ]; then
        log "🔴 DOWN — health check returned HTTP $HTTP_CODE"
        send_telegram "🔴 <b>Severinno DOWN!</b>%0AHealth check retornou HTTP $HTTP_CODE.%0AURL: ${HEALTH_URL}%0ATempo: $(date +'%d/%m/%Y %H:%M:%S')"
    else
        log "⚠️  STILL DOWN — HTTP $HTTP_CODE"
    fi
fi

# Save state
echo "$CURRENT_STATUS" > "$STATE_FILE"
