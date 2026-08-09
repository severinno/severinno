#!/usr/bin/env bash
# =============================================================================
# scripts/glitchtip-alerts.sh - Configurar alertas no GlitchTip
#
# Configura regras de alerta no GlitchTip via API e aponta para o webhook
# receiver da aplicacao, que encaminha para Discord e/ou Telegram.
#
# Pre-requisitos:
#   - GlitchTip rodando (docker compose -f docker-compose.glitchtip.yml up -d)
#   - curl + jq instalados
#   - Auth token do GlitchTip (gerar em: ${GLITCHTIP_URL}/settings/auth-tokens/)
#
# Uso:
#   export GLITCHTIP_URL=http://localhost:8000
#   export GLITCHTIP_TOKEN=gt_xxxx
#   ./scripts/glitchtip-alerts.sh setup           <- Configura tudo
#   ./scripts/glitchtip-alerts.sh test             <- Envia alerta de teste
#   ./scripts/glitchtip-alerts.sh status           <- Ver regras existentes
#   ./scripts/glitchtip-alerts.sh guide            <- Mostra guia manual (UI)
# =============================================================================

set -euo pipefail

# -- Configuracao ----------------------------------------------------------
GLITCHTIP_URL="${GLITCHTIP_URL:-http://localhost:8000}"
GLITCHTIP_TOKEN="${GLITCHTIP_TOKEN:-}"
APP_URL="${APP_URL:-http://localhost:3000}"
PROJECT_SLUG="${PROJECT_SLUG:-severinno}"
ORG_SLUG="${ORG_SLUG:-glitchtip}"

# -- Cores -----------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }
header(){ echo -e "\n${CYAN}--- $* ---${NC}\n"; }

# -- Helpers ---------------------------------------------------------------

glitchtip_api() {
  local method="$1" path="$2" data="${3:-}"
  local url="${GLITCHTIP_URL}${path}"

  if [ -n "$data" ]; then
    curl -sf -X "$method" "$url" \
      -H "Authorization: Bearer ${GLITCHTIP_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$data" 2>/dev/null || return 1
  else
    curl -sf -X "$method" "$url" \
      -H "Authorization: Bearer ${GLITCHTIP_TOKEN}" \
      -H "Content-Type: application/json" 2>/dev/null || return 1
  fi
}

check_prereqs() {
  if ! command -v curl &>/dev/null; then error "curl nao instalado"; return 1; fi
  if [ -z "$GLITCHTIP_TOKEN" ]; then
    warn "GLITCHTIP_TOKEN nao definido"
    info "Gere um token em: ${GLITCHTIP_URL}/settings/auth-tokens/"
    info "Depois: export GLITCHTIP_TOKEN=gt_xxxx"
    return 1
  fi
  if ! glitchtip_api "GET" "/api/0/" >/dev/null 2>&1; then
    error "Nao foi possivel conectar ao GlitchTip em ${GLITCHTIP_URL}"
    info "Verifique se o GlitchTip esta rodando e o token esta correto."
    return 1
  fi
  ok "Conexao com GlitchTip OK"
}

# -- Comandos --------------------------------------------------------------

cmd_status() {
  header "Regras de Alerta Existentes"

  # Buscar projetos
  local projects
  projects=$(glitchtip_api "GET" "/api/0/projects/" 2>/dev/null) || {
    warn "Nao foi possivel listar projetos (API pode nao suportar)"
    info "Verifique manualmente em: ${GLITCHTIP_URL}/settings/"
    return
  }

  echo "$projects" | jq -r '.[] | " \(.slug) - \(.name)"' 2>/dev/null || warn "Nenhum projeto encontrado"

  # Tentar listar regras do projeto (endpoint Sentry-compatible)
  local rules
  rules=$(glitchtip_api "GET" "/api/0/projects/${ORG_SLUG}/${PROJECT_SLUG}/rules/" 2>/dev/null) || {
    info "API de rules nao disponivel - verifique manualmente."
    return
  }

  echo "$rules" | jq -r '.[] | "\(.id) | \(.name) | \(.action?.label // "N/A")"' 2>/dev/null \
    || warn "Nenhuma regra de alerta encontrada"

  echo ""
  ok "Para ver detalhes: ${GLITCHTIP_URL}/settings/${PROJECT_SLUG}/alerts/"
}

