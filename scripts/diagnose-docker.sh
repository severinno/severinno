#!/bin/bash
# ============================================================================
# Severinno Docker Infrastructure Diagnostic (Linux/Mac)
# ============================================================================
# Usage: ./scripts/diagnose-docker.sh [-v]
#   -v    Verbose mode (extra details)
#
# Equivalent to diagnose-docker.ps1 for Windows.
# Requires: docker, docker compose, curl, jq (recommended), ss or lsof
# ============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    RED=$(tput setaf 1)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    CYAN=$(tput setaf 6)
    WHITE=$(tput setaf 7)
    GRAY=$(tput setaf 8 2>/dev/null || echo "$(tput setaf 7)")
    DARK_GRAY=$(tput setaf 8 2>/dev/null || echo "$(tput setaf 0)")
    BOLD=$(tput bold)
    DIM=$(tput dim)
    RESET=$(tput sgr0)
else
    RED=""; GREEN=""; YELLOW=""; CYAN=""; WHITE=""
    GRAY=""; DARK_GRAY=""; BOLD=""; DIM=""; RESET=""
fi

# ── Globals ───────────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
VERBOSE=false
START_TIME=$(date +%s)

# ── Project root ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── Helpers ───────────────────────────────────────────────────────────────

log_step() {
    echo ""
    echo "${DARK_GRAY}==============================${RESET}"
    echo "  ${CYAN}$1${RESET}"
    echo "${DARK_GRAY}==============================${RESET}"
}

pass() { echo "  ${GREEN}[PASS]${RESET} $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "  ${RED}[FAIL]${RESET} $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
warn() { echo "  ${YELLOW}[WARN]${RESET} $1"; WARN_COUNT=$((WARN_COUNT + 1)); }
skip() { echo "  ${DIM}[SKIP]${RESET} $1"; }
detail() { echo "         ${DARK_GRAY}$1${RESET}"; }

info() {
    if [ "$VERBOSE" = true ]; then
        echo "  ${WHITE}[INFO]${RESET} $1"
    fi
}

# Cleanup trap
cleanup() {
    cd "$PROJECT_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# Get compose project name from running container
get_compose_project_name() {
    local cid
    cid=$(docker compose ps -q app 2>/dev/null | head -1)
    if [ -n "$cid" ]; then
        local name
        name=$(docker container inspect "$cid" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null)
        if [ -n "$name" ]; then
            echo "$name"
            return
        fi
    fi
    # Fallback: derive from directory name
    basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-zA-Z0-9_-]//g'
}

# Check if jq is available
has_jq() {
    command -v jq >/dev/null 2>&1
}

# ── Header ────────────────────────────────────────────────────────────────
echo "${CYAN}Severinno Docker Infrastructure Diagnostic${RESET}"
echo "${GRAY}Started: $(date '+%Y-%m-%d %H:%M:%S')${RESET}"
echo "${GRAY}Project: $PROJECT_DIR${RESET}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
#  Parse args
# ═══════════════════════════════════════════════════════════════════════════
while getopts "v" opt; do
    case $opt in
        v) VERBOSE=true ;;
        *) ;;
    esac
done

# ═══════════════════════════════════════════════════════════════════════════
#  1. Pre-requisites
# ═══════════════════════════════════════════════════════════════════════════
log_step "1. Pre-requisitos"

if command -v docker >/dev/null 2>&1; then
    docker_ver=$(docker --version 2>/dev/null)
    pass "Docker CLI: $docker_ver"
else
    fail "Docker CLI nao disponivel"
    exit 1
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    dc_ver=$(docker compose version 2>/dev/null)
    pass "Docker Compose: $dc_ver"
else
    fail "Docker Compose nao disponivel"
fi

if docker info >/dev/null 2>&1; then
    pass "Docker daemon: rodando"
else
    fail "Docker daemon nao esta rodando"
    exit 1
fi

if command -v curl >/dev/null 2>&1; then
    pass "curl disponivel"
else
    warn "curl nao encontrado (healthchecks serao pulados)"
fi

if has_jq; then
    pass "jq disponivel"
