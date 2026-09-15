#!/usr/bin/env bash
# =============================================================================
# setup-github-runner.sh — Instala GitHub Actions Self-Hosted Runner
# =============================================================================
# Uso:
#   bash deploy/setup-github-runner.sh
#
# Pré-requisitos:
#   1. GitHub Personal Access Token (PAT) com permissões: repo, admin:repo_hook, workflow
#   2. Docker instalado no VPS
#   3. Rodar como root ou com sudo
#
# O script:
#   1. Cria usuário não-root 'github-runner'
#   2. Baixa e configura o runner
#   3. Instala como serviço systemd
#   4. Inicia o runner
# =============================================================================

set -euo pipefail

# ── Configurações ──────────────────────────────────────────────────────────
RUNNER_USER="github-runner"
RUNNER_HOME="/home/${RUNNER_USER}/actions-runner"
RUNNER_NAME="hostinger-runner"
RUNNER_LABELS="self-hosted,linux,x64,docker"
REPO_URL="https://github.com/severinno/severinno"
RUNNER_VERSION="2.320.0"
RUNNER_ARCH="linux-x64"
RUNNER_ARCHIVE="actions-runner-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}"

# ── Cores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Verificar pré-requisitos ───────────────────────────────────────────────
echo ""
echo "==========================================="
echo "  GitHub Actions Self-Hosted Runner Setup"
echo "==========================================="
echo ""

# Verificar se está rodando como root
if [[ $EUID -ne 0 ]]; then
  err "Execute como root: sudo bash $0"
fi

# Verificar Docker
if ! command -v docker &>/dev/null; then
  err "Docker não encontrado. Instale: https://docs.docker.com/engine/install/"
fi

# Solicitar token
echo ""
read -rp "Cole seu GitHub Personal Access Token (PAT): " GITHUB_PAT
if [[ -z "$GITHUB_PAT" ]]; then
  err "Token não pode ser vazio"
fi

# ── Criar usuário ──────────────────────────────────────────────────────────
if ! id "$RUNNER_USER" &>/dev/null; then
  log "Criando usuário ${RUNNER_USER}..."
  useradd -m -s /bin/bash "$RUNNER_USER"
  usermod -aG docker "$RUNNER_USER"
  log "Usuário criado e adicionado ao grupo docker"
else
  warn "Usuário ${RUNNER_USER} já existe"
  usermod -aG docker "$RUNNER_USER" 2>/dev/null || true
fi

# ── Criar diretório ────────────────────────────────────────────────────────
log "Criando diretório do runner..."
mkdir -p "$RUNNER_HOME"
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_HOME"

# ── Baixar runner ──────────────────────────────────────────────────────────
log "Baixando GitHub Actions Runner v${RUNNER_VERSION}..."
sudo -u "$RUNNER_USER" curl -L -o "${RUNNER_HOME}/${RUNNER_ARCHIVE}" "$RUNNER_URL"

# ── Extrair ────────────────────────────────────────────────────────────────
log "Extraindo archive..."
sudo -u "$RUNNER_USER" tar xzf "${RUNNER_HOME}/${RUNNER_ARCHIVE}" -C "$RUNNER_HOME"
rm -f "${RUNNER_HOME}/${RUNNER_ARCHIVE}"

# ── Configurar runner ──────────────────────────────────────────────────────
log "Configurando runner..."
echo ""
echo "==========================================="
echo "  Configuração do Runner"
echo "==========================================="
echo ""
echo "URL do repositório: ${REPO_URL}"
echo "Nome do runner: ${RUNNER_NAME}"
echo "Labels: ${RUNNER_LABELS}"
echo ""

sudo -u "$RUNNER_USER" "${RUNNER_HOME}/config.sh" \
  --url "$REPO_URL" \
  --token "$GITHUB_PAT" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work "_work" \
  --replace \
  --unattended

# ── Instalar como serviço systemd ──────────────────────────────────────────
log "Instalando como serviço systemd..."
"${RUNNER_HOME}/svc.sh" install "$RUNNER_USER"

# ── Iniciar serviço ────────────────────────────────────────────────────────
log "Iniciando serviço..."
"${RUNNER_HOME}/svc.sh" start

# ── Verificar status ───────────────────────────────────────────────────────
sleep 2
if systemctl is-active --quiet "actions.runner.*.service" 2>/dev/null ||    grep -q "actions.runner" <<< "$(systemctl list-units --type=service)"; then
  log "Runner instalado e rodando!"
else
  warn "Serviço pode não estar rodando. Verifique: systemctl status actions.runner.*"
fi

# ── Resumo ─────────────────────────────────────────────────────────────────
echo ""
echo "==========================================="
echo "  ✅ Instalação Concluída!"
echo "==========================================="
echo ""
echo "Runner: ${RUNNER_NAME}"
echo "Labels: ${RUNNER_LABELS}"
echo "Repositório: ${REPO_URL}"
echo ""
echo "Para verificar no GitHub:"
echo "  https://github.com/severinno/severinno/settings/actions/runners"
echo ""
echo "Comandos úteis:"
echo "  sudo systemctl status actions.runner.*   # Ver status"
echo "  sudo systemctl restart actions.runner.*  # Reiniciar"
echo "  sudo journalctl -u actions.runner.* -f   # Ver logs"
echo ""
