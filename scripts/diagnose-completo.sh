#!/bin/bash
# ============================================================================
# Severinno Complete Infrastructure Diagnostic
# ============================================================================
# Usage: ./scripts/diagnose-completo.sh [-v]
#   -v    Verbose mode
#
# Extends diagnose-docker.sh with:
#   - Worker health (email-worker, notification-worker)
#   - RabbitMQ deep health (queues, exchanges, consumers)
#   - Database connectivity (PostgreSQL)
#   - Redis connectivity
#   - API health endpoint verification
#   - End-to-end queue test (publish + consume)
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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── Helpers ───────────────────────────────────────────────────────────────

log_step() {
    echo ""
    echo "${DARK_GRAY}========================================${RESET}"
    echo "  ${CYAN}$1${RESET}"
    echo "${DARK_GRAY}========================================${RESET}"
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

cleanup() { cd "$PROJECT_DIR" 2>/dev/null || true; }
trap cleanup EXIT

has_jq() { command -v jq >/dev/null 2>&1; }

get_compose_project_name() {
    local cid
    cid=$(docker compose ps -q app 2>/dev/null | head -1)
    if [ -n "$cid" ]; then
        local name
        name=$(docker container inspect "$cid" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null)
        if [ -n "$name" ]; then echo "$name"; return; fi
    fi
    basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-zA-Z0-9_-]//g'
}

check_container_logs() {
    local svc=$1 keyword=$2 tail_lines=${3:-5}
    local logs
    logs=$(docker compose logs --tail="$tail_lines" "$svc" 2>/dev/null || true)
    if grep -q "$keyword" <<< "$logs"; then
        return 0
    fi
    echo "$logs" | tail -3
    return 1
}

# ── Parse args ────────────────────────────────────────────────────────────
while getopts "v" opt; do
    case $opt in v) VERBOSE=true ;; *) ;; esac
done

# ── Header ────────────────────────────────────────────────────────────────
echo "${CYAN}Severinno Complete Infrastructure Diagnostic${RESET}"
echo "${GRAY}Started: $(date '+%Y-%m-%d %H:%M:%S')${RESET}"
echo "${GRAY}Project: $PROJECT_DIR${RESET}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
#  1. Pre-requisites
# ═══════════════════════════════════════════════════════════════════════════
log_step "1. Pre-requisitos"

if command -v docker >/dev/null 2>&1; then
    docker_ver=$(docker --version 2>/dev/null)
    pass "Docker CLI: $docker_ver"
else
    fail "Docker CLI nao disponivel"; exit 1
fi

if docker compose version >/dev/null 2>&1; then
    dc_ver=$(docker compose version 2>/dev/null)
    pass "Docker Compose: $dc_ver"
else
    fail "Docker Compose nao disponivel"
fi

if docker info >/dev/null 2>&1; then
    pass "Docker daemon: rodando"
else
    fail "Docker daemon nao esta rodando"; exit 1
fi

if command -v curl >/dev/null 2>&1; then
    pass "curl disponivel"
else
    warn "curl nao encontrado (healthchecks serao pulados)"
fi

if has_jq; then
    pass "jq disponivel"
else
    warn "jq nao encontrado (precisao limitada em JSON)"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  2. Port Conflicts
# ═══════════════════════════════════════════════════════════════════════════
log_step "2. Conflitos de porta no host"

PORT_CHECK=""
if command -v ss >/dev/null 2>&1; then
    PORT_CHECK="ss"
elif command -v lsof >/dev/null 2>&1; then
    PORT_CHECK="lsof"
elif command -v netstat >/dev/null 2>&1; then
    PORT_CHECK="netstat"
else
    warn "Nenhuma ferramenta de rede (ss/lsof/netstat)"
fi

check_port() {
    local port=$1 service=$2 result=""
    case "$PORT_CHECK" in
        ss) result=$(ss -tlnp "sport = :$port" 2>/dev/null || true) ;;
        lsof) result=$(lsof -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true) ;;
        netstat) result=$(netstat -tlnp 2>/dev/null || true) ;;
    esac
    [ -z "$result" ] && { warn "Porta $port ($service): ninguem ouvindo"; return; }

    local pids=""
    case "$PORT_CHECK" in
        ss) pids=$(echo "$result" | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' 2>/dev/null || true) ;;
        lsof) pids=$(lsof -iTCP:"$port" -sTCP:LISTEN -Fp 2>/dev/null | sed 's/^p//' || true) ;;
        netstat) pids=$(echo "$result" | sed -n 's/.*LISTEN[[:space:]]\+\([0-9]\+\)\/.*/\1/p' 2>/dev/null || true) ;;
    esac

    local non_docker=""
    for pid in $pids; do
        pid=$(echo "$pid" | tr -dc '0-9'); [ -z "$pid" ] && continue
        local proc_name; proc_name=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
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
             "5672:RabbitMQ" "5000:OSRM (profile: routing)" \
             "15672:RabbitMQ Management"; do
    port="${entry%%:*}"
    svc="${entry#*:}"
    check_port "$port" "$svc"
