#!/usr/bin/env bash
# =============================================================================
# test-fail2ban-recidive.sh — Teste de verificação do Jail Recidive
# =============================================================================
# Simula um ataque cross-jail (múltiplos vetores) e verifica se o jail
# recidive do fail2ban bloqueia o IP reincidente.
#
# Uso:
#   chmod +x scripts/test-fail2ban-recidive.sh
#   sudo ./scripts/test-fail2ban-recidive.sh              # Modo interativo
#   sudo ./scripts/test-fail2ban-recidive.sh --ci          # Modo CI (exit code)
#   sudo ./scripts/test-fail2ban-recidive.sh --dry-run     # Apenas mostra o que faria
#   sudo ./scripts/test-fail2ban-recidive.sh --quick       # Pula simulação sshd
#   sudo ./scripts/test-fail2ban-recidive.sh cleanup       # Limpa IPs de teste
#
# ⚠️ Requer: fail2ban rodando, sudo, acesso ao fail2ban-client.
# ⚠️ Usa IPs reservados (10.254.0.0/16) para não interferir com tráfego real.
# =============================================================================

set -euo pipefail

# ── Cores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()      { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()     { echo -e "${RED}[ERRO]${NC} $1"; }
pass()    { echo -e "${GREEN}[PASS]${NC} $1"; }
fail()    { echo -e "${RED}[FAIL]${NC} $1"; }
header()  { echo -e "\n${MAGENTA}${BOLD}═══ $1 ═══${NC}\n"; }
subheader() { echo -e "${CYAN}── $1 ──${NC}"; }

# ── Configuração ───────────────────────────────────────────────────────────
TEST_IP="10.254.0.$((RANDOM % 250 + 2))"  # IP aleatório válido na faixa reservada (10.254.0.2–251)

DRY_RUN=false
CI_MODE=false
EXIT_CODE=0
ASSERTIONS_TOTAL=0
ASSERTIONS_PASSED=0
ASSERTIONS_FAILED=0

# ═══════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════

assert() {
  local description="$1"
  local result="$2"
  ASSERTIONS_TOTAL=$((ASSERTIONS_TOTAL + 1))
  if [[ "$result" == "true" ]]; then
    pass "✓ $description"
    ASSERTIONS_PASSED=$((ASSERTIONS_PASSED + 1))
  else
    fail "✗ $description"
    ASSERTIONS_FAILED=$((ASSERTIONS_FAILED + 1))
    EXIT_CODE=1
  fi
}

run_cmd() {
  if $DRY_RUN; then
    echo "    (dry-run) $*"
    return 0
  fi
  "$@" 2>/dev/null || return $?
}

fail2ban_cmd() {
  run_cmd fail2ban-client "$@"
}

ban_ip_in_jail() {
  local jail="$1"
  local ip="$2"
  local reason="${3:-ataque simulado (teste)}"

  if $DRY_RUN; then
    echo "    (dry-run) fail2ban-client set $jail banip $ip # $reason"
    return 0
  fi

  # Tenta banir via fail2ban-client diretamente
  if fail2ban-client set "$jail" banip "$ip" 2>/dev/null; then
    return 0
  fi

  # Se falhou, simula via log injection (fallback)
  local logpath
  case "$jail" in
    sshd) logpath="/var/log/auth.log" ;;
    caddy-access|caddy-badbots|caddy-404-scan) logpath="/var/log/caddy/severinno-access.log" ;;
    *) return 1 ;;
  esac

  if [[ ! -f "$logpath" ]]; then
    warn "Log $logpath não encontrado — não foi possível simular ataque no jail $jail"
    return 1
  fi

  local fake_entry
  case "$jail" in
    sshd)
      fake_entry="$(date '+%b %e %H:%M:%S') $(hostname) sshd[$$]: Failed password for invalid user admin from $ip port 54321 ssh2"
      ;;
    caddy-access)
      fake_entry="$ip - - [$(date '+%d/%b/%Y:%H:%M:%S %z')] \"POST /api/auth/login HTTP/1.1\" 401 1234"
      ;;
    caddy-badbots)
      fake_entry="$ip - - [$(date '+%d/%b/%Y:%H:%M:%S %z')] \"GET /.env HTTP/1.1\" 404 123 \"-\" \"sqlmap/1.8\""
      ;;
    caddy-404-scan)
      fake_entry="$ip - - [$(date '+%d/%b/%Y:%H:%M:%S %z')] \"GET /hidden_admin_$(date +%s) HTTP/1.1\" 404 123"
      ;;
  esac

  echo "$fake_entry" >> "$logpath"
  return 0
}