else
    warn "jq nao encontrado (usando grep para JSON, precisao limitada)"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  2. Port Conflicts
# ═══════════════════════════════════════════════════════════════════════════
log_step "2. Conflitos de porta no host"

# Detect port-checking tool
PORT_CHECK=""
if command -v ss >/dev/null 2>&1; then
    PORT_CHECK="ss"
elif command -v lsof >/dev/null 2>&1; then
    PORT_CHECK="lsof"
elif command -v netstat >/dev/null 2>&1; then
    PORT_CHECK="netstat"
else
    warn "Nenhuma ferramenta de rede encontrada (ss/lsof/netstat)"
fi

check_port() {
    local port=$1
    local service=$2
    local result=""

    case "$PORT_CHECK" in
        ss)
            result=$(ss -tlnp "sport = :$port" 2>/dev/null)
            ;;
        lsof)
            result=$(lsof -iTCP:"$port" -sTCP:LISTEN 2>/dev/null)
            ;;
        netstat)
            result=$(netstat -tlnp 2>/dev/null | grep ":$port ")
            ;;
    esac

    if [ -z "$result" ]; then
        warn "Porta $port ($service): ninguem ouvindo"
        return
    fi

    # Extract PIDs (different tools have different output formats)
    local pids=""
    case "$PORT_CHECK" in
        ss)
            # ss output: "users:(("process",pid=12345,fd=...))"
            pids=$(echo "$result" | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' 2>/dev/null || true)
            ;;
        lsof)
            # lsof output: "COMMAND PID ..." (PID in column 2) or use -Fp
            pids=$(lsof -iTCP:"$port" -sTCP:LISTEN -Fp 2>/dev/null | sed 's/^p//' || true)
            ;;
        netstat)
            # netstat output: "tcp 0 0 0.0.0.0:3003 0.0.0.0:* LISTEN 12345/node"
            pids=$(echo "$result" | sed -n 's/.*LISTEN[[:space:]]\+\([0-9]\+\)\/.*/\1/p' 2>/dev/null || true)
            ;;
    esac

    local non_docker=""
    for pid in $pids; do
        pid=$(echo "$pid" | tr -dc '0-9')
        [ -z "$pid" ] && continue
        local proc_name
        proc_name=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
        if ! grep -qiE 'docker|com\.docker' <<< "$proc_name"; then
            non_docker="$non_docker${proc_name} (PID $pid), "
        fi
    done

    if [ -n "$non_docker" ]; then
        warn "Porta $port ($service) ocupada por: ${non_docker%, }"
    else
        pass "Porta $port ($service): apenas Docker proxy"
    fi
}

for entry in "3000:Next.js App" "3003:Realtime (Socket.io)" \
             "5432:PostgreSQL" "6379:Redis" \
             "5672:RabbitMQ" "5000:OSRM (profile: routing)"; do
    port="${entry%%:*}"
    svc="${entry#*:}"
    check_port "$port" "$svc"
done

# ═══════════════════════════════════════════════════════════════════════════
#  3. Container Status
# ═══════════════════════════════════════════════════════════════════════════
log_step "3. Status dos Containers"

ps_output=$(docker compose ps --format '{{.Name}}||{{.Status}}||{{.Ports}}' 2>/dev/null || true)
if [ -z "$ps_output" ]; then
    warn "Nenhum container rodando. Execute 'docker compose up -d'."
else
    lines=$(echo "$ps_output" | grep -v '^$' | wc -l)
    pass "$lines container(s) encontrados"

    unhealthy=0
    exited=0
    while IFS='||' read -r name status ports; do
        name=$(echo "$name" | xargs)
        status=$(echo "$status" | xargs)
        ports=$(echo "$ports" | xargs)
        if grep -qi 'healthy' <<< "$status"; then
            echo "     ${GREEN}$name${RESET}  [${status}]"
            [ -n "$ports" ] && detail "Ports: $ports"
        elif grep -qi 'starting' <<< "$status"; then
            echo "     ${YELLOW}$name${RESET}  [${status}]"
        elif grep -qi 'unhealthy' <<< "$status"; then
            echo "     ${RED}$name  [UNHEALTHY]${RESET}"
            detail "$status"
            unhealthy=$((unhealthy + 1))
        elif grep -qiE 'Exit|exited' <<< "$status"; then
            echo "     ${RED}$name  [EXITED]${RESET}"
            exited=$((exited + 1))
        else
            echo "     $name  [$status]"
        fi
    done <<< "$ps_output"

    if [ "$unhealthy" -eq 0 ] && [ "$exited" -eq 0 ]; then
        pass "Todos saudaveis"
    else
        [ "$unhealthy" -gt 0 ] && fail "$unhealthy unhealthy"
        [ "$exited" -gt 0 ] && fail "$exited exited"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
