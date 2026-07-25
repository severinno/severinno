#!/bin/bash
# ============================================================================
# Severinno Marketplace — Service Dashboard (TUI)
# ============================================================================
# Mostra status dos serviços em tempo real, estilo htop.
# Atualiza a cada 3 segundos automaticamente.
#
# Usage:
#   ./scripts/dashboard.sh                    # Dashboard (auto: claro/escuro)
#   ./scripts/dashboard.sh --dark             # Forçar modo escuro
#   ./scripts/dashboard.sh --light            # Forçar modo claro
#   ./scripts/dashboard.sh --once             # Apenas um snapshot, sem loop
#   ./scripts/dashboard.sh --interval 5       # Atualiza a cada 5s (padrão: 3)
#   ./scripts/dashboard.sh --logs redis       # Mostrar só logs do Redis
#   ./scripts/dashboard.sh --logs postgis      # Mostrar só logs do PostGIS
#   ./scripts/dashboard.sh --compact            # Dashboard minimalista (sem logs/recursos)
#   ./scripts/dashboard.sh --json               # Exporta status como JSON (pipe com jq)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── Options ───────────────────────────────────────────────────────────────
# Track whether user explicitly set --dark or --light
HAS_THEME_FLAG=false
INTERVAL=3
ONCE=false
DARK=false
LOGS_FILTER=""
COMPACT=false
JSON_MODE=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --once) ONCE=true ;;
        --dark) DARK=true; HAS_THEME_FLAG=true ;;
        --light) DARK=false; HAS_THEME_FLAG=true ;;
        --compact) COMPACT=true ;;
        --json) JSON_MODE=true ;;
        --logs) shift; LOGS_FILTER="${1:-}" ;;
        --logs=*) LOGS_FILTER="${1#*=}" ;;
        --interval) shift; INTERVAL="${1:-3}" ;;
        --interval=*) INTERVAL="${1#*=}" ;;
    esac
    shift
done

