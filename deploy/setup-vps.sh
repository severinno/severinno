#!/usr/bin/env bash
# =============================================================================
# setup-vps.sh — Severinno VPS Initial Setup (Hostinger Ubuntu 22/24)
#
# Usage:
#   scp deploy/setup-vps.sh root@<VPS_IP>:/root/
#   ssh root@<VPS_IP> bash /root/setup-vps.sh
#
# Exit codes:
#   0 — success
#   1 — failure
#
# What this script does:
#   1. Updates system packages
#   2. Installs Docker + Docker Compose plugin
#   3. Creates a 'deploy' user with Docker access
#   4. Generates an SSH keypair for GitHub Actions
#   5. Clones the repository
#   6. Configures firewall (UFW)
#   7. Generates production secrets
#   8. Prints the SSH private key for GitHub Secrets
# =============================================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1" >&2; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

# ── Check root ──────────────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  err "Este script deve ser executado como root."
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║            Severinno — VPS Setup (Hostinger Ubuntu)                ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""

# ── Config ──────────────────────────────────────────────────────────────────
DEPLOY_USER="deploy"
DEPLOY_HOME="/home/$DEPLOY_USER"
PROJECT_DIR="$DEPLOY_HOME/severinno"
GITHUB_REPO="https://github.com/severinno/severinno.git"

# ── Phase 1: System Update ──────────────────────────────────────────────────
info "Fase 1/7: Atualizando sistema..."
apt update -qq
apt upgrade -y -qq
apt install -y -qq ca-certificates curl gnupg lsb-release git ufw fail2ban
log "Sistema atualizado."

# ── Phase 2: Install Docker ─────────────────────────────────────────────────
info "Fase 2/7: Instalando Docker..."
if command -v docker &>/dev/null; then
  warn "Docker já instalado: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
  log "Docker instalado: $(docker --version)"
fi

systemctl enable docker
systemctl start docker

if docker compose version &>/dev/null; then
  log "Docker Compose: $(docker compose version)"
else
  err "Docker Compose plugin não encontrado!"
  exit 1
fi

# ── Phase 3: Create deploy user ─────────────────────────────────────────────
info "Fase 3/7: Criando usuário '$DEPLOY_USER'..."
if id "$DEPLOY_USER" &>/dev/null; then
  warn "Usuário '$DEPLOY_USER' já existe."
else
  adduser --disabled-password --gecos "Severinno Deploy" "$DEPLOY_USER"
  log "Usuário '$DEPLOY_USER' criado."
fi

usermod -aG docker "$DEPLOY_USER"
log "Usuário '$DEPLOY_USER' adicionado ao grupo docker."

# ── Phase 4: SSH Key for GitHub Actions ──────────────────────────────────────
info "Fase 4/7: Gerando chave SSH para GitHub Actions..."
DEPLOY_SSH_DIR="$DEPLOY_HOME/.ssh"
DEPLOY_KEY="$DEPLOY_SSH_DIR/github_deploy"

mkdir -p "$DEPLOY_SSH_DIR"

if [ -f "$DEPLOY_KEY" ]; then
  warn "Chave SSH já existe: $DEPLOY_KEY"
else
  ssh-keygen -t ed25519 -C "github-actions-deploy@severinno" -f "$DEPLOY_KEY" -N ""
  log "Chave SSH gerada."
fi

# Add to authorized_keys
if ! grep -qf "$DEPLOY_KEY.pub" "$DEPLOY_SSH_DIR/authorized_keys" 2>/dev/null; then
  cat "$DEPLOY_KEY.pub" >> "$DEPLOY_SSH_DIR/authorized_keys"
  log "Chave pública adicionada ao authorized_keys."
fi

chmod 700 "$DEPLOY_SSH_DIR"
chmod 600 "$DEPLOY_SSH_DIR/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_SSH_DIR"

# ── Phase 5: Clone repository ───────────────────────────────────────────────
info "Fase 5/7: Preparando diretório do projeto..."
mkdir -p "$PROJECT_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$PROJECT_DIR"

if [ -d "$PROJECT_DIR/.git" ]; then
  warn "Repositório já clonado em $PROJECT_DIR"
else
  su - "$DEPLOY_USER" -c "git clone $GITHUB_REPO $PROJECT_DIR"
  log "Repositório clonado."
fi

# ── Phase 6: Firewall (UFW) ─────────────────────────────────────────────────
info "Fase 6/7: Configurando firewall..."
ufw allow OpenSSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS

# Enable UFW if not already
if ! ufw status | grep -q "Status: active"; then
  echo "y" | ufw enable
fi

log "Firewall configurado (SSH + HTTP + HTTPS)."
ufw status

# ── Phase 7: Generate secrets ───────────────────────────────────────────────
info "Fase 7/7: Gerando secrets de produção..."
SECRETS_DIR="$PROJECT_DIR/secrets"
mkdir -p "$SECRETS_DIR"

generate_secret() {
  local file="$1"
  if [ -f "$SECRETS_DIR/$file" ]; then
    warn "Secret '$file' já existe — pulando."
  else
    openssl rand -base64 32 > "$SECRETS_DIR/$file"
    log "Gerado: $file"
  fi
}

generate_secret "postgres_password.secret"
generate_secret "rabbitmq_password.secret"
generate_secret "minio_secret_key.secret"
openssl rand -base64 48 > "$SECRETS_DIR/session_secret.secret" 2>/dev/null || true

chmod 600 "$SECRETS_DIR"/*.secret
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$SECRETS_DIR"
log "Secrets gerados em $SECRETS_DIR/"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║                    ✅ SETUP CONCLUÍDO!                             ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "📋 Próximos passos:"
echo ""
echo "  1. Copie a CHAVE PRIVADA abaixo e adicione como secret"
echo "     no GitHub (Settings → Secrets → DEPLOY_KEY):"
echo ""
echo "─────────────── INÍCIO DA CHAVE (DEPLOY_KEY) ───────────────"
cat "$DEPLOY_KEY"
echo ""
echo "─────────────── FIM DA CHAVE ────────────────────────────────"
echo ""
echo "  2. Adicione os seguintes GitHub Secrets:"
echo ""
echo "     DEPLOY_HOST = $(curl -s ifconfig.me 2>/dev/null || echo '<SEU_IP>')"
echo "     DEPLOY_USER = $DEPLOY_USER"
echo "     DEPLOY_KEY  = (chave acima)"
echo "     DEPLOY_PATH = $PROJECT_DIR"
echo ""
echo "  3. Configure o .env.production:"
echo "     su - $DEPLOY_USER"
echo "     cd $PROJECT_DIR"
echo "     cp .env.example .env.production"
echo "     nano .env.production"
echo ""
echo "  4. Primeiro deploy manual:"
echo "     docker compose -f docker-compose.prod.yml \\"
echo "       --env-file .env.production up -d --build"
echo ""
echo "  5. Configure o DNS do domínio apontando para: $(curl -s ifconfig.me 2>/dev/null || echo '<SEU_IP>')"
echo ""
