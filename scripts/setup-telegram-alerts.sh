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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_DIR/monitoring/alertmanager/alertmanager.yml"
ENV_FILE="$PROJECT_DIR/.env"

# 1. O alertmanager.yml usa ${ALERTMANAGER_TELEGRAM_BOT_TOKEN} / ${CHAT_ID}
#    (Alertmanager expande env vars no config). O docker-compose.monitoring.yml
#    injeta esses valores do .env — então só precisamos garantir que estão no
#    .env (o docker compose lê .env automaticamente). NÃO fazer sed no yml:
#    isso quebraria a referência de env var.
#
# 2. Grava no .env — o health-alert.sh (cron */5) lê TELEGRAM_* do .env e envia
#    alertas independentes do Alertmanager; o compose do Alertmanager lê
#    ALERTMANAGER_TELEGRAM_* do mesmo .env. Sem isso, o monitoramento "finge"
#    que funciona: o cron roda mas nunca notifica ninguém.
if [ -f "$ENV_FILE" ]; then
  for pair in \
    "TELEGRAM_BOT_TOKEN=${BOT_TOKEN}" \
    "TELEGRAM_CHAT_ID=${CHAT_ID}" \
    "ALERTMANAGER_TELEGRAM_BOT_TOKEN=${BOT_TOKEN}" \
    "ALERTMANAGER_TELEGRAM_CHAT_ID=${CHAT_ID}"; do
    KEY="${pair%%=*}"
    VAL="${pair#*=}"
    if grep -q "^${KEY}=" "$ENV_FILE"; then
      sed -i "s|^${KEY}=.*|${KEY}=${VAL}|" "$ENV_FILE"
    else
      echo "${KEY}=${VAL}" >> "$ENV_FILE"
    fi
  done
  echo "   ✅ .env atualizado (TELEGRAM_* e ALERTMANAGER_TELEGRAM_*)"
fi

# 4. Teste real: envia mensagem de confirmação pro chat
SEND_RESULT=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  -d "text=✅ <b>Severinno</b> — alertas Telegram configurados com sucesso!" \
  -d "parse_mode=HTML" 2>/dev/null || echo "")

if grep -q '"ok":true' <<< "$SEND_RESULT"; then
  echo "   ✅ Mensagem de teste enviada pro chat $CHAT_ID"
else
  echo "   ⚠️  Não consegui enviar mensagem de teste (token inválido ou chat não iniciado)"
  echo "      Abra o bot no Telegram e envie /start antes de testar."
fi

# 5. Recria o container do Alertmanager (se a stack de monitoring estiver no
#    ar) pra ele pegar as novas ALERTMANAGER_TELEGRAM_* do .env
if grep -q "alertmanager" <<< "$(docker ps --format '{{.Names}}' 2>/dev/null)"; then
  docker compose -f "$PROJECT_DIR/docker-compose.monitoring.yml" up -d alertmanager 2>&1 | tail -1
fi

echo "✅ Telegram alerts configurado!"
echo ""
echo "Para testar, execute:"
echo "   curl -X POST http://localhost:9093/api/v1/alerts \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '[{\"labels\":{\"alertname\":\"Test\",\"severity\":\"critical\"},\"annotations\":{\"summary\":\"Teste\",\"description\":\"Alerta de teste\"}}]'"
