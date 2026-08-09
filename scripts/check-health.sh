#!/bin/bash
# ============================================================================
# Severinno Marketplace - Health Check & Pre-flight Diagnostic
# ============================================================================
# Verifica TUDO antes de tentar rodar o app. Detecta os problemas ANTES
# deles quebrarem o build. Rode antes de qualquer outro comando:
#
#   ./scripts/check-health.sh           # Verificacao completa
#   ./scripts/check-health.sh --quick   # So o essencial
#   ./scripts/check-health.sh --fix     # Tenta corrigir problemas detectados
#   ./scripts/check-health.sh --watch   # Monitora em loop (a cada 30s)
# ============================================================================

set -euo pipefail

# -- Colors ----------------------------------------------------------------
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    RED=$(tput setaf 1); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
    CYAN=$(tput setaf 6); WHITE=$(tput setaf 7); GRAY=$(tput setaf 8 2>/dev/null || echo "$(tput setaf 7)")
    BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
else
    RED=""; GREEN=""; YELLOW=""; CYAN=""; WHITE=""; GRAY=""; BOLD=""; DIM=""; RESET=""
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

MODE="full"
AUTO_FIX=false
WATCH=false
for arg in "$@"; do
    case "$arg" in
        --quick) MODE="quick" ;;
        --fix) AUTO_FIX=true ;;
        --watch) WATCH=true ;;
    esac
done

PASS=0; FAIL=0; WARN=0
CRITICAL_FAIL=false
declare -a ERRORS

pass() { echo "  ${GREEN}[PASS]${RESET} $1"; PASS=$((PASS + 1)); }
fail() { echo "  ${RED}[FAIL]${RESET} $1"; FAIL=$((FAIL + 1)); ERRORS+=("$1"); }
warn() { echo "  ${YELLOW}[WARN]${RESET} $1"; WARN=$((WARN + 1)); }
detail() { echo "         ${DIM}$1${RESET}"; }
step() { echo ""; echo "${GRAY}======================================${RESET}"; echo "  ${CYAN}$1${RESET}"; echo "${GRAY}======================================${RESET}"; }

port_in_use() {
    local port=$1
    if command -v ss >/dev/null 2>&1; then
        ss -tlnp "sport = :$port" 2>/dev/null | grep -qE "pid=[0-9]+" && return 0
    elif command -v lsof >/dev/null 2>&1; then
        lsof -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | grep -qv "com.docker" && return 0
    elif command -v netstat >/dev/null 2>&1; then
        netstat -ano 2>/dev/null | grep ":${port}" | grep -qi "LISTEN" && return 0
    fi
    return 1
}

pid_on_port() {
    local port=$1 pid=""
    if command -v ss >/dev/null 2>&1; then
        pid=$(ss -tlnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1)
    elif command -v lsof >/dev/null 2>&1; then
        pid=$(lsof -iTCP:"$port" -sTCP:LISTEN -Fp 2>/dev/null | sed 's/^p//' | head -1)
    elif command -v netstat >/dev/null 2>&1; then
        pid=$(netstat -ano 2>/dev/null | grep ":${port}" | grep "LISTEN" | awk '{print $NF}' | head -1)
    fi
    echo "$pid"
}

# Detect Python (python3 on Linux/Mac, python on Windows)
find_python() {
    if command -v python3 >/dev/null 2>&1; then
        echo "python3"
    elif command -v python >/dev/null 2>&1; then
        echo "python"
    else
        echo ""
    fi
}

# Temp directory for script artifacts (avoids /tmp/ issues on Windows)
TEMP_DIR="$PROJECT_DIR/.tmp"
mkdir -p "$TEMP_DIR" 2>/dev/null || true

