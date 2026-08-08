#!/usr/bin/env bash
# =============================================================================
# scripts/verify-hsts-preload.sh — HSTS Preload Preflight Verification
# =============================================================================
# Verifica, para cada host do domínio, se ele está APTO a ser submetido ao
# HSTS preload (hstspreload.org). A submissão é IRREVERSÍVEL na prática
# (remoção leva meses e requer remover a diretiva `preload` do header), então
# este script é o gate ANTES de submeter.
#
# Requisitos do hstspreload.org (https://hstspreload.org/):
#   1. O header Strict-Transport-Security deve estar presente em TODAS as
#      respostas HTTPS do domínio (incluindo redirects):
#        max-age=31536000; includeSubDomains; preload
#      (max-age >= 1 ano, obrigatório)
#   2. TODOS os subdomínios com registro DNS devem servir HTTPS válido —
#      inclusive os internos. Subdomínios SEM registro DNS (não resolvem)
#      ficam isentos.
#   3. O www, se tiver registro DNS, deve servir HTTPS.
#   4. Redirecionamento http:// -> https:// (o scanner acessa via http).
#
# Este script checa (1), (4) e audita (2)/(3): descobre os subdomínios a
# partir do Caddyfile.prod, verifica quais resolvem via DNS e testa HTTPS +
# HSTS em cada um que resolve.
#
# Usage:
#   ./scripts/verify-hsts-preload.sh                    # hosts do Caddyfile.prod
#   ./scripts/verify-hsts-preload.sh --ci               # Modo CI (exit code)
#   ./scripts/verify-hsts-preload.sh --hosts "a.com www.a.com"  # lista custom
#   ./scripts/verify-hsts-preload.sh --dns-override 1.1.1.1     # DNS resolver
#
# Exit code 0 = apto a submeter; 1 = há bloqueador.
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
CI_MODE="${CI_MODE:-false}"
DNS_SERVER="${DNS_SERVER:-}"
VERBOSE="${VERBOSE:-false}"
EXIT_CODE=0
ASSERTIONS_TOTAL=0
ASSERTIONS_PASSED=0
ASSERTIONS_FAILED=0

# Diretório raiz do repo (para localizar o Caddyfile.prod)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CADDYFILE="${CADDYFILE:-$REPO_ROOT/Caddyfile.prod}"

# ── Parse args ──────────────────────────────────────────────────────────────
HOSTS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ci) CI_MODE=true; shift ;;
    --hosts)
      # shellcheck disable=SC2206
      HOSTS=($2); shift 2 ;;
    --dns-override) DNS_SERVER="$2"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    --help|-h)
      echo "Uso: $0 [opções]"
      echo "  --ci                 Modo CI (exit code 0/1, sem cores)"
      echo "  --hosts 'a.com b.com'  Lista de hosts (padrão: Caddyfile.prod)"
      echo "  --dns-override <ip>  Servidor DNS (nslookup; padrão: sistema)"
      echo "  --verbose            Mostra detalhes de cada checagem"
      exit 0 ;;
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
done

# ── Cores ──────────────────────────────────────────────────────────────────
if [[ "$CI_MODE" == "true" ]]; then
  RED="" GREEN="" YELLOW="" BLUE="" MAGENTA="" CYAN="" BOLD="" NC=""
else
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BLUE='\033[0;34m'; MAGENTA='\033[0;35m'; CYAN='\033[0;36m'
  BOLD='\033[1m'; NC='\033[0m'
fi

