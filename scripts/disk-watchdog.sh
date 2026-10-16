#!/usr/bin/env bash
# =============================================================================
# scripts/disk-watchdog.sh — Sentinela de Disco, Auto-Limpeza e Alertas Proativos
# =============================================================================
#
# Executado a cada 30 minutos via crontab:
#   */30 * * * * /home/deploy/severinno/scripts/disk-watchdog.sh
#
# Funcionalidades:
# 1. Mede a ocupação do disco raiz (/).
# 2. Se ultrapassar THRESHOLD_WARN (70%), dispara limpeza preventiva de imagens,
#    builder cache e fstrim.
# 3. Dispara alertas proativos via Telegram e WhatsApp (Evolution API) se
#    houver credenciais configuradas no .env.
# Usage:
#   bash scripts/disk-watchdog.sh
#
# Exit codes:
#   0 — success
#   1 — failure
# =============================================================================

set -euo pipefail

LOG_FILE="/var/log/disk-watchdog.log"
THRESHOLD_WARN=70
THRESHOLD_CRIT=80
ENV_FILE="/home/deploy/severinno/.env"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Carrega variáveis de alerta se disponíveis
if [ -f "$ENV_FILE" ]; then
  TELEGRAM_BOT_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
  TELEGRAM_CHAT_ID=$(grep -E '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
  EVOLUTION_API_KEY=$(grep -E '^EVOLUTION_API_KEY=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
  EVOLUTION_INSTANCE=$(grep -E '^EVOLUTION_INSTANCE=' "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || echo "severinno")
  ADMIN_WHATSAPP=$(grep -E '^ADMIN_WHATSAPP=|^ADMIN_PHONE=|^OPS_WHATSAPP_NUMBER=' "$ENV_FILE" | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
else
  TELEGRAM_BOT_TOKEN=""
  TELEGRAM_CHAT_ID=""
  EVOLUTION_API_KEY=""
  EVOLUTION_INSTANCE="severinno"
  ADMIN_WHATSAPP=""
fi

send_remote_alert() {
  local title="$1"
  local message="$2"
  local severity="$3"

  local full_text="🚨 *[SEVERINNO VPS ALERT] ${severity}*
*${title}*

${message}
⏰ $(date +'%d/%m/%Y %H:%M:%S') | Host: 187.127.16.136"

  # Envio para Telegram
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -H "Content-Type: application/json" \
      -d "{\"chat_id\": \"${TELEGRAM_CHAT_ID}\", \"text\": \"${full_text}\", \"parse_mode\": \"Markdown\"}" >/dev/null 2>&1 || true
  fi

  # Envio para WhatsApp via Evolution API local
  if [ -n "$EVOLUTION_API_KEY" ] && [ -n "$ADMIN_WHATSAPP" ]; then
    local clean_phone=$(echo "$ADMIN_WHATSAPP" | tr -dc '0-9')
    curl -s -X POST "http://127.0.0.1:8080/message/sendText/${EVOLUTION_INSTANCE}" \
      -H "Content-Type: application/json" \
      -H "apikey: ${EVOLUTION_API_KEY}" \
      -d "{\"number\": \"${clean_phone}\", \"text\": \"${full_text}\"}" >/dev/null 2>&1 || true
  fi
}

USAGE_PERCENT=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
AVAIL_GB=$(df -h / | tail -1 | awk '{print $4}')

log "🔍 Checagem de rotina: ${USAGE_PERCENT}% ocupado (${AVAIL_GB} livres)"

# 1. Se passar do limite de alerta (70%), dispara auto-limpeza preventiva
if [ "$USAGE_PERCENT" -ge "$THRESHOLD_WARN" ]; then
  log "⚠️ Uso de disco atingiu ${USAGE_PERCENT}% (>= ${THRESHOLD_WARN}%). Disparando limpeza automática preventiva..."

  # Limpa caches BuildKit e imagens antigas
  docker builder prune -a -f --filter 'until=48h' >/dev/null 2>&1 || true
  docker image prune -a -f --filter 'until=48h' >/dev/null 2>&1 || true
  docker volume ls -q -f dangling=true | grep -E '^[a-f0-9]{64}$' | xargs -r docker volume rm >/dev/null 2>&1 || true
  rm -rf /tmp/bunx-* 2>/dev/null || true

  # Devolve blocos para o KVM da Hostinger
  fstrim -v / >/dev/null 2>&1 || true

  # Re-avalia o uso pós-limpeza
  NEW_USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
  NEW_AVAIL=$(df -h / | tail -1 | awk '{print $4}')
  log "✅ Limpeza concluída: Uso caiu de ${USAGE_PERCENT}% para ${NEW_USAGE}% (${NEW_AVAIL} livres)"

  send_remote_alert \
    "Auto-Limpeza de Disco Executada" \
    "O disco havia atingido ${USAGE_PERCENT}%. A limpeza automática preventiva reduziu para ${NEW_USAGE}% (${NEW_AVAIL} livres)." \
    "WARNING"

  # Se mesmo após a limpeza ainda estiver acima do nível crítico (80%), emite alerta crítico
  if [ "$NEW_USAGE" -ge "$THRESHOLD_CRIT" ]; then
    log "🚨 CRÍTICO: Uso de disco permanece em ${NEW_USAGE}% após limpeza! Ação manual requerida."
    send_remote_alert \
      "CRÍTICO: Disco permanece alto após auto-limpeza" \
      "Uso de disco permanece em ${NEW_USAGE}% (${NEW_AVAIL} livres). Necessária intervenção manual." \
      "CRITICAL"
  fi
fi

exit 0
