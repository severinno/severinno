#!/usr/bin/env bash
# =============================================================================
# Setup Telegram Alerts — Severinno Marketplace
# =============================================================================
# Guides you through setting up Telegram bot alerts via Alertmanager.
#
# Prerequisites:
#   1. Open Telegram and search for @BotFather
#   2. Send /newbot and follow instructions
#   3. Copy the bot token (format: 123456789:ABCdefGhi...)
#   4. Send a message to your bot from your phone
#   5. Get chat_id via: curl https://api.telegram.org/bot<TOKEN>/getUpdates
#
# Usage:
#   bash scripts/setup-telegram-alerts.sh <BOT_TOKEN> <CHAT_ID>
#
# Exit codes:
#   0 — setup complete
#   1 — missing arguments
# =============================================================================

set -euo pipefail

BOT_TOKEN="${1:-}"
CHAT_ID="${2:-}"

if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  📱 Setup Telegram Alerts — Severinno Marketplace           ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Como configurar:"
  echo ""
  echo "1. Abra o Telegram e busque @BotFather"
  echo "2. Envie /newbot e siga as instruções"
  echo "3. Copie o token do bot (formato: 123456789:ABCdefGhi...)"
  echo "4. Envie uma mensagem pro seu bot do celular"
  echo "5. Pegue o chat_id via:"
  echo "   curl https://api.telegram.org/bot<SEU_TOKEN>/getUpdates"
  echo ""
  echo "Uso:"
  echo "   bash scripts/setup-telegram-alerts.sh <BOT_TOKEN> <CHAT_ID>"
  echo ""
  echo "Exemplo:"
  echo "   bash scripts/setup-telegram-alerts.sh 123456789:ABCdef 987654321"
  exit 1
fi

echo "Configurando Telegram alerts..."

# Update alertmanager config with real token and chat_id
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_DIR/monitoring/alertmanager/alertmanager.yml"

sed -i "s|bot_token:.*|bot_token: \"${BOT_TOKEN}\"|" "$CONFIG_FILE"
sed -i "s|chat_id:.*|chat_id: ${CHAT_ID}|" "$CONFIG_FILE"

# Update docker-compose env vars
COMPOSE_FILE="$PROJECT_DIR/docker-compose.monitoring.yml"
if grep -q "ALERTMANAGER_TELEGRAM_BOT_TOKEN" "$COMPOSE_FILE"; then
  sed -i "s|ALERTMANAGER_TELEGRAM_BOT_TOKEN=.*|ALERTMANAGER_TELEGRAM_BOT_TOKEN=${BOT_TOKEN}|" "$COMPOSE_FILE"
  sed -i "s|ALERTMANAGER_TELEGRAM_CHAT_ID=.*|ALERTMANAGER_TELEGRAM_CHAT_ID=${CHAT_ID}|" "$COMPOSE_FILE"
fi

# Restart alertmanager
docker cp "$CONFIG_FILE" severinno-alertmanager-1:/etc/alertmanager/alertmanager.yml 2>/dev/null || true
docker restart severinno-alertmanager-1 2>&1 | tail -1

echo "✅ Telegram alerts configurado!"
echo ""
echo "Para testar, execute:"
echo "   curl -X POST http://localhost:9093/api/v1/alerts \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '[{\"labels\":{\"alertname\":\"Test\",\"severity\":\"critical\"},\"annotations\":{\"summary\":\"Teste\",\"description\":\"Alerta de teste\"}}]'"
