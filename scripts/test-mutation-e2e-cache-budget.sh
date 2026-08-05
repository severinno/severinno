#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-e2e-cache-budget.sh — Mutation test do GATE DE BUDGET
# do job 'E2E Cache' (measure-e2e-cache.mjs, espelho do measure-mutation-timing)
#
# Prova que o gate de overhead do e2e-cache REALMENTE pega a regressão que
# ele existe para matar: um payload do job 'E2E Cache' com durationSecs > 600
# (o job estourou o budget de 10 min) deve fazer o script sair com exit 1
# (::error:: + report.exceeded=true) — end-to-end no CI, NÃO só no teste
# unitário. A regressão real que o gate protege: o e2e-cache (PostGIS + Redis
# + build Next.js + Playwright) fica mais lento e o custo por PR sobe sem
# ninguém perceber — o budget duro 600s existe para acender.
#
# ⚠️ SKIP GATE: o medidor scripts/measure-e2e-cache.mjs AINDA NÃO foi criado.
# Este mutation test é o PROJETO do gate (mesma interface do timing-budget:
# --jobs-file + --max/--warn + exit 0/1/2 com zone/exceeded) e fica PRONTO
# para ativar automaticamente: enquanto o arquivo do medidor não existir, o
# script roda em modo SKIP (exit 0 + mensagem clara, sem falhar o master nem
# o check-mutation-jobs); no momento em que measure-e2e-cache.mjs for criado
# com essa interface, o mutation test passa a exercer as asserções reais —
# sem nenhuma mudança neste arquivo.
#
# Usage:
#   ./scripts/test-mutation-e2e-cache-budget.sh
#
# Exit codes:
#   0 — SKIP (medidor ainda não criado) OU regressão DETECTADA (900s → exit
#       1, 300s → exit 0, 500s → exit 0 + ::warning::, drift renomeado →
#       exit 2) ✅
#   1 — gate cego (900s saiu exit 0) OU controle quebrou (300s não passou)
#       OU faixa warn quebrou (500s não alertou) OU drift quebrou (renomeado
#       não saiu exit 2) OU falha de infra/asserção ❌
#
#   CONTROLE — payload com step de 300s (DENTRO do budget warn 480s) → o
#     medidor deve sair exit 0 com report.zone='ok' (o gate NÃO é over-eager:
#     payload saudável não falha);
#   WARN — payload com step de 500s (faixa SOFT: warn 480s < 500s <= max
#     600s) → exit 0 + ::warning:: + report.zone='warn' (ruído de runner
#     tolerado SEM perder a observabilidade);
#   MUTAÇÃO — payload com step de 900s (ACIMA do budget DURO 600s de 10 min)
#     → exit 1 com report.exceeded=true + zone='fail' (o gate falha — a
#     regressão de overhead do e2e-cache é detectada);
#   DRIFT — fixture com job E step renomeados (markers não casam) → exit 2
#     com 'drift de contrato' + found=false (a OUTRA coisa que o medidor
#     acusa, além do estouro: renomeação de contrato não pode passar em
#     silêncio como medição vazia).
#
# Se o gate mutado (900s) sair com exit 0, o teste unitário passaria MESMO
# com a regressão — guard cego — e o script falha (exit 1), bloqueando o CI.
# Os fixtures são criados em mktemp (JSON jobs API espelhando os MARKERS
# reais do e2e-cache.yml); NENHUM arquivo do repo real é tocado — o
# measure-e2e-cache.mjs roda em modo --jobs-file (sem gh, sem rede).
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/measure-e2e-cache.mjs"

# Markers REAIS do e2e-cache.yml (fonte única: o nome do job e do step no
# workflow; o guard futuro os exporta — aqui duplicados como const).
JOB_NAME="E2E Cache"
STEP_NAME="Run Playwright cache tests"

# DUAS FAIXAS do budget — espelham os --max/--warn que o job do CI usará
# quando o medidor for wireado: 600s DURO (10 min, faixa fail → exit 1) +
# 480s SOFT (8 min, faixa warn → ::warning:: + exit 0).
BUDGET_MAX=600
BUDGET_WARN=480

# ── Colors ────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