cmd_setup() {
  check_prereqs || return 1

  header "Configuracao de Alertas GlitchTip"

  # -- 1. Verificar/Criar webhook recipient ------------------------------
  info "Verificando webhook receiver da aplicacao..."
  local webhook_url="${APP_URL}/api/webhooks/sentry-alert"

  if curl -sf -o /dev/null -w "" "${APP_URL}/api/health" 2>/dev/null; then
    ok "App responde em ${APP_URL}"
  else
    warn "App nao responde em ${APP_URL} - o webhook pode nao estar acessivel"
    warn "Configure o APP_URL corretamente: export APP_URL=https://severinno.com.br"
  fi

  # -- 2. Criar regras de alerta via API ---------------------------------
  # GlitchTip usa API propria para rules - tentamos criar via endpoints
  # Sentry-compatible e mostramos o guia manual como fallback

  local rules_created=0

  # Regra 1: Erros fatais e 5xx
  info "Criando regra:  Erros Criticos (fatal/5xx)..."
  local rule_payload
  rule_payload=$(cat <<'PAYLOAD'
{
  "name": " Erros Criticos (fatal/5xx)",
  "action": {
    "type": "webhook",
    "target": "",
    "target_type": "specific"
  },
  "conditions": {
    "level": ["fatal", "error"],
    "frequency": 5,
    "times": 1
  },
  "webhook_url": ""
}
PAYLOAD
  )
  # Remove placeholders e adiciona webhook real
  rule_payload="${rule_payload//\"webhook_url\": \"\"/\"webhook_url\": \"${webhook_url}\"}"

  if glitchtip_api "POST" "/api/0/projects/${ORG_SLUG}/${PROJECT_SLUG}/rules/" "$rule_payload" >/dev/null 2>&1; then
    ok "Regra 'Erros Criticos' criada"
    rules_created=$((rules_created + 1))
  else
    warn "Nao foi possivel criar regra via API - sera necessario configurar manualmente"
  fi

  # Regra 2: Alta taxa de erros
  info "Criando regra:  Alta Taxa de Erros (10+ em 5 min)..."
  local rate_payload
  rate_payload=$(cat <<PAYLOAD
{
  "name": " Alta Taxa de Erros",
  "action": {
    "type": "webhook",
    "target": "",
    "target_type": "specific"
  },
  "conditions": {
    "times": 10,
    "frequency": 5
  },
  "webhook_url": "${webhook_url}"
}
PAYLOAD
  )

  if glitchtip_api "POST" "/api/0/projects/${ORG_SLUG}/${PROJECT_SLUG}/rules/" "$rate_payload" >/dev/null 2>&1; then
    ok "Regra 'Alta Taxa de Erros' criada"
    rules_created=$((rules_created + 1))
  else
    warn "API nao suporta criacao de regras - configurar manualmente (veja 'guide')"
  fi

  if [ "$rules_created" -eq 0 ]; then
    echo ""
    warn "Nenhuma regra foi criada via API. O GlitchTip nao expoe todos os endpoints"
    warn "do Sentry para gerenciamento de alertas. Siga o guia manual:"
    echo ""
    ./scripts/glitchtip-alerts.sh guide
  else
    echo ""
    ok "${rules_created} regra(s) criada(s) com sucesso!"
  fi

  # -- 3. Teste ----------------------------------------------------------
  echo ""
  info "Proximo passo: configurar as variaveis de ambiente para o webhook"
  echo ""
  echo "  DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/..."
  echo "  TELEGRAM_BOT_TOKEN=123456:ABC-DEF..."
  echo "  TELEGRAM_CHAT_ID=-123456789"
  echo "  SENTRY_ALERT_SECRET=um-segredo-aqui"
  echo ""
  info "Depois, teste o alerta:"
  echo "  curl -X POST \"${GLITCHTIP_URL}/api/0/projects/${ORG_SLUG}/${PROJECT_SLUG}/rules/\" \\"
  echo "    -H \"Authorization: Bearer ${GLITCHTIP_TOKEN}\" \\"
  echo "    -H \"Content-Type: application/json\" \\"
  echo "    -d '{\"name\":\"Teste\",\"action\":{\"type\":\"webhook\"},\"webhook_url\":\"${webhook_url}\"}'"
}

