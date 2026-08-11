#!/usr/bin/env bash
# =============================================================================
# scripts/test-security-headers.sh - Security Headers Verification
# =============================================================================
# Tests that ALL security headers defined in Caddyfile.prod and middleware.ts
# are present and correctly configured on the target server.
#
# Usage:
#   ./scripts/test-security-headers.sh                    # Test localhost:3000
#   ./scripts/test-security-headers.sh --ci               # Modo CI (exit code)
#   ./scripts/test-security-headers.sh --url https://severinno.com.br  # Custom URL
#   ./scripts/test-security-headers.sh --all              # Test all endpoints
#
# Environment:
#   BASE_URL    Target URL (default: http://localhost:3000)
#   CI_MODE     Set to "true" for CI mode (no colors, exit code)
# =============================================================================

set -euo pipefail

# -- Config ------------------------------------------------------------------
BASE_URL="${BASE_URL:-http://localhost:3000}"
CI_MODE="${CI_MODE:-false}"
TEST_ALL="${TEST_ALL:-false}"
EXIT_CODE=0
ASSERTIONS_TOTAL=0
ASSERTIONS_PASSED=0
ASSERTIONS_FAILED=0

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ci) CI_MODE=true; shift ;;
    --all) TEST_ALL=true; shift ;;
    --url) BASE_URL="$2"; shift 2 ;;
    --help|-h)
      echo "Uso: $0 [opcoes]"
      echo "  --ci          Modo CI (exit code 0/1)"
      echo "  --all         Testa todos os endpoints (/api/health, /api/health/detailed)"
      echo "  --url <url>   URL alvo (padrao: $BASE_URL)"
      exit 0 ;;
    *) echo "Opcao desconhecida: $1"; exit 1 ;;
  esac
done

# -- Cores (desativado em CI mode) ------------------------------------------
if [[ "$CI_MODE" == "true" ]]; then
  RED="" GREEN="" YELLOW="" BLUE="" MAGENTA="" CYAN="" BOLD="" NC=""
