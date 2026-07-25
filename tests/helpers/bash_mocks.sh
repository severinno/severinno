# ============================================================================
# Bash test helpers — common setup for all BATS test files
# ============================================================================

# ── Mock directory ─────────────────────────────────────────────────────────
MOCK_DIR="${BATS_TEST_TMPDIR}/mocks"
mkdir -p "$MOCK_DIR"

# ── Mock commands ──────────────────────────────────────────────────────────
# These override real commands to return controlled output for testing.

# tput: simulate terminal with color support
cat > "$MOCK_DIR/tput" << 'MOCK_TPUT'
#!/bin/bash
case "$1" in
    setaf) echo "\[\$2\]" ;;  # just return a placeholder
    bold)  echo "*" ;;
    dim)   echo "." ;;
    sgr0)  echo "/" ;;
    setab) echo "#" ;;
    *)     echo "" ;;
esac
MOCK_TPUT
chmod +x "$MOCK_DIR/tput"

# seq: simple implementation for Git Bash without coreutils seq
cat > "$MOCK_DIR/seq" << 'MOCK_SEQ'
#!/bin/bash
START=1; END="$1"
[ "$#" -ge 2 ] && { START="$1"; END="$2"; }
for ((i=START; i<=END; i++)); do echo "$i"; done
MOCK_SEQ
chmod +x "$MOCK_DIR/seq"

# date: return fixed timestamp
cat > "$MOCK_DIR/date" << 'MOCK_DATE'
#!/bin/bash
echo "12:34:56"
MOCK_DATE
chmod +x "$MOCK_DIR/date"

# clear: no-op
cat > "$MOCK_DIR/clear" << 'MOCK_CLEAR'
#!/bin/bash
true
MOCK_CLEAR
chmod +x "$MOCK_DIR/clear"

# ── Export PATH ────────────────────────────────────────────────────────────
export PATH="$MOCK_DIR:$PATH"

# ── Helper assertions ─────────────────────────────────────────────────────
assert_contains() {
    local haystack="$1" needle="$2" label="${3:-output}"
    if ! echo "$haystack" | grep -qF "$needle"; then
        echo "FAIL: Expected $label to contain '$needle'"
        echo "  Actual: $haystack"
        return 1
    fi
}

refute_contains() {
    local haystack="$1" needle="$2" label="${3:-output}"
    if echo "$haystack" | grep -qF "$needle"; then
        echo "FAIL: Expected $label NOT to contain '$needle'"
        echo "  Actual: $haystack"
        return 1
    fi
}
