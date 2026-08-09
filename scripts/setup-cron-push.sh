#!/bin/bash
# =============================================================================
# setup-cron.sh - Configura cron jobs no servidor de producao
#
# Uso:
#   chmod +x scripts/setup-cron.sh
#   sudo crontab -e   # ou:
#   ./scripts/setup-cron.sh --install
#
# Esse script INSTALA as entradas no crontab do usuario atual.
# Use --install para aplicar, ou leia as instrucoes manuais abaixo.
#
# Pre-requisitos:
#   - Servidor Next.js rodando (standalone ou via Docker)
#   - CRON_SECRET configurado no .env.production
#   - curl instalado
# =============================================================================

set -euo pipefail

# -- Configuracao ----------------------------------------------------------
# Altere estas variaveis para o seu ambiente
APP_URL="${APP_URL:-https://severinno.com.br}"
CRON_SECRET="${CRON_SECRET:-}"

# -- Crontab entries ------------------------------------------------------
# Cada entrada bate no endpoint correspondente com o token de autorizacao.
# Os logs vao para ~/cron-logs/ para debugging.
#
# Notas:
#   - push-scheduled: roda a cada 1 minuto (verifica se ha push agendados pendentes)
#   - reminders:      roda a cada 30 minutos (verifica bookings com scheduledAt em ~24h)
#   - settlements:    roda 1x ao dia as 03:00 (fecha periodo de repasse)
#   - commissions:    roda 1x ao mes no dia 1 as 04:00 (relatorio de comissoes)

CRON_ENTRIES=$(
  cat <<'CRONTAB'
# -- Severinno Cron Jobs -------------------------------------------------
# Push agendados - a cada 1 minuto
* * * * * curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer __CRON_SECRET__" "__APP_URL__/api/cron/push-scheduled" >> ~/cron-logs/push-scheduled.log 2>&1

# Lembretes de agendamento - a cada 30 minutos
*/30 * * * * curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer __CRON_SECRET__" "__APP_URL__/api/cron/reminders" >> ~/cron-logs/reminders.log 2>&1

# Fechamento de repasses - 1x ao dia as 03:00
0 3 * * * curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer __CRON_SECRET__" "__APP_URL__/api/cron/settlements" >> ~/cron-logs/settlements.log 2>&1

# Relatorio de comissoes - 1x ao mes no dia 1 as 04:00
0 4 1 * * curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer __CRON_SECRET__" "__APP_URL__/api/cron/commissions-report" >> ~/cron-logs/commissions.log 2>&1
CRONTAB
)

# -- Helpers --------------------------------------------------------------

function substitute_vars() {
  local content="$1"
  local url="$2"
  local secret="$3"
  echo "${content//__APP_URL__/$url}" | sed "s|__CRON_SECRET__|$secret|g"
}

function show_instructions() {
  echo "+==================================================================+"
  echo "|        Severinno - Configuracao Manual de Cron Jobs            |"
  echo "+==================================================================+"
  echo ""
  echo "Passo 1: Crie o diretorio de logs"
  echo "  mkdir -p ~/cron-logs"
  echo ""
  echo "Passo 2: Edite o crontab"
  echo "  crontab -e"
  echo ""
  echo "Passo 3: Adicione as seguintes linhas (substitua os placeholders):"
  echo ""
  substitute_vars "$CRON_ENTRIES" "$APP_URL" "$CRON_SECRET" | sed 's/^/  /'
  echo ""
  echo ""
  echo "Passo 4: Verifique se o cron esta rodando"
  echo "  crontab -l"
  echo "  systemctl status cron   # (ou service cron status)"
  echo ""
  echo "Passo 5: Teste manualmente cada endpoint"
  echo "  curl -H 'Authorization: Bearer SEU_CRON_SECRET' \\"
  echo "    'https://severinno.com.br/api/cron/push-scheduled'"
  echo ""
  echo "-- Variaveis -------------------------------------------------------"
  echo "  APP_URL:    ${APP_URL}"
  echo "  CRON_SECRET: ${CRON_SECRET:0:4}...${CRON_SECRET: -4}"
  echo "--------------------------------------------------------------------"
}

function install_crontab() {
  if [ -z "$CRON_SECRET" ]; then
    echo "[FAIL] CRON_SECRET nao configurado. Exporte a variavel ou use --dry-run"
    exit 1
  fi

  # Cria diretorio de logs
  mkdir -p ~/cron-logs

  # Gera o conteudo do crontab com as variaveis substituidas
  local new_cron
  new_cron=$(substitute_vars "$CRON_ENTRIES" "$APP_URL" "$CRON_SECRET")

  # Adiciona ao crontab existente (preserva entradas anteriores)
  local existing_cron
  existing_cron=$(crontab -l 2>/dev/null || true)

  local combined
  combined="$existing_cron"$'\n'"$new_cron"

  echo "$combined" | crontab -
  echo "[OK] Cron jobs instalados no crontab de $(whoami)"
  echo "   Verifique com: crontab -l"
}

# -- Main -----------------------------------------------------------------

case "${1:-}" in
  --install)
    install_crontab
    ;;
  --dry-run)
    echo " Simulacao - as seguintes entradas seriam instaladas:"
    echo ""
    substitute_vars "$CRON_ENTRIES" "$APP_URL" "${CRON_SECRET:-SUA_CRON_SECRET_AQUI}"
    echo ""
    echo "(nenhuma alteracao foi feita)"
    ;;
  *)
    show_instructions
    ;;
esac
