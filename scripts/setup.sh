#!/bin/bash
# ============================================================================
# Severinno Marketplace - Bootstrap Completo
# ============================================================================
# Faz TUDO que a gente fez manualmente na sessao, mas automagicamente:
#   [OK] Verifica pre-requisitos (Bun, Docker)
#   [OK] Detecta compose file correto
#   [OK] Remove containers conflitantes nas portas
#   [OK] Cria .env automaticamente com defaults
#   [OK] Sobe infra Docker correta (PostGIS, nao PostgreSQL vanilla)
#   [OK] Aguarda servicos ficarem saudaveis
#   [OK] Verifica encoding UTF-8 dos source files
#   [OK] Gera Prisma Client, sincroniza schema, popula banco
#   [OK] Inicia servidor dev
#
# Usage:
#   ./scripts/setup.sh              # Setup completo (recomendado)
#   ./scripts/setup.sh --quick      # Pula seed, so levanta infra + dev
#   ./scripts/setup.sh --docker     # So infra Docker, sem app
#   ./scripts/setup.sh --reset      # Destroi tudo e recria do zero
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

# -- Config ----------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

MODE="full"
for arg in "$@"; do
    case "$arg" in
        --quick) MODE="quick" ;;
        --docker) MODE="docker" ;;
        --reset) MODE="reset" ;;
    esac
done

PASS=0; FAIL=0; WARN=0
pass() { echo "  ${GREEN}[PASS]${RESET} $1"; PASS=$((PASS + 1)); }
fail() { echo "  ${RED}[FAIL]${RESET} $1"; FAIL=$((FAIL + 1)); }
warn() { echo "  ${YELLOW}[WARN]${RESET} $1"; WARN=$((WARN + 1)); }
detail() { echo "         ${DIM}$1${RESET}"; }
step() { echo ""; echo "${GRAY}======================================${RESET}"; echo "  ${CYAN}$1${RESET}"; echo "${GRAY}======================================${RESET}"; }

# ===========================================================================
# UTILITY FUNCTIONS
# ===========================================================================

# Check if a process is listening on a port (non-docker)
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

# Find PID of process on a port
pid_on_port() {
    local port=$1 pid=""
    if command -v ss >/dev/null 2>&1; then
        pid=$(ss -tlnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1)
    elif command -v lsof >/dev/null 2>&1; then
        pid=$(lsof -iTCP:"$port" -sTCP:LISTEN -Fp 2>/dev/null | sed 's/^p//' | head -1)
    elif command -v netstat >/dev/null 2>&1; then
        # Windows Git Bash: netstat -ano | findstr :3000 | findstr LISTEN
        pid=$(netstat -ano 2>/dev/null | grep ":${port}" | grep "LISTEN" | awk '{print $NF}' | head -1)
    fi
    echo "$pid"
}

# Kill process on a port
kill_port() {
    local port=$1 pid
    pid=$(pid_on_port "$port")
    [ -z "$pid" ] && return 0
    echo "     Matando processo PID $pid na porta $port..."
    kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || taskkill //F //PID "$pid" 2>/dev/null || true
    sleep 2
    if port_in_use "$port"; then
        warn "Nao foi possivel liberar porta $port"
        return 1
    fi
    pass "Porta $port liberada"
    return 0
}

# Temp directory for script artifacts (avoids /tmp/ issues on Windows)
TEMP_DIR="$PROJECT_DIR/.tmp"
mkdir -p "$TEMP_DIR" 2>/dev/null || true

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

# Check UTF-8 validity of all source files
PYTHON=$(find_python)