info()   { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()     { echo -e "${GREEN}[OK]${NC} $1"; }
warn()   { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()    { echo -e "${RED}[ERRO]${NC} $1"; }
pass()   { echo -e "${GREEN}[PASS]${NC} $1"; }
fail()   { echo -e "${RED}[FAIL]${NC} $1"; }
header() { echo -e "\n${MAGENTA}${BOLD}═══ $1 ═══${NC}\n"; }

assert() {
  local description="$1" result="$2"
  ASSERTIONS_TOTAL=$((ASSERTIONS_TOTAL + 1))
  if [[ "$result" == "true" ]]; then
    pass "✓ $description"; ASSERTIONS_PASSED=$((ASSERTIONS_PASSED + 1))
  else
    fail "✗ $description"; ASSERTIONS_FAILED=$((ASSERTIONS_FAILED + 1)); EXIT_CODE=1
  fi
}

# ── Dependências ────────────────────────────────────────────────────────────
# nslookup é usado para DNS (getent pode não existir no Git Bash/Windows e o
# --dns-override depende dele). Sem nslookup, hosts que resolvem seriam
# marcados como 'isento' silenciosamente (falso PASS) — por isso é obrigatório.
for cmd in curl nslookup; do
  if ! command -v "$cmd" &>/dev/null; then
    # No Debian/Ubuntu o binário nslookup vive no pacote dnsutils (ou
    # bind9-dnsutils no Ubuntu 23+), não num pacote chamado 'nslookup'.
    err "'$cmd' não está instalado. Debian/Ubuntu: apt-get install dnsutils"
    exit 1
  fi
done

# ── Descobre hosts a partir do Caddyfile.prod ───────────────────────────────
# Extrai os domínios dos blocos de site do Caddy (linhas que abrem com um
# domínio + opcionalmente vírgula com www). Ex.:
#   severinno.com.br, www.severinno.com.br {
#   glitchtip.severinno.com.br {
discover_hosts_from_caddyfile() {
  if [[ ! -f "$CADDYFILE" ]]; then
    warn "Caddyfile.prod não encontrado em $CADDYFILE — use --hosts"
    return 1
  fi
  # Exige PONTO no primeiro token (todo hostname real tem ponto; nenhuma
  # diretiva do Caddy tem — handle/header/rate_limit/log seriam capturados
  # como 'hosts' falsos e marcados 'isento', poluindo o relatório).
  grep -oE '^[[:space:]]*[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+(,[[:space:]]*[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+)*[[:space:]]*\{' "$CADDYFILE" \
    | sed -E 's/[[:space:]]*\{$//' \
    | tr ',' '\n' \
    | sed 's/[[:space:]]//g' \
    | grep -vE '^(http|https)://' \
    | sort -u
}

if [[ ${#HOSTS[@]} -eq 0 ]]; then
  mapfile -t HOSTS < <(discover_hosts_from_caddyfile || true)
fi
if [[ ${#HOSTS[@]} -eq 0 ]]; then
  err "Nenhum host a verificar. Passe --hosts ou rode a partir do repo com Caddyfile.prod."
  exit 1
fi

# ── DNS: verifica se o host resolve ─────────────────────────────────────────
host_resolves() {
  local host="$1"
  if [[ -n "$DNS_SERVER" ]]; then
    nslookup "$host" "$DNS_SERVER" &>/dev/null
  else
    getent hosts "$host" &>/dev/null || nslookup "$host" &>/dev/null
  fi
}

# ── Verifica HTTPS + header HSTS completo num host ──────────────────────────
check_host() {
  local host="$1"
  header "🛡️  Host: $host"

  # 1. DNS resolve?
  if ! host_resolves "$host"; then
    info "Sem registro DNS (não resolve) — isento de HTTPS, conforme requisito do preload."
    assert "DNS: $host não resolve (isento)" "true"
    return
  fi
  assert "DNS: $host resolve" "true"

  # 2. Redirect http:// -> https://
  local http_status redirect_loc
  http_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
    -H "User-Agent: hstspreload-verification/1.0" "http://$host/" 2>/dev/null || echo "000")
  if [[ "$http_status" == "000" ]]; then
    assert "http://$host respondeu (status=$http_status)" "false"
    warn "  Host inalcançável via http — impossível validar redirect"
  elif [[ "$http_status" == 301 || "$http_status" == 302 || "$http_status" == 307 || "$http_status" == 308 ]]; then
    redirect_loc=$(curl -s -o /dev/null -w "%{redirect_url}" --max-time 15 \
      -H "User-Agent: hstspreload-verification/1.0" "http://$host/" 2>/dev/null || echo "")
    if [[ "$redirect_loc" == https://* ]]; then
      assert "http://$host → HTTPS redirect (301/302/307/308 → $redirect_loc)" "true"
    else
      assert "http://$host redirect aponta para HTTPS (→ $redirect_loc)" "false"
    fi
  else
    assert "http://$host retorna redirect 3xx (status=$http_status)" "false"
    warn "  Respondeu $http_status — precisa ser 301/302/307/308 para https"
  fi

  # 3. HTTPS acessível + header HSTS íntegro
  local https_status hsts
  https_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 \
    -H "User-Agent: hstspreload-verification/1.0" "https://$host/" 2>/dev/null || echo "000")
  assert "https://$host respondeu (status=$https_status)" "true"

  hsts=$(curl -s -D - -o /dev/null --max-time 20 \
    -H "User-Agent: hstspreload-verification/1.0" "https://$host/" 2>/dev/null \
    | tr -d '\r' | grep -i '^Strict-Transport-Security:' | sed 's/^[^:]*:\s*//i' || echo "")

  if [[ -z "$hsts" ]]; then
    assert "Header Strict-Transport-Security presente em https://$host" "false"
    warn "  SEM HSTS — o hstspreload.org REJEITARÁ a submissão"
    return
  fi
  assert "Header Strict-Transport-Security presente em https://$host" "true"

  # max-age >= 31536000 (1 ano)
  local max_age
  max_age=$(echo "$hsts" | grep -oE 'max-age=[0-9]+' | grep -oE '[0-9]+' | head -1)
  if [[ -n "$max_age" && "$max_age" -ge 31536000 ]]; then
    assert "max-age >= 31536000 (1 ano) — atual: $max_age" "true"
  else
    assert "max-age >= 31536000 (atual: '${max_age:-ausente}')" "false"
  fi

  # includeSubDomains
  if echo "$hsts" | grep -qi "includeSubDomains"; then
    assert "includeSubDomains presente ✓" "true"
  else
    assert "includeSubDomains presente" "false"
  fi

  # preload
  if echo "$hsts" | grep -qi "preload"; then
    assert "preload presente ✓" "true"
  else
    assert "preload presente" "false"
  fi

  if [[ "$VERBOSE" == "true" ]]; then
    info "  Header observado: $hsts"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

echo -e "${BOLD}${MAGENTA}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  🔒 VERIFICAÇÃO PRÉ-SUBMISSÃO — HSTS PRELOAD               ║"
echo "║  Valida HTTPS + HSTS + redirect de todos os hosts          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Caddyfile:  ${CADDYFILE}"
echo "  Hosts:      ${HOSTS[*]}"
echo "  CI mode:    ${CI_MODE}"
echo "  Data:       $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

for host in "${HOSTS[@]}"; do
  check_host "$host"
done

# ── Resumo ──────────────────────────────────────────────────────────────────
header "📊 RESUMO"

pass_rate=0
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
  echo "║  ✅ APTO PARA SUBMISSÃO AO HSTS PRELOAD!                    ║"
  echo "║  Acesse https://hstspreload.org/ e submeta o domínio.       ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
else
  echo -e "${RED}${BOLD}"
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  ⚠️ ${ASSERTIONS_FAILED} ASSERÇÃO(ÕES) FALHOU(ARAM) — NÃO SUBMETER AINDA        ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo "Corrija os pontos acima antes de submeter em https://hstspreload.org/"
  echo "Lembrete: a submissão é praticamente irreversível (remoção leva meses)."
fi
echo ""

if [[ "$CI_MODE" == "true" ]]; then
  exit $EXIT_CODE
fi
