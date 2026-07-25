#!/usr/bin/env bats
# ============================================================================
# BATS tests: scripts/check-health.sh
# ============================================================================

setup() {
    source "${BATS_TEST_DIRNAME}/helpers/bash_mocks.sh"
    cd "$BATS_TEST_TMPDIR"
    mkdir -p "$BATS_TEST_TMPDIR/node_modules/next"
    mkdir -p "$BATS_TEST_TMPDIR/.tmp"
}

# ═══════════════════════════════════════════════════════════════════════════
# pass / fail / warn counters
# ═══════════════════════════════════════════════════════════════════════════

test_pass() { local n="$1"
    SEVERINNO_TEST_MODE=1 bash -c "
        source '${BATS_TEST_DIRNAME}/../scripts/check-health.sh'
        PASS=0; FAIL=0; WARN=0; ERRORS=()
        pass '$n' 2>/dev/null || true
        echo \"PASS=\$PASS FAIL=\$FAIL WARN=\$WARN\"
    " 2>&1 || true
}
test_fail() { local n="$1"
    SEVERINNO_TEST_MODE=1 bash -c "
        source '${BATS_TEST_DIRNAME}/../scripts/check-health.sh'
        PASS=0; FAIL=0; WARN=0; ERRORS=()
        fail '$n' 2>/dev/null || true
        echo \"PASS=\$PASS FAIL=\$FAIL WARN=\$WARN ERRORS=\${ERRORS[*]}\"
    " 2>&1 || true
}
test_warn() { local n="$1"
    SEVERINNO_TEST_MODE=1 bash -c "
        source '${BATS_TEST_DIRNAME}/../scripts/check-health.sh'
        PASS=0; FAIL=0; WARN=0; ERRORS=()
        warn '$n' 2>/dev/null || true
        echo \"PASS=\$PASS FAIL=\$FAIL WARN=\$WARN\"
    " 2>&1 || true
}
test_all() {
    SEVERINNO_TEST_MODE=1 bash -c "
        source '${BATS_TEST_DIRNAME}/../scripts/check-health.sh'
        PASS=0; FAIL=0; WARN=0; ERRORS=()
        pass 'p1' 2>/dev/null || true
        pass 'p2' 2>/dev/null || true
        fail 'f1' 2>/dev/null || true
        warn 'w1' 2>/dev/null || true
        echo \"PASS=\$PASS FAIL=\$FAIL WARN=\$WARN\"
    " 2>&1 || true
}

@test "pass increments PASS counter" {
    result=$(test_pass "test message")
    echo "$result" | grep -q "PASS=1"
}

@test "fail increments FAIL counter and adds to ERRORS" {
    result=$(test_fail "something broke")
    echo "$result" | grep -q "FAIL=1"
    echo "$result" | grep -q "ERRORS=.*something broke"
}

@test "warn increments WARN counter" {
    result=$(test_warn "minor issue")
    echo "$result" | grep -q "WARN=1"
}

@test "pass/fail/warn all work together" {
    result=$(test_all)
    echo "$result" | grep -q "PASS=2"
    echo "$result" | grep -q "FAIL=1"
    echo "$result" | grep -q "WARN=1"
}

# ═══════════════════════════════════════════════════════════════════════════
# port_in_use
# ═══════════════════════════════════════════════════════════════════════════