# ── SKIP GATE — medidor ainda não criado? Ativa sozinho quando existir ────
# O mutation test é o PROJETO do gate (interface documentada no header).
# Enquanto scripts/measure-e2e-cache.mjs não existir, NÃO há guard para
# exercer — rodar as asserções falharia por motivo errado (arquivo ausente).
# SKIP com exit 0 + mensagem clara mantém o master e o check-mutation-jobs
# verdes; o dia em que o medidor for criado, este script acorda sozinho.
if [ ! -f "$GUARD" ]; then
  echo ""
  info "⏭️  SKIP — scripts/measure-e2e-cache.mjs ainda NÃO foi criado."
  info "   O gate de budget de 10 min (600s) do job 'E2E Cache' está PROJETADO"
  info "   neste mutation test (mesma interface do timing-budget: --jobs-file,"
  info "   --max 600 duro + --warn 480 soft, exit 0/1/2 com zone/exceeded)."
  info "   Quando o medidor for criado com essa interface, este script ativa"
  info "   automaticamente e passa a provar o budget end-to-end no CI."
  echo ""
  pass "SKIP OK — medidor ausente, mutation test pronto e adormecido (exit 0)"
  exit 0
fi

# ── Cleanup (trap EXIT — SEMPRE remove o temp, mesmo com falha) ──────────
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ── build_fixture: gera o payload da jobs API com o step na duração dada ──
# $1 = arquivo de saída; $2 = started_at; $3 = completed_at.
# O payload usa o shape REAL da jobs API ({ total_count, jobs: [...] }) com
# os markers de contrato exatos — o extractE2eCacheStep do guard só acha o
# step se job E step casarem com os nomes do e2e-cache.yml.
build_fixture() {
  local out="$1"
  local started="$2"
  local completed="$3"
  cat > "$out" <<EOF
{
  "total_count": 1,
  "jobs": [
    {
      "name": "$JOB_NAME",
      "steps": [
        {
          "name": "$STEP_NAME",
          "started_at": "$started",
          "completed_at": "$completed",
          "conclusion": "success"
        }
      ]
    }
  ]
}
EOF
}

# ── build_drift_fixture: payload SEM os markers (job E step renomeados) ──
# Simula a regressão real de contrato: alguém renomeou o job/step do
# e2e-cache.yml. O nome do job mutado NÃO pode conter o substring 'E2E Cache'
# (o guard acha por .includes()) — espelho do cuidado do timing-budget.
build_drift_fixture() {
  local out="$1"
  local started="$2"
  local completed="$3"
  cat > "$out" <<EOF
{
  "total_count": 1,
  "jobs": [
    {
      "name": "Cache Validation (novo nome do job)",
      "steps": [
        {
          "name": "Run Playwright headers (novo nome do step)",
          "started_at": "$started",
          "completed_at": "$completed",
          "conclusion": "success"
        }
      ]
    }
  ]
}
EOF
}

