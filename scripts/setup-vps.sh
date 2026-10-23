#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# setup-vps.sh — Severinno Marketplace VPS Setup
# ═══════════════════════════════════════════════════════════════════════════
# Configuração completa de um VPS Ubuntu 24.04 para rodar o Severinno.
#
# Uso:
#   chmod +x scripts/setup-vps.sh
#   sudo bash scripts/setup-vps.sh                  # Setup completo
#   sudo bash scripts/setup-vps.sh --skip-docker    # Pular instalação Docker
#   sudo bash scripts/setup-vps.sh --skip-secrets   # Pular geração de secrets
#   sudo bash scripts/setup-vps.sh --dry-run        # Simular
#   sudo bash scripts/setup-vps.sh --help           # Ajuda
#
# Pré-requisitos:
#   - Ubuntu 24.04 LTS (fresh install)
#   - Acesso root via SSH
#   - Chave SSH pública já adicionada no GitHub
#     (https://github.com/settings/ssh/new)
#
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

SKIP_DOCKER=false
SKIP_SECRETS=false
DRY_RUN=false
RELEASE_BRANCH="${RELEASE_BRANCH:-release/v0.4.0}"
GIT_REPO="${GIT_REPO:-git@github.com:severinno/severinno.git}"

# ── Cores ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}  ℹ${NC} $1"; }
ok()    { echo -e "${GREEN}  ✔${NC} $1"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $1"; }
err()   { echo -e "${RED}  ✘${NC} $1"; }
step()  { echo ""; echo -e "${BLUE}${BOLD}◆ $1${NC}"; echo "  ${BLUE}──────────────────────────────${NC}"; }
dry()   { echo -e "${YELLOW}  [DRY-RUN]${NC} $1"; }

# ── Help ──────────────────────────────────────────────────────────────────
show_help() {
    cat <<'HELP'

  ╔══════════════════════════════════════════════════════╗
  ║   Severinno VPS Setup v1.0                            ║
  ╚══════════════════════════════════════════════════════╝

  Uso: sudo bash scripts/setup-vps.sh [opções]

  Opções:
    --skip-docker    Pular instalação do Docker
    --skip-secrets   Pular geração de secrets
    --dry-run        Simular (mostra comandos sem executar)
    --help           Esta ajuda

  Variáveis:
    RELEASE_BRANCH   Branch do release (default: release/v0.4.0)
    GIT_REPO         URL do repositório (default: git@github.com:severinno/...)

HELP
    exit 0
}

# ── Argument parsing ──────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --skip-docker)  SKIP_DOCKER=true; shift ;;
        --skip-secrets) SKIP_SECRETS=true; shift ;;
        --dry-run)      DRY_RUN=true; shift ;;
        --help|-h)      show_help ;;
    esac
done

run() {
    if [ "$DRY_RUN" = true ]; then dry "$*"; else eval "$*"; fi
}

# ============================================================================
#  1. SYSTEM UPDATE
# ============================================================================
setup_system() {
    step "1/8 — Atualizando sistema"

    info "Atualizando pacotes..."
    run apt update -y
    run apt upgrade -y

    info "Instalando dependências..."
    run apt install -y curl wget git ufw fail2ban \
        postgresql-client jq logrotate unattended-upgrades

    ok "Sistema atualizado"
}

# ============================================================================
#  2. DOCKER
# ============================================================================
setup_docker() {
    step "2/8 — Instalando Docker + Compose"

    if [ "$SKIP_DOCKER" = true ]; then
        warn "Docker pulado (--skip-docker)"
        return 0
    fi

    if command -v docker &>/dev/null; then
        ok "Docker já instalado: $(docker --version)"
    else
        info "Instalando Docker via script oficial..."
        run curl -fsSL https://get.docker.com | sh
        ok "Docker instalado: $(docker --version)"
    fi

    run systemctl enable docker
    run systemctl start docker

    ok "Docker habilitado no boot"
}

# ============================================================================
#  3. FIREWALL (UFW)
# ============================================================================
setup_firewall() {
    step "3/8 — Configurando firewall (UFW)"

    info "Configurando regras..."
    run ufw default deny incoming
    run ufw default allow outgoing
    run ufw allow 22/tcp      comment 'SSH'
    run ufw allow 80/tcp      comment 'HTTP (Caddy)'
    run ufw allow 443/tcp     comment 'HTTPS (Caddy)'

    info "Ativando firewall..."
    run ufw --force enable

    ok "Firewall ativo — portas 22, 80, 443 liberadas"
}