# ── Auto-detect dark mode (only if no --dark/--light flag) ────────────────
if [ "$HAS_THEME_FLAG" != true ]; then
    # Check env var override first
    case "${SEVERINNO_DARK_MODE:-}" in
        1|true|yes|dark) DARK=true ;;
        0|false|no|light) DARK=false ;;
        *)
            # Method 1: OSC 11 escape sequence — query terminal background color
            if [ -t 1 ] && command -v stty >/dev/null 2>&1; then
                saved_stty=""; bg_raw=""
                saved_stty=$(stty -g 2>/dev/null || true)
                stty -echo -icanon time 1 min 0 2>/dev/null || true
                printf '\e]11;?\a'
                IFS= read -r -d $'\a' -t 0.2 bg_raw 2>/dev/null || true
                stty "$saved_stty" 2>/dev/null || true

                # Parse rgb:hhhh/hhhh/hhhh (handles both 2-nibble and 4-nibble formats)
                if [[ "$bg_raw" =~ rgb:([0-9a-fA-F]+)/([0-9a-fA-F]+)/([0-9a-fA-F]+) ]]; then
                    r=$((16#${BASH_REMATCH[1]}))
                    g=$((16#${BASH_REMATCH[2]}))
                    b=$((16#${BASH_REMATCH[3]}))
                    # Normalize 4-nibble format (0–65535 → 0–255)
                    [ $r -gt 255 ] && r=$((r >> 8))
                    [ $g -gt 255 ] && g=$((g >> 8))
                    [ $b -gt 255 ] && b=$((b >> 8))
                    luminance=$(( (r * 299 + g * 587 + b * 114) / 1000 ))
                    [ "$luminance" -lt 128 ] && DARK=true
                fi
            fi

            # Method 2: COLORFGBG (legacy terminals like konsole, rxvt)
            if [ "$DARK" != true ] && [ -n "${COLORFGBG:-}" ]; then
                bg_val="${COLORFGBG##*;}"
                [ "$bg_val" -le 7 ] 2>/dev/null && DARK=true
            fi
            ;;
    esac
fi

# ── Theme Colors ──────────────────────────────────────────────────────────
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
    if [ "$DARK" = true ]; then
        # Dark mode — bright variants legíveis em fundo escuro
        RED=$(tput setaf 9)       # bright red
        GREEN=$(tput setaf 10)    # bright green
        YELLOW=$(tput setaf 11)   # bright yellow
        CYAN=$(tput setaf 14)     # bright cyan
        WHITE=$(tput setaf 15)    # bright white
        GRAY=$(tput setaf 8 2>/dev/null || echo "$(tput setaf 7)")  # fallback to white
        BOLD=$(tput bold)
        DIM=$(tput dim)
        RESET=$(tput sgr0)
        BG_RED=""; BG_GREEN=""; BG_YELLOW=""; BG_CYAN=""  # no bg fill
        ICON_OK="◉"; ICON_ERR="◉"; ICON_WARN="◉"; ICON_OFF="○"
        DIM_CYAN="$GRAY"
    else
        # Light mode (default)
        RED=$(tput setaf 1); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
        CYAN=$(tput setaf 6)
        WHITE=$(tput setaf 7)
        GRAY=$(tput setaf 8 2>/dev/null || echo "$(tput setaf 7)")
        BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
        BG_RED=$(tput setab 1); BG_GREEN=$(tput setab 2)
        BG_YELLOW=$(tput setab 3); BG_CYAN=$(tput setab 6)
        ICON_OK="●"; ICON_ERR="●"; ICON_WARN="●"; ICON_OFF="○"
        DIM_CYAN="$CYAN"
    fi
else
    RED=""; GREEN=""; YELLOW=""; CYAN=""; WHITE=""; GRAY=""
    BOLD=""; DIM=""; RESET=""; BG_RED=""; BG_GREEN=""; BG_YELLOW=""; BG_CYAN=""
    ICON_OK="●"; ICON_ERR="●"; ICON_WARN="●"; ICON_OFF="○"
    DIM_CYAN=""
fi

# ── Helpers ───────────────────────────────────────────────────────────────
status_icon() {
    case "$1" in
        healthy|running|ok|PONG) echo "${GREEN}$ICON_OK${RESET}" ;;
        unhealthy|error|fail)    echo "${RED}$ICON_ERR${RESET}" ;;
        starting|degraded)       echo "${YELLOW}$ICON_WARN${RESET}" ;;
        off|stopped|*)           echo "${DIM}$ICON_OFF${RESET}" ;;
    esac
}
header_bar() {
    local text="$1"
    if [ "$DARK" = true ]; then
        # Dark mode: subtle overline, no background fill
        echo "${WHITE}${BOLD}  $text${RESET}"
        echo "${GRAY}  $(printf '─%.0s' $(seq 1 60))${RESET}"
    else
        echo "${BG_CYAN}${WHITE}${BOLD}  $text${RESET}"
    fi
}

sub_header() {
    if [ "$DARK" = true ]; then
        echo "  ${GRAY}${BOLD}$1${RESET}"
    else
        echo "${CYAN}-- $1 --${RESET}"
    fi
}

# ── JSON Helpers ─────────────────────────────────────────────────────────
json_escape() {
    # Escapa string para JSON: " → \", \ → \\, newline → \n, tab → \t
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\t'/\\t}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    printf '%s' "$s"
}

json_value() {
    # Usage: json_value <name> <value> [last]
    # Outputs: "name": "value"[,
    local comma=","
    [ "${3:-}" = "last" ] && comma=""
    printf '    "%s": "%s"%s\n' "$1" "$(json_escape "$2")" "$comma"
}

json_bool() {
    local comma=","
    [ "${3:-}" = "last" ] && comma=""
    printf '    "%s": %s%s\n' "$1" "$2" "$comma"
}

json_number() {
    local comma=","
    [ "${3:-}" = "last" ] && comma=""
    printf '    "%s": %s%s\n' "$1" "$2" "$comma"
}

collect_json() {
    local timestamp
    timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

    echo "{"
    json_value "timestamp" "$timestamp"
    json_value "theme" "$([ "$DARK" = true ] && echo 'dark' || echo 'light')"

    # ── Containers ─────────────────────────────────────────────
    echo '  "containers": ['
    local first=true
    local containers
    containers=$(docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}' 2>/dev/null || true)
    if [ -n "$containers" ]; then
        while IFS='|' read -r name status ports; do
            if [ "$first" = true ]; then
                first=false
            else
                echo ','
            fi
            echo '    {'
            json_value "name" "$name"
            local short_name="$name"
            short_name=$(echo "$short_name" | sed 's/^severinno-//' | sed 's/-1$//')
            json_value "short_name" "$short_name"
            json_value "status" "$status"
            local health="unknown"
            echo "$status" | grep -qi "healthy" && health="healthy"
            echo "$status" | grep -qi "unhealthy" && health="unhealthy"
            echo "$status" | grep -qi "Exit" && health="exited"
            echo "$status" | grep -qi "starting" && health="starting"
            json_value "health" "$health"
            local port_clean
            port_clean=$(echo "$ports" | sed 's/,.*//' | xargs)
            json_value "ports" "$port_clean" "last"
            printf '    }'
        done <<< "$containers"
    fi
    echo ''
    echo '  ]',

    # ── Database & Cache ───────────────────────────────────────
    echo '  "database": {'

    # PostgreSQL
    local pg_status="off" pg_tables=0 pg_ver="" pg_error=""
    local pg_container
    pg_container=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE "postgis|postgres" | head -1 || true)
    if [ -n "$pg_container" ]; then
        if docker exec "$pg_container" pg_isready -U severinno -d severinno 2>/dev/null | grep -q "accepting"; then
            pg_status="ok"
            pg_tables=$(docker exec "$pg_container" psql -U severinno -d severinno -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "0")
            pg_ver=$(docker exec "$pg_container" psql -U severinno -d severinno -Atc "SELECT PostGIS_Version()" 2>/dev/null || echo "")
            pg_ver="${pg_ver%% *}"
        else
            pg_status="error"
            pg_error="not responding"
        fi
    fi
    echo '    "postgresql": {'
    json_value "status" "$pg_status"
    json_number "tables" "${pg_tables:-0}"
    if [ -n "$pg_ver" ]; then
        json_value "postgis_version" "$pg_ver"
    fi
    if [ -n "$pg_error" ]; then
        json_value "error" "$pg_error"
    fi
    json_value "container" "$pg_container" "last"
    echo '    },'

    # Redis
    local redis_status="off" redis_ping="" redis_error=""
    local redis_container
    redis_container=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE "redis|valkey" | head -1 || true)
    if [ -n "$redis_container" ]; then
        local redis_cmd="redis-cli"
        echo "$redis_container" | grep -qi "valkey" && redis_cmd="valkey-cli"
        if docker exec "$redis_container" $redis_cmd ping 2>/dev/null | grep -q "PONG"; then
            redis_status="ok"
            redis_ping="PONG"
        else
            redis_status="error"
            redis_error="no response"
        fi
    fi
    echo '    "redis": {'
    json_value "status" "$redis_status"
    [ -n "$redis_ping" ] && json_value "ping" "$redis_ping"
    [ -n "$redis_error" ] && json_value "error" "$redis_error"
    json_value "container" "$redis_container" "last"
    echo '    },'

    # MinIO
    local minio_status="off" minio_error=""
    local minio_container
    minio_container=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i "minio" | grep -iv "init" | head -1 || true)
    if [ -n "$minio_container" ]; then
        if curl -s -o /dev/null -w "" --connect-timeout 3 http://localhost:9000/minio/health/live 2>/dev/null; then
            minio_status="ok"
        else
            minio_status="error"
            minio_error="port 9000"
        fi
    fi
    echo '    "minio": {'
    json_value "status" "$minio_status"
    [ -n "$minio_error" ] && json_value "error" "$minio_error"
    json_value "container" "$minio_container" "last"
    echo '    }'
    echo '  },'

    # ── Application Server ─────────────────────────────────────
    echo '  "application": {'
    local next_status="off" next_http="000" next_health=""
    if command -v curl >/dev/null 2>&1; then
        next_http=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 http://localhost:3000 2>/dev/null || echo "000")
        if [ "$next_http" = "200" ]; then
            next_status="ok"
            next_health=$(curl -s --connect-timeout 3 http://localhost:3000/api/health 2>/dev/null || true)
        else
            next_status="error"
        fi
    fi
    echo '    "nextjs": {'
    json_value "status" "$next_status"
    json_number "http_code" "$next_http"
    [ -n "$next_health" ] && json_value "health_endpoint" "$(echo "$next_health" | tr -d '\n' | cut -c1-200)"
    json_value "url" "http://localhost:3000" "last"
    echo '    }'
    echo '  }',

    # ── System Resources ───────────────────────────────────────
    echo '  "system_resources": {'

    # Disk
    if command -v df >/dev/null 2>&1; then
        local disk_info disk_total disk_used disk_avail disk_pct
        disk_info=$(df -h / 2>/dev/null | tail -1 | awk '{print $(NF-4), $(NF-3), $(NF-2), $(NF-1)}')
        if [ -n "$disk_info" ]; then
            disk_total=$(echo "$disk_info" | awk '{print $1}')
            disk_used=$(echo "$disk_info" | awk '{print $2}')
            disk_avail=$(echo "$disk_info" | awk '{print $3}')
            disk_pct_int=$(echo "$disk_info" | awk '{print $4}' | tr -d '%')
            echo '    "disk": {'
            json_value "total" "$disk_total"
            json_value "used" "$disk_used"
            json_value "available" "$disk_avail"
            json_number "used_percent" "${disk_pct_int:-0}" "last"
            echo '    },'
        fi
    fi

    # Docker disk
    if command -v docker >/dev/null 2>&1; then
        local docker_disk
        docker_disk=$(docker system df 2>/dev/null | tail -1 | awk '{print $4, $5}' || true)
        if [ -n "$docker_disk" ]; then
            json_value "docker_disk" "$docker_disk"
        fi
        echo '    "containers_stats": ['
        local stats
        stats=$(docker stats --no-stream --format '{{.Name}}│{{.CPUPerc}}│{{.MemUsage}}│{{.MemPerc}}' 2>/dev/null | grep -v "glitchtip" || true)
        local first_stat=true
        if [ -n "$stats" ]; then
            while IFS='│' read -r cname cpu mem mempct; do
                if [ "$first_stat" = true ]; then
                    first_stat=false
                else
                    echo ','
                fi
                local sn="$cname"
                sn=$(echo "$sn" | sed 's/^severinno-//' | sed 's/-1$//')
                echo '      {'
                json_value "name" "$sn"
                json_value "cpu" "$cpu"
                json_value "memory" "$mem"
                json_value "memory_percent" "$mempct" "last"
                printf '      }'
            done <<< "$stats"
        fi
        echo ''
        echo '    ]'
    else
        echo '    "containers_stats": []'
    fi
    echo '  }',

    # ── Summary ────────────────────────────────────────────────
    local containers_pass=0 containers_fail=0 containers_warn=0
    if [ -n "$containers" ]; then
        while IFS='|' read -r name status ports; do
            if echo "$status" | grep -qi "healthy"; then
                containers_pass=$((containers_pass + 1))
            elif echo "$status" | grep -qiE "unhealthy|Exit"; then
                containers_fail=$((containers_fail + 1))
            elif echo "$status" | grep -qi "starting"; then
                containers_warn=$((containers_warn + 1))
            fi
        done <<< "$containers"
    fi
    local total=$((containers_pass + containers_fail + containers_warn))
    [ "$pg_status" = "ok" ] && containers_pass=$((containers_pass + 1)) || { [ "$pg_status" = "error" ] && containers_fail=$((containers_fail + 1)) || containers_warn=$((containers_warn + 1)); }
    [ "$redis_status" = "ok" ] && containers_pass=$((containers_pass + 1)) || { [ "$redis_status" = "error" ] && containers_fail=$((containers_fail + 1)) || containers_warn=$((containers_warn + 1)); }
    [ "$minio_status" = "ok" ] && containers_pass=$((containers_pass + 1)) || { [ "$minio_status" = "error" ] && containers_fail=$((containers_fail + 1)) || containers_warn=$((containers_warn + 1)); }
    [ "$next_status" = "ok" ] && containers_pass=$((containers_pass + 1)) || { [ "$next_status" = "error" ] && containers_fail=$((containers_fail + 1)) || containers_warn=$((containers_warn + 1)); }
    total=$((containers_pass + containers_fail + containers_warn))
    local healthy_status="true"
    [ "$containers_fail" -gt 0 ] && healthy_status="false"

    echo '  "summary": {'
    json_number "pass" "$containers_pass"
    json_number "fail" "$containers_fail"
    json_number "warn" "$containers_warn"
    json_number "total" "$total"
    json_bool "healthy" "$healthy_status" "last"
    echo '  }'
    echo '}'
}

