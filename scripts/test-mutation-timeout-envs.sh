#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-timeout-envs.sh — Mutation test do guard de doc das
# envs de timeout (check-timeout-envs.mjs)
#
# Prova que o scripts/check-timeout-envs.mjs REALMENTE detecta a regressão
# que ele existe para bloquear: uma env `*_TIMEOUT_MS` consumida em src/ que
# deixa de estar documentada (README tabela Fetch timeouts, .env.example ou
# composes) com o mesmo default em ms — ou uma linha STALE na doc. Operação
# tunava um timeout invisível (LYTEX/EVOLUTION/GLITCHTIP/ALERT_WEBHOOK) e o
# default documentado driftava do código; o guard deriva do código e exige o
# par env+default nas 3 docs.
#
#   CONTROLE:      fixture limpo (env em src/ + doc nas 3 docs) → guard exit 0
#   MUTAÇÃO A:     linha do README REMOVIDA → guard DEVE FALHAR (exit 1)
#   MUTAÇÃO B:     default do README DIVERGENTE (10s → 99s) → guard DEVE FALHAR
#   MUTAÇÃO C:     linha do .env.example REMOVIDA → guard DEVE FALHAR
#   MUTAÇÃO D:     linha do docker-compose.yml REMOVIDA → guard DEVE FALHAR
#   MUTAÇÃO E:     linha do docker-compose.prod.yml REMOVIDA → guard DEVE FALHAR
#   MUTAÇÃO F:     linha STALE no README (env documentada sem uso em src/) →
#                  guard DEVE FALHAR
#   MUTAÇÃO G:     defaults INCONSISTENTES no próprio src/ (2 call sites com
#                  valores diferentes) → guard DEVE FALHAR
#
# O script NÃO toca NENHUM arquivo do repo: o guard roda com --root num
# fixture temporário (src/ + README.md + .env.example + 2 composes).
#
# Usage:
#   ./scripts/test-mutation-timeout-envs.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com a mutação) OU infra ❌
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-timeout-envs.mjs"

TMP_DIR="$(mktemp -d)"

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── Cleanup (trap EXIT — SEMPRE remove o temp, mesmo com falha) ──────────
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── build_fixture: env em src/ + doc consistente nas 3 docs ───────────────
build_fixture() {
  mkdir -p "$TMP_DIR/src/lib"
  cat > "$TMP_DIR/src/lib/client.ts" <<'EOF'
import { envTimeoutSignal, resolveTimeoutMs } from "@/lib/fetch-timeout"

export const LYTEX_TIMEOUT = resolveTimeoutMs("LYTEX_TIMEOUT_MS", 10_000)
export async function callLytex(url: string) {
  const res = await fetch(url, {
    signal: envTimeoutSignal("LYTEX_TIMEOUT_MS", 10_000),
  })
  return res.json()
}
EOF
  cat > "$TMP_DIR/README.md" <<'EOF'
## Environment Variables

### Fetch timeouts (`*_TIMEOUT_MS`)

Every timeout env must be documented consistently.

| Env               | Default | Scope                          |
| ----------------- | ------- | ------------------------------ |
| `LYTEX_TIMEOUT_MS` | 10s     | Gateway Lytex (`src/lib/lytex.ts`) |
EOF
  cat > "$TMP_DIR/.env.example" <<'EOF'
# Timeout envs (ms)
LYTEX_TIMEOUT_MS=10000
EOF
  cat > "$TMP_DIR/docker-compose.yml" <<'EOF'
services:
  app:
    image: app:latest
    environment:
      LYTEX_TIMEOUT_MS: ${LYTEX_TIMEOUT_MS:-10000}
EOF
  cat > "$TMP_DIR/docker-compose.prod.yml" <<'EOF'
services:
  app:
    image: app:latest
    environment:
      LYTEX_TIMEOUT_MS: ${LYTEX_TIMEOUT_MS:-10000}
EOF
}

