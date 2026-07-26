#!/bin/bash
# ============================================================================
# Severinno Marketplace — Service Dashboard (TUI)
# ============================================================================
# Mostra status dos serviços em tempo real, estilo htop.
# Atualiza a cada 3 segundos automaticamente.
#
# Usage:
#   ./scripts/dashboard.sh              # Dashboard completo
#   ./scripts/dashboard.sh --once       # Apenas um snapshot, sem loop
#   ./scripts/dashboard.sh --interval 5 # Atualiza a cada 5s (padrão: 3)
# ============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    RED=$(tput setaf 1); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
    CYAN=$(tput setaf 6); WHITE=$(tput setaf 7); GRAY=$(tput setaf 8 2>/dev/null || echo "$(tput setaf 7)")
    BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
    BG_RED=$(tput setab 1); BG_GREEN=$(tput setab 2); BG_YELLOW=$(tput setab 3)
    BG_CYAN=$(tput setab 6)
else
    RED=""; GREEN=""; YELLOW=""; CYAN=""; WHITE=""; GRAY=""; BOLD=""; DIM=""; RESET=""
    BG_RED=""; BG_GREEN=""; BG_YELLOW=""; BG_CYAN=""
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

INTERVAL=3
ONCE=false
for arg in "$@"; do
    case "$arg" in
        --once) ONCE=true ;;
        --interval) shift; INTERVAL="${1:-3}" ;;
        --interval=*) INTERVAL="${arg#*=}" ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────────────────────
status_icon() {
    case "$1" in
        healthy|running|ok|PONG) echo "${GREEN}●${RESET}" ;;
        unhealthy|error|fail)    echo "${RED}●${RESET}" ;;
        starting|degraded)       echo "${YELLOW}●${RESET}" ;;
        off|stopped|*)           echo "${DIM}○${RESET}" ;;
    esac
}

draw_box() {
    local title="$1" width=60
    echo "  ${CYAN}┌─$(printf '─%.0s' $(seq 1 $width))─┐${RESET}"
    echo "  ${CYAN}│${RESET}  ${BOLD}$title${RESET}$(printf ' %.0s' $(seq 1 $((width - ${#title} - 2))))${CYAN}│${RESET}"
    echo "  ${CYAN}└─$(printf '─%.0s' $(seq 1 $width))─┘${RESET}"
}