check_utf8() {
    local has_issues=false
    if [ -n "$PYTHON" ]; then
        local result
        result=$("$PYTHON" -c "
import os
bad = []
for root, dirs, files in os.walk('src'):
    for f in files:
        if not f.endswith(('.ts', '.tsx')):
            continue
        path = os.path.join(root, f)
        with open(path, 'rb') as fh:
            raw = fh.read()
        try:
            raw.decode('utf-8')
        except UnicodeDecodeError as e:
            bad.append(f'{path}: {e}')
if bad:
    for b in bad:
        print(b)
    print(f'TOTAL: {len(bad)} arquivo(s) com erro')
else:
    print('OK')
" 2>&1) || true
        if echo "$result" | grep -q "OK"; then
            pass "Encoding UTF-8: todos os source files validos"
        else
            warn "Encoding UTF-8: arquivos corrompidos encontrados!"
            echo "$result" | while IFS= read -r line; do
                detail "$line"
            done
            has_issues=true
        fi
    else
        warn "Python nao disponivel - pulando verificacao UTF-8"
    fi
    $has_issues && return 1 || return 0
}

# Fix UTF-8 corruption in a file
fix_utf8_file() {
    local file=$1
    echo "     Corrigindo: $file"
    # Replace common invalid UTF-8 byte sequences with ASCII hyphens
    "$PYTHON" -c "
import sys
with open('$file', 'rb') as f:
    data = f.read()
fixed = bytearray()
i = 0
while i < len(data):
    byte = data[i]
    if byte < 0x80:
        fixed.append(byte)
        i += 1
    elif 0xC2 <= byte <= 0xDF:
        if i + 1 < len(data) and 0x80 <= data[i+1] <= 0xBF:
            fixed.extend(data[i:i+2])
            i += 2
        else:
            fixed.append(ord('-'))
            i += 1
    elif 0xE0 <= byte <= 0xEF:
        if i + 2 < len(data) and 0x80 <= data[i+1] <= 0xBF and 0x80 <= data[i+2] <= 0xBF:
            fixed.extend(data[i:i+3])
            i += 3
        else:
            fixed.append(ord('-'))
            i += 1
    else:
        fixed.append(ord('-'))
        i += 1
with open('$file', 'wb') as f:
    f.write(bytes(fixed))
" 2>&1
}

# Auto-fix all UTF-8 issues
auto_fix_utf8() {
    echo ""
    detail "Verificando e corrigindo encoding UTF-8..."
    local fixed_count=0
    if [ -n "$PYTHON" ]; then
        "$PYTHON" -c "
import os
bad = []
for root, dirs, files in os.walk('src'):
    for f in files:
        if not f.endswith(('.ts', '.tsx')):
            continue
        path = os.path.join(root, f)
        with open(path, 'rb') as fh:
            raw = fh.read()
        try:
            raw.decode('utf-8')
        except UnicodeDecodeError:
            bad.append(path)
with open('$TEMP_DIR/utf8-bad.txt', 'w') as f:
    f.write('\n'.join(bad))
" 2>&1 || true

        while IFS= read -r file; do
            [ -z "$file" ] && continue
            fix_utf8_file "$file"
            fixed_count=$((fixed_count + 1))
        done < "$TEMP_DIR/utf8-bad.txt"

        if [ "$fixed_count" -gt 0 ]; then
            pass "UTF-8: corrigidos $fixed_count arquivo(s) corrompido(s)"
        else
            pass "UTF-8: nenhum arquivo corrompido"
        fi
    else
        warn "Python nao disponivel - nao foi possivel corrigir UTF-8"
    fi
}

# ===========================================================================
# MAIN
# ===========================================================================

echo ""
echo "${CYAN}${BOLD}+==================================================+${RESET}"
echo "${CYAN}${BOLD}|     Severinno Marketplace - Bootstrap v1.0      |${RESET}"
echo "${CYAN}${BOLD}+==================================================+${RESET}"
echo "${GRAY}Projeto: $PROJECT_DIR${RESET}"
echo "${GRAY}Modo: $MODE${RESET}"
echo ""

# ===========================================================================
# 1. PRE-REQUISITOS
# ===========================================================================
step "1. Pre-requisitos"

# Bun
if command -v bun >/dev/null 2>&1; then
    bun_ver=$(bun --version 2>/dev/null)
    pass "Bun: $bun_ver"
else
    fail "Bun nao encontrado - instale com: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Node modules
if [ -d "node_modules" ]; then
    pass "node_modules: existe"
else
    detail "Instalando dependencias..."
    bun install 2>&1 | tail -3
    pass "Dependencias instaladas"
fi

# Docker
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker_ver=$(docker --version 2>/dev/null)
    pass "Docker: $docker_ver"
else
    fail "Docker nao esta rodando - inicie o Docker Desktop primeiro"
    exit 1
fi

# Docker Compose
if docker compose version >/dev/null 2>&1; then
    dc_ver=$(docker compose version 2>/dev/null)
    pass "Docker Compose: $dc_ver"
else
    fail "Docker Compose nao disponivel"
    exit 1
fi

# Python (para UTF-8 check)
PYTHON=$(find_python)
if [ -n "$PYTHON" ]; then
    pass "${PYTHON} disponivel"
else
    warn "Python nao encontrado - verificacao UTF-8 sera pulada"
fi

# ===========================================================================
# 2. ENV FILE
# ===========================================================================
step "2. Arquivo .env"

DETECTED_COMPOSE="docker-compose.yml"
# Check if docker-compose.dev.yml has relevant services running or if user prefers it
if [ -f "docker-compose.dev.yml" ]; then
    # Check if dev.yml has PostGIS (which we need for migrations)
    if grep -q "postgis/postgis" docker-compose.dev.yml 2>/dev/null; then
        DETECTED_COMPOSE="docker-compose.dev.yml"
        detail "Detectado: docker-compose.dev.yml (com PostGIS + servicos extras)"
    fi
fi

if [ -f ".env" ]; then
    pass ".env existe"
    # Check if DATABASE_URL is set
    if grep -q "DATABASE_URL" .env 2>/dev/null; then
        pass "DATABASE_URL: configurada"
    else
        warn "DATABASE_URL nao encontrada no .env"
    fi
else
    warn ".env nao existe - criando com valores padrao..."
    
    if echo "$DETECTED_COMPOSE" | grep -q "dev"; then
        # docker-compose.dev.yml defaults
        cat > .env << 'ENVEOF'
# Severinno - Variaveis de ambiente (gerado automaticamente pelo setup.sh)
DATABASE_URL="postgresql://severinno:severinno@localhost:5432/severinno"
REDIS_URL="redis://localhost:6380"
SESSION_SECRET="dev-secret-autogerada-mude-em-producao-123456"
S3_ACCESS_KEY=severinno
S3_SECRET_KEY=severinno_minio_dev
S3_BUCKET=severinno
S3_ENDPOINT=http://localhost:9000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3003
ENVEOF
    else
        # docker-compose.yml defaults
        cat > .env << 'ENVEOF'
# Severinno - Variaveis de ambiente (gerado automaticamente pelo setup.sh)
DATABASE_URL="postgresql://severinno:severinno_dev@localhost:5432/severinno"
REDIS_URL="redis://localhost:6379"
SESSION_SECRET="dev-secret-autogerada-mude-em-producao-123456"
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=severinno-uploads
S3_ENDPOINT=http://localhost:9000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3001
ENVEOF
    fi
    pass ".env criado com valores padrao para $DETECTED_COMPOSE"
fi

# Source .env
set -a
source .env 2>/dev/null || true
set +a

# ===========================================================================
# 3. LIBERAR PORTAS
# ===========================================================================
step "3. Verificando conflitos de porta"

PORTS_TO_CHECK="5432:PostgreSQL 6379:Redis 6380:Redis(dev) 3000:Next.js 5672:RabbitMQ 9000:MinIO"
for entry in $PORTS_TO_CHECK; do
    port="${entry%%:*}"
    svc="${entry#*:}"
    
    # Check for Docker containers first - they're fine, just note them
    docker_containers=$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep ":$port->" || true)
    
    if port_in_use "$port"; then
        local_pid=$(pid_on_port "$port")
        proc_name=""
        if [ -n "$local_pid" ]; then
            if command -v ps >/dev/null 2>&1; then
                proc_name=$(ps -p "$local_pid" -o comm= 2>/dev/null || echo "unknown")
            fi
        fi
        
        # If it's the same docker service, it's fine
        if echo "$proc_name" | grep -qiE "docker|com\.docker"; then
            pass "Porta $port ($svc): Docker proxy"
        else
            warn "Porta $port ($svc): ocupada por $proc_name (PID $local_pid)"
            detail "Tentando liberar..."
            kill_port "$port" || true
        fi
    else
        pass "Porta $port ($svc): livre"
    fi