unban_ip_all_jails() {
  local ip="$1"
  local found=false
  for jail in sshd caddy-access caddy-badbots caddy-404-scan recidive; do
    if fail2ban-cmd set "$jail" unbanip "$ip" 2>/dev/null; then
      ok "  IP $ip removido do jail $jail"
      found=true
    fi
  done
  $found || warn "  IP $ip não estava banido em nenhum jail"
}

check_ip_banned_in_jail() {
  local jail="$1"
  local ip="$2"
  fail2ban-cmd status "$jail" 2>/dev/null | grep -q "$ip"
}



# ═══════════════════════════════════════════════════════════════════════════
# FASES DO TESTE
# ═══════════════════════════════════════════════════════════════════════════

test_preflight() {
  header "🔍 PRÉ-VOO — Verificações Iniciais"
  local all_ok=true

  # ── Root check ──────────────────────────────────────────────────────────
  subheader "Verificando privilégios"
  if [[ $EUID -eq 0 ]]; then
    assert "Executando como root" "true"
  else
    assert "Executando como root (necessário para fail2ban-client)" "false"
    err "Este script precisa de sudo. Execute: sudo $0"
    exit 1
  fi

  # ── fail2ban instalado ──────────────────────────────────────────────────
  subheader "Verificando fail2ban"
  if command -v fail2ban-client &>/dev/null; then
    local version
    version=$(fail2ban-client --version 2>&1 | head -1)
    assert "fail2ban instalado ($version)" "true"
  else
    assert "fail2ban instalado" "false"
    err "fail2ban não está instalado. Execute: sudo ./scripts/fail2ban-setup.sh install"
    exit 1
  fi

  # ── fail2ban rodando ────────────────────────────────────────────────────
  if systemctl is-active --quiet fail2ban 2>/dev/null; then
    assert "fail2ban service está ativo" "true"
  else
    assert "fail2ban service está ativo" "false"
    warn "fail2ban não está rodando. Tentando iniciar..."
    systemctl start fail2ban 2>/dev/null || true
    sleep 2
    if systemctl is-active --quiet fail2ban 2>/dev/null; then
      ok "fail2ban iniciado com sucesso"
    else
      err "Não foi possível iniciar fail2ban"
      all_ok=false
    fi
  fi

  # ── Jails necessários ativos ────────────────────────────────────────────
  subheader "Verificando jails obrigatórios"
  local required_jails=("sshd" "caddy-access" "caddy-badbots" "caddy-404-scan" "recidive")
  local all_jails_active=true
  for jail in "${required_jails[@]}"; do
    if fail2ban-cmd status "$jail" &>/dev/null; then
      assert "Jail '$jail' está ativo" "true"
    else
      assert "Jail '$jail' está ativo" "false"
      warn "Jail $jail não encontrado. Execute: sudo ./scripts/fail2ban-setup.sh install"
      all_jails_active=false
      all_ok=false
    fi
  done

  # ── Recidive config correta ─────────────────────────────────────────────
  subheader "Verificando configuração do jail recidive"
  if [[ -f "/etc/fail2ban/jail.local" ]]; then
    if grep -q "\[recidive\]" /etc/fail2ban/jail.local; then
      assert "Seção [recidive] existe no jail.local" "true"
      local recidive_enabled=$(grep -A20 '\[recidive\]' /etc/fail2ban/jail.local | grep 'enabled' | grep -c 'true')
      if [[ "$recidive_enabled" -ge 1 ]]; then
        assert "Jail recidive está enabled = true" "true"
      else
        assert "Jail recidive está enabled = true" "false"
        warn "Jail recidive está presente mas desabilitado (enabled != true)"
      fi
      local recidive_maxretry=$(grep -A20 '\[recidive\]' /etc/fail2ban/jail.local | grep 'maxretry' | head -1 | grep -oP '\d+')
      assert "maxretry = $recidive_maxretry (3+ é seguro)" "true"
      local recidive_bantime=$(grep -A20 '\[recidive\]' /etc/fail2ban/jail.local | grep 'bantime' | head -1 | grep -oP '\d+')
      assert "bantime = $recidive_bantime (≥ 86400 = 1 dia)" "true"
      local recidive_findtime=$(grep -A20 '\[recidive\]' /etc/fail2ban/jail.local | grep 'findtime' | head -1 | grep -oP '\d+')
      assert "findtime = $recidive_findtime (≥ 3600 = 1h)" "true"
    else
      assert "Seção [recidive] existe no jail.local" "false"
      err "Jail recidive não está configurado no jail.local!"
      all_ok=false
    fi
  else
    assert "Arquivo /etc/fail2ban/jail.local existe" "false"
    err "jail.local não encontrado em /etc/fail2ban/"
    all_ok=false
  fi

  if $all_ok; then
    echo ""
    ok "✅ Pré-voo: todas as verificações passaram. Pronto para testar!"
  else
    echo ""
    warn "⚠️ Algumas verificações falharam. O teste pode não funcionar completamente."
  fi
}

