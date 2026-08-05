#!/usr/bin/env bash
# =============================================================================
# scripts/test-mutation-timing-budget.sh — Mutation test do GATE DE BUDGET
# do measure-mutation-timing.mjs em TRÊS FAIXAS (fixtures do teste: --max
# 240 duro + --warn 180 soft + --alert 100 suave — em produção a faixa soft
# DERIVA da mediana dos últimos runs: --warn-median 4 --warn-margin 0.2; o
# literal --warn 180 dos fixtures é o controle da faixa)
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
#   0 — regressão DETECTADA (300s → exit 1, 35s → exit 0, 120s → exit 0 +
#       ::notice::, 200s → exit 0 + ::warning::, act-log 300s → exit 1,
#       act-log 35s → exit 0, act-log infra → exit 1, act-log drift 100s
#       → exit 1, publish 35s → exit 0,
#       publish 300s → exit 1, warn-only → exit 0 + ::warning::, drift
#       renomeado → exit 2, faixa vazia --alert >= --warn → exit 2) ✅
#   1 — gate cego (300s saiu exit 0) OU controle quebrou (35s não passou)
#       OU faixa notice quebrou (120s não noticiou) OU faixa warn quebrou
#       (200s não alertou) OU act-log quebrou (300s não falhou / 35s falhou /
#       infra não diagnosticou / drift act-log 100s não falhou) OU publish
#       quebrou OU validação quebrou
#       (--alert >= --warn não saiu exit 2) OU falha de infra/asserção ❌
#
#   CONTROLE — payload com step de 35s (DENTRO do alert 100s) → o script
#     deve sair exit 0 com report.zone='ok' (o gate NÃO é over-eager:
#     payload saudável não falha) — prova que o fixture válido não acende;
#   NOTICE — payload com step de 120s (faixa SUAVE: alert 100s < 120s <=
#     warn 180s) → exit 0 + ::notice:: + report.zone='notice' (ESCALADA
#     SUAVE: a faixa notice observa o drift cedo, ruído baixo, ANTES do
#     warning acender — não bloqueia, só noticia);
#   WARN — payload com step de 200s (faixa SOFT: warn 180s < 200s <= max
#     240s) → exit 0 + ::warning:: + report.zone='warn' (ruído de runner
#     tolerado SEM perder a observabilidade — a faixa intermediária alerta,
#     não falha);
#   VALIDAÇÃO — --alert >= --warn (faixa notice vazia: alert 180s >= warn
#     180s) → exit 2 (uso inválido — a escalada exige alert < warn < max);
#   MUTAÇÃO — payload com step de 300s (ACIMA do budget DURO 240s) → o
#     script deve sair exit 1 com report.exceeded=true + zone='fail' (o gate
#     falha — a regressão é detectada);
#   DRIFT — fixture SEM o job 'contrato coordenado' (job E step renomeados —
#     a regressão real do seed-guards: renomearam 'Run mutation test') → o
#     script deve sair exit 2 com 'drift de contrato' + found=false (a OUTRA
#     coisa que o medidor acusa, além do estouro: renomeação de contrato não
#     pode passar em silêncio como medição vazia);
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
#   DRIFT ACT-LOG — log do act com 100s + --fail-drift 50 --history-file
#     (mediana 62.5s → +60%) → exit 1 + drifted=true (o gate de DRIFT
#     RELATIVO também cobre o caminho act — PRs sem seed-guards na default,
#     onde a jobs API não mede e o log é a única fonte de duração);
#   WARN-ONLY — a MESMA mutação com --warn-only → exit 0 + ::warning:: no
#     stdout (o modo não-bloqueante NÃO mascara a detecção — o alerta
#     acende);
#   PUBLISH — o baseline auto-atualizado (--publish-baseline, dry-run): 35s
#     ok → publica 42 (margem 0.2) com exit 0; 300s fail → NÃO publica (run
#     lento não ratcheta o baseline) com exit 1. DEZ direções do mesmo
#     gate: saudável / faixa warn / estourado / drift (sem o job) /
#     act-log (estourado + controle + infra) / publish (ok + fail) / alerta /
#     validação (faixa vazia). DOZE direções do mesmo gate.
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

