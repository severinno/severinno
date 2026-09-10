#!/bin/bash
# =============================================================================
# setup-gitea.sh — Instalacao completa do Gitea no VPS Hostinger
# =============================================================================
# Uso: sudo bash deploy/setup-gitea.sh
#
# Este script:
# 1. Verifica/instala Docker
# 2. Copia os arquivos de configuracao
# 3. Inicia Gitea + Caddy (HTTPS) + Runner
# =============================================================================

set -euo pipefail

# ── Cores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

# ── Verificar se e root ───────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  error "Execute como root: sudo bash deploy/setup-gitea.sh"
fi

# ── Configuracoes ─────────────────────────────────────────────────────────
GITEA_DIR="/opt/gitea"
DOMAIN="git.severinno.cloud"

# ── Passo 1: Verificar Docker ─────────────────────────────────────────────
info "Verificando Docker..."
if ! command -v docker &> /dev/null; then
  warn "Docker nao encontrado. Instalando..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  log "Docker instalado"
else
  log "Docker ja instalado: $(docker --version)"
fi

# ── Passo 2: Verificar Docker Compose ─────────────────────────────────────
info "Verificando Docker Compose..."
if ! docker compose version &> /dev/null; then
  error "Docker Compose plugin nao encontrado!"
fi
log "Docker Compose: $(docker compose version)"

# ── Passo 3: Criar diretorio ──────────────────────────────────────────────
info "Criando diretorio de instalacao..."
mkdir -p "$GITEA_DIR"
cd "$GITEA_DIR"

# ── Passo 4: Copiar arquivos de configuracao ─────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

info "Copiando Caddyfile.gitea..."
cp "$REPO_DIR/deploy/Caddyfile.gitea" "$GITEA_DIR/Caddyfile"

info "Copiando docker-compose.gitea.yml..."
cp "$REPO_DIR/deploy/docker-compose.gitea.yml" "$GITEA_DIR/docker-compose.yml"

info "Copiando env.gitea.example..."
if [ ! -f "$GITEA_DIR/.env" ]; then
  cp "$REPO_DIR/deploy/env.gitea.example" "$GITEA_DIR/.env"
  log ".env criado — configure o RUNNER_TOKEN em $GITEA_DIR/.env"
else
  warn ".env ja existe — mantendo"
fi

log "Arquivos copiados para $GITEA_DIR"

# ── Passo 5: Iniciar Gitea + Caddy ────────────────────────────────────────
info "Iniciando Gitea + Caddy..."
docker compose up -d gitea caddy

# Aguardar Gitea ficar pronto
info "Aguardando Gitea inicializar..."
for i in $(seq 1 40); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
    log "Gitea pronto em https://$DOMAIN!"
    break
  fi
  # Fallback para porta 3000 (se Caddy ainda nao estiver pronto)
  HTTP_CODE_LOCAL=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
  if [ "$HTTP_CODE_LOCAL" = "200" ] || [ "$HTTP_CODE_LOCAL" = "302" ]; then
    log "Gitea pronto na porta 3000 (Caddy pode estar inicializando)..."
    break
  fi
  sleep 3
  echo -n "."
done
echo ""

# ── Passo 6: Instrucoes ──────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  GITEA INSTALADO COM SUCESSO!"
echo "============================================================"
echo ""
echo "  Proximos passos:"
echo ""
echo "  1. Configure o DNS:"
echo "     $DOMAIN → IP deste servidor"
echo ""
echo "  2. Acesse: https://$DOMAIN"
echo "     (ou http://localhost:3000 enquanto DNS nao propagar)"
echo ""
echo "  3. Crie o usuario admin (primeira vez)"
echo ""
echo "  4. Para ativar o Runner (CI/CD):"
echo "     a) Va em Site Administration → Runners → Create new Runner"
echo "     b) Copie o token de registro"
echo "     c) Execute:"
echo ""
echo "        cd $GITEA_DIR"
echo "        sed -i 's|COLE_O_TOKEN_AQUI|SEU_TOKEN|' .env"
echo "        docker compose up -d runner"
echo ""
echo "  5. Importe o repositorio:"
echo "     - New Repository → Import from GitHub"
echo "     - Cole o token do GitHub"
echo ""
echo "  6. Configure os Secrets do Gitea Actions:"
echo "     Settings → Actions → Secrets"
echo ""
echo "     DEPLOY_HOST = $(curl -s ifconfig.me 2>/dev/null || echo '<SEU_IP>')"
echo "     DEPLOY_USER = deploy"
echo "     DEPLOY_KEY  = (chave SSH em /home/deploy/.ssh/github_deploy)"
echo "     DEPLOY_PATH = /home/deploy/severinno"
echo ""
echo "============================================================"
echo ""