#  4. Port Bindings
# ═══════════════════════════════════════════════════════════════════════════
log_step "4. Port Bindings"

# Format: service|port_key|optional|description
bindings_list="
app|3000/tcp|false|Next.js App
realtime|3003/tcp|false|Realtime WebSocket
postgis|5432/tcp|false|PostgreSQL
redis|6379/tcp|false|Redis
rabbitmq|5672/tcp|false|RabbitMQ
caddy|80/tcp|false|Caddy HTTP
caddy|443/tcp|false|Caddy HTTPS
osrm|5000/tcp|true|OSRM (profile: routing)
"

while IFS='|' read -r svc port_key is_opt desc; do
    [ -z "$svc" ] && continue
    svc=$(echo "$svc" | xargs)
    port_key=$(echo "$port_key" | xargs)
    desc=$(echo "$desc" | xargs)

    cid=$(docker compose ps -q "$svc" 2>/dev/null | head -1)
    if [ -z "$cid" ]; then
        if [ "$is_opt" = "true" ]; then
            skip "$desc ($svc): nao rodando (opcional)"
        else
            warn "$desc ($svc): nao rodando"
        fi
        continue
    fi

    ports_json=$(docker container inspect "$cid" --format '{{json .NetworkSettings.Ports}}' 2>/dev/null || echo "{}")

    if has_jq; then
        host_port=$(echo "$ports_json" | jq -r ".\"$port_key\"[0].HostPort // empty" 2>/dev/null)
        host_ip=$(echo "$ports_json" | jq -r ".\"$port_key\"[0].HostIp // empty" 2>/dev/null)
    else
        # Fallback: sed to extract HostPort for the specific port_key
        # The JSON looks like: {"3000/tcp":[{"HostIp":"0.0.0.0","HostPort":"3000"}]}
        host_port=$(echo "$ports_json" | sed -n "s|.*\"$port_key\":\[{\"HostIp\":\"[^\"]*\",\"HostPort\":\"\([^\"]*\)\"}.*|\1|p")
        host_ip=$(echo "$ports_json" | sed -n "s|.*\"$port_key\":\[{\"HostIp\":\"\([^\"]*\)\".*|\1|p")
    fi

    if [ -n "$host_port" ]; then
        pass "$desc ($svc) -> ${host_ip:-0.0.0.0}:$host_port"
    else
        warn "$desc ($svc): exposta mas nao publicada"
    fi
done < <(echo "$bindings_list")

# ═══════════════════════════════════════════════════════════════════════════
#  5. Networks
# ═══════════════════════════════════════════════════════════════════════════
log_step "5. Redes Docker"

project_name=$(get_compose_project_name)
info "Compose project: $project_name"

