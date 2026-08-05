#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-timing-budget.sh — Mutation test do GATE DE BUDGET
# do measure-mutation-timing.mjs em DUAS FAIXAS (fixtures do teste: --max
# 240 duro + --warn 180 soft — em produção o soft é a baseline var)
#
# Prova que o gate de overhead do contrato coordenado REALMENTE pega a
# regressão que ele existe para matar, SEM o ruído de runner nas faixas
# intermediárias: um payload do mutation-coord-update com durationSecs > 240
# (o step 'Run mutation test' estourou o budget DURO) deve fazer o script
# sair com exit 1 (::error:: + report.exceeded=true) — end-to-end no CI,
# NÃO só no teste unitário. A regressão real que o gate protege: o contrato
# coordenado fica mais lento (5 cenários → 6 runs de vitest) e o custo por
# PR sobe sem ninguém perceber — o gate duro 240s existe para acender.
#
# Usage:
#   ./scripts/test-mutation-timing-budget.sh
#
# Exit codes:
#   0 — regressão DETECTADA (300s → exit 1, 35s → exit 0, 200s → exit 0 +
#       ::warning::, act-log 300s → exit 1, act-log 35s → exit 0, act-log
#       infra → exit 1, publish 35s → exit 0, publish 300s → exit 1,
#       warn-only → exit 0 + ::warning::) ✅
#   1 — gate cego (300s saiu exit 0) OU controle quebrou (35s não passou)
#       OU faixa warn quebrou (200s não alertou) OU act-log quebrou (300s
#       não falhou / 35s falhou / infra não diagnosticou) OU publish quebrou
#       OU falha de infra/asserção ❌
#
#   CONTROLE — payload com step de 35s (DENTRO do budget warn 180s) → o
#     script deve sair exit 0 com report.zone='ok' (o gate NÃO é over-eager:
#     payload saudável não falha) — prova que o fixture válido não acende;
#   WARN — payload com step de 200s (faixa SOFT: warn 180s < 200s <= max
#     240s) → exit 0 + ::warning:: + report.zone='warn' (ruído de runner
#     tolerado SEM perder a observabilidade — a faixa intermediária alerta,
#     não falha);
#   MUTAÇÃO — payload com step de 300s (ACIMA do budget DURO 240s) → o
#     script deve sair exit 1 com report.exceeded=true + zone='fail' (o gate
#     falha — a regressão é detectada);
#   ACT-LOG — log do act com o step de 300s (medição via act, sem jobs API)
#     → exit 1 + zone='fail' (cobre PRs que ainda não têm o seed-guards.yml
#     na branch DEFAULT: o reusable não roda no CI real, o act re-executa o
#     job com a imagem ubuntu-bun e o guard mede a duração do log — a mesma
#     regressão de 300s deve falhar);
#   ACT-LOG CONTROLE — log com step de 35s → exit 0 + zone='ok' (via act
#     também não é over-eager);
#   ACT-LOG INFRA — log SEM o step + --act-exit 1 (act morreu cedo, ex.:
#     imagem não publicada) → exit 1 + diagnóstico claro (o --act-exit
#     distingue infra de drift, espelhando o check-tier1-fastpath);
#   WARN-ONLY — a MESMA mutação com --warn-only → exit 0 + ::warning:: no
#     stdout (o modo não-bloqueante NÃO mascara a detecção — o alerta
#     acende);
#   PUBLISH — o baseline auto-atualizado (--publish-baseline, dry-run): 35s
#     ok → publica 42 (margem 0.2) com exit 0; 300s fail → NÃO publica (run
#     lento não ratcheta o baseline) com exit 1. NOVE direções do mesmo
#     gate: saudável / faixa warn / estourado / act-log (estourado +
#     controle + infra) / publish (ok + fail) / alerta.
#
# Se o gate mutado (300s) sair com exit 0, o teste unitário passaria MESMO
# com a regressão — guard cego — e o script falha (exit 1), bloqueando o CI.
# Os fixtures são criados em mktemp (JSON jobs API espelhando os MARKERS
# reais do seed-guards.yml); NENHUM arquivo do repo real é tocado — o
# measure-mutation-timing.mjs roda em modo --jobs-file (sem gh, sem rede).
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$SCRIPT_DIR/scripts/measure-mutation-timing.mjs"