run_health_check() {
    PASS=0; FAIL=0; WARN=0; CRITICAL_FAIL=false; ERRORS=()

    echo "${CYAN}${BOLD}+==========================================+${RESET}"
    echo "${CYAN}${BOLD}|  Severinno Health Check v1.0             |${RESET}"
    echo "${CYAN}${BOLD}+==========================================+${RESET}"
    echo "${GRAY}$(date '+%Y-%m-%d %H:%M:%S') - Modo: $MODE${RESET}"
    echo ""

    # =======================================================================
    # 1. PRE-REQUISITOS
    # =======================================================================
    step "1. Pre-requisitos"

    # Bun
    if command -v bun >/dev/null 2>&1; then
        pass "Bun $(bun --version 2>/dev/null)"
    else
        fail "Bun nao instalado"
    fi

    # Node modules
    if [ -d "node_modules" ]; then
        # Check using bun which handles pnpm hoisting correctly
        if bun run next --version 2>/dev/null | grep -qE "^Next\.js"; then
            pass "node_modules: Next.js $(bun run next --version 2>/dev/null | head -1)"
        elif [ -f "node_modules/next/package.json" ]; then
            pass "node_modules: Next.js encontrado"
        elif [ -d "node_modules/.pnpm" ] && ls node_modules/.pnpm/next* 2>/dev/null | head -1 | grep -q "next"; then
            pass "node_modules: Next.js (pnpm hoisted)"
        else
            warn "node_modules: estrutura incompleta"
            detail "Tentando verificar com 'bun why next'..."
            if $AUTO_FIX; then
                detail "Instalando dependencias..."
                bun install 2>&1 | tail -3
                pass "Dependencias reinstaladas"
            fi
        fi
    else
        fail "node_modules nao existe"
        if $AUTO_FIX; then
            detail "Instalando dependencias..."
            bun install 2>&1 | tail -3
            pass "Dependencias instaladas"
        fi
    fi

    # Docker
    if command -v docker >/dev/null 2>&1; then
        if docker info >/dev/null 2>&1; then
            pass "Docker Desktop rodando"
        else
            fail "Docker Desktop nao esta rodando"
            CRITICAL_FAIL=true
        fi
    else
        fail "Docker nao instalado"
        CRITICAL_FAIL=true
    fi

    # Docker Compose
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        pass "Docker Compose disponivel"
    else
        fail "Docker Compose nao disponivel"
        CRITICAL_FAIL=true
    fi

    # =======================================================================
    # 2. ARQUIVO .env
    # =======================================================================
    step "2. Variaveis de ambiente"

    if [ -f ".env" ]; then
        pass ".env existe"

        # Verificar variaveis obrigatorias
        local missing_vars=""
        for var in DATABASE_URL SESSION_SECRET; do
            if grep -q "^${var}=" .env 2>/dev/null; then
                : # ok
            else
                missing_vars="$missing_vars $var"
            fi
        done

        if [ -n "$missing_vars" ]; then
            fail "Variaveis obrigatorias ausentes no .env:$missing_vars"
            if $AUTO_FIX; then
                detail "Execute: ./scripts/setup.sh para recriar o .env"
            fi
        else
            pass "Variaveis obrigatorias: OK"
        fi

        # Verificar SESSION_SECRET length
        local secret
        secret=$(grep "^SESSION_SECRET=" .env 2>/dev/null | cut -d'=' -f2)
        if [ ${#secret} -lt 32 ] 2>/dev/null; then
            warn "SESSION_SECRET muito curta (< 32 caracteres)"
        fi
    else
        fail ".env nao existe"
        CRITICAL_FAIL=true
        if $AUTO_FIX; then
            detail "Execute: ./scripts/setup.sh para criar automaticamente"
        fi
    fi

    # =======================================================================
    # 3. PORTAS
    # =======================================================================
    step "3. Portas"

    for entry in "5432:PostgreSQL" "6379:Redis" "6380:Redis(dev)" "3000:Next.js" "5672:RabbitMQ" "9000:MinIO" "9001:MinIO Console"; do
        local port="${entry%%:*}"
        local svc="${entry#*:}"

        if port_in_use "$port"; then
            # Try to identify the process
            local pid proc_name
            pid=$(pid_on_port "$port" 2>/dev/null || echo "")
            proc_name=""
            if [ -n "$pid" ]; then
                proc_name=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
            fi
            pass "Porta $port ($svc): ocupada por $proc_name"
        else
            warn "Porta $port ($svc): ninguem ouvindo"
        fi
    done

    # =======================================================================
    # 4. CONTAINERS DOCKER
    # =======================================================================
    step "4. Containers Docker"

    local containers
    containers=$(docker ps --format '{{.Names}}||{{.Image}}||{{.Status}}' 2>/dev/null || true)

    if [ -z "$containers" ]; then
        fail "Nenhum container Docker rodando"
        CRITICAL_FAIL=true
        if $AUTO_FIX; then
            detail "Execute: ./scripts/setup.sh para subir a infra"
        fi
    else
        local healthy=0 unhealthy=0 others=0
        while IFS='||' read -r name image status; do
            if echo "$status" | grep -qi "healthy"; then
                echo "     ${GREEN}$name${RESET}  [${status}]"
                healthy=$((healthy + 1))
            elif echo "$status" | grep -qi "unhealthy"; then
                echo "     ${RED}$name  [UNHEALTHY]${RESET}"
                unhealthy=$((unhealthy + 1))
            elif echo "$status" | grep -qiE "Exit|exited"; then
                echo "     ${RED}$name  [EXITED]${RESET}"
                unhealthy=$((unhealthy + 1))
            else
                echo "     $name  [$status]"
                others=$((others + 1))
            fi
        done <<< "$containers"

        pass "$healthy saudavel(is)"

        if [ "$unhealthy" -gt 0 ]; then
            fail "$unhealthy container(s) nao saudavel(is)"
        fi

        # Verificar containers essenciais
        for required in postgres postgis; do
            if echo "$containers" | grep -qi "$required"; then
                pass "Container $required: presente"
                break
            fi
        done || {
            fail "Nenhum container PostgreSQL/PostGIS rodando"
            CRITICAL_FAIL=true
        }

        for required in redis; do
            if echo "$containers" | grep -qi "redis\|valkey"; then
                pass "Container Redis/Valkey: presente"
                break
            fi
        done || {
            fail "Nenhum container Redis rodando"
        }

        # Verificar se tem PostGIS (nao so PostgreSQL vanilla)
        if echo "$containers" | grep -qi "postgis"; then
            pass "PostGIS detectado"
        fi
    fi

    # =======================================================================
    # 5. ENCODING UTF-8
    # =======================================================================
    step "5. Encoding UTF-8"

    PYTHON=$(find_python)
    if [ -n "$PYTHON" ]; then
        local utf8_result
        utf8_result=$("$PYTHON" -c "
import os
bad = []
for root, dirs, files in os.walk('src'):
    for f in files:
        if not f.endswith(('.ts', '.tsx')):
            continue
        path = os.path.join(root, f)
        try:
            with open(path, 'rb') as fh:
                raw = fh.read()
            raw.decode('utf-8')
        except UnicodeDecodeError as e:
            bad.append((path, str(e)))
if bad:
    for p, e in bad:
        print(f'{p}: {e}')
else:
    print('OK')
" 2>&1) || true

        if echo "$utf8_result" | grep -q "^OK$"; then
            pass "Encoding UTF-8: todos os source files validos"
        else
            local count
            count=$(echo "$utf8_result" | grep -c "prisma/schema\|src/" 2>/dev/null || echo "1")
            fail "$count arquivo(s) com encoding corrompido!"
            echo "$utf8_result" | head -5 | while IFS= read -r line; do
                detail "$line"
            done
            if $AUTO_FIX; then
                detail "Corrigindo arquivos corrompidos..."
                echo "$utf8_result" | while IFS=':' read -r file rest; do
                    [ -z "$file" ] && continue
                    "$PYTHON" -c "
import sys
with open('$file', 'rb') as f:
    data = bytearray(f.read())
fixed = bytearray()
i = 0
while i < len(data):
    byte = data[i]
    if byte < 0x80:
        fixed.append(byte)
        i += 1
    elif 0xC2 <= byte <= 0xDF:
        if i + 1 < len(data) and 0x80 <= data[i+1] <= 0xBF:
            fixed.extend(data[i:i+2]); i += 2
        else:
            fixed.append(ord('-')); i += 1
    elif 0xE0 <= byte <= 0xEF:
        if i + 2 < len(data) and 0x80 <= data[i+1] <= 0xBF and 0x80 <= data[i+2] <= 0xBF:
            fixed.extend(data[i:i+3]); i += 3
        else:
            fixed.append(ord('-')); i += 1
    else:
        fixed.append(ord('-')); i += 1
with open('$file', 'wb') as f:
    f.write(bytes(fixed))
" 2>/dev/null || true
                done
                pass "UTF-8: correcao automatica aplicada"
            fi
        fi
    else
        warn "Python nao disponivel - verificacao UTF-8 pulada"
    fi

    # =======================================================================
    # 6. CONEXAO COM BANCO DE DADOS
    # =======================================================================
    step "6. Conexao com banco de dados"

    # Tenta via container Docker
    local pg_container
    pg_container=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE "postgis|postgres" | head -1 || true)

    if [ -n "$pg_container" ]; then
        if docker exec "$pg_container" pg_isready -U "${POSTGRES_USER:-severinno}" -d "${POSTGRES_DB:-severinno}" 2>/dev/null | grep -q "accepting"; then
            pass "PostgreSQL aceitando conexoes"
            
            # Verificar extensao PostGIS
            if docker exec "$pg_container" psql -U "${POSTGRES_USER:-severinno}" -d "${POSTGRES_DB:-severinno}" -Atc "SELECT PostGIS_Version()" 2>/dev/null | grep -qE "^[0-9]"; then
                pass "Extensao PostGIS ativa"
            else
                warn "PostGIS nao esta habilitado - migrations geoespaciais falharao"
                if $AUTO_FIX; then
                    docker exec "$pg_container" psql -U "${POSTGRES_USER:-severinno}" -d "${POSTGRES_DB:-severinno}" -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || true
                    pass "PostGIS habilitado"
                fi
            fi

            # Verificar tabelas
            local table_count
            table_count=$(docker exec "$pg_container" psql -U "${POSTGRES_USER:-severinno}" -d "${POSTGRES_DB:-severinno}" -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "0")
            if [ "$table_count" -gt 0 ] 2>/dev/null; then
                pass "Banco populado: $table_count tabelas"
            else
                warn "Nenhuma tabela encontrada - execute: bun run db:seed"
            fi
        else
            fail "PostgreSQL nao esta aceitando conexoes"
        fi
    else
        fail "Container PostgreSQL nao encontrado"
    fi

    # =======================================================================
    # 7. CONEXAO REDIS
    # =======================================================================
    step "7. Conexao Redis"

    local redis_container
    redis_container=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE "redis|valkey" | head -1 || true)

    if [ -n "$redis_container" ]; then
        local redis_cmd="redis-cli"
        # Check if it's valkey
        if echo "$redis_container" | grep -qi "valkey"; then
            redis_cmd="valkey-cli"
        fi

        if docker exec "$redis_container" $redis_cmd ping 2>/dev/null | grep -q "PONG"; then
            pass "Redis/Valkey: PONG"
        else
            warn "Redis: ping falhou"
        fi
    else
        warn "Container Redis nao encontrado"
    fi

    # =======================================================================
    # 8. API HEALTH ENDPOINT
    # =======================================================================
    step "8. API Health"

    if command -v curl >/dev/null 2>&1; then
        if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://localhost:3000 2>/dev/null | grep -q "200"; then
            pass "Next.js respondendo em http://localhost:3000"

            # Health endpoint especifico
            local health_resp
            health_resp=$(curl -s --connect-timeout 5 http://localhost:3000/api/health 2>/dev/null || true)
            if [ -n "$health_resp" ]; then
                local truncated
                truncated=$(echo "$health_resp" | tr -d '\n' | cut -c1-120)
                detail "$truncated"
                pass "/api/health respondeu"
            else
                warn "/api/health nao respondeu"
            fi
        else
            warn "Next.js nao esta rodando em http://localhost:3000"
        fi
    else
        warn "curl nao disponivel - health check HTTP pulado"
    fi

    # =======================================================================
    # SUMMARY
    # =======================================================================
    step "Resumo Final"

    local TOTAL=$((PASS + FAIL + WARN))
    echo ""
    echo "  ${WHITE}PASS: ${GREEN}$PASS${WHITE}   FAIL: ${RED}$FAIL${WHITE}   WARN: ${YELLOW}$WARN${WHITE}   Total: $TOTAL${RESET}"
    echo ""

    if [ "$FAIL" -eq 0 ] && [ "$WARN" -eq 0 ]; then
        echo "  ${GREEN}${BOLD}[OK] Sistema 100% saudavel!${RESET}"
    elif [ "$FAIL" -eq 0 ]; then
        echo "  ${YELLOW}[!]  Sistema saudavel com ressalvas${RESET}"
    elif $CRITICAL_FAIL; then
        echo "  ${RED}[FAIL] Problemas criticos detectados - corrija antes de rodar o app${RESET}"
        echo "  ${RED}   Execute: ./scripts/setup.sh${RESET}"
    else
        echo "  ${RED}[!]  Problemas detectados (nao criticos)${RESET}"
    fi
    echo ""
}

# -- Main ------------------------------------------------------------------

if $WATCH; then
    # Modo watch: executa a cada 30s
    detail "Modo watch - verificando a cada 30 segundos..."
    detail "Pressione Ctrl+C para sair"
    echo ""
    while true; do
        run_health_check
        echo "${DIM}--------------------------------------${RESET}"
        echo "${DIM}Proxima verificacao em 30s... Ctrl+C para sair${RESET}"
        echo ""
        sleep 30
    done
else
    run_health_check

    # Exit code based on critical failures
    if $CRITICAL_FAIL; then
        exit 1
    fi
    exit 0
fi
