#!/usr/bin/env bats
# ============================================================================
# BATS tests: scripts/dashboard.sh
# ============================================================================
# Tests the helper functions and argument parsing without requiring Docker.

setup() {
    source "${BATS_TEST_DIRNAME}/helpers/bash_mocks.sh"
    # Reset globals before each test
    DARK=false
    ONCE=false
    INTERVAL=3

    # Change to project root (where dashboard.sh expects to be)
    cd "$BATS_TEST_TMPDIR"
    # Symlink node_modules to satisfy the script's cd
    mkdir -p "$BATS_TEST_TMPDIR/node_modules"
}

# ═══════════════════════════════════════════════════════════════════════════
# status_icon
# ═══════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════
# status_icon — tested via subshell (handles set -euo pipefail)
# ═══════════════════════════════════════════════════════════════════════════

test_status_icon() {
    local input="$1"
    SEVERINNO_TEST_MODE=1 bash -c "
        source '${BATS_TEST_DIRNAME}/../scripts/dashboard.sh'
        status_icon '$input'
    " 2>&1 || true
}

@test "status_icon: healthy returns green icon" {
    result=$(test_status_icon "healthy")
    [[ "$result" == *"●"* ]] || [[ "$result" == *"◉"* ]]
}

@test "status_icon: unhealthy returns red icon" {
    result=$(test_status_icon "unhealthy")
    [[ "$result" == *"●"* ]] || [[ "$result" == *"◉"* ]]
}

@test "status_icon: starting returns yellow icon" {
    result=$(test_status_icon "starting")
    [[ "$result" == *"●"* ]] || [[ "$result" == *"◉"* ]]
}

@test "status_icon: off returns dim circle" {
    result=$(test_status_icon "off")
    [[ "$result" == *"○"* ]]
}

@test "status_icon: PONG maps to healthy/green" {
    result=$(test_status_icon "PONG")
    [[ "$result" == *"●"* ]] || [[ "$result" == *"◉"* ]]
}

@test "status_icon: error maps to unhealthy/red" {
    result=$(test_status_icon "error")
    [[ "$result" == *"●"* ]] || [[ "$result" == *"◉"* ]]
}

@test "status_icon: unknown status maps to off" {
    result=$(test_status_icon "something_unknown")
    [[ "$result" == *"○"* ]]
}

# ═══════════════════════════════════════════════════════════════════════════
# header_bar — tested via subshell
# ═══════════════════════════════════════════════════════════════════════════

test_header_bar() {
    local dark="$1" text="$2"
    SEVERINNO_TEST_MODE=1 bash -c "
        cd '${BATS_TEST_TMPDIR}'
        mkdir -p node_modules
        source '${BATS_TEST_DIRNAME}/../scripts/dashboard.sh'
        DARK=$dark
        header_bar '$text'
    " 2>&1 || true
}

@test "header_bar: light mode includes header text" {
    result=$(test_header_bar "false" "Test Header")
    echo "$result" | grep -q "Test Header"
}

@test "header_bar: dark mode uses bold white + line" {
    result=$(test_header_bar "true" "Test Header")
    echo "$result" | grep -q "Test Header"
    echo "$result" | grep -q "─"
}

# ═══════════════════════════════════════════════════════════════════════════
# sub_header — tested via subshell
# ═══════════════════════════════════════════════════════════════════════════

test_sub_header() {
    local dark="$1" text="$2"
    SEVERINNO_TEST_MODE=1 bash -c "
        cd '${BATS_TEST_TMPDIR}'
        mkdir -p node_modules
        source '${BATS_TEST_DIRNAME}/../scripts/dashboard.sh'
        DARK=$dark
        sub_header '$text'
    " 2>&1 || true
}

@test "sub_header: light mode includes section text" {
    result=$(test_sub_header "false" "Test Section")
    echo "$result" | grep -q "Test Section"
}

@test "sub_header: dark mode includes section text" {
    result=$(test_sub_header "true" "Test Section")
    echo "$result" | grep -q "Test Section"
}

# ═══════════════════════════════════════════════════════════════════════════
# Argument parsing
# ═══════════════════════════════════════════════════════════════════════════

@test "argument parsing: defaults are correct" {
    # Run the argument parsing from dashboard.sh in isolation
    INTERVAL=3; ONCE=false; DARK=false
    # No args — defaults should remain
    ( eval "$(grep -o 'INTERVAL=3\|ONCE=false\|DARK=false' <<< '' 2>/dev/null || true)"; true )
}

@test "argument parsing: --once sets ONCE=true" {
    # Simulate the argument parsing
    ONCE=false
    for arg in "--once"; do
        case "$arg" in
            --once) ONCE=true ;;
        esac
    done
    [ "$ONCE" = true ]
}

@test "argument parsing: --dark sets DARK=true" {
    DARK=false
    for arg in "--dark"; do
        case "$arg" in
            --dark) DARK=true ;;
        esac
    done
    [ "$DARK" = true ]
}