done

# ═══════════════════════════════════════════════════════════════════════════
#  3. Container Status (all services)
# ═══════════════════════════════════════════════════════════════════════════
log_step "3. Status dos Containers"

ps_output=$(docker compose ps --format '{{.Name}}||{{.Status}}||{{.Ports}}' 2>/dev/null || true)
if [ -z "$ps_output" ]; then
    warn "Nenhum container rodando. Execute 'docker compose up -d'."
else
    lines=$(echo "$ps_output" | grep -v '^$' | wc -l)
    pass "$lines container(s) encontrados"

    unhealthy=0; exited=0
    while IFS='||' read -r name status ports; do
        name=$(echo "$name" | xargs); status=$(echo "$status" | xargs); ports=$(echo "$ports" | xargs)
        if grep -qi 'healthy' <<< "$status"; then
            echo "     ${GREEN}$name${RESET}  [${status}]"
            [ -n "$ports" ] && detail "Ports: $ports"
        elif grep -qi 'starting' <<< "$status"; then
            echo "     ${YELLOW}$name${RESET}  [${status}]"
        elif grep -qi 'unhealthy' <<< "$status"; then
            echo "     ${RED}$name  [UNHEALTHY]${RESET}"; detail "$status"
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
#  4. Port Bindings (infra + workers)
# ═══════════════════════════════════════════════════════════════════════════
log_step "4. Port Bindings"

bindings_list="
app|3000/tcp|false|Next.js App
realtime|3003/tcp|false|Realtime WebSocket
postgis|5432/tcp|false|PostgreSQL
redis|6379/tcp|false|Redis
rabbitmq|5672/tcp|false|RabbitMQ AMQP
rabbitmq|15672/tcp|false|RabbitMQ Management
caddy|80/tcp|false|Caddy HTTP
caddy|443/tcp|false|Caddy HTTPS
osrm|5000/tcp|true|OSRM (profile: routing)
"

