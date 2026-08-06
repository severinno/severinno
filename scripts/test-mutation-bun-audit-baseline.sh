#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-bun-audit-baseline.sh — Mutation test do guard de
# drift de vulnerabilidades de deps (check-bun-audit-baseline.mjs)
#
# Prova que o scripts/check-bun-audit-baseline.mjs REALMENTE detecta as
# regressões que ele existe para bloquear:
#
#   Cenário A (HIGH NOVO):   um advisory de severidade HIGH novo aparece
#                            (pacote novo vulnerável) — o guard exige FALHA
#                            (exit 1) com a mensagem de achado NOVO.
#   Cenário B (MODERATE c/   um advisory MODERATE novo com --min-severity
#   --min-severity high):    high NÃO falha (aviso) — prova que o gate de
#                            severidade funciona (só high/critical bloqueiam).
#
# E o CONTROLE: o mesmo run de audit sem achados novos passa (exit 0) —
# provando que a falha vem da MUTAÇÃO, não de um fixture quebrado.
#
# DIFERENÇA vs mutation-seed-dev-e2e: aqui o fixture é criado do zero num
# mktemp e o guard roda em modo --results-file (lê o JSON do bun audit de um
# FIXTURE em vez de spawnar o audit real com rede — o mesmo modo que os
# testes unitários usam). O script não toca NENHUM arquivo do repositório
# real.
#
# Pipeline:
#   1. Cria temp dir com o fixture do bun audit (--results-file) — shape real
#      do `bun audit --json`: { [pacote]: [advisory {url, severity, title}] }
#   2. CONTROLE: --update gera o baseline; run limpo → exit 0 ('nenhum NOVO')
#   3. MUTAÇÃO A: advisory HIGH novo (sharp) → guard DEVE FALHAR (exit 1)
#   4. MUTAÇÃO B: advisory MODERATE novo (uuid) com --min-severity high →
#      guard NÃO deve falhar (exit 0 + aviso 'não bloqueiam')
#   5. Cleanup (trap EXIT — rm -rf do temp)
#
# Usage:
#   ./scripts/test-mutation-bun-audit-baseline.sh
#
# Exit codes:
#   0 — mutações DETECTADAS pelo guard (falhou pelas asserções esperadas) ✅
#   1 — guard CEGO (passou com a mutação A / falhou a B) OU infra ❌
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/check-bun-audit-baseline.mjs"

TMP_DIR="$(mktemp -d)"
AUDIT="$TMP_DIR/audit.json"
BASELINE="$TMP_DIR/baseline.json"

# ── Asserções esperadas (mensagens do guard quando detecta as mutações) ──
# Fonte: scripts/check-bun-audit-baseline.mjs (main):
#   bloqueio  → '🔓 check-bun-audit-baseline: N achado(s) NOVO(s) de severidade >= 'high' ...:\n#               • <pkg>  [<sev>]  <url>'
#   aviso     → '⚠️  N achado(s) de severidade abaixo de '<min>' (não bloqueiam ...)' —
#               o <min> é o valor RUNTIME do --min-severity (ex.: 'high'), não um literal.
#
# ⚠️ Source-coupled: estas strings reproduzem a mensagem EXATA do guard. Se
# a mensagem for reformulada em scripts/check-bun-audit-baseline.mjs, o
# mutation test falha com 'não pela asserção esperada' (não é guard cego —
# é o esperado por acoplamento; atualizar as duas juntas).
EXPECTED_BLOCKING="NOVO"
EXPECTED_HIGH_FILE="sharp"
EXPECTED_WARNING="não bloqueiam"
EXPECTED_MODERATE_FILE="uuid"

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

# ── build_audit: (re)escreve o fixture do bun audit ─────────────────────
# Shape real do `bun audit --json` (v1.3.14, 08/2026): objeto chaveado por
# pacote com array de advisories (url GHSA, severity, title).
build_audit() {
  cat > "$AUDIT" <<'EOF'
{
  "lodash": [
    {"url": "https://github.com/advisories/GHSA-lodash-1", "severity": "moderate", "title": "lodash proto pollution"}
  ],
  "next": [
    {"url": "https://github.com/advisories/GHSA-next-1", "severity": "high", "title": "next vuln"}
  ]
}
EOF
}