# ── run_guard: roda o measure-e2e-cache.mjs com --jobs-file + budget ─────
# $1 = fixture; demais args = flags extras (ex.: --warn-only).
# Retorna via GUARD_OUTPUT/GUARD_EXIT.
run_guard() {
  local fixture="$1"
  shift
  set +e
  GUARD_OUTPUT="$(node "$GUARD" --jobs-file "$fixture" --max "$BUDGET_MAX" --warn "$BUDGET_WARN" "$@" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (gate de budget 600/480s do e2e-cache)"
echo "   Fixtures: payload jobs API com steps de 300s (controle), 500s (faixa"
echo "   soft) e 900s (faixa dura, > 10 min) + drift renomeado (exit 2)"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── 1. CONTROLE — 300s (faixa OK: <= warn 480s) → exit 0 + zone=ok ─────
CONTROL_FIXTURE="$TMP_DIR/control-300s.json"
build_fixture "$CONTROL_FIXTURE" "2026-08-02T20:16:40Z" "2026-08-02T20:21:40Z"

info "Controle — payload de 300s (faixa OK, <= warn 480s) deve sair exit 0..."
run_guard "$CONTROL_FIXTURE"
echo "$GUARD_OUTPUT" | tail -6

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: payload de 300s saiu com exit $GUARD_EXIT (esperado 0)."
  fail "O gate está over-eager — payload saudável não deveria falhar."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"exceeded": false'; then
  fail "CONTROLE FALHOU: report.exceeded não é false para 300s."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "ok"'; then
  fail "CONTROLE FALHOU: report.zone não é 'ok' para 300s."
  exit 1
fi
pass "Controle OK — 300s → exit 0, zone=ok, exceeded=false (gate não é over-eager)"

# ── 1b. WARN — 500s (faixa SOFT: 480 < 500 <= 600) → exit 0 + ::warning:: ─
WARN_FIXTURE="$TMP_DIR/warn-500s.json"
build_fixture "$WARN_FIXTURE" "2026-08-02T20:16:40Z" "2026-08-02T20:25:00Z"

info "Faixa soft — payload de 500s (warn 480s < 500s <= max 600s) deve sair exit 0 com ::warning::..."
run_guard "$WARN_FIXTURE"
echo "$GUARD_OUTPUT" | head -2

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "FAIXA WARN FALHOU: 500s saiu com exit $GUARD_EXIT (esperado 0)."
  fail "Ruído de runner intermediário não deveria falhar o CI — só alertar."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "::warning::budget de payload na faixa de WARN"; then
  fail "FAIXA WARN FALHOU: ::warning:: da faixa soft ausente para 500s."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "warn"'; then
  fail "FAIXA WARN FALHOU: report.zone não é 'warn' para 500s."
  exit 1
fi
pass "Faixa soft OK — 500s → exit 0 + ::warning:: + zone=warn (ruído tolerado)"

# ── 2. MUTAÇÃO — 900s (acima do budget DURO 600s = 10 min) → exit 1 ─────
MUT_FIXTURE="$TMP_DIR/mutation-900s.json"
build_fixture "$MUT_FIXTURE" "2026-08-02T20:16:40Z" "2026-08-02T20:31:40Z"

info "Mutação — payload de 900s (ACIMA do budget duro 600s de 10 min) deve sair exit 1..."
run_guard "$MUT_FIXTURE"
echo "$GUARD_OUTPUT" | tail -6

if [ "$GUARD_EXIT" -ne 1 ]; then
  if [ "$GUARD_EXIT" -eq 2 ]; then
    fail "DRIFT DE CONTRATO: payload de 900s saiu com exit 2 (esperado 1 — budget)."
    fail "Os markers do fixture não casaram com o e2e-cache.yml real — verifique"
    fail "JOB_NAME/STEP_NAME no topo deste script (o teste falharia por motivo errado)."
  else
    fail "GUARD CEGA: payload de 900s saiu com exit $GUARD_EXIT (esperado 1)."
    fail "O teste unitário passaria MESMO com a regressão de overhead — o gate"
    fail "não pega o estouro do budget de 10 min do e2e-cache. Mutation test falha."
  fi
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "budget de payload EXCEDIDO"; then
  fail "GUARD CEGA: mensagem 'budget de payload EXCEDIDO' ausente no exit 1."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"exceeded": true'; then
  fail "GUARD CEGA: report.exceeded não é true para 900s."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "fail"'; then
  fail "GUARD CEGA: report.zone não é 'fail' para 900s."
  exit 1
fi
pass "Regressão DETECTADA: 900s → exit 1, zone=fail, exceeded=true, mensagem clara"

# ── 3. DRIFT — job E step renomeados (markers não casam) → exit 2 ────────
DRIFT_FIXTURE="$TMP_DIR/drift-renamed.json"
build_drift_fixture "$DRIFT_FIXTURE" "2026-08-02T20:16:40Z" "2026-08-02T20:21:40Z"

info "Drift — fixture SEM os markers 'E2E Cache'/'Run Playwright cache tests' deve sair exit 2..."
run_guard "$DRIFT_FIXTURE"
echo "$GUARD_OUTPUT" | tail -5

if [ "$GUARD_EXIT" -ne 2 ]; then
  fail "DRIFT CEGO: fixture renomeado saiu com exit $GUARD_EXIT (esperado 2)."
  fail "A renomeação do job/step do e2e-cache.yml passaria em SILÊNCIO como"
  fail "medição vazia — o medidor não acusa o drift de contrato. Mutation test falha."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "drift de contrato"; then
  fail "DRIFT CEGO: mensagem 'drift de contrato' ausente no exit 2."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"found": false'; then
  fail "DRIFT CEGO: report.found não é false no exit 2."
  exit 1
fi
pass "Drift DETECTADO: job/step renomeados → exit 2 + 'drift de contrato' + found=false"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o gate de budget 600/480s do e2e-cache cobre:"
pass "  • controle: 300s → exit 0, zone=ok (gate não é over-eager)"
pass "  • faixa soft: 500s → exit 0 + ::warning::, zone=warn (ruído tolerado)"
pass "  • mutação: 900s → exit 1, zone=fail, exceeded=true (10 min estourado, DETECTADO)"
pass "  • drift: job/step renomeados → exit 2 + 'drift de contrato', found=false"
pass "Nenhum arquivo do repo real foi tocado (fixtures em mktemp)."
exit 0