while IFS='|' read -r svc port_key is_opt desc; do
    [ -z "$svc" ] && continue
    svc=$(echo "$svc" | xargs); port_key=$(echo "$port_key" | xargs); desc=$(echo "$desc" | xargs)

    cid=$(docker compose ps -q "$svc" 2>/dev/null | head -1)
    if [ -z "$cid" ]; then
        if [ "$is_opt" = "true" ]; then skip "$desc ($svc): nao rodando (opcional)"; else warn "$desc ($svc): nao rodando"; fi
        continue
    fi

    ports_json=$(docker container inspect "$cid" --format '{{json .NetworkSettings.Ports}}' 2>/dev/null || echo "{}")
    if has_jq; then
        host_port=$(echo "$ports_json" | jq -r ".\"$port_key\"[0].HostPort // empty" 2>/dev/null)
        host_ip=$(echo "$ports_json" | jq -r ".\"$port_key\"[0].HostIp // empty" 2>/dev/null)
    else
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
    [ -z "$net_info" ] && { warn "Rede '$full_name' nao encontrada"; continue; }

    if has_jq; then
        driver=$(echo "$net_info" | jq -r '.[0].Driver // "?"')
        is_internal=$(echo "$net_info" | jq -r '.[0].Internal // false')
        container_count=$(echo "$net_info" | jq -r '.[0].Containers | length // 0')
        echo "     ${CYAN}$net_name (${full_name})${RESET}"
        detail "Driver: $driver | Internal: $is_internal | Containers: $container_count"
        [ "$is_internal" = "true" ] && detail "ATENCAO: Rede interna! Port bindings podem falhar."
        echo "$net_info" | jq -r '.[0].Containers // {} | to_entries[] | "  + \(.value.Name) (\(.value.IPv4Address // "no ip"))"' 2>/dev/null | while read -r line; do detail "$line"; done
    else
        driver=$(echo "$net_info" | sed -n 's/.*"Driver":[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
        is_internal=$(echo "$net_info" | sed -n 's/.*"Internal":[[:space:]]*\(true\|false\).*/\1/p' | head -1)
        echo "     ${CYAN}$net_name (${full_name})${RESET}"
        detail "Driver: ${driver:-?} | Internal: ${is_internal:-?}"
        [ "$is_internal" = "true" ] && detail "ATENCAO: Rede interna!"
    fi
    pass "Rede '$net_name' ok"
done

# ═══════════════════════════════════════════════════════════════════════════
#  6. Worker Health
# ═══════════════════════════════════════════════════════════════════════════
log_step "6. Workers (RabbitMQ Consumers)"

for worker_info in "email-worker:email:Email" "notification-worker:notification:Notificacao"; do
    svc="${worker_info%%:*}"
    rest="${worker_info#*:}"
    routing_key="${rest%%:*}"
    label="${rest#*:}"

    info "Checking $label worker ($svc, routingKey=$routing_key)"

    # Container status
    cid=$(docker compose ps -q "$svc" 2>/dev/null | head -1)
    if [ -z "$cid" ]; then
        warn "Worker $label ($svc): container nao rodando"
        continue
    fi

    # Container state
    state=$(docker container inspect "$cid" --format '{{.State.Status}}' 2>/dev/null || echo "unknown")
    if [ "$state" != "running" ]; then
        fail "Worker $label ($svc): estado=$state (esperado=running)"
        continue
    fi

    # Check logs for startup and connection confirmation
    logs_ok=false
    connected=false
    startup_logs=$(docker compose logs --tail=15 "$svc" 2>/dev/null || true)
    if grep -q "starting" <<< "$startup_logs"; then
        logs_ok=true
    fi
    if grep -q "listening on queue" <<< "$startup_logs"; then
        connected=true
    fi

    if [ "$logs_ok" = true ] && [ "$connected" = true ]; then
        pass "Worker $label ($svc): rodando e conectado ao RabbitMQ"
        last_line=$(echo "$startup_logs" | grep "listening on queue" | tail -1 | xargs || true)
        [ -n "$last_line" ] && detail "$last_line"
    elif [ "$logs_ok" = true ]; then
        warn "Worker $label ($svc): rodando mas nao confirmou conexao RabbitMQ"
        detail "Ultimas linhas: $(echo "$startup_logs" | tail -3 | tr '\n' ' ' | xargs)"
    else
        warn "Worker $label ($svc): rodando mas logs sem confirmacao de startup"
        detail "Ultimas linhas: $(echo "$startup_logs" | tail -3 | tr '\n' ' ' | xargs)"
    fi

    # Check restart count
    restart_count=$(docker container inspect "$cid" --format '{{.RestartCount}}' 2>/dev/null || echo "0")
    if [ "$restart_count" -gt 3 ]; then
        warn "Worker $label ($svc): ${restart_count} restart(s) - possivel crash loop"
    elif [ "$restart_count" -gt 0 ]; then
        detail "Restarts: $restart_count"
    fi
done

# ═══════════════════════════════════════════════════════════════════════════
#  7. RabbitMQ Deep Health
# ═══════════════════════════════════════════════════════════════════════════
log_step "7. RabbitMQ Deep Health"

rmq_cid=$(docker compose ps -q rabbitmq 2>/dev/null | head -1)
if [ -z "$rmq_cid" ]; then
    warn "RabbitMQ: container nao rodando"
else
    # Check connectivity via healthcheck command
    conn_check=$(docker exec "$rmq_cid" rabbitmq-diagnostics check_port_connectivity 2>/dev/null || true)
    if grep -qi "ok\|succeeded" <<< "$conn_check"; then
        pass "RabbitMQ: conectividade OK (docker exec)"
    else
        # Alternative: just check if the process is listening
        status=$(docker container inspect "$rmq_cid" --format '{{.State.Status}}' 2>/dev/null || echo "unknown")
        if [ "$status" = "running" ]; then
            pass "RabbitMQ: container running"
            detail "Healthcheck especifico nao disponivel via docker exec"
        else
            fail "RabbitMQ: container status=$status"
        fi
    fi

    # List queues and consumers via rabbitmq-diagnostics
    queue_list=$(docker exec "$rmq_cid" rabbitmq-diagnostics list_queues 2>/dev/null || true)
    if [ -n "$queue_list" ]; then
        info "Filas encontradas:"
        echo "$queue_list" | while read -r line; do
            [ -n "$line" ] && detail "  $line"
        done
        # Check for expected queues
        for expected_q in "emails" "notifications"; do
            if grep -qw "$expected_q" <<< "$queue_list"; then
                # Get consumer count via rabbitmqctl
                consumers=$(docker exec "$rmq_cid" rabbitmqctl list_queues name consumers messages 2>/dev/null | grep -w "$expected_q" | awk '{print $2}' || echo "0")
                if [ -n "$consumers" ] && [ "$consumers" -gt 0 ] 2>/dev/null; then
                    pass "Fila '$expected_q': $consumers consumidor(es)"
                else
                    warn "Fila '$expected_q': sem consumidores ativos!"
                fi
            else
                warn "Fila '$expected_q' nao encontrada no RabbitMQ"
            fi
        done
    else
        warn "Nao foi possivel listar filas"
    fi

    # Check exchange
    exchange_check=$(docker exec "$rmq_cid" rabbitmq-diagnostics list_exchanges 2>/dev/null | grep "severinno.direct" || true)
    if [ -n "$exchange_check" ]; then
        pass "Exchange 'severinno.direct' existe"
    else
        warn "Exchange 'severinno.direct' nao encontrado"
    fi

    # Check version
    rmq_version=$(docker exec "$rmq_cid" rabbitmq-diagnostics status 2>/dev/null | grep -i "rabbitmq_version\|\"RabbitMQ\"" | head -1 || true)
    [ -n "$rmq_version" ] && detail "${rmq_version}"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  8. Database & Redis Health
# ═══════════════════════════════════════════════════════════════════════════
log_step "8. Database & Redis"

# PostgreSQL check via container
pg_cid=$(docker compose ps -q postgis 2>/dev/null | head -1)
if [ -n "$pg_cid" ]; then
    pg_check=$(docker exec "$pg_cid" pg_isready -U severinno -d severinno 2>/dev/null || true)
    if grep -q "accepting connections" <<< "$pg_check"; then
        pass "PostgreSQL: aceitando conexoes"
        # Get version
        pg_ver=$(docker exec "$pg_cid" psql -U severinno -d severinno -Atc "SELECT version()" 2>/dev/null | head -1 | sed 's/ on.*//' || true)
        [ -n "$pg_ver" ] && detail "$pg_ver"
    else
        warn "PostgreSQL: $pg_check"
    fi
else
    warn "PostgreSQL: container nao rodando"
fi

# Valkey check via container
redis_cid=$(docker compose ps -q redis 2>/dev/null | head -1)
if [ -n "$redis_cid" ]; then
    redis_ping=$(docker exec "$redis_cid" valkey-cli ping 2>/dev/null || true)
    if [ "$redis_ping" = "PONG" ]; then
        pass "Valkey: PONG"
        redis_info=$(docker exec "$redis_cid" valkey-cli INFO server 2>/dev/null | grep "^valkey_version" || true)
        [ -n "$redis_info" ] && detail "$redis_info"
    else
        warn "Redis: $redis_ping"
    fi
else
    warn "Redis: container nao rodando"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  9. Healthcheck Endpoints
# ═══════════════════════════════════════════════════════════════════════════
log_step "9. Healthcheck Endpoints"

if command -v curl >/dev/null 2>&1; then
    # Realtime health
    resp=$(curl -s --connect-timeout 5 "http://localhost:3003/health" 2>&1 || true)
    if [ -n "$resp" ]; then
        trunc=$(echo "$resp" | tr -d '\n' | cut -c1-80)
        pass "Realtime: http://localhost:3003/health"
        detail "$trunc"
    else
        warn "Realtime: nao respondeu"
    fi

    # Next.js /api/health (checks db, redis, rabbitmq)
    resp=$(curl -s --connect-timeout 10 "http://localhost:3000/api/health" 2>&1 || true)
    if [ -n "$resp" ]; then
        trunc=$(echo "$resp" | tr -d '\n' | cut -c1-120)
        pass "Next.js App: http://localhost:3000/api/health"
        detail "$trunc"

        # Parse individual service statuses
        if has_jq; then
            if echo "$resp" | jq -e '.checks.rabbitmq.status == "ok"' >/dev/null 2>&1; then
                pass "API health: RabbitMQ conectado"
            else
                rmq_status=$(echo "$resp" | jq -r '.checks.rabbitmq.status // "?"' 2>/dev/null)
                warn "API health: RabbitMQ status=$rmq_status"
            fi
            if echo "$resp" | jq -e '.checks.database.status == "ok"' >/dev/null 2>&1; then
                pass "API health: Database conectado"
            else
                db_status=$(echo "$resp" | jq -r '.checks.database.status // "?"' 2>/dev/null)
                warn "API health: Database status=$db_status"
            fi
            if echo "$resp" | jq -e '.checks.redis.status == "ok"' >/dev/null 2>&1; then
                pass "API health: Redis conectado"
            else
                redis_status=$(echo "$resp" | jq -r '.checks.redis.status // "?"' 2>/dev/null)
                warn "API health: Redis status=$redis_status"
            fi
        else
            # Basic grep fallback
            grep -q '"rabbitmq":{"status":"ok"' <<< "$resp" && pass "API health: RabbitMQ OK" || warn "API health: RabbitMQ pode estar offline"
            grep -q '"database":{"status":"ok"' <<< "$resp" && pass "API health: Database OK" || true
            grep -q '"redis":{"status":"ok"' <<< "$resp" && pass "API health: Redis OK" || true
        fi
    else
        warn "Next.js App: nao respondeu em /api/health"
    fi
else
    warn "curl nao disponivel. Healthchecks pulados."
fi

# ═══════════════════════════════════════════════════════════════════════════
# 10. End-to-End Queue Test
# ═══════════════════════════════════════════════════════════════════════════
log_step "10. Teste End-to-End de Filas"

# Publish a test message directly to RabbitMQ via docker exec
rmq_cid=$(docker compose ps -q rabbitmq 2>/dev/null | head -1)
app_cid=$(docker compose ps -q app 2>/dev/null | head -1)

if [ -z "$rmq_cid" ]; then
    skip "RabbitMQ nao rodando. Teste E2E de filas pulado."
elif [ -z "$app_cid" ]; then
    skip "App nao rodando. Teste E2E de filas pulado (nao e possivel publicar)."
else
    # Publish a test message directly to RabbitMQ via rabbitmqctl
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    test_payload='{"source":"diagnose-completo","type":"DIAGNOSTIC","timestamp":"'$timestamp'"}'

    # Get current message count for notifications queue
    before_notif=$(docker exec "$rmq_cid" rabbitmqctl list_queues name messages 2>/dev/null | grep -w "notifications" | awk '{print $2}' || echo "0")
    before_email=$(docker exec "$rmq_cid" rabbitmqctl list_queues name messages 2>/dev/null | grep -w "emails" | awk '{print $2}' || echo "0")
    detail "Antes: notificacoes=${before_notif} msg, emails=${before_email} msg"

    # Publish via rabbitmqctl (disponivel no RabbitMQ 4.x, sintaxe posicional)
    detail "Publicando mensagem de teste no exchange severinno.direct..."
    pub_result=$(docker exec "$rmq_cid" rabbitmqctl publish \
        severinno.direct notification "$test_payload" 2>/dev/null || true)

    if grep -qi "ok\|sent\|published" <<< "$pub_result"; then
        pass "Publicacao: mensagem publicada no RabbitMQ"

        # Wait briefly for consumer to process
        sleep 2
        detail "Aguardando consumo pelos workers..."

        # Check if message was consumed (count should go down)
        after_notif=$(docker exec "$rmq_cid" rabbitmqctl list_queues name messages 2>/dev/null | grep -w "notifications" | awk '{print $2}' || echo "0")
        detail "Depois: notificacoes=${after_notif} msg"

        if [ "$after_notif" -lt "$before_notif" ] 2>/dev/null; then
            pass "Mensagem consumida! Worker processou a notificacao."
        elif [ "$after_notif" -eq "$before_notif" ] 2>/dev/null; then
            warn "Mensagem NAO consumida (${after_notif} msg). Worker pode estar offline."
        fi
    else
        warn "Publicacao: rabbitmqctl publish falhou"
        detail "Resposta: $(echo "$pub_result" | head -3 | tr '\n' ' ')"
    fi

    # Verify app can reach RabbitMQ via health API
    health_resp=$(curl -s --connect-timeout 5 "http://localhost:3000/api/health" 2>&1 || true)
    if grep -qi "rabbitmq.*ok" <<< "$health_resp"; then
        pass "App conectado ao RabbitMQ (confirmado por /api/health)"
    fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# 11. Docker Resources
# ═══════════════════════════════════════════════════════════════════════════
log_step "11. Recursos do Docker"

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
echo "  ${WHITE}Total de verificacoes: $TOTAL${RESET}"
echo ""
echo "  ${GREEN}[PASS] $PASS_COUNT${RESET}"
echo "  ${YELLOW}[WARN] $WARN_COUNT${RESET}"
echo "  ${RED}[FAIL] $FAIL_COUNT${RESET}"
echo ""

if [ "$FAIL_COUNT" -eq 0 ] && [ "$WARN_COUNT" -eq 0 ]; then
    echo "  ${GREEN}Tudo ok! Stack completa saudavel.${RESET}"
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
echo "  ${CYAN}Para ver logs dos workers:${RESET}"
echo "     docker compose logs email-worker --tail=50 -f"
echo "     docker compose logs notification-worker --tail=50 -f"
echo ""