# ============================================================================
#  4. FAIL2BAN
# ============================================================================
setup_fail2ban() {
    step "4/8 — Configurando fail2ban"

    info "Copiando configurações..."
    run mkdir -p /etc/fail2ban/filter.d

    if [ -f "$PROJECT_DIR/config/fail2ban/jail.local" ]; then
        run cp "$PROJECT_DIR/config/fail2ban/jail.local" /etc/fail2ban/
        ok "jail.local copiado"
    else
        warn "config/fail2ban/jail.local não encontrado"
    fi

    if [ -d "$PROJECT_DIR/config/fail2ban/filter.d" ]; then
        run cp "$PROJECT_DIR/config/fail2ban/filter.d/"*.conf /etc/fail2ban/filter.d/ 2>/dev/null || true
        ok "Filters copiados"
    fi

    run systemctl enable fail2ban
    run systemctl restart fail2ban

    ok "fail2ban ativo com jails: sshd, caddy-access, caddy-badbots, caddy-404-scan, recidive"
}

# ============================================================================
#  5. LOGROTATE
# ============================================================================
setup_logrotate() {
    step "5/8 — Configurando logrotate para Caddy"

    if [ -f "$PROJECT_DIR/config/logrotate/caddy" ]; then
        run cp "$PROJECT_DIR/config/logrotate/caddy" /etc/logrotate.d/caddy
        ok "logrotate/caddy instalado"
        info "Testando: logrotate -d /etc/logrotate.d/caddy"
        run logrotate -d /etc/logrotate.d/caddy 2>&1 | tail -3
    else
        warn "config/logrotate/caddy não encontrado — pulando"
    fi
}

# ============================================================================
#  6. GIT CLONE
# ============================================================================
setup_git() {
    step "6/8 — Clonando repositório"

    if [ -d "$PROJECT_DIR/.git" ]; then
        ok "Repositório já clonado em $PROJECT_DIR"
        info "Atualizando para $RELEASE_BRANCH..."
        run cd "$PROJECT_DIR"
        run git fetch --tags --force
        run git checkout "$RELEASE_BRANCH" --force
        run git pull origin "$RELEASE_BRANCH" --force
    else
        info "Clonando $GIT_REPO..."
        run git clone "$GIT_REPO" "$PROJECT_DIR"
        run cd "$PROJECT_DIR"
        run git checkout "$RELEASE_BRANCH"
    fi

    ok "Repositório pronto: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown') em $RELEASE_BRANCH"
}