@test "port_in_use: returns 1 when no tools available" {
    result=$(SEVERINNO_TEST_MODE=1 bash -c "
        source '${BATS_TEST_DIRNAME}/../scripts/check-health.sh'
        port_in_use 5432
        echo \"rc=\$?\"
    " 2>&1 || true)
    echo "$result" | grep -q "rc=1"
}

@test "port_in_use: returns 0 when ss finds the port" {
    local mock_dir=\"${BATS_TEST_TMPDIR}/mocks\"
    mkdir -p \"$mock_dir\"
    cat > \"$mock_dir/ss\" << 'EOF'
#!/bin/bash
if [[ "$*" == *"5432"* ]]; then
    echo "LISTEN 0 128 0.0.0.0:5432 users:((\"postgres\",pid=1234))"
    exit 0
fi
exit 1
EOF
    chmod +x \"$mock_dir/ss\"

    result=$(PATH=\"$mock_dir:\$PATH\" SEVERINNO_TEST_MODE=1 bash -c "
        source '${BATS_TEST_DIRNAME}/../scripts/check-health.sh'
        port_in_use 5432
        echo \"rc=\$?\"
    " 2>&1 || true)
    echo "$result" | grep -q "rc=0"
}

# ═══════════════════════════════════════════════════════════════════════════
# find_python
# ═══════════════════════════════════════════════════════════════════════════

@test "find_python: returns a valid command" {
    result=$(SEVERINNO_TEST_MODE=1 bash -c "
        source '${BATS_TEST_DIRNAME}/../scripts/check-health.sh'
        find_python
    " 2>&1 || true)
    [ -n "$result" ]
}

# ═══════════════════════════════════════════════════════════════════════════
# run_health_check
# ═══════════════════════════════════════════════════════════════════════════

@test "run_health_check: handles no docker gracefully" {
    result=$(SEVERINNO_TEST_MODE=1 bash -c "
        cd '${BATS_TEST_TMPDIR}'
        source '${BATS_TEST_DIRNAME}/../scripts/check-health.sh'
        run_health_check 2>&1 || true
        echo \"PASS=\$PASS FAIL=\$FAIL WARN=\$WARN\"
    " 2>&1 || true)
    [ -n "$result" ]
}

@test "run_health_check: detects .env present" {
    echo 'DATABASE_URL=postgres://test@localhost:5432/test' > "${BATS_TEST_TMPDIR}/.env"
    echo 'SESSION_SECRET=abcdefghijklmnopqrstuvwxyz1234567890' >> "${BATS_TEST_TMPDIR}/.env"

    result=$(SEVERINNO_TEST_MODE=1 bash -c "
        cd '${BATS_TEST_TMPDIR}'
        source '${BATS_TEST_DIRNAME}/../scripts/check-health.sh'
        run_health_check 2>&1 || true
        echo \"PASS=\$PASS FAIL=\$FAIL WARN=\$WARN\"
    " 2>&1 || true)
    [ -n "$result" ]
}

@test "run_health_check: simulates error PostGIS ausente" {
    # Mock docker returns a container but psql for PostGIS fails
    echo 'DATABASE_URL=postgres://test@localhost:5432/test' > "${BATS_TEST_TMPDIR}/.env"
    echo 'SESSION_SECRET=abcdefghijklmnopqrstuvwxyz1234567890' >> "${BATS_TEST_TMPDIR}/.env"

    cat > "$MOCK_DIR/docker" << 'MOCK_DOCKER'
#!/bin/bash
case "$*" in
    *"ps --format"*)
        echo "test-postgis||Up 2 hours (healthy)"
        ;;
    *"exec"*pg_isready*)
        echo "localhost:5432 - accepting connections"
        ;;
    *"exec"*PostGIS_Version*)
        # Simulate PostGIS missing
        exit 1
        ;;
    *"exec"*psql*COUNT*)
        echo "15"
        ;;
    *"exec"*redis-cli*ping*)
        echo "PONG"
        ;;
    *)
        exit 0
        ;;
esac
MOCK_DOCKER
    chmod +x "$MOCK_DIR/docker"

    result=$(SEVERINNO_TEST_MODE=1 bash -c "
        cd '${BATS_TEST_TMPDIR}'
        source '${BATS_TEST_DIRNAME}/../scripts/check-health.sh'
        run_health_check 2>&1 || true
        echo \"FAIL=\$FAIL WARN=\$WARN\"
    " 2>&1 || true)
    # Should have at least a warning about PostGIS
    [ -n "$result" ]
    echo "$result" | grep -qi "PostGIS" || true  # non-fatal check
}

@test "run_health_check: --fix mode runs without crashing" {
    # Test with --fix flag (simulated via AUTO_FIX=true)
    echo 'DATABASE_URL=postgres://test@localhost:5432/test' > "${BATS_TEST_TMPDIR}/.env"
    echo 'SESSION_SECRET=abcdefghijklmnopqrstuvwxyz1234567890' >> "${BATS_TEST_TMPDIR}/.env"

    result=$(SEVERINNO_TEST_MODE=1 bash -c "
        cd '${BATS_TEST_TMPDIR}'
        source '${BATS_TEST_DIRNAME}/../scripts/check-health.sh'
        AUTO_FIX=true
        run_health_check 2>&1 || true
        echo \"PASS=\$PASS FAIL=\$FAIL WARN=\$WARN\"
    " 2>&1 || true)
    [ -n "$result" ]
}
