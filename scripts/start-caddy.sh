#!/bin/bash
# ---------------------------------------------------------------------------
# start-caddy.sh — Inicia Caddy como reverse proxy pro Severinno
# ---------------------------------------------------------------------------
#
# Usage:
#   bash scripts/start-caddy.sh [args]
#
# Exit codes:
#   0 — success
#   1 — failure
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CADDY_BIN="$HOME/caddy"
CADDYFILE="$PROJECT_DIR/Caddyfile"
CADDY_DATA="$PROJECT_DIR/.caddy"
CADDY_LOG="$PROJECT_DIR/caddy-access.log"
PID_FILE="$PROJECT_DIR/.caddy.pid"

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}=== Severinno — Caddy Reverse Proxy ===${NC}"

# Verificar se o binário existe
if [ ! -f "$CADDY_BIN" ]; then
  echo -e "${RED}❌ Caddy não encontrado em $CADDY_BIN${NC}"
  echo "Execute: curl -sL 'https://caddyserver.com/api/download?os=linux&arch=amd64' -o ~/caddy && chmod +x ~/caddy"
  exit 1
fi

# Verificar se já está rodando
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo -e "${YELLOW}⚠️  Caddy já está rodando (PID $(cat "$PID_FILE"))${NC}"
  echo "Para reiniciar: ./scripts/restart-caddy.sh"
  exit 0
fi

# Verificar DNS — o domínio precisa apontar pra este IP
echo ""
echo "📋 Verificando DNS..."
RESOLVED_IP=$(dig +short severinno.com A 2>/dev/null || echo "")
MY_IP=$(curl -s4 ifconfig.me 2>/dev/null || echo "")

if [ -n "$RESOLVED_IP" ] && [ "$RESOLVED_IP" != "$MY_IP" ]; then
  echo -e "${RED}⚠️  AVISO: severinno.com aponta pra $RESOLVED_IP, mas este servidor é $MY_IP${NC}"
  echo "Configure o DNS A record pra apontar pra $MY_IP antes de usar HTTPS."
  echo "Continuando mesmo assim (Caddy vai retry automático)..."
  echo ""
fi

# Criar diretório de dados do Caddy
mkdir -p "$CADDY_DATA"

# Iniciar Caddy
echo -e "${GREEN}🚀 Iniciando Caddy...${NC}"
echo "   Caddyfile: $CADDYFILE"
echo "   Domínio:   severinno.com"
echo "   Proxy:     localhost:3000"
echo ""

# Run Caddy in background
cd "$PROJECT_DIR"
nohup "$CADDY_BIN" run --config "$CADDYFILE" --adapter caddyfile \
  --state "$CADDY_DATA/state.json" \
  > /dev/null 2>"$CADDY_LOG" &

CADDY_PID=$!
echo "$CADDY_PID" > "$PID_FILE"

# Wait a bit and check if it's running
sleep 2
if kill -0 "$CADDY_PID" 2>/dev/null; then
  echo -e "${GREEN}✅ Caddy rodando! PID: $CADDY_PID${NC}"
  echo ""
  echo "📋 URLs disponíveis:"
  echo "   https://severinno.com       (HTTPS — após DNS + Let's Encrypt)"
  echo "   http://localhost:2080       (HTTP fallback)"
  echo ""
  echo "📋 Logs:"
  echo "   tail -f $CADDY_LOG"
  echo ""
  echo "📋 Parar:"
  echo "   ./scripts/stop-caddy.sh"
else
  echo -e "${RED}❌ Caddy falhou ao iniciar. Logs:${NC}"
  tail -20 "$CADDY_LOG"
  exit 1
fi
