#!/usr/bin/env bash
# =============================================================================
# fail2ban-setup.sh — Configura Fail2ban para proteger o servidor Severinno
# =============================================================================
# Uso:
#   chmod +x scripts/fail2ban-setup.sh
#   sudo ./scripts/fail2ban-setup.sh install     # Instala e configura
#   sudo ./scripts/fail2ban-setup.sh status      # Mostra status dos jails
#   sudo ./scripts/fail2ban-setup.sh test        # Testa filters com logs reais
#   sudo ./scripts/fail2ban-setup.sh unban <IP>  # Remove ban de um IP
#   sudo ./scripts/fail2ban-setup.sh log         # Mostra últimos bans
# =============================================================================
# Pré-requisitos:
#   - Servidor Linux (Debian/Ubuntu testado)
#   - Caddy com logs em common log format (já configurado no Caddyfile.prod)
#   - Acesso sudo
# =============================================================================

set -euo pipefail

# ── Cores para output ─────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERRO]${NC} $1"; }

# ── Caminhos ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FILTERS_SRC="$PROJECT_DIR/config/fail2ban/filter.d"
JAIL_SRC="$PROJECT_DIR/config/fail2ban/jail.local"
FILTERS_DST="/etc/fail2ban/filter.d"
JAIL_DST="/etc/fail2ban/jail.local"
CADDY_LOG_DIR="/var/log/caddy"

# ═══════════════════════════════════════════════════════════════════════════
# INSTALAÇÃO
# ═══════════════════════════════════════════════════════════════════════════

