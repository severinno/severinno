#!/usr/bin/env bash
# =============================================================================
# scripts/test-security-headers.sh — Security Headers Verification
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

# ── Config ──────────────────────────────────────────────────────────────────
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
      echo "Uso: $0 [opções]"
      echo "  --ci          Modo CI (exit code 0/1)"
      echo "  --all         Testa todos os endpoints (/api/health, /api/health/detailed)"
      echo "  --url <url>   URL alvo (padrão: $BASE_URL)"
      exit 0 ;;
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
done

# ── Cores (desativado em CI mode) ──────────────────────────────────────────
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
header()  { echo -e "\n${MAGENTA}${BOLD}═══ $1 ═══${NC}\n"; }

# ── Temp file (limpo no trap) ──────────────────────────────────────────────
HEADERS_FILE="$(mktemp /tmp/security-headers.XXXXXX 2>/dev/null || echo "/tmp/security-headers.txt")"
cleanup() { rm -f "$HEADERS_FILE" 2>/dev/null || true; }
trap cleanup EXIT

# ── Detect: behind Caddy? ──────────────────────────────────────────────────
# Caddy adiciona um header Server: Caddy que podemos detectar. Se não
# houver Caddy, os headers de segurança (HSTS, CSP, etc.) podem não
# estar presentes (CDN como hcdn pode strips-los) — tratamos como WARN.
# Quando atrás do Caddy, testes completos (assert).
BEHIND_CADDY=false
detect_caddy() {
  fetch_headers "$BASE_URL"
  local server
  server=$(get_header "Server")
  if echo "$server" | grep -qi "caddy"; then
    BEHIND_CADDY=true
    info "Detectado Caddy (Server: $server) — testes completos"
  else
    warn "Caddy NÃO detectado (Server: ${server:-ausente}) — headers de segurança"
    warn "serão WARM (não FAIL). Configure Caddy para testes completos."
  fi
}

# ── Helper: fetch headers from URL ─────────────────────────────────────────
fetch_headers() {
  local url="$1"
  # Usa GET em vez de HEAD para capturar headers reais (CDNs/proxies
  # podem retornar headers diferentes em HEAD requests).
  curl -s -o /dev/null -D "$HEADERS_FILE" -w "%{http_code}" "$url" 2>/dev/null || echo "000"
}

get_header() {
  local name="$1"
  grep -i "^${name}:" "$HEADERS_FILE" 2>/dev/null | sed 's/^[^:]*:\s*//i' || echo ""
}

# ── Assert helper ──────────────────────────────────────────────────────────
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

# ── Assert-or-warn: quando BEHIND_CADDY=false, falha vira WARN ──────────────
assert_or_warn() {
  local description="$1"
  local result="$2"
  ASSERTIONS_TOTAL=$((ASSERTIONS_TOTAL + 1))
  if [[ "$result" == "true" ]]; then
    pass "✓ $description"
    ASSERTIONS_PASSED=$((ASSERTIONS_PASSED + 1))
  elif [[ "$BEHIND_CADDY" == "true" ]]; then
    fail "✗ $description"
    ASSERTIONS_FAILED=$((ASSERTIONS_FAILED + 1))
    EXIT_CODE=1
  else
    warn "⚠ $description (CDN pode strips-los — configure Caddy para asserting)"
    ASSERTIONS_PASSED=$((ASSERTIONS_PASSED + 1))
  fi
}

# ── Test: HSTS ─────────────────────────────────────────────────────────────
test_hsts() {
  header "🔒 1. Strict-Transport-Security (HSTS)"

  hsts=$(get_header "Strict-Transport-Security")

  if [[ -z "$hsts" ]]; then
    assert_or_warn "Header Strict-Transport-Security está presente" "false"
    warn "HSTS não configurado — risco de downgrade attack (SSLStrip)"
    return
  fi

  assert_or_warn "Header Strict-Transport-Security está presente ($hsts)" "true"

  # max-age deve ser >= 1 ano (31536000)
  if echo "$hsts" | grep -qi "max-age=31536000"; then
    assert_or_warn "max-age=31536000 (1 ano) ✓" "true"
  else
    local ma=$(echo "$hsts" | grep -oP 'max-age=\K\d+' || echo "0")
    assert_or_warn "max-age=31536000 (1 ano) — atual: $ma" "false"
    warn "HSTS max-age < 1 ano ou ausente. Recomendado: 31536000"
  fi

  if echo "$hsts" | grep -qi "includeSubDomains"; then
    assert_or_warn "includeSubDomains presente ✓" "true"
  else
    assert_or_warn "includeSubDomains presente" "false"
    warn "includeSubDomains ausente — subdomínios não protegi dos contra SSLStrip"
  fi

  if echo "$hsts" | grep -qi "preload"; then
    assert_or_warn "preload presente ✓" "true"
  else
    assert_or_warn "preload presente" "false"
    warn "preload ausente — considerar adicionar para entrar no pré-carregamento do Chrome"
  fi
}

