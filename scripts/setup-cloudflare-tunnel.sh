#!/bin/bash
# ---------------------------------------------------------------------------
# setup-cloudflare-tunnel.sh
# Configura Named Tunnel do Cloudflare pro Severinno
#
# Pré-requisitos:
#   1. Conta Cloudflare criada com severinno.com adicionado
#   2. Nameservers do domínio apontando pro Cloudflare
#   3. cloudflared instalado em ~/cloudflared
#
# Usage:
#   bash scripts/setup-cloudflare-tunnel.sh [args]
#
# Exit codes:
#   0 — success
#   1 — failure
# ---------------------------------------------------------------------------

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

CADDY_BIN="$HOME/cloudflared"
TUNNEL_NAME="severinno"
DOMAIN="severinno.com"

echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Severinno — Cloudflare Named Tunnel Setup  ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Step 1: Authenticate
echo -e "${YELLOW}Passo 1/4: Autenticando com Cloudflare...${NC}"
echo "Um navegador vai abrir. Faça login na sua conta Cloudflare."
echo "Selecione o domínio severinno.com quando solicitado."
echo ""
read -p "Pressione Enter pra continuar..."
"$CADDY_BIN" tunnel login

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo -e "${RED}❌ Autenticação falhou. Execute o script novamente.${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Autenticado com sucesso!${NC}"
echo ""

# Step 2: Create tunnel
echo -e "${YELLOW}Passo 2/4: Criando tunnel '${TUNNEL_NAME}'...${NC}"
"$CADDY_BIN" tunnel create "$TUNNEL_NAME" 2>&1 || true
TUNNEL_ID=$("$CADDY_BIN" tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}' | head -1)

if [ -z "$TUNNEL_ID" ]; then
  echo -e "${RED}❌ Não foi possível criar/encontrar o tunnel.${NC}"
  echo "Tunnels disponíveis:"
  "$CADDY_BIN" tunnel list
  exit 1
fi
echo -e "${GREEN}✅ Tunnel criado! ID: $TUNNEL_ID${NC}"
echo ""

# Step 3: Configure DNS routing
echo -e "${YELLOW}Passo 3/4: Configurando DNS routing...${NC}"
"$CADDY_BIN" tunnel route dns "$TUNNEL_ID" "$DOMAIN" 2>&1 || true
"$CADDY_BIN" tunnel route dns "$TUNNEL_ID" "www.$DOMAIN" 2>&1 || true
echo -e "${GREEN}✅ DNS configurado pra $DOMAIN → tunnel${NC}"
echo ""

# Step 4: Create config file
echo -e "${YELLOW}Passo 4/4: Criando configuração...${NC}"
CONFIG_DIR="$HOME/.cloudflared"
CONFIG_FILE="$CONFIG_DIR/config.yml"

cat > "$CONFIG_FILE" << EOF
# Severinno — Cloudflare Named Tunnel Configuration
# Gerado automaticamente por setup-cloudflare-tunnel.sh

tunnel: $TUNNEL_ID
credentials-file: $CONFIG_DIR/$TUNNEL_ID.json

ingress:
  - hostname: $DOMAIN
    service: http://localhost:3000
    originRequest:
      noTLSVerify: false
      connectTimeout: 30s
      keepAliveTimeout: 90s
  - hostname: www.$DOMAIN
    service: http://localhost:3000
  - service: http_status:404
EOF

echo -e "${GREEN}✅ Config salvo em $CONFIG_FILE${NC}"
echo ""

# Summary
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║            Setup Completo! 🎉               ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║                                              ║${NC}"
echo -e "${CYAN}║  Tunnel ID:  $TUNNEL_ID                       ║${NC}"
echo -e "${CYAN}║  Domínio:    https://$DOMAIN                 ║${NC}"
echo -e "${CYAN}║  Origin:     http://localhost:3000            ║${NC}"
echo -e "${CYAN}║                                              ║${NC}"
echo -e "${CYAN}║  Para iniciar:                               ║${NC}"
echo -e "${CYAN}║    systemctl restart severinno-tunnel         ║${NC}"
echo -e "${CYAN}║                                              ║${NC}"
echo -e "${CYAN}║  Para ver logs:                              ║${NC}"
echo -e "${CYAN}║    journalctl -u severinno-tunnel -f          ║${NC}"
echo -e "${CYAN}║                                              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
