#!/usr/bin/env bash
# =============================================================================
# setup-woodpecker.sh — Instala Woodpecker CI no VPS
# =============================================================================
# Uso:
#   bash deploy/setup-woodpecker.sh
#
# Pré-requisitos:
#   1. Docker instalado no VPS
#   2. OAuth App criado no GitHub
#   3. Arquivo .env.woodpecker configurado
# =============================================================================

set -euo pipefail

# ── Cores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "==========================================="
echo "  Woodpecker CI Setup"
echo "==========================================="
echo ""

# ── Verificar pré-requisitos ───────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  err "Docker não encontrado. Instale: https://docs.docker.com/engine/install/"
fi

# ── Criar diretório ────────────────────────────────────────────────────────
WOODPECKER_DIR="/opt/woodpecker"
mkdir -p "$WOODPECKER_DIR"
log "Diretório criado: $WOODPECKER_DIR"

# ── Gerar secrets ──────────────────────────────────────────────────────────
AGENT_SECRET=$(openssl rand -hex 32)
log "Agent secret gerado"

# ── Criar docker-compose ───────────────────────────────────────────────────
cat > "$WOODPECKER_DIR/docker-compose.yml" << 'EOF'
services:
  woodpecker-server:
    image: woodpeckerci/woodpecker-server:v3
    container_name: woodpecker-server
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - woodpecker-server-data:/var/lib/woodpecker/
    environment:
      - WOODPECKER_OPEN=true
      - WOODPECKER_HOST=${WOODPECKER_HOST}
      - WOODPECKER_GITHUB=true
      - WOODPECKER_GITHUB_CLIENT=${WOODPECKER_GITHUB_CLIENT}
      - WOODPECKER_GITHUB_SECRET=${WOODPECKER_GITHUB_SECRET}
      - WOODPECKER_AGENT_SECRET=${WOODPECKER_AGENT_SECRET}
      - WOODPECKER_ADMIN=severinno
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8000/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3

  woodpecker-agent:
    image: woodpeckerci/woodpecker-agent:v3
    container_name: woodpecker-agent
    restart: unless-stopped
    depends_on:
      woodpecker-server:
        condition: service_healthy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WOODPECKER_SERVER=woodpecker-server:9000
      - WOODPECKER_AGENT_SECRET=${WOODPECKER_AGENT_SECRET}
      - WOODPECKER_MAX_WORKFLOWS=2

volumes:
  woodpecker-server-data:
    name: woodpecker-server-data
EOF

# ── Criar .env ─────────────────────────────────────────────────────────────
cat > "$WOODPECKER_DIR/.env" << EOF
WOODPECKER_HOST=http://severinno.cloud:8000
WOODPECKER_GITHUB_CLIENT=YOUR_CLIENT_ID
WOODPECKER_GITHUB_SECRET=YOUR_CLIENT_SECRET
WOODPECKER_AGENT_SECRET=$AGENT_SECRET
EOF

log "Arquivos criados em $WOODPECKER_DIR"
echo ""

# ── Instruções ─────────────────────────────────────────────────────────────
echo "==========================================="
echo "  Próximos Passos"
echo "==========================================="
echo ""
echo "1. Crie um OAuth App no GitHub:"
echo "   https://github.com/settings/developers"
echo ""
echo "2. Configure o .env:"
echo "   nano $WOODPECKER_DIR/.env"
echo ""
echo "3. Inicie o Woodpecker:"
echo "   cd $WOODPECKER_DIR && docker compose up -d"
echo ""
echo "4. Acesse:"
echo "   http://severinno.cloud:8000"
echo ""
echo "5. Faça login com sua conta GitHub"
echo ""
echo "6. Ative o repositório severinno/severinno"
echo ""
echo "==========================================="