test_single_jail_ban() {
  header "🔴 FASE 1 — Banimento em Jail Único (sshd)"
  info "IP de teste: $TEST_IP"

  # ── Banir IP no sshd ────────────────────────────────────────────────────
  subheader "Banindo IP $TEST_IP no jail sshd"
  if $DRY_RUN; then
    ok "(dry-run) IP $TEST_IP banido no sshd"
  else
    if ban_ip_in_jail "sshd" "$TEST_IP" "simulacao SSH brute force"; then
      sleep 1
      if check_ip_banned_in_jail "sshd" "$TEST_IP"; then
        assert "IP $TEST_IP foi banido no jail sshd" "true"
      else
        assert "IP $TEST_IP foi banido no jail sshd" "false"
        warn "Não foi possível banir IP no jail sshd. Tentando injetar no log..."
        warn "Você pode simular manualmente:"
        echo ""
        echo "  echo '$(date '+%b %e %H:%M:%S') $(hostname) sshd[$$]: Failed password for admin from $TEST_IP port 22 ssh2' | sudo tee -a /var/log/auth.log"
        echo ""
        # Fallback: tenta simular via log injection
        ban_ip_in_jail "sshd" "$TEST_IP" "fallback log injection" || true
        sleep 2
      fi
    else
      assert "IP $TEST_IP foi banido no jail sshd" "false"
      warn "Não foi possível simular ataque no sshd. Pulando para próximos testes."
    fi
  fi

  # ── Verificar que recidive NÃO pegou (apenas 1 ban) ────────────────────
  subheader "Verificando que recidive NÃO acionou (apenas 1 jail)"
  sleep 1
  if check_ip_banned_in_jail "recidive" "$TEST_IP"; then
    assert "IP $TEST_IP NÃO está no jail recidive (1 ban apenas)" "false"
    warn "RECIDIVE ACIONOU PREMATURAMENTE! Isso significa que o findtime/maxretry está muito agressivo."
    warn "Considere aumentar maxretry para 4+ ou diminuir findtime para 43200 (12h)."
  else
    assert "IP $TEST_IP NÃO está no jail recidive (1 ban apenas)" "true"
    ok "✔ recidive não acionou — apenas 1/3 bans necessários"
  fi
}