cmd_install() {
  info "Iniciando instalação/configuração do fail2ban..."

  # ── 1. Verificar root ──────────────────────────────────────────────────
  if [[ $EUID -ne 0 ]]; then
    err "Este comando precisa ser executado como root (sudo)."
    exit 1
  fi

  # ── 2. Instalar fail2ban ───────────────────────────────────────────────
  if ! command -v fail2ban-client &>/dev/null; then
    info "Instalando fail2ban..."
    if command -v apt-get &>/dev/null; then
      apt-get update -qq && apt-get install -y -qq fail2ban iptables-persistent
    elif command -v yum &>/dev/null; then
      yum install -y epel-release fail2ban iptables-services
    else
      err "Gerenciador de pacotes não suportado (apt/yum). Instale o fail2ban manualmente."
      exit 1
    fi
    ok "fail2ban instalado com sucesso."
  else
    ok "fail2ban já está instalado ($(fail2ban-client --version 2>&1 | head -1))"
  fi

  # ── 3. Parar fail2ban para configuração ────────────────────────────────
  info "Parando fail2ban para aplicar configurações..."
  systemctl stop fail2ban 2>/dev/null || true

  # ── 4. Copiar filters personalizados ───────────────────────────────────
  if [[ -d "$FILTERS_SRC" ]]; then
    info "Copiando filters personalizados..."
    mkdir -p "$FILTERS_DST"
    for filter in "$FILTERS_SRC"/*.conf; do
      if [[ -f "$filter" ]]; then
        cp "$filter" "$FILTERS_DST/"
        ok "  Filter: $(basename "$filter") copiado"
      fi
    done
  else
    warn "Diretório de filters não encontrado: $FILTERS_SRC"
  fi

  # ── 5. Copiar jail.local ───────────────────────────────────────────────
  if [[ -f "$JAIL_SRC" ]]; then
    info "Copiando jail.local..."
    cp "$JAIL_SRC" "$JAIL_DST"
    chmod 644 "$JAIL_DST"
    ok "jail.local copiado para $JAIL_DST"
  else
    warn "jail.local não encontrado em $JAIL_SRC"
  fi

  # ── 6. Garantir que o log do Caddy existe ──────────────────────────────
  if [[ ! -d "$CADDY_LOG_DIR" ]]; then
    warn "Diretório $CADDY_LOG_DIR não existe. Criando..."
    mkdir -p "$CADDY_LOG_DIR"
  fi

  # ── 7. Configurar logrotate para logs do Caddy ─────────────────────────
  local logrotate_conf="/etc/logrotate.d/caddy"
  if [[ ! -f "$logrotate_conf" ]]; then
    info "Configurando logrotate para os logs do Caddy..."
    cat > "$logrotate_conf" << 'LOGROTATE'
/var/log/caddy/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
    dateext
    dateformat -%Y%m%d
    sharedscripts
    postrotate
        systemctl restart fail2ban > /dev/null 2>&1 || true
    endscript
}
LOGROTATE
    ok "logrotate configurado para /var/log/caddy/*.log"
  else
    ok "logrotate já configurado"
  fi

  # ── 8. Habilitar e iniciar fail2ban ────────────────────────────────────
  info "Iniciando fail2ban..."
  systemctl enable fail2ban
  systemctl start fail2ban

  # ── 9. Verificar status ────────────────────────────────────────────────
  sleep 2
  if systemctl is-active --quiet fail2ban; then
    ok "fail2ban está ATIVO e RODANDO!"
  else
    err "fail2ban não iniciou. Verifique: journalctl -u fail2ban --no-pager -n 50"
    exit 1
  fi

  # ── 10. Mostrar resumo ─────────────────────────────────────────────────
  echo ""
  info "═══════════════════════════════════════════════════════"
  info "  RESUMO DA INSTALAÇÃO"
  info "═══════════════════════════════════════════════════════"
  echo ""
  fail2ban-client status 2>/dev/null | grep -E "^( |-)" || true
  echo ""
  info "Jails ativos:"
  fail2ban-client status 2>/dev/null | grep "Jail list" || true
  echo ""
  ok "Instalação concluída com sucesso!"
  echo ""
  info "Comandos úteis:"
  info "  sudo fail2ban-client status sshd              # Status SSH"
  info "  sudo fail2ban-client status caddy-access      # Status Caddy Auth"
  info "  sudo fail2ban-client status caddy-badbots     # Status Bad Bots"
  info "  sudo fail2ban-client status caddy-404-scan    # Status 404 Scan"
  info "  sudo fail2ban-client set sshd unbanip <IP>    # Desbanir IP"
  info "  sudo fail2ban-regex /var/log/caddy/severinno-access.log \\"
  info "                     /etc/fail2ban/filter.d/caddy-access.conf  # Testar regex"
}

# ═══════════════════════════════════════════════════════════════════════════
# STATUS
# ═══════════════════════════════════════════════════════════════════════════

cmd_status() {
  echo -e "${BLUE}═══ fail2ban — Status Geral ═══${NC}"
  echo ""
  fail2ban-client status 2>/dev/null || echo "fail2ban não está rodando."

  echo ""
  echo -e "${BLUE}═══ SSH Jail ═══${NC}"
  fail2ban-client status sshd 2>/dev/null || echo "Jail sshd não encontrado."

  echo ""
  echo -e "${BLUE}═══ Caddy Access Jail ═══${NC}"
  fail2ban-client status caddy-access 2>/dev/null || echo "Jail caddy-access não encontrado."

  echo ""
  echo -e "${BLUE}═══ Caddy Bad Bots Jail ═══${NC}"
  fail2ban-client status caddy-badbots 2>/dev/null || echo "Jail caddy-badbots não encontrado."

  echo ""
  echo -e "${BLUE}═══ Caddy 404 Scan Jail ═══${NC}"
  fail2ban-client status caddy-404-scan 2>/dev/null || echo "Jail caddy-404-scan não encontrado."
}

# ═══════════════════════════════════════════════════════════════════════════
# TESTE — Validar filters com logs reais
# ═══════════════════════════════════════════════════════════════════════════

cmd_test() {
  echo -e "${BLUE}═══ Testando Filters com Logs Reais ═══${NC}"
  echo ""

  for filter in caddy-access caddy-badbots caddy-404-scan; do
    filter_path="/etc/fail2ban/filter.d/${filter}.conf"
    log_path="/var/log/caddy/severinno-access.log"

    if [[ ! -f "$filter_path" ]]; then
      warn "Filter $filter.conf não encontrado em $filter_path"
      continue
    fi

    if [[ ! -f "$log_path" ]]; then
      warn "Log $log_path não encontrado — pulando teste de $filter"
      echo ""
      info "Para testar com logs simulados, use:"
      info "  echo '192.168.1.1 - - [27/Jul/2026:12:00:00 +0000] \"POST /api/auth/login HTTP/1.1\" 401 1234' \\"
      info "    | sudo fail2ban-regex /dev/stdin /etc/fail2ban/filter.d/${filter}.conf"
      echo ""
      continue
    fi

    echo -e "${BLUE}── Filter: ${filter} ──${NC}"
    fail2ban-regex "$log_path" "$filter_path" 2>&1 | grep -E "(Success|Fail|Total|Lines|Matches)"
    echo ""
  done
}

# ═══════════════════════════════════════════════════════════════════════════
# UNBAN — Remover banimento manual
# ═══════════════════════════════════════════════════════════════════════════

cmd_unban() {
  local ip="$1"
  if [[ -z "$ip" ]]; then
    err "Uso: $0 unban <IP>"
    exit 1
  fi

  echo -e "${BLUE}Removendo ban do IP $ip em todos os jails...${NC}"

  for jail in sshd caddy-access caddy-badbots caddy-404-scan; do
    if fail2ban-client set "$jail" unbanip "$ip" 2>/dev/null; then
      ok "  IP $ip removido do jail $jail"
    else
      warn "  IP $ip não estava banido no jail $jail (ou jail inativo)"
    fi
  done
}

# ═══════════════════════════════════════════════════════════════════════════
# LOG — Mostrar histórico de bans
# ═══════════════════════════════════════════════════════════════════════════

cmd_log() {
  local lines="${1:-50}"

  echo -e "${BLUE}═══ Últimos $lines bans registrados ═══${NC}"
  echo ""

  if [[ -f "/var/log/fail2ban.log" ]]; then
    grep -E "(Ban|Unban)" /var/log/fail2ban.log | tail -n "$lines"
  else
    warn "Arquivo /var/log/fail2ban.log não encontrado."
    info "Verifique: journalctl -u fail2ban --no-pager -n 50"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

show_help() {
  echo "Uso: $0 <comando> [args]"
  echo ""
  echo "Comandos:"
  echo "  install            Instala/configura fail2ban (requer sudo)"
  echo "  status             Mostra status de todos os jails"
  echo "  test               Testa filters com logs existentes"
  echo "  unban <IP>         Remove ban de um IP em todos os jails"
  echo "  log [linhas]       Mostra histórico de bans (padrão: 50)"
  echo "  help               Mostra esta ajuda"
  echo ""
  echo "Exemplos:"
  echo "  sudo $0 install"
  echo "  $0 status"
  echo "  sudo $0 unban 192.168.1.100"
  echo "  $0 log 100"
}

case "${1:-help}" in
  install)
    cmd_install
    ;;
  status)
    cmd_status
    ;;
  test)
    cmd_test
    ;;
  unban)
    cmd_unban "${2:-}"
    ;;
  log)
    cmd_log "${2:-50}"
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    err "Comando desconhecido: $1"
    echo ""
    show_help
    exit 1
    ;;
esac