# ============================================================================
#  7. SECRETS + .ENV
# ============================================================================
setup_secrets() {
    step "7/8 — Gerando secrets e .env"

    if [ "$SKIP_SECRETS" = true ]; then
        warn "Secrets pulados (--skip-secrets)"
        return 0
    fi

    local secrets_dir="$PROJECT_DIR/secrets"

    if [ ! -d "$secrets_dir" ]; then
        warn "Diretório secrets/ não encontrado"
        return 1
    fi

    # Copiar templates
    info "Copiando templates .example → .secret..."
    for f in "$secrets_dir"/*.example; do
        local target="${f%.example}"
        if [ ! -f "$target" ]; then
            run cp "$f" "$target"
            info "  Criado: $(basename "$target")"
        else
            info "  Já existe: $(basename "$target")"
        fi
    done

    # Gerar senhas aleatórias (só se o arquivo estiver vazio ou for template)
    info "Gerando senhas aleatórias..."
    local generated=0
    for secret in postgres_password session_secret rabbitmq_pass \
        cron_secret glitchtip_db_password glitchtip_s3_secret_key \
        admin_password; do
        local file="$secrets_dir/$secret.secret"
        if [ -f "$file" ] && [ ! -s "$file" ] || grep -q "MUDE_AQUI\|CHANGE_ME\|example" "$file" 2>/dev/null; then
            run openssl rand -base64 32 > "$file"
            ok "  $secret.secret → gerado"
            generated=$((generated + 1))
        fi
    done

    # Secrets manuais (precisam de input externo)
    for manual in admin_email s3_secret_key vapid_private_key smtp_pass \
        lytex_client_secret glitchtip_secret_key evolution_api_key; do
        local file="$secrets_dir/$manual.secret"
        if [ -f "$file" ] && [ ! -s "$file" ] || grep -q "MUDE_AQUI\|CHANGE_ME\|example" "$file" 2>/dev/null; then
            warn "  ⚠️  $manual.secret precisa ser preenchido manualmente!"
            info "     Edite: nano $file"
        fi
    done

    if [ "$generated" -gt 0 ]; then
        ok "$generated secrets gerados automaticamente"
    else
        info "Todos os secrets já existem"
    fi

    # Copiar .env.production → .env.production.local
    if [ -f "$PROJECT_DIR/.env.production" ] && [ ! -f "$PROJECT_DIR/.env.production.local" ]; then
        run cp "$PROJECT_DIR/.env.production" "$PROJECT_DIR/.env.production.local"
        warn ".env.production.local criado — PREENCHA AS VARIÁVEIS!"
        info "  Edite: nano $PROJECT_DIR/.env.production.local"
    else
        info ".env.production.local já existe"
    fi
}

# ============================================================================
#  8. DIRETÓRIOS + VALIDAÇÃO
# ============================================================================
setup_dirs() {
    step "8/8 — Criando diretórios e validando"

    # Diretórios
    run mkdir -p /var/log/caddy
    run mkdir -p /var/backups/severinno/postgres

    ok "Diretórios de log e backup criados"

    # Validar setup
    info "Verificando instalação..."
    local fail=0

    command -v docker &>/dev/null && ok "Docker OK" || { err "Docker NOK"; fail=1; }
    command -v docker compose &>/dev/null && ok "Docker Compose OK" || { err "Docker Compose NOK"; fail=1; }
    command -v git &>/dev/null && ok "Git OK" || { err "Git NOK"; fail=1; }
    command -v curl &>/dev/null && ok "Curl OK" || { err "Curl NOK"; fail=1; }
    command -v jq &>/dev/null && ok "jq OK" || { err "jq NOK"; fail=1; }
    command -v pg_dump &>/dev/null && ok "pg_dump OK" || warn "pg_dump não encontrado (apt install postgresql-client)"
    command -v fail2ban-client &>/dev/null && ok "fail2ban OK" || warn "fail2ban não encontrado"

    grep -q "active" <<< "$(ufw status)" && ok "UFW ativo" || warn "UFW não está ativo"

    if [ -f "$PROJECT_DIR/docker-compose.prod.yml" ]; then
        ok "docker-compose.prod.yml encontrado"
    else
        err "docker-compose.prod.yml não encontrado!"
        fail=1
    fi

    return $fail
}

# ============================================================================
#  MAIN
# ============================================================================
main() {
    echo ""
    echo "  ╔══════════════════════════════════════════════════════════════╗"
    echo "  ║   🖥️  Severinno VPS Setup v1.0                              ║"
    echo "  ╚══════════════════════════════════════════════════════════════╝"
    echo ""

    if [ "$DRY_RUN" = true ]; then
        warn "Modo DRY-RUN — nenhuma alteração será feita!"
        echo ""
    fi

    if [ "$(id -u)" -ne 0 ]; then
        err "Execute como root: sudo bash scripts/setup-vps.sh"
        exit 1
    fi

    local total_start
    total_start=$(date +%s)

    setup_system
    setup_docker
    setup_firewall
    setup_fail2ban
    setup_logrotate
    setup_git
    setup_secrets
    setup_dirs

    local total_end
    total_end=$(date +%s)
    local elapsed=$((total_end - total_start))
    local minutes=$((elapsed / 60))

    echo ""
    echo "  ╔══════════════════════════════════════════════════════════════╗"
    echo "  ║   ${GREEN}✅ VPS SETUP CONCLUÍDO!${NC}                              ║"
    echo "  ╚══════════════════════════════════════════════════════════════╝"
    echo ""
    info "Duração: ${minutes} minuto(s)"
    info "Branch:  $RELEASE_BRANCH"
    info "Commit:  $(cd "$PROJECT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo 'N/A')"
    echo ""
    info "📋 PRÓXIMOS PASSOS:"
    echo ""
    echo "  1. Preencher secrets manuais:"
    echo "     nano $PROJECT_DIR/secrets/admin_email.secret   # e-mail REAL do admin (login)"
    echo "     nano $PROJECT_DIR/secrets/s3_secret_key.secret"
    echo "     nano $PROJECT_DIR/secrets/vapid_private_key.secret"
    echo "     nano $PROJECT_DIR/secrets/smtp_pass.secret"
    echo "     nano $PROJECT_DIR/secrets/lytex_client_secret.secret"
    echo "     nano $PROJECT_DIR/secrets/glitchtip_secret_key.secret"
    echo ""
    echo "  2. Preencher .env.production.local:"
    echo "     nano $PROJECT_DIR/.env.production.local"
    echo ""
    echo "  3. Gerar VAPID keys (se precisar):"
    echo "     npx web-push generate-vapid-keys"
    echo ""
    echo "  4. Configurar DNS:"
    echo "     severinno.com.br → A → $(curl -s ifconfig.me 2>/dev/null || echo '<IP_DO_VPS>')"
    echo ""
    echo "  5. Rodar deploy:"
    echo "     cd $PROJECT_DIR && bash scripts/deploy.sh"
    echo ""
}

main "$@"