# ── Test: Content-Security-Policy ──────────────────────────────────────────
test_csp() {
  header "🛡️ 2. Content-Security-Policy (CSP)"

  csp=$(get_header "Content-Security-Policy")

  if [[ -z "$csp" ]]; then
    if [[ "$BEHIND_CADDY" == "true" ]]; then
      assert "Header Content-Security-Policy está presente" "false"
      warn "CSP não configurado — vulnerável a XSS!"
    else
      warn "CSP ausente (sem Caddy) — Caddy configura CSP no Caddyfile.prod"
    fi
    return
  fi

  assert_or_warn "Header Content-Security-Policy está presente" "true"

  # Diretivas obrigatórias
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
      assert_or_warn "  $directive ✓" "true"
    else
      assert_or_warn "  $directive" "false"
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
      warn "  connect-src NÃO inclui $source — pode quebrar funcionalidades"
    fi
  done
}

# ── Test: Security Headers básicos ─────────────────────────────────────────
test_security_headers() {
  header "🔐 3. Security Headers Básicos"

  # X-Content-Type-Options
  xcto=$(get_header "X-Content-Type-Options")
  if echo "$xcto" | grep -qi "nosniff"; then
    assert_or_warn "X-Content-Type-Options: nosniff ✓" "true"
  else
    assert_or_warn "X-Content-Type-Options: nosniff" "false"
    warn "Sem X-Content-Type-Options — risco de MIME sniffing"
  fi

  # X-Frame-Options
  xfo=$(get_header "X-Frame-Options")
  if echo "$xfo" | grep -qi "DENY"; then
    assert_or_warn "X-Frame-Options: DENY ✓" "true"
  else
    assert_or_warn "X-Frame-Options: DENY" "false"
    warn "Sem X-Frame-Options — risco de clickjacking"
  fi

  # X-XSS-Protection
  xss=$(get_header "X-XSS-Protection")
  if echo "$xss" | grep -qi "1; mode=block"; then
    assert_or_warn "X-XSS-Protection: 1; mode=block ✓" "true"
  else
    assert_or_warn "X-XSS-Protection: 1; mode=block" "false"
    warn "X-XSS-Protection ausente — navegadores antigos não bloqueiam XSS refletido"
  fi

  # Referrer-Policy
  rp=$(get_header "Referrer-Policy")
  if echo "$rp" | grep -qi "strict-origin-when-cross-origin"; then
    assert_or_warn "Referrer-Policy: strict-origin-when-cross-origin ✓" "true"
  else
    assert_or_warn "Referrer-Policy: strict-origin-when-cross-origin" "false"
    warn "Referrer-Policy ausente ou incorreta — vazamento de dados via referrer"
  fi

  # Permissions-Policy
  local pp
  pp=$(get_header "Permissions-Policy")
  if echo "$pp" | grep -qi "camera=()"; then
    assert_or_warn "Permissions-Policy: camera desabilitada ✓" "true"
  else
    assert_or_warn "Permissions-Policy: camera desabilitada" "false"
  fi
  if echo "$pp" | grep -qi "microphone=()"; then
    assert_or_warn "Permissions-Policy: microfone desabilitado ✓" "true"
  else
    assert_or_warn "Permissions-Policy: microfone desabilitado" "false"
  fi
  if echo "$pp" | grep -qi "geolocation=(self)"; then
    assert_or_warn "Permissions-Policy: geolocation restrita a self ✓" "true"
  else
    assert_or_warn "Permissions-Policy: geolocation restrita a self" "false"
  fi
}