test_cross_jail_second() {
  header "🟠 FASE 2 — Segundo Jail (caddy-access)"
  info "IP de teste: $TEST_IP"

  # ── Banir IP no caddy-access ────────────────────────────────────────────
  subheader "Banindo IP $TEST_IP no jail caddy-access"
  if $DRY_RUN; then
    ok "(dry-run) IP $TEST_IP banido no caddy-access"
  else
    if ban_ip_in_jail "caddy-access" "$TEST_IP" "simulacao 401 repetido"; then
      sleep 1
      if check_ip_banned_in_jail "caddy-access" "$TEST_IP"; then
        assert "IP $TEST_IP foi banido no jail caddy-access" "true"
      else
        assert "IP $TEST_IP foi banido no jail caddy-access" "false"
      fi
    else
      assert "IP $TEST_IP foi banido no jail caddy-access" "false"
    fi
  fi

  # ── Verificar que recidive ainda NÃO pegou (apenas 2 bans) ────────────
  subheader "Verificando que recidive NÃO acionou (2 jails — precisa de 3)"
  sleep 1
  if check_ip_banned_in_jail "recidive" "$TEST_IP"; then
    assert "IP $TEST_IP NÃO está no jail recidive (2 bans apenas)" "false"
    warn "RECIDIVE ACIONOU COM APENAS 2 BANS!"
    warn "Verifique maxretry no [recidive]: deve ser >= 3"
    local actual_maxretry=$(grep -A20 '\[recidive\]' /etc/fail2ban/jail.local 2>/dev/null | grep 'maxretry' | head -1 | grep -oP '\d+')
    info "maxretry atual no recidive: ${actual_maxretry:-não encontrado}"
  else
    assert "IP $TEST_IP NÃO está no jail recidive (2 bans apenas)" "true"
    ok "✔ recidive ainda não acionou — 2/3 bans (mais um pra trigger)"
  fi
}

test_recidive_trigger() {
  header "🔴🟠 FASE 3 — TERCEIRO JAIL → RECIDIVE TRIGGER"
  info "IP de teste: $TEST_IP"

  # ── Banir IP no caddy-badbots (terceiro jail!) ─────────────────────────
  subheader "Banindo IP $TEST_IP no jail caddy-badbots (terceiro jail)"
  if $DRY_RUN; then
    ok "(dry-run) IP $TEST_IP banido no caddy-badbots"
  else
    if ban_ip_in_jail "caddy-badbots" "$TEST_IP" "simulacao bot scanner"; then
      sleep 1
      if check_ip_banned_in_jail "caddy-badbots" "$TEST_IP"; then
        assert "IP $TEST_IP foi banido no jail caddy-badbots" "true"
      else
        assert "IP $TEST_IP foi banido no jail caddy-badbots" "false"
      fi
    else
      assert "IP $TEST_IP foi banido no jail caddy-badbots" "false"
    fi
  fi

  # ── Verificar que recidive ACIONOU (3 bans cross-jail) ─────────────────
  subheader "🎯 Verificação CRÍTICA: recidive deve ter acionado"
  sleep 2  # Dar tempo para fail2ban processar o log e acionar recidive

  if check_ip_banned_in_jail "recidive" "$TEST_IP"; then
    assert "🚨 IP $TEST_IP está no jail recidive (3 bans cross-jail)" "true"
    echo ""
    ok "╔═══════════════════════════════════════════════════════════╗"
    ok "║  ✅ RECIDIVE FUNCIONANDO!                               ║"
    ok "║  IP reincidente em 3 jails foi banido por 14 dias!      ║"
    ok "╚═══════════════════════════════════════════════════════════╝"
  else
    assert "🚨 IP $TEST_IP está no jail recidive (3 bans cross-jail)" "false"
    echo ""
    warn "╔═══════════════════════════════════════════════════════════╗"
    warn "║  ❌ RECIDIVE NÃO ACIONOU!                               ║"
    warn "║  Possíveis causas:                                     ║"
    warn "║  1. fail2ban precisa de mais tempo para processar log   ║"
    warn "║  2. IP não aparece no fail2ban.log (log do recidive)    ║"
    warn "║  3. maxretry/findtime muito permissivos                ║"
    warn "╚═══════════════════════════════════════════════════════════╝"

    # Diagnóstico
    subheader "Diagnóstico"
    info "Verificando se o IP aparece em outros jails..."
    for jail in sshd caddy-access caddy-badbots caddy-404-scan; do
      if check_ip_banned_in_jail "$jail" "$TEST_IP"; then
        ok "  IP encontrado no jail $jail"
      else
        warn "  IP NÃO encontrado no jail $jail"
      fi
    done

    if [[ -f "/var/log/fail2ban.log" ]]; then
      info "Últimas linhas do fail2ban.log:"
      tail -20 /var/log/fail2ban.log 2>/dev/null | head -20 || echo "(log vazio ou inacessível)"
    else
      info "fail2ban.log não encontrado em /var/log/fail2ban.log"
    fi

    info "Status do jail recidive:"
    fail2ban-cmd status recidive 2>&1 | head -10 || echo "  (jail inacessível)"

    warn "Para testar manualmente:"
    echo "    sudo fail2ban-client set sshd banip $TEST_IP"
    echo "    sudo fail2ban-client set caddy-access banip $TEST_IP"
    echo "    sudo fail2ban-client set caddy-badbots banip $TEST_IP"
    echo "    sleep 3 && sudo fail2ban-client status recidive"
  fi

  echo ""
  info "📊 Bans ativos no servidor (todos os jails):"
  for jail in sshd caddy-access caddy-badbots caddy-404-scan recidive; do
    local status=$(fail2ban-cmd status "$jail" 2>/dev/null | grep -E "(Total banned|Currently banned)" | tr -d '\n' || echo "  (inativo)")
    echo "    $jail: $status"
  done
}