# Guard do tier-1 (não usado aqui diretamente — só documenta a paridade da
# técnica de parse): o --act-log do measure-mutation-timing reusa o MESMO
# extractDurationFromLine do check-tier1-fastpath (check-setup-bun-common.mjs).

TMP_DIR="$(mktemp -d)"

# Markers REAIS do seed-guards.yml (fonte única: o próprio guard os exporta;
# aqui duplicados como const — o vitest do workflow já trava o par script↔yml).
JOB_NAME="Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)"
STEP_NAME="Run mutation test (contrato coordenado — 5 cenários, 2 elos)"

# DUAS FAIXAS do budget — espelham os --max/--warn dos jobs de CI
# (pr-check.yml mutation-coord-timing-guard + benchmark-weekly.yml
# mutation-coord-timing): 240s DURO (faixa fail → exit 1) + 180s SOFT
# (faixa warn → ::warning:: + exit 0). Ajustes AQUI e nos jobs devem ser
# coordenados (o vitest do workflow trava o par script↔yml).
BUDGET_MAX=240
BUDGET_WARN=180

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

# ── build_fixture: gera o payload da jobs API com o step na duração dada ──
# $1 = arquivo de saída; $2 = started_at; $3 = completed_at.
# O payload usa o shape REAL da jobs API ({ total_count, jobs: [...] }) com
# os markers de contrato exatos — o extractMutationStep do guard só acha o
# step se job E step casarem com os nomes do seed-guards.yml.
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

# ── run_guard: roda o measure-mutation-timing.mjs com --jobs-file + budget ──
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