# TRÊS FAIXAS do budget — espelham os --max/--warn dos jobs de CI
# (pr-check.yml mutation-coord-timing-guard + benchmark-weekly.yml
# mutation-coord-timing): 240s DURO (faixa fail → exit 1) + 180s SOFT
# (faixa warn → ::warning:: + exit 0) + 100s SUAVE (faixa notice →
# ::notice:: + exit 0 — escalada suave). Ajustes AQUI e nos jobs devem ser
# coordenados (o vitest do workflow trava o par script↔yml).
BUDGET_MAX=240
BUDGET_WARN=180
BUDGET_ALERT=100

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
  GUARD_OUTPUT="$(node "$GUARD" --jobs-file "$fixture" --max "$BUDGET_MAX" --warn "$BUDGET_WARN" --alert "$BUDGET_ALERT" "$@" 2>&1)"
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
  GUARD_OUTPUT="$(node "$GUARD" --act-log "$fixture" --max "$BUDGET_MAX" --warn "$BUDGET_WARN" --alert "$BUDGET_ALERT" --act-exit "$act_exit" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

# ── run_act_log_drift_guard: medidor em modo --act-log com o gate de DRIFT
# RELATIVO (--fail-drift PCT) — a MESMA semântica do run_drift_guard, mas a
# fonte do step ATUAL é o LOG DO ACT (não a jobs API). Cobre PRs que ainda
# não têm o seed-guards.yml na branch DEFAULT (o reusable não roda no CI
# real → jobs API vazia; o act roda o job com a imagem ubuntu-bun e o log é
# a única fonte de medição). O histórico da mediana vem do --history-file
# (fixture determinístico, sem gh — modo TESTE).
# $1 = fixture (log do act); $2 = history file (mediana determinística).
run_act_log_drift_guard() {
  local fixture="$1"
  local history="$2"
  set +e
  GUARD_OUTPUT="$(node "$GUARD" --act-log "$fixture" --history-file "$history" --max "$BUDGET_MAX" --fail-drift 50 --window 4 2>&1)"
  GUARD_EXIT=$?
  set -e
}

echo ""
echo "  ═════════════════════════════════════════════════════════════════"
echo "   🧪 SEVERINNO — MUTATION TEST (gate de budget 240/180/100s do mutation-coord)"
echo "   Fixtures: payload jobs API com steps de 35s (controle ok), 120s (faixa"
echo "   notice), 200s (faixa soft) e 300s (faixa dura) + job renomeado (drift"
echo "   exit 2) + logs do act (300s estourado, 35s controle, vazio+infra) —"
echo "   markers reais do seed-guards.yml"
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

# ── 1c. NOTICE — 120s (faixa SUAVE: alert 100 < 120 <= warn 180) → notice ─
NOTICE_FIXTURE="$TMP_DIR/notice-120s.json"
build_fixture "$NOTICE_FIXTURE" "2026-08-02T20:16:40Z" "2026-08-02T20:18:40Z"

info "Faixa suave — payload de 120s (alert 100s < 120s <= warn 180s) deve sair exit 0 com ::notice::..."
run_guard "$NOTICE_FIXTURE"
echo "$GUARD_OUTPUT" | head -2

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "FAIXA NOTICE FALHOU: 120s saiu com exit $GUARD_EXIT (esperado 0)."
  fail "A escalada suave (faixa notice) não deveria bloquear — só noticiar o drift cedo."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "::notice::budget de payload na faixa de NOTICE"; then
  fail "FAIXA NOTICE FALHOU: ::notice:: da faixa suave ausente para 120s."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "notice"'; then
  fail "FAIXA NOTICE FALHOU: report.zone não é 'notice' para 120s."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"noticed": true'; then
  fail "FAIXA NOTICE FALHOU: report.noticed não é true para 120s."
  exit 1
fi
pass "Faixa suave OK — 120s → exit 0 + ::notice:: + zone=notice (escalada suave observa o drift cedo)"