render_dashboard() {
    local timestamp
    timestamp=$(date '+%H:%M:%S')

    # ── Header ──────────────────────────────────────────────────────
    clear 2>/dev/null || true
    echo ""
    local theme_indicator="☀️ Light Mode"
    [ "$DARK" = true ] && theme_indicator="🌙 Dark Mode"
    header_bar "${theme_indicator}  Dashboard  [${timestamp}]  (Ctrl+C)"
    echo ""

    local pass=0 fail=0 warn=0

    # ════════════════════════════════════════════════════════════════
    # DOCKER CONTAINERS
    # ════════════════════════════════════════════════════════════════
    sub_header "Docker Containers"

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
    sub_header "Database & Cache"

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
    sub_header "Application Server"

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
    # SYSTEM RESOURCES (oculto em --compact)
    # ════════════════════════════════════════════════════════════════
    if [ "$COMPACT" != true ]; then
    sub_header "System Resources"

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
fi

    # ════════════════════════════════════════════════════════════════
    # LIVE LOGS (oculto em --compact)
    # ════════════════════════════════════════════════════════════════
    if [ "$COMPACT" != true ]; then
        local ll_title="Live Logs"
        [ -n "$LOGS_FILTER" ] && ll_title="Live Logs ($LOGS_FILTER)"
        sub_header "$ll_title"

    if command -v docker >/dev/null 2>&1; then
        local log_containers
        log_containers=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -v "glitchtip" || true)

        if [ -n "$log_containers" ]; then
            while IFS= read -r cname; do
                local short_name
                short_name=$(echo "$cname" | sed 's/^severinno-//' | sed 's/-1$//')

                # Apply --logs filter if set
                if [ -n "$LOGS_FILTER" ]; then
                    if ! echo "$short_name" | grep -qi "$LOGS_FILTER"; then
                        continue  # Skip non-matching containers
                    fi
                fi

                # Get last 5 log lines, strip Docker timestamps, truncate
                local logs
                logs=$(docker logs --tail 5 "$cname" 2>/dev/null || true)

                if [ -n "$logs" ]; then
                    echo "  ${BOLD}${short_name}:${RESET}"
                    while IFS= read -r line; do
                        # Strip Docker ISO timestamp prefix
                        line=$(echo "$line" | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}\.[0-9]\+Z[[:space:]]*//')
                        # Truncate to 90 chars
                        if [ ${#line} -gt 90 ]; then
                            line="${line:0:87}..."
                        fi
                        # Highlight error/warning keywords with colors
                        if echo "$line" | grep -qiE "\<ERROR?\>|FATAL|PANIC|TRACE"; then
                            printf "    ${RED}%-90s${RESET}\n" "$line"
                        elif echo "$line" | grep -qiE "\<WARN\>|WARNING"; then
                            printf "    ${YELLOW}%-90s${RESET}\n" "$line"
                        else
                            printf "    ${DIM}%-90s${RESET}\n" "$line"
                        fi
                    done <<< "$logs"
                fi
            done <<< "$log_containers"
        else
            echo "  ${DIM}  Nenhum container rodando${RESET}"
        fi
    fi

    # Next.js error check (runs locally, not in Docker)
    if command -v curl >/dev/null 2>&1; then
        local next_logs
        next_logs=$(curl -s --connect-timeout 2 http://localhost:3000/api/health 2>/dev/null || true)
        echo "  ${BOLD}Next.js (local):${RESET}"
        if [ -n "$next_logs" ]; then
            local next_status next_uptime next_color
            next_status=$(echo "$next_logs" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
            next_uptime=$(echo "$next_logs" | grep -o '"uptime":[0-9]*' | cut -d: -f2)
            next_status="${next_status:-unknown}"; next_uptime="${next_uptime:-0}"
            next_color="$DIM"; [ "$next_status" != "ok" ] && next_color="$RED"
            echo "    ${next_color}status: $next_status  uptime: ${next_uptime}s${RESET}"
        else
            echo "    ${DIM}offline — start with: bun run dev${RESET}"
        fi
    fi
    echo ""
fi

    # ════════════════════════════════════════════════════════════════
    # SUMMARY
    # ════════════════════════════════════════════════════════════════
    local total=$((pass + fail + warn))
    if [ "$DARK" = true ]; then
        echo "  ${GRAY}$(printf '─%.0s' $(seq 1 62))${RESET}"
    else
        echo "${CYAN}  ───────────────────────────────────────────────────────────${RESET}"
    fi
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

if $JSON_MODE; then
    collect_json
elif $ONCE; then
    render_dashboard
else
    while true; do
        render_dashboard
        sleep "$INTERVAL"
    done
fi