cmd_test() {
  header "Enviando alerta de teste para o webhook"

  local webhook_url="${APP_URL}/api/webhooks/sentry-alert"
  local secret="${SENTRY_ALERT_SECRET:-}"

  # Payload simulando um alerta real do Sentry/GlitchTip
  local test_payload
  test_payload=$(cat <<'PAYLOAD'
{
  "action": "triggered",
  "data": {
    "event": {
      "event_id": "test-123",
      "level": "error",
      "message": "Teste de alerta - Erro proposital para verificar integracao",
      "culprit": "src/app/api/bookings/route.ts:42",
      "logger": "bookings.handler",
      "tags": [["environment", "production"], ["source", "uncaughtException"], ["endpoint", "/api/bookings"]],
      "exception": {
        "values": [{
          "type": "TypeError",
          "value": "Cannot read properties of undefined (reading 'id')",
          "mechanism": { "type": "onunhandledrejection" }
        }]
      },
      "metadata": {
        "title": "TypeError: Cannot read properties of undefined"
      },
      "request": {
        "url": "/api/bookings/123",
        "method": "POST"
      }
    },
    "triggered_rule": {
      "id": "rule-1",
      "name": " Erros Criticos"
    }
  },
  "actor": { "type": "application", "id": "glitchtip" }
}
PAYLOAD
  )

  # Adiciona secret se configurado
  if [ -n "$secret" ]; then
    test_payload=$(echo "$test_payload" | jq --arg s "$secret" '. + {secret: $s}')
  fi

  info "Enviando alerta de teste para ${webhook_url}..."
  echo ""

  local response
  response=$(curl -s -X POST "$webhook_url" \
    -H "Content-Type: application/json" \
    ${secret:+ -H "Authorization: Bearer ${secret}"} \
    -d "$test_payload" 2>&1)

  local http_code=$?
  if [ "$http_code" -eq 0 ]; then
    ok "Alerta de teste enviado! Resposta: ${response}"
    echo ""
    info "Verifique:"
    info "  - Discord: o canal deve ter recebido um embed com o erro"
    info "  - Telegram: o grupo/canal deve ter recebido a mensagem"
    info "  - Logs: docker compose logs app | grep sentry-alert"
  else
    error "Falha ao enviar alerta de teste"
    info "Verifique se o servidor esta rodando em ${APP_URL}"
  fi
}

cmd_guide() {
  header "Guia Manual - Configuracao de Alertas no GlitchTip UI"

  echo "Se a criacao via API nao funcionar, configure manualmente:"
  echo ""
  echo "+==================================================================+"
  echo "|  1. Acesse o GlitchTip:                                        |"
  echo "|     ${GLITCHTIP_URL}                               |"
  echo "|                                                                    |"
  echo "|  2. Faca login com o admin criado anteriormente                   |"
  echo "|                                                                    |"
  echo "|  3. Va em: Organizations > [Sua Org] > Projects > [Severinno]    |"
  echo "|     > Settings > Project Alerts                                   |"
  echo "|                                                                    |"
  echo "|  4. Clique em \"Create New Alert\"                                |"
  echo "|                                                                    |"
  echo "|  5. Configure as regras:                                          |"
  echo "|                                                                    |"
  echo "|  +----------------------------------------------------------+   |"
  echo "|  | Regra A:  Erros Criticos                                |   |"
  echo "|  |   Quando: 1 erro com nivel fatal ou error em 5 min        |   |"
  echo "|  |   Acao: Webhook -> ${APP_URL}/api/webhooks/sentry-alert   |   |"
  echo "|  +----------------------------------------------------------+   |"
  echo "|  | Regra B:  Alta Taxa de Erros                            |   |"
  echo "|  |   Quando: 10+ erros em 5 minutos                          |   |"
  echo "|  |   Acao: Webhook -> ${APP_URL}/api/webhooks/sentry-alert   |   |"
  echo "|  +----------------------------------------------------------+   |"
  echo "|  | Regra C:  Unhandled Rejections                          |   |"
  echo "|  |   Quando: 1 erro com tag source=unhandledRejection        |   |"
  echo "|  |   Acao: Webhook -> ${APP_URL}/api/webhooks/sentry-alert   |   |"
  echo "|  +----------------------------------------------------------+   |"
  echo "|                                                                    |"
  echo "|  6. Em \"Add An Alert Recipient\", escolha \"Webhook\"             |"
  echo "|     e cole a URL do seu webhook receiver                          |"
  echo "+==================================================================+"
  echo ""
  echo "+- Configuracao do Discord -----------------------------------------+"
  echo "| 1. Abra as configuracoes do servidor Discord                      |"
  echo "| 2. Va em Integrations > Webhooks > New Webhook                   |"
  echo "| 3. De um nome (ex: Severinno Alertas) e selecione o canal        |"
  echo "| 4. Copie a URL do webhook                                       |"
  echo "| 5. Adicione ao .env: DISCORD_WEBHOOK_URL=<url>                  |"
  echo "+------------------------------------------------------------------+"
  echo ""
  echo "+- Configuracao do Telegram ----------------------------------------+"
  echo "| 1. Crie um bot no Telegram via @BotFather                         |"
  echo "| 2. Copie o token do bot                                           |"
  echo "| 3. Adicione o bot ao grupo desejado                               |"
  echo "| 4. Descubra o Chat ID: https://api.telegram.org/bot<TOKEN>/      |"
  echo "|                     getUpdates                                   |"
  echo "| 5. Adicione ao .env:                                             |"
  echo "|    TELEGRAM_BOT_TOKEN=123456:ABC-DEF...                         |"
  echo "|    TELEGRAM_CHAT_ID=-123456789                                   |"
  echo "+------------------------------------------------------------------+"
  echo ""
  echo "+- Testar a integracao ---------------------------------------------+"
  echo "| ./scripts/glitchtip-alerts.sh test                                |"
  echo "+------------------------------------------------------------------+"
}