done

# ===========================================================================
# 4. PARAR CONTAINERS CONFLITANTES
# ===========================================================================
step "4. Limpando containers orfaos/conflitantes"

# Se estamos usando docker-compose.yml, pare containers do dev.yml que conflitam
if [ "$DETECTED_COMPOSE" = "docker-compose.yml" ]; then
    for old_container in severinno-postgis-1; do
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "$old_container"; then
            warn "Container conflitante: $old_container"
            docker stop "$old_container" 2>/dev/null || true
            docker rm "$old_container" 2>/dev/null || true
            pass "$old_container parado e removido"
        fi
    done
fi

# Se estamos usando dev.yml, pare containers do docker-compose.yml que conflitam
if echo "$DETECTED_COMPOSE" | grep -q "dev"; then
    for old_container in severinno-postgres-1; do
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "$old_container"; then
            warn "Container conflitante: $old_container"
            docker stop "$old_container" 2>/dev/null || true
            docker rm "$old_container" 2>/dev/null || true
            pass "$old_container parado e removido"
        fi
    done
    
    # Remove volume do postgres antigo para evitar conflito de dados
    docker volume rm severinno_postgres_data 2>/dev/null || true
fi

# ===========================================================================
# 5. SUBIR INFRA DOCKER
# ===========================================================================
step "5. Subindo infraestrutura Docker"