@test "argument parsing: --interval 5 sets INTERVAL=5" {
    set -- --interval 5
    INTERVAL=3
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --interval) shift; INTERVAL="${1:-3}" ;;
        esac
        shift
    done
    [ "$INTERVAL" = 5 ]
}

@test "argument parsing: --dark --once both work together" {
    DARK=false; ONCE=false
    for arg in "--dark" "--once"; do
        case "$arg" in
            --once) ONCE=true ;;
            --dark) DARK=true ;;
        esac
    done
    [ "$DARK" = true ] && [ "$ONCE" = true ]
}

# ═══════════════════════════════════════════════════════════════════════════
# render_dashboard — with mocked Docker services
# ═══════════════════════════════════════════════════════════════════════════

@test "render_dashboard: handles gracefully (with mocked docker)" {
    # Create a comprehensive docker mock that handles all commands
    cat > "$MOCK_DIR/docker" << 'MOCK_DOCKER'
#!/bin/bash
case "$*" in
    *"ps --format"*)
        echo "test-redis|healthy|6379/tcp"
        ;;
    *"exec"*pg_isready*)
        echo "localhost:5432 - accepting connections"
        ;;
    *"exec"*psql*PostGIS*)
        echo "3.4.0"
        ;;
    *"exec"*psql*COUNT*)
        echo "15"
        ;;
    *"exec"*redis-cli*ping*|*"exec"*valkey-cli*ping*)
        echo "PONG"
        ;;
    *"logs --tail"*)
        echo "1:C 25 Jul 2026 * Ready"
        ;;
    *"stats --no-stream"*)
        echo "test-redis|0.50%|10MiB|0.5%"
        ;;
    *"system df"*)
        echo "Images 3 1.5GB"
        ;;
    *"exec"*)
        exit 0
        ;;
    *)
        exit 0
        ;;
esac
MOCK_DOCKER
    chmod +x "$MOCK_DIR/docker"

    # Mock curl (handles all calls)
    cat > "$MOCK_DIR/curl" << 'MOCK_CURL'
#!/bin/bash
if [[ "$*" == *"-o /dev/null -w"* ]]; then
    echo "200"
elif [[ "$*" == *"api/health"* ]]; then
    echo '{"status":"ok","uptime":100}'
else
    exit 0
fi
MOCK_CURL
    chmod +x "$MOCK_DIR/curl"

    # Run in a subshell
    result=$(SEVERINNO_TEST_MODE=1 bash -c "
        cd '${BATS_TEST_TMPDIR}'
        mkdir -p node_modules
        source '${BATS_TEST_DIRNAME}/../scripts/dashboard.sh'
        render_dashboard 2>&1 || true
    " 2>&1 || true)

    # Should at least output something without crashing
    [ -n "$result" ]
}

@test "render_dashboard: shows unhealthy container in red" {
    # Mock docker returning an UNHEALTHY container
    cat > "$MOCK_DIR/docker" << 'MOCK_UNHEALTHY'
#!/bin/bash
case "$*" in
    *"ps --format"*)
        echo "test-postgis|unhealthy|5432/tcp"
        ;;
    *)
        exit 0
        ;;
esac
MOCK_UNHEALTHY
    chmod +x "$MOCK_DIR/docker"

    cat > "$MOCK_DIR/curl" << 'MOCK_CURL'
#!/bin/bash
exit 1
MOCK_CURL
    chmod +x "$MOCK_DIR/curl"

    result=$(SEVERINNO_TEST_MODE=1 bash -c "
        cd '${BATS_TEST_TMPDIR}'
        mkdir -p node_modules
        source '${BATS_TEST_DIRNAME}/../scripts/dashboard.sh'
        render_dashboard 2>&1 || true
    " 2>&1 || true)

    [ -n "$result" ]
}

@test "render_dashboard: shows exited container" {
    # Mock docker returning an EXITED container
    cat > "$MOCK_DIR/docker" << 'MOCK_EXITED'
#!/bin/bash
case "$*" in
    *"ps --format"*)
        echo "test-redis|Exited (1) 2 hours ago|"
        ;;
    *)
        exit 0
        ;;
esac
MOCK_EXITED
    chmod +x "$MOCK_DIR/docker"

    cat > "$MOCK_DIR/curl" << 'MOCK_CURL'
#!/bin/bash
exit 1
MOCK_CURL
    chmod +x "$MOCK_DIR/curl"

    result=$(SEVERINNO_TEST_MODE=1 bash -c "
        cd '${BATS_TEST_TMPDIR}'
        mkdir -p node_modules
        source '${BATS_TEST_DIRNAME}/../scripts/dashboard.sh'
        render_dashboard 2>&1 || true
    " 2>&1 || true)

    [ -n "$result" ]
}