# ── 1d. VALIDAÇÃO — --alert >= --warn (faixa notice vazia) → exit 2 ────
# A escalada exige alert < warn < max. Se alguém passar --alert >= --warn,
# a faixa notice vira VAZIA e a semântica das 4 zonas fica quebrada — o CLI
# deve rejeitar (exit 2), não silenciosamente ignorar.
info "Validação — --alert 180 com --warn 180 (faixa notice vazia) deve sair exit 2..."
set +e
GUARD_OUTPUT="$(node "$GUARD" --jobs-file "$CONTROL_FIXTURE" --max "$BUDGET_MAX" --warn "$BUDGET_WARN" --alert "$BUDGET_WARN" 2>&1)"
GUARD_EXIT=$?
set -e
echo "$GUARD_OUTPUT" | tail -2

if [ "$GUARD_EXIT" -ne 2 ]; then
  fail "VALIDAÇÃO FALHOU: --alert >= --warn saiu com exit $GUARD_EXIT (esperado 2)."
  fail "A faixa notice vazia não é detectada — a escalada suave aceitaria config quebrada."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q -- "--alert deve ser MENOR que --warn"; then
  fail "VALIDAÇÃO FALHOU: mensagem '--alert deve ser MENOR que --warn' ausente."
  exit 1
fi
pass "Validação OK — --alert 180 >= --warn 180 → exit 2 + mensagem de faixa vazia"

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