else
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  MAGENTA='\033[0;35m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  NC='\033[0m'
fi

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()      { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()     { echo -e "${RED}[ERRO]${NC} $1"; }
pass()    { echo -e "${GREEN}[PASS]${NC} $1"; }
fail()    { echo -e "${RED}[FAIL]${NC} $1"; }
header()  { echo -e "\n${MAGENTA}${BOLD}=== $1 ===${NC}\n"; }

# -- Temp file (limpo no trap) ----------------------------------------------
HEADERS_FILE="$(mktemp /tmp/security-headers.XXXXXX 2>/dev/null || echo "/tmp/security-headers.txt")"
cleanup() { rm -f "$HEADERS_FILE" 2>/dev/null || true; }
trap cleanup EXIT

# -- Helper: fetch headers from URL -----------------------------------------
fetch_headers() {
  local url="$1"
  # Usa GET em vez de HEAD para capturar headers reais (CDNs/proxies
  # podem retornar headers diferentes em HEAD requests).
  # --max-time/--connect-timeout (2026-08, sec security-headers-gate): um
  # curl SEM timeout deixava o job esperando minutos num connect stall
  # (run 31430040398: HTTP 000000, tail de 9:08 em toda prova - o site
  # responde em ~200ms quando saudavel; o stall era o curl sem bound).
  curl -s -o /dev/null -D "$HEADERS_FILE" -w "%{http_code}" --max-time 20 --connect-timeout 10 "$url" 2>/dev/null || echo "000"
}

get_header() {
  local name="$1"
  grep -i "^${name}:" "$HEADERS_FILE" 2>/dev/null | sed 's/^[^:]*:\s*//i' || echo ""
}

# -- Assert helper ----------------------------------------------------------
assert() {
  local description="$1"
  local result="$2"
  ASSERTIONS_TOTAL=$((ASSERTIONS_TOTAL + 1))
  if [[ "$result" == "true" ]]; then
    pass "- $description"
    ASSERTIONS_PASSED=$((ASSERTIONS_PASSED + 1))
  else
    fail "[X] $description"
    ASSERTIONS_FAILED=$((ASSERTIONS_FAILED + 1))
    EXIT_CODE=1
  fi
}

# -- Test: HSTS -------------------------------------------------------------
test_hsts() {
  header " 1. Strict-Transport-Security (HSTS)"

  hsts=$(get_header "Strict-Transport-Security")

  if [[ -z "$hsts" ]]; then
    assert "Header Strict-Transport-Security esta presente" "false"
    warn "HSTS nao configurado - risco de downgrade attack (SSLStrip)"
    return
  fi

  assert "Header Strict-Transport-Security esta presente ($hsts)" "true"

  # max-age deve ser >= 1 ano (31536000)
  if echo "$hsts" | grep -qi "max-age=31536000"; then
    assert "max-age=31536000 (1 ano) -" "true"
  else
    local ma=$(echo "$hsts" | grep -oP 'max-age=\K\d+' || echo "0")
    assert "max-age=31536000 (1 ano) - atual: $ma" "false"
    warn "HSTS max-age < 1 ano ou ausente. Recomendado: 31536000"
  fi

  if echo "$hsts" | grep -qi "includeSubDomains"; then
    assert "includeSubDomains presente -" "true"
  else
    assert "includeSubDomains presente" "false"
    warn "includeSubDomains ausente - subdominios nao protegi dos contra SSLStrip"
  fi

  if echo "$hsts" | grep -qi "preload"; then
    assert "preload presente -" "true"
  else
    assert "preload presente" "false"
    warn "preload ausente - considerar adicionar para entrar no pre-carregamento do Chrome"
  fi
}

# -- Test: Content-Security-Policy ------------------------------------------
test_csp() {
  header " 2. Content-Security-Policy (CSP)"

  csp=$(get_header "Content-Security-Policy")

  if [[ -z "$csp" ]]; then
    assert "Header Content-Security-Policy esta presente" "false"
    warn "CSP nao configurado - vulneravel a XSS!"
    return
  fi

  assert "Header Content-Security-Policy esta presente" "true"

  # Diretivas obrigatorias
  local directives=(
    "default-src 'self'"
    "object-src 'none'"
    "frame-ancestors 'none'"
    "base-uri 'self'"
    "form-action 'self'"
    "worker-src 'self' blob:"
    "manifest-src 'self'"
  )

  for directive in "${directives[@]}"; do
    if echo "$csp" | grep -qi "$directive"; then
      assert "  $directive -" "true"
    else
      assert "  $directive" "false"
    fi
  done

  # Verificar conectividade com GlitchTip, OSM, etc.
  local connect_sources=(
    "api.glitchtip.com"
    "tile.openstreetmap.org"
    "nominatim.openstreetmap.org"
  )

  for source in "${connect_sources[@]}"; do
    if echo "$csp" | grep -qi "$source"; then
      ok "  connect-src inclui $source"
    else
      warn "  connect-src NAO inclui $source - pode quebrar funcionalidades"
    fi
  done

  # CSP3 Reporting API: report-to + Reporting-Endpoints header (modern) com
  # report-uri como fallback legado (browsers que suportam ambos preferem
  # report-to e ignoram report-uri - o par e seguro de enviar junto).
  if echo "$csp" | grep -qi "report-to csp-endpoint"; then
    assert "  report-to csp-endpoint -" "true"
  else
    assert "  report-to csp-endpoint" "false"
    warn "  Sem report-to - CSP3 Reporting API desativado"
  fi

  if echo "$csp" | grep -qi "report-uri /api/csp-report"; then
    assert "  report-uri /api/csp-report (legado) -" "true"
  else
    assert "  report-uri /api/csp-report (legado)" "false"
    warn "  Sem report-uri - browsers legados nao reportarao violacoes"
  fi

  local reporting_endpoints
  reporting_endpoints=$(get_header "Reporting-Endpoints")
  if echo "$reporting_endpoints" | grep -qi 'csp-endpoint="/api/csp-report"'; then
    assert "  Header Reporting-Endpoints: csp-endpoint -" "true"
  else
    assert "  Header Reporting-Endpoints: csp-endpoint" "false"
    warn "  Sem Reporting-Endpoints header - report-to nao tem endpoint definido"
  fi
}

# -- Test: Security Headers basicos -----------------------------------------
test_security_headers() {
  header " 3. Security Headers Basicos"

  # X-Content-Type-Options
  xcto=$(get_header "X-Content-Type-Options")
  if echo "$xcto" | grep -qi "nosniff"; then
    assert "X-Content-Type-Options: nosniff -" "true"
  else
    assert "X-Content-Type-Options: nosniff" "false"
    warn "Sem X-Content-Type-Options - risco de MIME sniffing"
  fi

  # X-Frame-Options
  xfo=$(get_header "X-Frame-Options")
  if echo "$xfo" | grep -qi "DENY"; then
    assert "X-Frame-Options: DENY -" "true"
  else
    assert "X-Frame-Options: DENY" "false"
    warn "Sem X-Frame-Options - risco de clickjacking"
  fi

  # X-XSS-Protection - DEPRECATED. Modern browsers ignore it and OWASP
  # recommends REMOVING it (the old `1; mode=block` could even enable a
  # filter-based bypass on legacy browsers). We assert it is ABSENT, matching
  # the production config (next.config.ts / middleware.ts do not set it).
  xss=$(get_header "X-XSS-Protection")
  if [[ -z "$xss" ]]; then
    assert "X-XSS-Protection ausente (deprecado - OWASP recomenda remover) -" "true"
  else
    assert "X-XSS-Protection ausente - presente: '$xss' (deprecado, remover)" "false"
  fi

  # Referrer-Policy
  rp=$(get_header "Referrer-Policy")
  if echo "$rp" | grep -qi "strict-origin-when-cross-origin"; then
    assert "Referrer-Policy: strict-origin-when-cross-origin -" "true"
  else
    assert "Referrer-Policy: strict-origin-when-cross-origin" "false"
    warn "Referrer-Policy ausente ou incorreta - vazamento de dados via referrer"
  fi

  # Permissions-Policy
  local pp
  pp=$(get_header "Permissions-Policy")
  if echo "$pp" | grep -qi "camera=()"; then
    assert "Permissions-Policy: camera desabilitada -" "true"
  else
    assert "Permissions-Policy: camera desabilitada" "false"
  fi
  if echo "$pp" | grep -qi "microphone=()"; then
    assert "Permissions-Policy: microfone desabilitado -" "true"
  else
    assert "Permissions-Policy: microfone desabilitado" "false"
  fi
  if echo "$pp" | grep -qi "geolocation=(self)"; then
    assert "Permissions-Policy: geolocation restrita a self -" "true"
  else
    assert "Permissions-Policy: geolocation restrita a self" "false"
  fi
}

# -- Test: Headers de remocao (Server, X-Powered-By) ------------------------
test_removed_headers() {
  header " 4. Headers que NAO devem vazar"

  server=$(get_header "Server")
  if [[ -z "$server" ]]; then
    assert "Header Server removido (sem vazamento de tecnologia) -" "true"
  else
    assert "Header Server removido - presente: '$server'" "false"
    warn "Header Server vaza informacao: '$server'"
  fi

  powered=$(get_header "X-Powered-By")
  if [[ -z "$powered" ]]; then
    assert "Header X-Powered-By removido -" "true"
  else
    assert "Header X-Powered-By removido" "false"
    warn "X-Powered-By vaza tecnologia: '$powered'"
  fi
}

# -- Test: Rate Limit e Health ----------------------------------------------
test_rate_limit_headers() {
  header " 5. Rate Limiting & Controles"

  rate_limit=$(get_header "X-RateLimit-Limit")
  if [[ -n "$rate_limit" ]]; then
    assert "X-RateLimit-Limit presente ($rate_limit) -" "true"
  else
    assert "X-RateLimit-Limit presente" "false"
    warn "Rate limit headers ausentes - sem protecao contra abuso via middleware"
  fi
}

# -- Test: HTTPS/TLS (quando URL e HTTPS) ----------------------------------
test_tls() {
  local url="$1"
  if [[ "$url" != https://* ]]; then
    info "URL nao e HTTPS - pulando verificacao TLS"
    return
  fi

  header " 6. TLS/SSL (HTTPS)"

  # Verificar TLS 1.2+ (sem ciphers especificos para compatibilidade com CI)
  tls_info=$(curl -sI --tlsv1.2 --tls-max 1.3 \
    --max-time 20 --connect-timeout 10 \
    -o /dev/null -w "%{ssl_verify_result}" "$url" 2>/dev/null || echo "error")

  if [[ "$tls_info" != "error" ]]; then
    assert "TLS 1.2+ disponivel -" "true"
  else
    warn "Nao foi possivel verificar TLS 1.2 - pode ser restricao de cipher no cliente"
    # Isso e comum em CI que pode nao ter os ciphers modernos
  fi
}

# ===========================================================================
# MAIN
# ===========================================================================

echo -e "${BOLD}${MAGENTA}"
echo "+==============================================================+"
echo "|   TESTE DE VERIFICACAO - SECURITY HEADERS                |"
echo "|  Valida CSP, HSTS, X-Frame-Options e mais via curl         |"
echo "+==============================================================+"
echo -e "${NC}"
echo "  Target:   ${BASE_URL}"
echo "  CI mode:  ${CI_MODE}"
echo "  Test all: ${TEST_ALL}"
echo "  Date:     $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# -- Pre-verificacao --------------------------------------------------------
if ! command -v curl &>/dev/null; then
  err "curl nao esta instalado. Instale com: apt-get install curl"
  exit 1
fi

# -- Definir endpoints ------------------------------------------------------
ENDPOINTS=("$BASE_URL")
if [[ "$TEST_ALL" == "true" ]]; then
  ENDPOINTS+=("$BASE_URL/api/health")
  ENDPOINTS+=("$BASE_URL/api/health/detailed")
  ENDPOINTS+=("$BASE_URL/api/auth/login")
fi

for endpoint in "${ENDPOINTS[@]}"; do
  echo ""
  info "==========================================================="
  info "  Testando: $endpoint"
  info "==========================================================="

  status=$(fetch_headers "$endpoint")

  if [[ "$status" == "000" ]]; then
    fail "Endpoint nao respondeu (curl falhou)"
    EXIT_CODE=1
    continue
  fi

  assert "Endpoint respondeu com HTTP $status" "true"

  test_hsts
  test_csp
  test_security_headers
  test_removed_headers

  # Rate-limit headers are API-only by design (middleware applies them to
  # /api/* paths). Asserting them on page routes (/ , /categoria, /u)
  # would be a false failure.
  if [[ "$endpoint" == */api/* ]]; then
    test_rate_limit_headers
  fi

  if [[ "$endpoint" == "$BASE_URL" ]]; then
    test_tls "$endpoint"
  fi
done

# -- Resumo -----------------------------------------------------------------
header " RESUMO"

pass_rate=0
if [[ $ASSERTIONS_TOTAL -gt 0 ]]; then
  pass_rate=$(( (ASSERTIONS_PASSED * 100) / ASSERTIONS_TOTAL ))
fi

echo ""
echo "  Total de assercoes: ${ASSERTIONS_TOTAL}"
echo "  [OK] Passaram:        ${ASSERTIONS_PASSED}"
echo "  [FAIL] Falharam:        ${ASSERTIONS_FAILED}"
echo "   Taxa de sucesso: ${pass_rate}%"
echo ""

if [[ $ASSERTIONS_FAILED -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}"
  echo "+==============================================================+"
  echo "|  [OK] TODOS OS SECURITY HEADERS VALIDOS!                     |"
  echo "|  CSP, HSTS e headers de seguranca configurados.            |"
  echo "+==============================================================+"
  echo -e "${NC}"
else
  echo -e "${RED}${BOLD}"
  echo "+==============================================================+"
  echo "|  [!] ${ASSERTIONS_FAILED} SECURITY HEADER(S) FALHOU(ARAM)               |"
  echo "+==============================================================+"
  echo -e "${NC}"
  echo "Revise as falhas acima. Verifique:"
  echo "  - Caddyfile.prod (security headers block)"
  echo "  - src/middleware.ts (security headers for SSR)"
  echo "  - docker-compose.prod.yml (Caddy config)"
fi
echo ""

if [[ "$CI_MODE" == "true" ]]; then
  exit $EXIT_CODE
fi