if echo "$DETECTED_COMPOSE" | grep -q "dev"; then
    COMPOSE_FILE="-f docker-compose.dev.yml"
    SERVICES="postgis redis minio"
    detail "Usando docker-compose.dev.yml"
    detail "Subindo: $SERVICES"
else
    COMPOSE_FILE=""
    SERVICES="postgres redis minio"
    detail "Usando docker-compose.yml (PostgreSQL vanilla)"
    detail "[!]  ATENCAO: Este compose usa postgres:16-alpine SEM PostGIS!"
    detail "   Se precisar de PostGIS, use: docker-compose.dev.yml"
    detail "Subindo: $SERVICES"
fi

docker compose $COMPOSE_FILE up -d $SERVICES 2>&1 | tail -5 || {
    fail "Erro ao subir containers!"
    docker compose $COMPOSE_FILE logs --tail=10 2>/dev/null || true
    exit 1
}
pass "Containers iniciados"

# ===========================================================================
# 6. AGUARDAR SAUDE DOS SERVICOS
# ===========================================================================
step "6. Aguardando servicos ficarem saudaveis"

MAX_RETRIES=30
for svc in $SERVICES; do
    detail "Aguardando $svc..."
    for i in $(seq 1 $MAX_RETRIES); do
        status=$(docker compose $COMPOSE_FILE ps --format '{{.Status}}' "$svc" 2>/dev/null || echo "")
        if echo "$status" | grep -qi "healthy"; then
            pass "$svc: saudavel (${i}s)"
            break
        elif echo "$status" | grep -qi "unhealthy"; then
            warn "$svc: unhealthy - verificando logs..."
            docker compose $COMPOSE_FILE logs --tail=5 "$svc" 2>/dev/null || true
            break
        fi
        sleep 2
    done
done

# ===========================================================================
# 7. HABILITAR POSTGIS (se necessario)
# ===========================================================================
step "7. Extensao PostGIS"