for net_name in frontend backend; do
    full_name="${project_name}_${net_name}"
    net_info=$(docker network inspect "$full_name" 2>/dev/null || true)
    if [ -z "$net_info" ]; then
        warn "Rede '$full_name' nao encontrada"
        continue
    fi

    if has_jq; then
        driver=$(echo "$net_info" | jq -r '.[0].Driver // "?"')
        is_internal=$(echo "$net_info" | jq -r '.[0].Internal // false')
        container_count=$(echo "$net_info" | jq -r '.[0].Containers | length // 0')
        echo "     ${CYAN}$net_name (${full_name})${RESET}"
        detail "Driver: $driver | Internal: $is_internal | Containers: $container_count"
        if [ "$is_internal" = "true" ]; then
            detail "ATENCAO: Rede interna! Port bindings podem falhar."
        fi
        echo "$net_info" | jq -r '.[0].Containers // {} | to_entries[] | "  + \(.value.Name) (\(.value.IPv4Address // "no ip"))"' 2>/dev/null | while read -r line; do
            detail "$line"
        done
    else
        # Fallback: sed-based extraction
        driver=$(echo "$net_info" | sed -n 's/.*"Driver":[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
        is_internal=$(echo "$net_info" | sed -n 's/.*"Internal":[[:space:]]*\(true\|false\).*/\1/p' | head -1)
        echo "     ${CYAN}$net_name (${full_name})${RESET}"
        detail "Driver: ${driver:-?} | Internal: ${is_internal:-?}"
        if [ "$is_internal" = "true" ]; then
            detail "ATENCAO: Rede interna! Port bindings podem falhar."
        fi
        # List containers via sed
        container_names=$(echo "$net_info" | sed -n 's/.*"Name":[[:space:]]*"\([^"]*\)".*/\1/p' 2>/dev/null || true)
        while read -r cname; do
            [ -n "$cname" ] && detail "  + $cname"
        done <<< "$container_names"
    fi
    pass "Rede '$net_name' ok"
done

# ═══════════════════════════════════════════════════════════════════════════
#  6. Healthcheck Endpoints
# ═══════════════════════════════════════════════════════════════════════════
log_step "6. Healthcheck Endpoints"

if command -v curl >/dev/null 2>&1; then
    for ep in "Realtime:http://localhost:3003/health" "Next.js App:http://localhost:3000/api/health"; do
        svc="${ep%%:*}"
        url="${ep#*:}"
        resp=$(curl -s --connect-timeout 5 "$url" 2>&1 || true)
        if [ -n "$resp" ]; then
            trunc=$(echo "$resp" | tr -d '\n' | cut -c1-80)
            pass "$svc: $url respondeu"
            detail "$trunc"
        else
            warn "$svc: $url nao respondeu"
        fi
    done
else
    warn "curl nao disponivel. Healthchecks pulados."
fi

# ═══════════════════════════════════════════════════════════════════════════
#  7. Docker Resources
# ═══════════════════════════════════════════════════════════════════════════
log_step "7. Recursos do Docker"

df_output=$(docker system df 2>/dev/null || true)
if [ -n "$df_output" ]; then
    while read -r line; do
        if grep -qE '(Images|Containers|Local Volumes|Build Cache)' <<< "$line"; then
            detail "$(echo "$line" | xargs)"
        fi
    done < <(echo "$df_output")
    pass "Docker system df: ok"
else
    warn "Nao foi possivel verificar recursos"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  Summary
# ═══════════════════════════════════════════════════════════════════════════
log_step "Resumo Final"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
TOTAL=$((PASS_COUNT + FAIL_COUNT + WARN_COUNT))

echo ""
echo "  ${WHITE}Duracao: ${DURATION}s${RESET}"
echo "  ${WHITE}Total: $TOTAL${RESET}"
echo ""
echo "  ${GREEN}[PASS] $PASS_COUNT${RESET}"
echo "  ${YELLOW}[WARN] $WARN_COUNT${RESET}"
echo "  ${RED}[FAIL] $FAIL_COUNT${RESET}"
echo ""

if [ "$FAIL_COUNT" -eq 0 ] && [ "$WARN_COUNT" -eq 0 ]; then
    echo "  ${GREEN}Tudo ok! Infraestrutura Docker saudavel.${RESET}"
elif [ "$FAIL_COUNT" -eq 0 ]; then
    echo "  ${YELLOW}Com ressalvas. Verifique os WARNs acima.${RESET}"
else
    echo "  ${RED}${FAIL_COUNT} falha(s). Verifique os FAILs acima.${RESET}"
fi

echo ""
echo "  ${CYAN}Dica: Para reconstruir todos os containers:${RESET}"
echo "     docker compose down"
echo "     docker compose build --no-cache"
echo "     docker compose up -d"
echo ""