# ── build_act_log_fixture: log do act com a linha de sucesso do step ─────
# $1 = arquivo de saída; $2 = duração em segundos.
# O log espelha o formato REAL do act (0.2.89): a linha
# 'Success - Main <step> [X.XXs]' que o extractDurationFromLine parseia —
# a MESMA técnica do check-tier1-fastpath.mjs. O modo --act-log do guard
# cobre PRs que ainda não têm o seed-guards.yml na branch DEFAULT (o
# reusable não roda no CI real → jobs API vazia; o act roda o job com a
# imagem ubuntu-bun e o log é a única fonte de medição).
build_act_log_fixture() {
  local out="$1"
  local secs="$2"
  cat > "$out" <<EOF
[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ⭐ Run Main bun run test:mutation-coord-update
[Mutation Test (contrato coordenado — doc↔anchor↔código, 5 cenários)/Run mutation test (contrato coordenado — 5 cenários, 2 elos)] ✅  Success - Main $STEP_NAME [${secs}s]
EOF
}

# ── run_act_log_guard: roda o medidor em modo --act-log (mesmo gate) ─────
# $1 = fixture (log do act); $2 = --act-exit opcional (0 = exit 0 do act).
run_act_log_guard() {
  local fixture="$1"
  local act_exit="${2:-0}"
  set +e
  GUARD_OUTPUT="$(node "$GUARD" --act-log "$fixture" --max "$BUDGET_MAX" --warn "$BUDGET_WARN" --act-exit "$act_exit" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (gate de budget 240/180s do mutation-coord)"
echo "   Fixtures: payload jobs API com steps de 35s (controle), 200s (faixa"
echo "   soft) e 300s (faixa dura) + logs do act (300s estourado, 35s controle,"
echo "   vazio+infra) — markers reais do seed-guards.yml"
echo "  ═════════════════════════════════════════════════════════════════"
echo ""

# ── 1. CONTROLE — 35s (faixa OK: <= warn 180s) → exit 0 + zone=ok ─────
CONTROL_FIXTURE="$TMP_DIR/control-35s.json"
build_fixture "$CONTROL_FIXTURE" "2026-08-02T20:16:40Z" "2026-08-02T20:17:15Z"

info "Controle — payload de 35s (faixa OK, <= warn 180s) deve sair exit 0..."
run_guard "$CONTROL_FIXTURE"
echo "$GUARD_OUTPUT" | tail -6

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "CONTROLE FALHOU: payload de 35s saiu com exit $GUARD_EXIT (esperado 0)."
  fail "O gate está over-eager — payload saudável não deveria falhar."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"exceeded": false'; then
  fail "CONTROLE FALHOU: report.exceeded não é false para 35s."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "ok"'; then
  fail "CONTROLE FALHOU: report.zone não é 'ok' para 35s."
  exit 1
fi
pass "Controle OK — 35s → exit 0, zone=ok, exceeded=false (gate não é over-eager)"

# ── 1b. WARN — 200s (faixa SOFT: 180 < 200 <= 240) → exit 0 + ::warning:: ─
WARN_FIXTURE="$TMP_DIR/warn-200s.json"
build_fixture "$WARN_FIXTURE" "2026-08-02T20:16:40Z" "2026-08-02T20:20:00Z"

info "Faixa soft — payload de 200s (warn 180s < 200s <= max 240s) deve sair exit 0 com ::warning::..."
run_guard "$WARN_FIXTURE"
echo "$GUARD_OUTPUT" | head -2

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "FAIXA WARN FALHOU: 200s saiu com exit $GUARD_EXIT (esperado 0)."
  fail "Ruído de runner intermediário não deveria falhar o CI — só alertar."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "::warning::budget de payload na faixa de WARN"; then
  fail "FAIXA WARN FALHOU: ::warning:: da faixa soft ausente para 200s."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "warn"'; then
  fail "FAIXA WARN FALHOU: report.zone não é 'warn' para 200s."
  exit 1
fi
pass "Faixa soft OK — 200s → exit 0 + ::warning:: + zone=warn (ruído tolerado)"

# ── 2. MUTAÇÃO — 300s (acima do budget DURO 240s) → exit 1 + zone=fail ──
MUT_FIXTURE="$TMP_DIR/mutation-300s.json"
build_fixture "$MUT_FIXTURE" "2026-08-02T20:16:40Z" "2026-08-02T20:21:40Z"

info "Mutação — payload de 300s (ACIMA do budget duro 240s) deve sair exit 1..."
run_guard "$MUT_FIXTURE"
echo "$GUARD_OUTPUT" | tail -6

if [ "$GUARD_EXIT" -ne 1 ]; then
  if [ "$GUARD_EXIT" -eq 2 ]; then
    fail "DRIFT DE CONTRATO: payload de 300s saiu com exit 2 (esperado 1 — budget)."
    fail "Os markers do fixture não casaram com o seed-guards.yml real — verifique"
    fail "JOB_NAME/STEP_NAME no topo deste script (o teste falharia por motivo errado)."
  else
    fail "GUARD CEGA: payload de 300s saiu com exit $GUARD_EXIT (esperado 1)."
    fail "O teste unitário passaria MESMO com a regressão de overhead — o gate"
    fail "não pega o estouro do budget. O mutation test falha."
  fi
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "budget de payload EXCEDIDO"; then
  fail "GUARD CEGA: mensagem 'budget de payload EXCEDIDO' ausente no exit 1."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"exceeded": true'; then
  fail "GUARD CEGA: report.exceeded não é true para 300s."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "fail"'; then
  fail "GUARD CEGA: report.zone não é 'fail' para 300s."
  exit 1
fi
pass "Regressão DETECTADA: 300s → exit 1, zone=fail, exceeded=true, mensagem clara"

# ── 2b. ACT-LOG — log do act com 300s (via act, sem jobs API) → exit 1 ──
# Cobre a medição de PRs que ainda não têm o seed-guards.yml na default:
# o reusable não roda no CI real, então o job mutation-coord-timing-act-guard
# do pr-check.yml re-executa o job via act (imagem ubuntu-bun) e o guard
# mede a duração do log. A mesma regressão (300s > duro 240s) deve falhar
# exit 1 — prova que o modo --act-log pega o estouro end-to-end.
ACTLOG_FIXTURE="$TMP_DIR/actlog-300s.log"
build_act_log_fixture "$ACTLOG_FIXTURE" "300"

info "Act-log — log do act com step de 300s (ACIMA do duro 240s) deve sair exit 1..."
run_act_log_guard "$ACTLOG_FIXTURE"
echo "$GUARD_OUTPUT" | tail -6

if [ "$GUARD_EXIT" -ne 1 ]; then
  fail "ACT-LOG CEGO: log de 300s saiu com exit $GUARD_EXIT (esperado 1)."
  fail "O modo --act-log não pega o estouro do budget — a medição via act"
  fail "falharia em silêncio em PRs sem seed-guards na default. Mutation test falha."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "budget de payload EXCEDIDO"; then
  fail "ACT-LOG CEGO: mensagem 'budget de payload EXCEDIDO' ausente no exit 1."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"exceeded": true'; then
  fail "ACT-LOG CEGO: report.exceeded não é true para o log de 300s."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "fail"'; then
  fail "ACT-LOG CEGO: report.zone não é 'fail' para o log de 300s."
  exit 1
fi
pass "Act-log OK — 300s no log do act → exit 1, zone=fail, exceeded=true (gate pega via act)"

# ── 2c. ACT-LOG CONTROLE — log com 35s → exit 0 (via act, não over-eager) ─
ACTLOG_OK_FIXTURE="$TMP_DIR/actlog-35s.log"
build_act_log_fixture "$ACTLOG_OK_FIXTURE" "35"

info "Act-log controle — log com step de 35s (faixa OK) deve sair exit 0..."
run_act_log_guard "$ACTLOG_OK_FIXTURE"
echo "$GUARD_OUTPUT" | tail -4

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "ACT-LOG OVER-EAGER: log de 35s saiu com exit $GUARD_EXIT (esperado 0)."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "ok"'; then
  fail "ACT-LOG OVER-EAGER: report.zone não é 'ok' para o log de 35s."
  exit 1
fi
pass "Act-log controle OK — 35s → exit 0, zone=ok (via act não é over-eager)"

# ── 2d. ACT-LOG INFRA — act morreu antes do step → exit 1 com diagnóstico ─
# Log SEM a linha de sucesso do step + --act-exit 1 (act falhou cedo — ex.:
# imagem não publicada): o guard deve falhar exit 1 com a mensagem de infra,
# NÃO drift exit 2 (o --act-exit distingue as duas causas).
ACTLOG_EMPTY="$TMP_DIR/actlog-empty.log"
printf '[job/step] ❌  Error - Main Run actions/checkout@v4\n' > "$ACTLOG_EMPTY"

info "Act-log infra — log sem o step + --act-exit 1 (act morreu cedo) deve sair exit 1..."
run_act_log_guard "$ACTLOG_EMPTY" "1"
echo "$GUARD_OUTPUT" | tail -4

if [ "$GUARD_EXIT" -ne 1 ]; then
  fail "ACT-LOG INFRA: log vazio + --act-exit 1 saiu com exit $GUARD_EXIT (esperado 1)."
  fail "O diagnóstico de act morto-antes-do-step não está funcionando."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "act falhou ANTES do step"; then
  fail "ACT-LOG INFRA: mensagem 'act falhou ANTES do step' ausente."
  exit 1
fi
pass "Act-log infra OK — act morto-cedo → exit 1 + diagnóstico claro (não vira drift mudo)"

# ── 2e. PUBLISH — baseline auto-atualizado (--publish-baseline, dry-run) ─
# O semanal publica o tempo medido como repository variable MUTATION_TIMING_BASELINE
# (gh variable set) quando o budget PASSOU — os jobs do gate consultam a var em
# vez do literal 180. DRY-RUN (env MEASURE_MUTATION_TIMING_DRY_PUBLISH=1): sem gh
# real, o report carrega baseline.published="dry-run" + o ::notice:: com o valor.
#   • 35s (zone ok) → publica 42 (35 * 1.2, margem default 0.2) + exit 0
#   • 300s (zone fail) → NÃO publica (run lento não ratcheta o baseline) + exit 1
# Se o guard perdesse o wiring (publicar em fail, valor errado, margem ignorada),
# uma das duas asserções falha — o mutation test bloqueia.
run_publish_guard() {
  local fixture="$1"
  set +e
  GUARD_OUTPUT="$(MEASURE_MUTATION_TIMING_DRY_PUBLISH=1 node "$GUARD" --jobs-file "$fixture" --max "$BUDGET_MAX" --warn "$BUDGET_WARN" --publish-baseline MUTATION_TIMING_BASELINE 2>&1)"
  GUARD_EXIT=$?
  set -e
}

info "Publish — 35s (zone ok) com --publish-baseline deve publicar baseline 42 (dry-run)..."
run_publish_guard "$CONTROL_FIXTURE"
echo "$GUARD_OUTPUT" | grep -E 'gh variable set|baseline' | head -3

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "PUBLISH FALHOU: 35s + --publish-baseline saiu com exit $GUARD_EXIT (esperado 0)."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '\[dry-run\] gh variable set MUTATION_TIMING_BASELINE 42'; then
  fail "PUBLISH FALHOU: ::notice:: do dry-run com valor 42 ausente (margem 0.2 sobre 35s)."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"published": "dry-run"'; then
  fail "PUBLISH FALHOU: report.baseline.published não é dry-run."
  exit 1
fi
pass "Publish ok — 35s → baseline 42 publicado (dry-run), exit 0 (budget passou = publica)"

info "Publish — 300s (zone fail) com --publish-baseline NÃO deve publicar (run lento não ratcheta o baseline)..."
run_publish_guard "$MUT_FIXTURE"
echo "$GUARD_OUTPUT" | grep -E 'EXCEDIDO|baseline' | head -3

if [ "$GUARD_EXIT" -ne 1 ]; then
  fail "PUBLISH-FAIL FALHOU: 300s + --publish-baseline saiu com exit $GUARD_EXIT (esperado 1 — gate)."
  exit 1
fi
if echo "$GUARD_OUTPUT" | grep -q 'gh variable set'; then
  fail "PUBLISH-FAIL FALHOU: publicou baseline com o budget EXCEDIDO — run lento viraria o novo normal."
  exit 1
fi
pass "Publish-fail OK — 300s → exit 1 SEM publicar (fail não ratcheta o baseline)"

# ── 3. WARN-ONLY — a mesma mutação, modo não-bloqueante → exit 0 + warning ─
info "Warn-only — 300s com --warn-only deve sair exit 0 com ::warning::..."
run_guard "$MUT_FIXTURE" "--warn-only"
echo "$GUARD_OUTPUT" | head -2

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "WARN-ONLY FALHOU: --warn-only saiu com exit $GUARD_EXIT (esperado 0)."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "::warning::budget de payload EXCEDIDO"; then
  fail "WARN-ONLY FALHOU: ::warning:: ausente no modo não-bloqueante."
  exit 1
fi
pass "Warn-only OK — 300s com --warn-only → exit 0 + ::warning:: (alerta audível)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o gate de budget 240/180s cobre as DUAS FAIXAS + ACT-LOG end-to-end:"
pass "  • controle: 35s → exit 0, zone=ok (gate não é over-eager)"
pass "  • faixa soft: 200s → exit 0 + ::warning::, zone=warn (ruído tolerado)"
pass "  • mutação: 300s → exit 1, zone=fail, exceeded=true (regressão DETECTADA)"
pass "  • act-log: 300s no log do act → exit 1, zone=fail (gate pega VIA ACT)"
pass "  • act-log controle: 35s → exit 0, zone=ok (via act não é over-eager)"
pass "  • act-log infra: act morto-cedo → exit 1 + diagnóstico (não vira drift mudo)"
pass "  • publish: 35s ok → baseline 42 publicado (dry-run); 300s fail → NÃO publica"
pass "  • warn-only: 300s → exit 0 + ::warning:: (alerta sem mascarar a detecção)"
pass "Nenhum arquivo do repo real foi tocado (fixtures em mktemp)."
exit 0