render_dashboard() {
    local timestamp
    timestamp=$(date '+%H:%M:%S')

    # ── Header ──────────────────────────────────────────────────────
    clear 2>/dev/null || true
    echo ""
    echo "${BG_CYAN}${WHITE}${BOLD}  Severinno Service Dashboard                                   ${RESET}"
    echo "${GRAY}  Última atualização: $timestamp   (Ctrl+C para sair)${RESET}"
    echo ""

    local pass=0 fail=0 warn=0

    # ════════════════════════════════════════════════════════════════
    # DOCKER CONTAINERS
    # ════════════════════════════════════════════════════════════════
    draw_box "Docker Containers"

    local containers
    containers=$(docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}' 2>/dev/null || true)

    if [ -z "$containers" ]; then
        echo "  ${DIM}  Nenhum container rodando${RESET}"
        fail=$((fail + 1))
    else
        while IFS='|' read -r name status ports; do
            local icon status_text

            if echo "$status" | grep -qi "healthy"; then
                icon=$(status_icon "healthy")
                status_text="${GREEN}healthy${RESET}"
                pass=$((pass + 1))
            elif echo "$status" | grep -qi "unhealthy"; then
                icon=$(status_icon "unhealthy")
                status_text="${RED}unhealthy${RESET}"
                fail=$((fail + 1))
            elif echo "$status" | grep -qi "starting"; then
                icon=$(status_icon "starting")
                status_text="${YELLOW}starting${RESET}"
                warn=$((warn + 1))
            elif echo "$status" | grep -qi "Exit"; then
                icon=$(status_icon "error")
                status_text="${RED}exited${RESET}"
                fail=$((fail + 1))
            else
                icon=$(status_icon "off")
                status_text="${DIM}$status${RESET}"
            fi

            local port_display=""
            if [ -n "$ports" ]; then
                port_display=$(echo "$ports" | sed 's/,.*//' | xargs)
            fi

            printf "  ${icon}  ${BOLD}%-22s${RESET}  %s\n" "$name" "$status_text"
        done <<< "$containers"
    fi
    echo ""

    # ════════════════════════════════════════════════════════════════
    # DATABASE
    # ════════════════════════════════════════════════════════════════
    draw_box "Database & Cache"

    local pg_container
    pg_container=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE "postgis|postgres" | head -1 || true)

    if [ -n "$pg_container" ]; then
        if docker exec "$pg_container" pg_isready -U severinno -d severinno 2>/dev/null | grep -q "accepting"; then
            local tables postgis_ver
            tables=$(docker exec "$pg_container" psql -U severinno -d severinno -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "?")
            postgis_ver=$(docker exec "$pg_container" psql -U severinno -d severinno -Atc "SELECT PostGIS_Version()" 2>/dev/null || echo "off")

            if echo "$postgis_ver" | grep -qE "^[0-9]"; then
                echo "  $(status_icon ok)  PostgreSQL    │ ${BOLD}$tables${RESET} tabelas │ PostGIS ${postgis_ver%% *}"
            else
                echo "  $(status_icon ok)  PostgreSQL    │ ${BOLD}$tables${RESET} tabelas │ ${YELLOW}sem PostGIS${RESET}"
            fi
            pass=$((pass + 1))
        else
            echo "  $(status_icon error)  PostgreSQL    │ ${RED}não responde${RESET}"
            fail=$((fail + 1))
        fi
    else
        echo "  $(status_icon off)  PostgreSQL    │ ${DIM}container não encontrado${RESET}"
        warn=$((warn + 1))
    fi

    # Redis
    local redis_container
    redis_container=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE "redis|valkey" | head -1 || true)

    if [ -n "$redis_container" ]; then
        local redis_cmd="redis-cli"
        echo "$redis_container" | grep -qi "valkey" && redis_cmd="valkey-cli"
        if docker exec "$redis_container" $redis_cmd ping 2>/dev/null | grep -q "PONG"; then
            echo "  $(status_icon ok)  Redis/Valkey  │ ${GREEN}PONG${RESET}"
            pass=$((pass + 1))
        else
            echo "  $(status_icon error)  Redis/Valkey  │ ${RED}sem resposta${RESET}"
            fail=$((fail + 1))
        fi
    else
        echo "  $(status_icon off)  Redis/Valkey  │ ${DIM}não encontrado${RESET}"
        warn=$((warn + 1))
    fi

    # MinIO
    local minio_container
    minio_container=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i "minio" | grep -iv "init" | head -1 || true)
    if [ -n "$minio_container" ]; then
        if curl -s -o /dev/null -w "" --connect-timeout 3 http://localhost:9000/minio/health/live 2>/dev/null; then
            echo "  $(status_icon ok)  MinIO S3      │ ${GREEN}http://localhost:9000${RESET}"
            pass=$((pass + 1))
        else
            echo "  $(status_icon error)  MinIO S3      │ ${RED}porta 9000 sem resposta${RESET}"
            warn=$((warn + 1))
        fi
    else
        echo "  $(status_icon off)  MinIO S3      │ ${DIM}não encontrado${RESET}"
        warn=$((warn + 1))
    fi
    echo ""

    # ════════════════════════════════════════════════════════════════
    # NEXT.JS SERVER
    # ════════════════════════════════════════════════════════════════
    draw_box "Application Server"

    if command -v curl >/dev/null 2>&1; then
        local http_code
        http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 http://localhost:3000 2>/dev/null || echo "000")

        if [ "$http_code" = "200" ]; then
            echo "  $(status_icon ok)  Next.js       │ ${GREEN}http://localhost:3000${RESET} │ HTTP $http_code"
            pass=$((pass + 1))

            # Health endpoint
            local health
            health=$(curl -s --connect-timeout 3 http://localhost:3000/api/health 2>/dev/null || true)
            if [ -n "$health" ]; then
                local health_trunc
                health_trunc=$(echo "$health" | tr -d '\n' | cut -c1-80)
                echo "  ${DIM}                   │ /api/health: $health_trunc${RESET}"
            fi
        elif [ "$http_code" = "000" ]; then
            echo "  $(status_icon off)  Next.js       │ ${DIM}http://localhost:3000${RESET} │ ${YELLOW}offline${RESET}"
            warn=$((warn + 1))
        else
            echo "  $(status_icon error)  Next.js       │ ${RED}HTTP $http_code${RESET}"
            fail=$((fail + 1))
        fi
    else
        echo "  $(status_icon off)  curl não disponível"
    fi
    echo ""

    # ════════════════════════════════════════════════════════════════
    # SYSTEM RESOURCES
    # ════════════════════════════════════════════════════════════════
    draw_box "System Resources"

    # Disk space — pega os últimos 4 campos (evita espaços no nome do filesystem)
    if command -v df >/dev/null 2>&1; then
        local disk_info
        disk_info=$(df -h / 2>/dev/null | tail -1 | awk '{print $(NF-4), $(NF-3), $(NF-2), $(NF-1)}')
        if [ -n "$disk_info" ]; then
            local disk_total disk_used disk_avail disk_pct
            disk_total=$(echo "$disk_info" | awk '{print $1}')
            disk_used=$(echo "$disk_info" | awk '{print $2}')
            disk_avail=$(echo "$disk_info" | awk '{print $3}')
            disk_pct=$(echo "$disk_info" | awk '{print $4}')
            local disk_color="$GREEN"
            echo "$disk_pct" | grep -qE "^[8-9][0-9]%|100%" && disk_color="$RED"
            echo "$disk_pct" | grep -qE "^[6-7][0-9]%" && disk_color="$YELLOW"
            printf "  ${BOLD}%-20s${RESET} %s used of %s (${disk_color}%s${RESET})  %s free\n" "Disk (/)" "$disk_used" "$disk_total" "$disk_pct" "$disk_avail"
        fi
    fi

    # Docker system disk
    if command -v docker >/dev/null 2>&1; then
        local docker_disk
        docker_disk=$(docker system df 2>/dev/null | tail -1 | awk '{print $4, $5}' || true)
        if [ -n "$docker_disk" ]; then
            echo "  ${BOLD}Docker System${RESET}    │ $docker_disk"
        fi

        # Container CPU/Mem
        local stats
        stats=$(docker stats --no-stream --format '{{.Name}}│{{.CPUPerc}}│{{.MemUsage}}│{{.MemPerc}}' 2>/dev/null | grep -v "glitchtip" || true)
        if [ -n "$stats" ]; then
            echo "  ${BOLD}Container CPU/Mem:${RESET}"
            while IFS='│' read -r cname cpu mem mempct; do
                local short_name
                short_name=$(echo "$cname" | sed 's/^severinno-//' | sed 's/-1$//')
                printf "    ${DIM}%-16s${RESET} %-7s  %-20s  %s\n" "$short_name" "$cpu" "$mem" "$mempct"
            done <<< "$stats"
        fi
    fi
    echo ""

    # ════════════════════════════════════════════════════════════════
    # SUMMARY
    # ════════════════════════════════════════════════════════════════
    local total=$((pass + fail + warn))
    echo "${CYAN}  ───────────────────────────────────────────────────────────${RESET}"
    echo "  ${GREEN}PASS: $pass${RESET}   ${RED}FAIL: $fail${RESET}   ${YELLOW}WARN: $warn${RESET}   Total: $total"

    if [ "$fail" -eq 0 ] && [ "$warn" -eq 0 ]; then
        echo "  ${GREEN}✅ Todos os serviços saudáveis${RESET}"
    elif [ "$fail" -eq 0 ]; then
        echo "  ${YELLOW}⚠️  Com ressalvas${RESET}"
    else
        echo "  ${RED}❌ $fail falha(s) detectada(s)${RESET}"
    fi
    echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────
trap 'echo ""; echo "  Dashboard encerrado."; echo ""; exit 0' INT TERM

if $ONCE; then
    render_dashboard
else
    while true; do
        render_dashboard
        sleep "$INTERVAL"
    done
fi