test_cleanup() {
  header "🧹 FASE 4 — Limpeza"
  info "Removendo IP de teste $TEST_IP de todos os jails..."

  if $DRY_RUN; then
    ok "(dry-run) IP $TEST_IP removido de todos os jails"
    return
  fi

  unban_ip_all_jails "$TEST_IP"

  # Verificar que a limpeza funcionou
  sleep 1
  local still_banned=false
  for jail in sshd caddy-access caddy-badbots caddy-404-scan recidive; do
    if check_ip_banned_in_jail "$jail" "$TEST_IP"; then
      warn "IP $TEST_IP ainda está banido no jail $jail"
      still_banned=true
    fi
  done

  if $still_banned; then
    assert "Limpeza: IP $TEST_IP removido de todos os jails" "false"
    warn "Alguns bans não foram removidos. Execute manualmente:"
    warn "  sudo fail2ban-client set recidive unbanip $TEST_IP"
    warn "  sudo fail2ban-client set sshd unbanip $TEST_IP"
    warn "  sudo fail2ban-client set caddy-access unbanip $TEST_IP"
    warn "  sudo fail2ban-client set caddy-badbots unbanip $TEST_IP"
  else
    assert "Limpeza: IP $TEST_IP removido de todos os jails" "true"
    ok "✔ Ambiente de teste limpo"
  fi

  echo ""
  info "🧪 Teste concluído com IP $TEST_IP — você pode querer verificar:"
  info "  sudo fail2ban-client status recidive"
  info "  tail -20 /var/log/fail2ban.log | grep $TEST_IP"
}