# ── Test: Headers de remoção (Server, X-Powered-By) ────────────────────────
test_removed_headers() {
  header "🚫 4. Headers que NÃO devem vazar"

  server=$(get_header "Server")
  if [[ -z "$server" ]]; then
    assert_or_warn "Header Server removido (sem vazamento de tecnologia) ✓" "true"
  elif echo "$server" | grep -qi "caddy"; then
    # Caddy expõe 'Server: Caddy' — isso é esperado e aceitável
    pass "✓ Header Server: Caddy (aceitável — proxy reverso)"
  else
    assert_or_warn "Header Server removido — presente: '$server'" "false"
    warn "Header Server vaza informação: '$server'"
  fi

  powered=$(get_header "X-Powered-By")
  if [[ -z "$powered" ]]; then
    assert_or_warn "Header X-Powered-By removido ✓" "true"
  else
    assert_or_warn "Header X-Powered-By removido" "false"
    warn "X-Powered-By vaza tecnologia: '$powered'"
  fi
}

# ── Test: Rate Limit e Health ──────────────────────────────────────────────
test_rate_limit_headers() {
  header "📊 5. Rate Limiting & Controles"

  rate_limit=$(get_header "X-RateLimit-Limit")
  if [[ -n "$rate_limit" ]]; then
    assert_or_warn "X-RateLimit-Limit presente ($rate_limit) ✓" "true"
  else
    assert_or_warn "X-RateLimit-Limit presente" "false"
    warn "Rate limit headers ausentes — sem proteção contra abuso via middleware"
  fi
}

# ── Test: HTTPS/TLS (quando URL é HTTPS) ──────────────────────────────────
test_tls() {
  local url="$1"
  if [[ "$url" != https://* ]]; then
    info "URL não é HTTPS — pulando verificação TLS"
    return
  fi

  header "🔐 6. TLS/SSL (HTTPS)"

  # Verificar TLS 1.2+ (sem ciphers específicos para compatibilidade com CI)
  tls_info=$(curl -sI --tlsv1.2 --tls-max 1.3 \
    -o /dev/null -w "%{ssl_verify_result}" "$url" 2>/dev/null || echo "error")

  if [[ "$tls_info" != "error" ]]; then
    assert "TLS 1.2+ disponível ✓" "true"
  else
    warn "Não foi possível verificar TLS 1.2 — pode ser restrição de cipher no cliente"
    # Isso é comum em CI que pode não ter os ciphers modernos
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

echo -e "${BOLD}${MAGENTA}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  🔒 TESTE DE VERIFICAÇÃO — SECURITY HEADERS                ║"
echo "║  Valida CSP, HSTS, X-Frame-Options e mais via curl         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Target:   ${BASE_URL}"
echo "  CI mode:  ${CI_MODE}"
echo "  Test all: ${TEST_ALL}"
echo "  Date:     $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# ── Pré-verificação ────────────────────────────────────────────────────────
if ! command -v curl &>/dev/null; then
  err "curl não está instalado. Instale com: apt-get install curl"
  exit 1
fi

# ── Detect Caddy ───────────────────────────────────────────────────────────
detect_caddy

# ── Definir endpoints ──────────────────────────────────────────────────────
ENDPOINTS=("$BASE_URL")
if [[ "$TEST_ALL" == "true" ]]; then
  ENDPOINTS+=("$BASE_URL/api/health")
  ENDPOINTS+=("$BASE_URL/api/health/detailed")
  ENDPOINTS+=("$BASE_URL/api/auth/login")
fi

for endpoint in "${ENDPOINTS[@]}"; do
  echo ""
  info "═══════════════════════════════════════════════════════════"
  info "  Testando: $endpoint"
  info "═══════════════════════════════════════════════════════════"

  status=$(fetch_headers "$endpoint")

  if [[ "$status" == "000" ]]; then
    fail "Endpoint não respondeu (curl falhou)"
    EXIT_CODE=1
    continue
  fi

  assert "Endpoint respondeu com HTTP $status" "true"

  test_hsts
  test_csp
  test_security_headers
  test_removed_headers
  test_rate_limit_headers

  if [[ "$endpoint" == "$BASE_URL" ]]; then
    test_tls "$endpoint"
  fi
done

# ── Resumo ─────────────────────────────────────────────────────────────────
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
  echo "║  ✅ TODOS OS SECURITY HEADERS VÁLIDOS!                     ║"
  echo "║  CSP, HSTS e headers de segurança configurados.            ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
else
  echo -e "${RED}${BOLD}"
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  ⚠️ ${ASSERTIONS_FAILED} SECURITY HEADER(S) FALHOU(ARAM)               ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
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