cmd_env() {
  header "Variaveis de Ambiente Necessarias"

  echo "# -- Webhook Receiver (obrigatorio para receber alertas) -----"
  echo "# URL base da aplicacao (usada pelo script para montar o webhook)"
  echo "APP_URL=https://severinno.com.br"
  echo ""
  echo "# -- Discord (opcional) --------------------------------------"
  echo "# URL do webhook do Discord (criar em: Server Settings > Integrations)"
  echo "DISCORD_WEBHOOK_URL="
  echo ""
  echo "# -- Telegram (opcional) -------------------------------------"
  echo "# Token do bot Telegram (criar em: @BotFather)"
  echo "TELEGRAM_BOT_TOKEN="
  echo "# Chat ID do grupo/canal (descobrir via getUpdates)"
  echo "TELEGRAM_CHAT_ID="
  echo ""
  echo "# -- Seguranca (recomendado) ---------------------------------"
  echo "# Token secreto para validar origem dos webhooks"
  echo "SENTRY_ALERT_SECRET="
  echo ""
  echo "# -- GlitchTip (para o script de setup) ----------------------"
  echo "GLITCHTIP_URL=http://localhost:8000"
  echo "GLITCHTIP_TOKEN="
}

# -- Main -------------------------------------------------------------------
case "${1:-help}" in
  setup)  cmd_setup ;;
  test)   cmd_test ;;
  status) cmd_status ;;
  guide)  cmd_guide ;;
  env)    cmd_env ;;
  help|*)
    echo "GlitchTip Alertas - Configuracao de alertas com Discord/Telegram"
    echo ""
    echo "Uso: $0 <comando>"
    echo ""
    echo "Comandos:"
    echo "  setup   Configurar alertas no GlitchTip (API + guia)"
    echo "  test    Enviar alerta de teste para o webhook"
    echo "  status  Ver regras de alerta existentes"
    echo "  guide   Mostrar guia manual para configuracao via UI"
    echo "  env     Mostrar variaveis de ambiente necessarias"
    echo ""
    echo "Variaveis:"
    echo "  GLITCHTIP_URL     URL do GlitchTip (default: http://localhost:8000)"
    echo "  GLITCHTIP_TOKEN   Auth token (gerar em: \${GLITCHTIP_URL}/settings/auth-tokens/)"
    echo "  APP_URL           URL da aplicacao (default: http://localhost:3000)"
    echo "  SENTRY_ALERT_SECRET  Secret para validar webhooks"
    ;;
esac