# ── 2e. DRIFT — fixture SEM o job 'contrato coordenado' → exit 2 ─────────
# A OUTRA regressão que o medidor acusa (além do estouro de budget): se o
# job OU o step do seed-guards.yml for RENOMEADO, o extractMutationStep do
# guard NÃO acha o step → o medidor deve sair exit 2 (drift de contrato)
# com mensagem clara — NUNCA exit 0 (medição vazia que passaria em
# silêncio). O fixture usa um job SEM o marker 'contrato coordenado' E um
# step SEM 'Run mutation test' — o cenário exato do incidente real (o step
# foi renomeado; o job tampouco casa com o marker). CUIDADO: o nome do job
# mutado NÃO pode conter o substring 'contrato coordenado' — o guard acha
# o job por .includes(), então um 'sem contrato coordenado' ainda casaria.
build_drift_fixture() {
  local out="$1"
  local started="$2"
  local completed="$3"
  cat > "$out" <<EOF
{
  "total_count": 1,
  "jobs": [
    {
      "name": "Mutation Test (novo nome do job renomeado)",
      "steps": [
        {
          "name": "Run seed validation (novo nome do step)",
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

DRIFT_FIXTURE="$TMP_DIR/drift-renamed-job-step.json"
build_drift_fixture "$DRIFT_FIXTURE" "2026-08-02T20:16:40Z" "2026-08-02T20:17:15Z"

info "Drift — fixture SEM o job 'contrato coordenado' (job e step renomeados) deve sair exit 2..."
run_guard "$DRIFT_FIXTURE"
echo "$GUARD_OUTPUT" | tail -5

if [ "$GUARD_EXIT" -ne 2 ]; then
  fail "DRIFT CEGO: fixture renomeado saiu com exit $GUARD_EXIT (esperado 2)."
  fail "A renomeação do job/step do seed-guards passaria em SILÊNCIO como"
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
pass "Drift DETECTADO: job/step renomeados (sem 'contrato coordenado') → exit 2 + found=false"

# ── 2f. PUBLISH — baseline auto-atualizado (--publish-baseline, dry-run) ─
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
  GUARD_OUTPUT="$(MEASURE_MUTATION_TIMING_DRY_PUBLISH=1 node "$GUARD" --jobs-file "$fixture" --max "$BUDGET_MAX" --warn "$BUDGET_WARN" --alert "$BUDGET_ALERT" --publish-baseline MUTATION_TIMING_BASELINE 2>&1)"
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

# ── 3b. MEDIAN — faixa soft DERIVADA da mediana (--warn-median 4) ────────
# A produção não passa mais --warn literal: a faixa soft DERIVA da MEDIANA
# dos últimos N runs medidos do MESMO step (--warn-median 4 --warn-margin
# 0.2 — o warn se AUTO-AJUSTA ao runner real, sem variable publicada). Este
# bloco prova a derivação end-to-end no modo TESTE (--jobs-file +
# --history-file — fixtures determinísticos, sem gh):
#   • MEDIAN CONTROLE — 35s com histórico de mediana 62.5s → warn derivado
#     75s (ceil(62.5*1.2)) → exit 0 + zone=ok + warnSource=median
#     (a derivação não é over-eager);
#   • MEDIAN WARN — 80s (75s < 80s <= duro 240s) → exit 0 + ::warning:: +
#     zone=warn (o soft AUTO-AJUSTADO acende — um 80s que o literal 180s
#     NUNCA veria vira alerta com a derivação);
#   • MEDIAN MUTAÇÃO — 300s → exit 1 (o gate DURO continua FIXO — a
#     derivação NÃO move o --max 240);
#   • MEDIAN VALIDAÇÃO — --warn-median combinado com --warn (escolha:
#     literal OU derivada) → exit 2.
# Se a derivação quebrar (mediana errada, margem ignorada, clamp solto, o
# soft virar vazio), uma das asserções falha — o mutation test bloqueia.
run_median_guard() {
  local fixture="$1"
  local history="$2"
  shift 2
  set +e
  GUARD_OUTPUT="$(node "$GUARD" --jobs-file "$fixture" --history-file "$history" --max "$BUDGET_MAX" --warn-median 4 --warn-margin 0.2 "$@" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

build_history_fixture() {
  local out="$1"
  cat > "$out" <<'EOF'
{
  "runs": [
    { "runId": "1001", "durationSecs": 70 },
    { "runId": "1002", "durationSecs": 55 },
    { "runId": "1003", "durationSecs": 40 },
    { "runId": "1004", "durationSecs": 200 }
  ]
}
EOF
}

HISTORY_FIXTURE="$TMP_DIR/history.json"
build_history_fixture "$HISTORY_FIXTURE"

# ── 3b-i. MEDIAN CONTROLE — 35s (<= warn derivado 75s) → exit 0 + zone=ok ─
info "Median controle — 35s com mediana 62.5s (warn derivado 75s) deve sair exit 0 + zone=ok..."
run_median_guard "$CONTROL_FIXTURE" "$HISTORY_FIXTURE"
echo "$GUARD_OUTPUT" | tail -5

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "MEDIAN CONTROLE FALHOU: 35s saiu com exit $GUARD_EXIT (esperado 0)."
  fail "A derivação pela mediana está over-eager — payload saudável não deveria falhar."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"warnSource": "median"'; then
  fail "MEDIAN CONTROLE FALHOU: report.warnSource não é 'median' — a derivação não está ativa."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"warnSecs": 75'; then
  fail "MEDIAN CONTROLE FALHOU: warnSecs derivado não é 75 (mediana 62.5 * 1.2 = ceil 75)."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "ok"'; then
  fail "MEDIAN CONTROLE FALHOU: report.zone não é 'ok' para 35s."
  exit 1
fi
pass "Median controle OK — 35s → exit 0, zone=ok, warnSecs=75 derivado da mediana (62.5*1.2)"

# ── 3b-ii. MEDIAN WARN — 80s (75s < 80s <= 240s) → exit 0 + ::warning:: ──
MEDIAN_WARN_FIXTURE="$TMP_DIR/median-warn-80s.json"
build_fixture "$MEDIAN_WARN_FIXTURE" "2026-08-02T20:16:40Z" "2026-08-02T20:18:00Z"

info "Median warn — 80s (warn derivado 75s < 80s <= duro 240s) deve sair exit 0 com ::warning::..."
run_median_guard "$MEDIAN_WARN_FIXTURE" "$HISTORY_FIXTURE"
echo "$GUARD_OUTPUT" | head -2

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "MEDIAN WARN FALHOU: 80s saiu com exit $GUARD_EXIT (esperado 0)."
  fail "O soft derivado deveria alertar, não falhar (ruído tolerado)."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "::warning::budget de payload na faixa de WARN"; then
  fail "MEDIAN WARN FALHOU: ::warning:: da faixa soft derivada ausente para 80s."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "warn"'; then
  fail "MEDIAN WARN FALHOU: report.zone não é 'warn' para 80s."
  exit 1
fi
pass "Median warn OK — 80s → exit 0 + ::warning:: + zone=warn (o soft AUTO-AJUSTADO acende cedo)"

# ── 3b-iii. MEDIAN MUTAÇÃO — 300s → exit 1 (o DURO continua FIXO) ──────
info "Median mutação — 300s com --warn-median deve sair exit 1 (gate duro imutável pela derivação)..."
run_median_guard "$MUT_FIXTURE" "$HISTORY_FIXTURE"
echo "$GUARD_OUTPUT" | tail -5

if [ "$GUARD_EXIT" -ne 1 ]; then
  fail "MEDIAN MUTAÇÃO FALHOU: 300s saiu com exit $GUARD_EXIT (esperado 1)."
  fail "A derivação da faixa soft NÃO pode mover o budget duro — o gate continua 240s."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "budget de payload EXCEDIDO"; then
  fail "MEDIAN MUTAÇÃO FALHOU: mensagem 'budget de payload EXCEDIDO' ausente."
  exit 1
fi
pass "Median mutação OK — 300s → exit 1 (duro 240s inalterado — derivação só ajusta o soft)"

# ── 3b-iv. MEDIAN VALIDAÇÃO — --warn-median + --warn → exit 2 ───────────
info "Median validação — --warn-median combinado com --warn (escolha: literal OU derivada) deve sair exit 2..."
set +e
GUARD_OUTPUT="$(node "$GUARD" --jobs-file "$CONTROL_FIXTURE" --history-file "$HISTORY_FIXTURE" --max "$BUDGET_MAX" --warn-median 4 --warn "$BUDGET_WARN" 2>&1)"
GUARD_EXIT=$?
set -e
echo "$GUARD_OUTPUT" | tail -2

if [ "$GUARD_EXIT" -ne 2 ]; then
  fail "MEDIAN VALIDAÇÃO FALHOU: --warn-median + --warn saiu com exit $GUARD_EXIT (esperado 2)."
  fail "O CLI aceitaria duas fontes de faixa soft concorrentes — ambíguo."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "não pode ser combinado com --warn"; then
  fail "MEDIAN VALIDAÇÃO FALHOU: mensagem de exclusividade --warn-median/--warn ausente."
  exit 1
fi
pass "Median validação OK — --warn-median + --warn → exit 2 (fonte única da faixa soft enforced)"

# ── 3c. DRIFT — gate de DRIFT RELATIVO (--fail-drift PCT) ────────────────
# O job do PR (mutation-coord-timing-guard) usa --fail-drift: compara a
# duração do step ATUAL contra a MEDIANA do histórico e FALHA quando o desvio
# relativo ultrapassa o threshold (--fail-drift 50 = falha se o step for 50%
# mais lento que a mediana) — o --max 240 vira TETO ABSOLUTO (d > max falha
# SEMPRE, mesmo com drift pequeno). Este bloco prova o gate end-to-end no modo
# TESTE (--jobs-file + --history-file — mediana 62.5s do fixture de 4 runs):
#   • DRIFT CONTROLE — 35s (-44% vs mediana) → exit 0 + zone=ok + drifted=false
#     (drift NEGATIVO é saudável — o gate não é over-eager);
#   • DRIFT OK — 80s (+28% < 50%) → exit 0 + zone=ok (abaixo do threshold
#     não falha — o PR tolera variação normal de runner);
#   • DRIFT MUTAÇÃO — 100s (+60% > 50%, abaixo do teto 240s) → exit 1 +
#     drifted=true (o DRIFT RELATIVO falha ANTES do teto — a regressão lenta
#     que o --max nunca veria vira gate);
#   • DRIFT TETO — 300s vs mediana ALTA 227.5s (+31.87% < 50%, acima do
#     teto 240s) → exit 1 + exceeded=true + drifted=false (o TETO ABSOLUTO
#     falha MESMO com drift pequeno — --max é a rede final inegociável);
#   • DRIFT VALIDAÇÃO — --fail-drift combinado com --warn (semânticas
#     concorrentes) → exit 2.
# Se o drift quebrar (mediana errada, percentual errado, teto perdido), uma
# das asserções falha — o mutation test bloqueia.
run_drift_guard() {
  local fixture="$1"
  local history="$2"
  shift 2
  set +e
  GUARD_OUTPUT="$(node "$GUARD" --jobs-file "$fixture" --history-file "$history" --max "$BUDGET_MAX" --fail-drift 50 --window 4 "$@" 2>&1)"
  GUARD_EXIT=$?
  set -e
}

# ── 3c-i. DRIFT CONTROLE — 35s (-44% vs mediana 62.5s) → exit 0 + drifted=false
info "Drift controle — 35s (-44% vs mediana 62.5s) deve sair exit 0 + drifted=false..."
run_drift_guard "$CONTROL_FIXTURE" "$HISTORY_FIXTURE"
echo "$GUARD_OUTPUT" | tail -5

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "DRIFT CONTROLE FALHOU: 35s saiu com exit $GUARD_EXIT (esperado 0)."
  fail "Drift negativo é saudável — o gate de drift relativo não deveria falhar."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"driftSource": "median"'; then
  fail "DRIFT CONTROLE FALHOU: report.driftSource não é 'median' — o gate de drift não está ativo."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"drifted": false'; then
  fail "DRIFT CONTROLE FALHOU: drifted deveria ser false para 35s (-44% < 50%)."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"zone": "ok"'; then
  fail "DRIFT CONTROLE FALHOU: report.zone não é 'ok' para 35s."
  exit 1
fi
pass "Drift controle OK — 35s → exit 0, zone=ok, drifted=false (drift negativo tolerado)"

# ── 3c-ii. DRIFT OK — 80s (+28% < 50%) → exit 0 (variação normal de runner) ─
info "Drift ok — 80s (+28% < threshold 50%) deve sair exit 0..."
run_drift_guard "$MEDIAN_WARN_FIXTURE" "$HISTORY_FIXTURE"
echo "$GUARD_OUTPUT" | tail -4

if [ "$GUARD_EXIT" -ne 0 ]; then
  fail "DRIFT OK FALHOU: 80s saiu com exit $GUARD_EXIT (esperado 0)."
  fail "+28% está ABAIXO do threshold 50% — variação normal de runner não pode falhar o PR."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"drifted": false'; then
  fail "DRIFT OK FALHOU: drifted deveria ser false para 80s (+28% < 50%)."
  exit 1
fi
pass "Drift ok OK — 80s → exit 0 (desvio +28% abaixo do threshold 50% tolerado)"

# ── 3c-iii. DRIFT MUTAÇÃO — 100s (+60% > 50%, ABAIXO do teto) → exit 1 ───
DRIFT_MUT_FIXTURE="$TMP_DIR/drift-mut-100s.json"
build_fixture "$DRIFT_MUT_FIXTURE" "2026-08-02T20:16:40Z" "2026-08-02T20:18:20Z"

info "Drift mutação — 100s (+60% > 50%, abaixo do teto 240s) deve sair exit 1 (DRIFT RELATIVO)..."
run_drift_guard "$DRIFT_MUT_FIXTURE" "$HISTORY_FIXTURE"
echo "$GUARD_OUTPUT" | tail -5

if [ "$GUARD_EXIT" -ne 1 ]; then
  fail "DRIFT MUTAÇÃO FALHOU: 100s saiu com exit $GUARD_EXIT (esperado 1)."
  fail "O drift relativo de +60% deveria falhar MESMO ABAIXO do teto de 240s — é exatamente a regressão lenta que o --max nunca vê."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"drifted": true'; then
  fail "DRIFT MUTAÇÃO FALHOU: drifted deveria ser true para 100s (+60% > 50%)."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q 'drift relativo EXCEDIDO'; then
  fail "DRIFT MUTAÇÃO FALHOU: mensagem de drift relativo EXCEDIDO ausente."
  exit 1
fi
pass "Drift mutação OK — 100s → exit 1, drifted=true (drift +60% falha ANTES do teto)"

# ── 3c-iv. DRIFT TETO — 300s com mediana ALTA (drift pequeno +31.87% < 50%,
# ACIMA do teto 240s) → exit 1 + exceeded, drifted FALSE ─────────────────
# O teto é a rede final: falha SEMPRE acima de 240s, MESMO quando o drift
# relativo está DENTRO do limiar (o cenário 3c-iii provou o drift ANTES do
# teto; este prova o teto ANTES/Acima do drift). Com a mediana de 227.5s
# (durations 230/220/225/235), 300s tem drift +31.87% < 50% → a CAUSA da
# falha só pode ser o TETO (exceeded=true, drifted=false) — isolando a
# propriedade 'teto absoluto inegociável' que o fixture de mediana 62.5s
# não conseguia provar (lá 300s era drift +380% E teto simultâneos).
DRIFT_TETO_HISTORY="$TMP_DIR/drift-teto-history.json"
cat > "$DRIFT_TETO_HISTORY" <<'EOF'
{
  "runs": [
    { "runId": "1", "durationSecs": 230 },
    { "runId": "2", "durationSecs": 220 },
    { "runId": "3", "durationSecs": 225 },
    { "runId": "4", "durationSecs": 235 }
  ]
}
EOF

info "Drift teto — 300s com mediana 227.5s (+31.87% < 50%, acima do teto) deve sair exit 1 por EXCEEDED (drifted false)..."
run_drift_guard "$MUT_FIXTURE" "$DRIFT_TETO_HISTORY"
echo "$GUARD_OUTPUT" | tail -5

if [ "$GUARD_EXIT" -ne 1 ]; then
  fail "DRIFT TETO FALHOU: 300s saiu com exit $GUARD_EXIT (esperado 1)."
  fail "O teto absoluto --max 240 continua sendo a rede final — 300s falha SEMPRE."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"exceeded": true'; then
  fail "DRIFT TETO FALHOU: exceeded deveria ser true para 300s (teto absoluto)."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"drifted": false'; then
  fail "DRIFT TETO FALHOU: drifted deveria ser FALSE — 300s tem drift +31.8% < 50%; a causa é só o TETO."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "budget de payload EXCEDIDO"; then
  fail "DRIFT TETO FALHOU: mensagem 'budget de payload EXCEDIDO' (teto) ausente."
  exit 1
fi
pass "Drift teto OK — 300s → exit 1, exceeded=true + drifted=false (teto absoluto falha mesmo com drift pequeno)"

# ── 3c-v. DRIFT VALIDAÇÃO — --fail-drift + --warn → exit 2 (semântica única) ─
info "Drift validação — --fail-drift combinado com --warn (semânticas concorrentes) deve sair exit 2..."
set +e
GUARD_OUTPUT="$(node "$GUARD" --jobs-file "$CONTROL_FIXTURE" --history-file "$HISTORY_FIXTURE" --max "$BUDGET_MAX" --fail-drift 50 --warn "$BUDGET_WARN" 2>&1)"
GUARD_EXIT=$?
set -e
echo "$GUARD_OUTPUT" | tail -2

if [ "$GUARD_EXIT" -ne 2 ]; then
  fail "DRIFT VALIDAÇÃO FALHOU: --fail-drift + --warn saiu com exit $GUARD_EXIT (esperado 2)."
  fail "O CLI aceitaria duas semânticas de gate concorrentes — ambíguo."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q "não pode ser combinado com --warn"; then
  fail "DRIFT VALIDAÇÃO FALHOU: mensagem de exclusividade --fail-drift/--warn ausente."
  exit 1
fi
pass "Drift validação OK — --fail-drift + --warn → exit 2 (semântica única do gate enforced)"

# ── 3c-vi. DRIFT ACT-LOG — 100s no log do act (+60% vs mediana 62.5s,
# ABAIXO do teto 240s) → exit 1 (drifted=true) ───────────────────────────
# O gate de drift relativo também funciona no caminho ACT: PRs que ainda não
# têm o seed-guards.yml na default não podem medir via jobs API (o reusable
# não roda no CI real), então o job mutation-coord-timing-act-guard do
# pr-check.yml re-executa o job via act (imagem ubuntu-bun) e o guard mede o
# log. A MESMA regressão lenta do 3c-iii (100s vs mediana 62.5s = +60% >
# threshold 50%, abaixo do teto 240s) deve falhar exit 1 via act-log —
# provando que o gate de drift cobre os DOIS caminhos de medição (jobs API
# E log do act).
ACTLOG_DRIFT_FIXTURE="$TMP_DIR/actlog-drift-100s.log"
build_act_log_fixture "$ACTLOG_DRIFT_FIXTURE" "100"

info "Drift act-log — log do act com 100s (+60% vs mediana 62.5s, abaixo do teto 240s) deve sair exit 1 (drift relativo)..."
run_act_log_drift_guard "$ACTLOG_DRIFT_FIXTURE" "$HISTORY_FIXTURE"
echo "$GUARD_OUTPUT" | tail -6

if [ "$GUARD_EXIT" -ne 1 ]; then
  fail "DRIFT ACT-LOG FALHOU: 100s via act-log saiu com exit $GUARD_EXIT (esperado 1)."
  fail "O gate de drift não pega a regressão no caminho act — PRs sem"
  fail "seed-guards na default passariam em silêncio. Mutation test falha."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q '"drifted": true'; then
  fail "DRIFT ACT-LOG FALHOU: drifted deveria ser true para 100s (+60% > 50%)."
  exit 1
fi
if ! echo "$GUARD_OUTPUT" | grep -q 'drift relativo EXCEDIDO'; then
  fail "DRIFT ACT-LOG FALHOU: mensagem 'drift relativo EXCEDIDO' ausente no exit 1."
  exit 1
fi
pass "Drift act-log OK — 100s → exit 1, drifted=true (drift relativo pega via act-log, sem jobs API)"

# ═════════════════════════════════════════════════════════════════════════
# Result (cleanup roda no trap EXIT)
# ═════════════════════════════════════════════════════════════════════════

echo ""
pass "MUTATION TEST PASSED — o gate de budget 240/180/100s cobre as TRÊS FAIXAS + ACT-LOG + MEDIAN end-to-end:"
pass "  • controle: 35s → exit 0, zone=ok (gate não é over-eager)"
pass "  • faixa suave: 120s → exit 0 + ::notice::, zone=notice (escalada suave — drift cedo, não bloqueia)"
pass "  • faixa soft: 200s → exit 0 + ::warning::, zone=warn (ruído tolerado)"
pass "  • mutação: 300s → exit 1, zone=fail, exceeded=true (regressão DETECTADA)"
pass "  • validação: --alert 180 >= --warn 180 → exit 2 (faixa notice vazia rejeitada)"
pass "  • act-log: 300s no log do act → exit 1, zone=fail (gate pega VIA ACT)"
pass "  • act-log controle: 35s → exit 0, zone=ok (via act não é over-eager)"
pass "  • act-log infra: act morto-cedo → exit 1 + diagnóstico (não vira drift mudo)"
pass "  • drift: job/step renomeados (sem 'contrato coordenado') → exit 2 + 'drift de contrato', found=false"
pass "  • publish: 35s ok → baseline 42 publicado (dry-run); 300s fail → NÃO publica"
pass "  • warn-only: 300s → exit 0 + ::warning:: (alerta sem mascarar a detecção)"
pass "  • median controle: 35s → exit 0 + warnSecs=75 derivado (mediana 62.5 * 1.2)"
pass "  • median warn: 80s → exit 0 + ::warning:: (soft AUTO-AJUSTADO acende cedo)"
pass "  • median mutação: 300s → exit 1 (duro 240s imutável pela derivação)"
pass "  • median validação: --warn-median + --warn → exit 2 (fonte única enforced)"
pass "  • drift act-log: 100s no log do act → exit 1, drifted=true (drift relativo via act, sem jobs API)"
pass "Nenhum arquivo do repo real foi tocado (fixtures em mktemp)."
exit 0