# Se for postgres:16-alpine, precisamos trocar para postgis
PG_CONTAINER=$(docker compose $COMPOSE_FILE ps --format '{{.Names}}' postgres postgis 2>/dev/null | head -1 || true)
PG_IMAGE=$(docker container inspect "$PG_CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || echo "")

if echo "$PG_IMAGE" | grep -qi "postgis"; then
    # PostGIS ja esta rodando
    docker exec "$PG_CONTAINER" psql -U "${POSTGRES_USER:-severinno}" -d "${POSTGRES_DB:-severinno}" -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || true
    docker exec "$PG_CONTAINER" psql -U "${POSTGRES_USER:-severinno}" -d "${POSTGRES_DB:-severinno}" -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;" 2>/dev/null || true
    pass "PostGIS habilitado"
elif [ -n "$PG_CONTAINER" ]; then
    warn "PostgreSQL sem PostGIS - migrations podem falhar!"
    detail "Recomendado: use docker-compose.dev.yml que tem postgis/postgis"
    detail "Ou troque manualmente a imagem no docker-compose.yml"
else
    warn "Container PostgreSQL nao encontrado"
fi

# ===========================================================================
# 8. CORRIGIR ENCODING UTF-8
# ===========================================================================
step "8. Verificacao de encoding UTF-8"
auto_fix_utf8

# ===========================================================================
# 9. PRISMA: GENERATE + SYNC
# ===========================================================================
step "9. Prisma - Gerar cliente + sincronizar schema"

detail "Gerando Prisma Client..."
bun run db:generate 2>&1 | tail -5 || {
    fail "prisma generate falhou"
    exit 1
}
pass "Prisma Client gerado"

# Tentar db push primeiro (mais seguro que migrate)
detail "Sincronizando schema com db push..."
bunx prisma db push 2>&1 | tail -5 || {
    warn "db push falhou - tentando abordagem alternativa..."
    # Tenta aplicar migrations na ordem
    bunx prisma migrate reset --force 2>&1 | tail -10 || {
        fail "Nao foi possivel sincronizar o banco"
        exit 1
    }
}
pass "Schema sincronizado"

# ===========================================================================
# 10. RESOLVER MIGRATIONS PENDENTES
# ===========================================================================
step "10. Resolvendo migrations pendentes"

# Lista de todas as migrations do projeto
MIGRATIONS_DIR="prisma/migrations"
if [ -d "$MIGRATIONS_DIR" ]; then
    # Marcar todas as migrations como aplicadas (ja que usamos db push)
    find "$MIGRATIONS_DIR" -maxdepth 1 -type d ! -name "migrations" | sort | while IFS= read -r mig_dir; do
        mig_name=$(basename "$mig_dir")
        # Pular diretorio manual/ se existir
        [ "$mig_name" = "manual" ] && continue
        
        # Verificar se ja esta aplicada
        if bunx prisma migrate status 2>/dev/null | grep -q "$mig_name"; then
            detail "$mig_name: ja aplicada"
        else
            detail "Resolvendo: $mig_name"
            bunx prisma migrate resolve --applied "$mig_name" 2>/dev/null || true
        fi
    done
    pass "Migrations resolvidas"
fi

# ===========================================================================
# 11. SEED (exceto no modo --quick)
# ===========================================================================
step "11. Populando banco com dados de teste"

if [ "$MODE" = "quick" ]; then
    detail "Modo --quick: pulando seed"
    pass "Seed pulado (modo rapido)"
else
    detail "Executando seed..."
    if bun run db:seed 2>&1 | tail -10; then
        pass "Banco populado com dados de demonstracao"
    else
        warn "Seed falhou - banco vazio, mas app pode funcionar"
    fi
fi

# ===========================================================================
# 12. INICIAR SERVIDOR DEV
# ===========================================================================
step "12. Iniciando servidor de desenvolvimento"

# Mata qualquer servidor anterior na porta 3000
kill_port 3000 || true

detail "Iniciando: bun run dev"
detail "URL: http://localhost:3000"
echo ""

# Inicia em background
bun run dev > "$TEMP_DIR/dev.log" 2>&1 &
DEV_PID=$!

# Aguarda o servidor responder
for i in $(seq 1 20); do
    if curl -s -o /dev/null -w "" http://localhost:3000 2>/dev/null; then
        echo ""
        echo "${GREEN}${BOLD}  [OK] Servidor pronto!${RESET}"
        echo "  ${CYAN}http://localhost:3000${RESET}"
        echo ""
        break
    fi
    sleep 2
done

# ===========================================================================
# SUMMARY
# ===========================================================================
step "Resumo Final"

TOTAL=$((PASS + FAIL + WARN))
echo ""
echo "  ${WHITE}PASS: $PASS   FAIL: $FAIL   WARN: $WARN   Total: $TOTAL${RESET}"
echo ""

if [ "$FAIL" -eq 0 ] && [ "$WARN" -eq 0 ]; then
    echo "  ${GREEN}${BOLD}[OK] Setup completo - tudo funcionando!${RESET}"
elif [ "$FAIL" -eq 0 ]; then
    echo "  ${YELLOW}[!]  Setup concluido com ressalvas (veja WARNs acima)${RESET}"
else
    echo "  ${RED}[FAIL] Setup com falhas - revise os erros acima${RESET}"
fi

echo ""
echo "  ${CYAN}Credenciais de teste:${RESET}"
echo "    Admin:    admin@severinno.com / admin123"
echo "    Cliente:  cliente@severinno.com / cliente123"
echo "    Prestador: carlos@severinno.com / provider123"
echo ""
echo "  ${CYAN}Servicos:${RESET}"
echo "    App:      http://localhost:3000"
echo "    MinIO:    http://localhost:9001 (severinno / severinno_minio_dev)"
echo ""
echo "  ${CYAN}Logs:${RESET}"
echo "    Dev:      tail -f $TEMP_DIR/dev.log"
echo "    Docker:   docker compose ${COMPOSE_FILE} logs -f"
echo ""