# ── run_guard: roda o guard no temp dir (cwd = temp — paths relativos) ──
run_guard() {
  set +e
  OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" "$@" 2>&1)"
  EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (check-bun-audit-baseline deve GATEAR)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# STEP 1+2 — Fixture + CONTROLE (audit limpo → exit 0)
# ═════════════════════════════════════════════════════════════════════════

info "STEP 1: Criando fixture do bun audit em $TMP_DIR..."

build_audit

info "STEP 2: Controle — --update gera o baseline; audit limpo deve PASS (exit 0)..."

set +e
UPDATE_OUTPUT="$(cd "$TMP_DIR" && node "$GUARD" --baseline baseline.json --results-file audit.json --update 2>&1)"
UPDATE_EXIT=$?
set -e

if [ "$UPDATE_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: --update não gerou o baseline (exit $UPDATE_EXIT)."
  echo "$UPDATE_OUTPUT" | tail -10
  exit 1
fi
if [ ! -f "$BASELINE" ]; then
  fail "CONTROLE FALHOU: baseline.json não foi criado pelo --update."
  exit 1
fi

run_guard --baseline baseline.json --results-file audit.json
if [ "$EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: guard rejeitou o audit LIMPO (exit $EXIT)."
  echo "$OUTPUT" | tail -10
  fail "O fixture base não é válido — o mutation test não pode prosseguir."
  exit 1
fi
pass "Controle OK — audit limpo passa no guard (exit 0, baseline com 2 achados)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 3+4 — MUTAÇÃO A (advisory HIGH novo): deve FALHAR
# ═════════════════════════════════════════════════════════════════════════

info "STEP 3: Aplicando mutação A — pacote sharp com advisory HIGH novo..."

cat > "$AUDIT" <<'EOF'
{
  "lodash": [
    {"url": "https://github.com/advisories/GHSA-lodash-1", "severity": "moderate", "title": "lodash proto pollution"}
  ],
  "next": [
    {"url": "https://github.com/advisories/GHSA-next-1", "severity": "high", "title": "next vuln"}
  ],
  "sharp": [
    {"url": "https://github.com/advisories/GHSA-sharp-new", "severity": "high", "title": "sharp RCE"}
  ]
}
EOF

info "STEP 4: Rodando guard contra a mutação A (HIGH novo)..."
run_guard --baseline baseline.json --results-file audit.json
echo "$OUTPUT" | tail -6

# Caso 1 — guard CEGO: PASS com a mutação. O findNewFindings foi removido/
# enfraquecido. Este é o cenário que o mutation test existe para BLOQUEAR.
if [ "$EXIT" -eq 0 ]; then
  fail "GUARD CEGO (HIGH novo): check-bun-audit-baseline passou com advisory"
  fail "HIGH novo (exit 0). Verifique se findNewFindings ainda acusa"
  fail "assinatura fora do baseline em scripts/check-bun-audit-baseline.mjs."
  exit 1
fi

# Caso 2 — falhou, mas NÃO pela asserção esperada (outro invariante quebrou).
if ! echo "$OUTPUT" | grep -Fq "$EXPECTED_BLOCKING" || ! echo "$OUTPUT" | grep -Fq "$EXPECTED_HIGH_FILE"; then
  fail "Guard falhou (exit $EXIT) mas NÃO pela asserção esperada:"
  fail "  esperava (mensagem): $EXPECTED_BLOCKING"
  fail "  esperava (arquivo):  $EXPECTED_HIGH_FILE"
  fail "Falha pode ser outro invariante do fixture — veja o output acima."
  exit 1
fi

pass "Mutação A DETECTADA: guard falhou com '🔓 $EXPECTED_BLOCKING' (exit $EXIT)"

# ═════════════════════════════════════════════════════════════════════════
# STEP 5+6 — MUTAÇÃO B (MODERATE novo + --min-severity alta): NÃO falha
# ═════════════════════════════════════════════════════════════════════════

info "STEP 5: Aplicando mutação B — pacote uuid com advisory MODERATE novo..."

cat > "$AUDIT" <<'EOF'
{
  "lodash": [
    {"url": "https://github.com/advisories/GHSA-lodash-1", "severity": "moderate", "title": "lodash proto pollution"}
  ],
  "next": [
    {"url": "https://github.com/advisories/GHSA-next-1", "severity": "high", "title": "next vuln"}
  ],
  "uuid": [
    {"url": "https://github.com/advisories/GHSA-uuid-new", "severity": "moderate", "title": "uuid issue"}
  ]
}
EOF

info "STEP 6: Rodando guard com --min-severity high contra a mutação B..."
run_guard --baseline baseline.json --results-file audit.json --min-severity high
echo "$OUTPUT" | tail -6

# Caso 1 — guard FALHOU com moderate + min alta: o filtro de severidade
# quebrou (moderate virou bloqueante). BLOQUEIA o mutation test.
if [ "$EXIT" -ne 0 ]; then
  fail "GUARD FALHOU com MODERATE novo + --min-severity high (exit $EXIT):"
  fail "o filtro de severidade não está eximindo severidade menor — moderate"
  fail "não deveria bloquear com min=high."
  exit 1
fi

# Caso 2 — passou, mas SEM o aviso de severidade menor (guard mudo).
if ! echo "$OUTPUT" | grep -Fq "$EXPECTED_WARNING" || ! echo "$OUTPUT" | grep -Fq "$EXPECTED_MODERATE_FILE"; then
  fail "Guard passou (exit 0) mas NÃO emitiu o aviso esperado:"
  fail "  esperava (aviso): $EXPECTED_WARNING"
  fail "  esperava (pacote): $EXPECTED_MODERATE_FILE"
  exit 1
fi

pass "Mutação B tratada: MODERATE novo com min=high virou AVISO (exit 0), não falha"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o guard de bun audit pega advisory HIGH novo"
pass "(exit 1) e exime MODERATE com --min-severity high (aviso, exit 0)"
exit 0