# ── run_guard: roda o guard no fixture (--root) ───────────────────────────
run_guard() {
  set +e
  OUTPUT="$(node "$GUARD" --root "$TMP_DIR" 2>&1)"
  EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-timeout-envs deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture base + CONTROLE (doc consistente → exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture limpo (env documentada nas 3 docs)..."
build_fixture

info "STEP 2: Controle — fixture limpo; guard deve PASS (exit 0)..."
run_guard
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o fixture LIMPO (exit $EXIT)."
  echo "$OUTPUT" | tail -10
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — fixture limpo passa no guard (exit 0)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A: linha do README removida
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — linha do README removida..."
cat > "$TMP_DIR/README.md" <<'EOF'
## Environment Variables

### Fetch timeouts (`*_TIMEOUT_MS`)

Every timeout env must be documented consistently.

| Env               | Default | Scope                          |
| ----------------- | ------- | ------------------------------ |
EOF

info "STEP 4: Rodando guard contra a mutação A (README sem a env)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (README): check-timeout-envs passou com env órfã da tabela"
  fail "do README (exit 0). O guard não varre a doc do README."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "README"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou o README — veja o output acima."
  exit 1
fi
pass "Mutação A DETECTADA: guard falhou citando o README (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B: default do README divergente (10s → 99s)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — default do README divergente (10s → 99s)..."
cat > "$TMP_DIR/README.md" <<'EOF'
## Environment Variables

### Fetch timeouts (`*_TIMEOUT_MS`)

Every timeout env must be documented consistently.

| Env               | Default | Scope                          |
| ----------------- | ------- | ------------------------------ |
| `LYTEX_TIMEOUT_MS` | 99s     | Gateway Lytex (`src/lib/lytex.ts`) |
EOF

info "STEP 6: Rodando guard contra a mutação B (default divergente)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (default): passou com default da doc (99s) ≠ código (10s)."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "≠ código"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a divergência de default — veja acima."
  exit 1
fi
pass "Mutação B DETECTADA: guard citou default divergente (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 7+8 — MUTAÇÃO C: linha do .env.example removida
# ═════════════════════════════════════════════════════════════════════════

info "STEP 7: Resetando README e aplicando mutação C — .env.example sem a env..."
build_fixture
cat > "$TMP_DIR/.env.example" <<'EOF'
# Timeout envs (ms) — sem LYTEX_TIMEOUT_MS de propósito
EOF

info "STEP 8: Rodando guard contra a mutação C (.env.example vazio)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (.env.example): passou com env ausente do .env.example."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq ".env.example"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou o .env.example — veja acima."
  exit 1
fi
pass "Mutação C DETECTADA: guard citou o .env.example (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 9+10 — MUTAÇÃO D: linha do docker-compose.yml removida
# ═════════════════════════════════════════════════════════════════════════

info "STEP 9: Aplicando mutação D — docker-compose.yml sem a env..."
build_fixture
cat > "$TMP_DIR/docker-compose.yml" <<'EOF'
services:
  app:
    image: app:latest
    environment:
      PORT: 3000
EOF

info "STEP 10: Rodando guard contra a mutação D (compose base sem a env)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (compose base): passou com env ausente do docker-compose.yml."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "docker-compose.yml"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou o docker-compose.yml — veja acima."
  exit 1
fi
pass "Mutação D DETECTADA: guard citou o docker-compose.yml (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 11+12 — MUTAÇÃO E: linha do docker-compose.prod.yml removida
# ═════════════════════════════════════════════════════════════════════════

info "STEP 11: Aplicando mutação E — docker-compose.prod.yml sem a env..."
build_fixture
cat > "$TMP_DIR/docker-compose.prod.yml" <<'EOF'
services:
  app:
    image: app:latest
    environment:
      PORT: 3000
EOF

info "STEP 12: Rodando guard contra a mutação E (compose prod sem a env)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (compose prod): passou com env ausente do docker-compose.prod.yml."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "docker-compose.prod.yml"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou o docker-compose.prod.yml — veja acima."
  exit 1
fi
pass "Mutação E DETECTADA: guard citou o docker-compose.prod.yml (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 13+14 — MUTAÇÃO F: linha STALE no README (env sem uso em src/)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 13: Aplicando mutação F — linha stale no README (env sem uso em src/)..."
build_fixture
cat > "$TMP_DIR/README.md" <<'EOF'
## Environment Variables

### Fetch timeouts (`*_TIMEOUT_MS`)

Every timeout env must be documented consistently.

| Env               | Default | Scope                          |
| ----------------- | ------- | ------------------------------ |
| `LYTEX_TIMEOUT_MS` | 10s     | Gateway Lytex (`src/lib/lytex.ts`) |
| `GHOST_TIMEOUT_MS` | 30s     | Env que não existe em src/      |
EOF

info "STEP 14: Rodando guard contra a mutação F (linha stale)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (stale): passou com linha do README sem uso real em src/."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "stale"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou a linha stale — veja acima."
  exit 1
fi
pass "Mutação F DETECTADA: guard citou a linha stale (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 15+16 — MUTAÇÃO G: defaults inconsistentes no próprio src/
# ═════════════════════════════════════════════════════════════════════════

info "STEP 15: Aplicando mutação G — 2 call sites com defaults diferentes..."
build_fixture
cat > "$TMP_DIR/src/lib/client.ts" <<'EOF'
import { envTimeoutSignal, resolveTimeoutMs } from "@/lib/fetch-timeout"

export const A = resolveTimeoutMs("LYTEX_TIMEOUT_MS", 10_000)
export const B = resolveTimeoutMs("LYTEX_TIMEOUT_MS", 5_000)
EOF

info "STEP 16: Rodando guard contra a mutação G (defaults inconsistentes)..."
run_guard
echo "$OUTPUT" | tail -4

if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (defaults): passou com a MESMA env usando 10s e 5s em src/."
  exit 1
fi
if ! echo "$OUTPUT" | grep -Fq "DIFERENTES"; then
  fail "Guard falhou (exit $EXIT) mas NÃO citou defaults diferentes — veja acima."
  exit 1
fi
pass "Mutação G DETECTADA: guard citou defaults inconsistentes (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard pega env órfã do README (exit 1),"
pass "default divergente (exit 1), env ausente do .env.example/composes"
pass "(exit 1), linha stale (exit 1) e defaults inconsistentes em src/ (exit 1)"
exit 0