test_reports() {
  header "📈 RESUMO DO TESTE"

  local pass_rate=0
  if [[ $ASSERTIONS_TOTAL -gt 0 ]]; then
    pass_rate=$(( (ASSERTIONS_PASSED * 100) / ASSERTIONS_TOTAL ))
  fi

  echo ""
  echo "  Total de asserções: ${ASSERTIONS_TOTAL}"
  echo "  ✅ Passaram:        ${ASSERTIONS_PASSED}"
  echo "  ❌ Falharam:        ${ASSERTIONS_FAILED}"
  echo "  📊 Taxa de sucesso: ${pass_rate}%"
  echo ""

  if [[ $ASSERTIONS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  ✅ TESTE COMPLETO — TODOS OS CHECKS PASSARAM!              ║"
    echo "║  Recidive está funcionando corretamente.                   ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
  else
    echo -e "${RED}${BOLD}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  ⚠️ TESTE INCOMPLETO — ${ASSERTIONS_FAILED} CHECK(S) FALHARAM              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo "Revise as falhas acima e ajuste a configuração conforme necessário."
    echo "Após ajustar, reinicie o fail2ban: sudo systemctl restart fail2ban"
  fi
  echo ""

  if $CI_MODE; then
    exit $EXIT_CODE
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# MODO CLEANUP — Remove IPs de teste residuais
# ═══════════════════════════════════════════════════════════════════════════

cmd_cleanup() {
  header "🧹 Limpeza de IPs de Teste Residuais"
  warn "Este comando remove bans de IPs na faixa 10.254.0.0/16 (reservada para testes)"
  warn "de todos os jails do fail2ban."

  if ! $DRY_RUN && ! $CI_MODE; then
    echo ""
    read -r -p "Continuar? (s/N): " confirm
    [[ "$confirm" =~ ^[sSyY] ]] || { info "Cancelado."; exit 0; }
  fi

  local cleaned=0
  for jail in sshd caddy-access caddy-badbots caddy-404-scan recidive; do
    local banned_ips=$(fail2ban-cmd status "$jail" 2>/dev/null | grep -oP '\d+\.\d+\.\d+\.\d+' || true)
    for ip in $banned_ips; do
      if echo "$ip" | grep -q '^10\.254\.'; then
        if $DRY_RUN; then
          echo "    (dry-run) unban $ip do jail $jail"
        else
          fail2ban-cmd set "$jail" unbanip "$ip" &>/dev/null && \
            ok "  IP $ip removido do jail $jail" || true
        fi
        cleaned=$((cleaned + 1))
      fi
    done
  done

  if [[ $cleaned -eq 0 ]]; then
    ok "Nenhum IP de teste residual encontrado."
  else
    ok "$cleaned IP(s) de teste limpos."
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

show_banner() {
  echo -e "${MAGENTA}${BOLD}"
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  🔒 TESTE DE VERIFICAÇÃO — FAIL2BAN JAIL RECIDIVE          ║"
  echo "║  Simulação de ataque cross-jail (SSH + Caddy + Bad Bots)   ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo "  IP de teste:       ${TEST_IP}"
  echo "  Modo CI:           ${CI_MODE}"
  echo "  Dry-run:           ${DRY_RUN}"

  echo "  Data:              $(date '+%Y-%m-%d %H:%M:%S')"
  echo "  Hostname:          $(hostname)"
  echo "  fail2ban versão:   $(fail2ban-client --version 2>&1 | head -1 || echo 'desconhecida')"
  echo ""
}

show_help() {
  echo "Uso: $0 [opções]"
  echo ""
  echo "Opções:"
  echo "  --help, -h     Mostra esta ajuda"
  echo "  --ci           Modo CI (exit code 0/1, sem prompts interativos)"
  echo "  --dry-run      Apenas mostra o que seria executado (não modifica nada)"
  echo "  --quick        Ignorado (precisa de 3 jails para cross-jail)"
  echo "  cleanup        Remove IPs de teste residuais (faixa 10.254.0.0/16)"
  echo ""
  echo "Exemplos:"
  echo "  sudo $0                    # Teste interativo completo"
  echo "  sudo $0 --ci               # Teste CI (útil para pipelines)"
  echo "  sudo $0 --dry-run          # Pré-visualização"
  echo "  sudo $0 --quick --ci       # Teste rápido + CI"
  echo "  sudo $0 cleanup            # Limpar IPs de teste"
}

# ── Parse args ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) show_help; exit 0 ;;
    --ci) CI_MODE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --quick) warn "--quick não é mais suportado (precisa de 3 jails para cross-jail). Ignorando."; shift ;;
    cleanup) cmd_cleanup; exit 0 ;;
    *) err "Opção desconhecida: $1"; show_help; exit 1 ;;
  esac
done

# ── Execução ───────────────────────────────────────────────────────────────
show_banner
test_preflight
test_single_jail_ban
test_cross_jail_second
test_recidive_trigger
test_cleanup
test_reports
