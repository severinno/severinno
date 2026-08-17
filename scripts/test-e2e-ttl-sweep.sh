#!/usr/bin/env bash
# =============================================================================
# scripts/test-e2e-ttl-sweep.sh — E2E TTL Sweep (realtime com sweep rápido)
#
# Sobe o realtime dev com REALTIME_TTL_SWEEP_MS=2000 (o default é 60s) numa
# PORTA DEDICADA (default 3199 — NÃO toca o realtime dev da 3003) e roda a
# suíte e2e/realtime-ttl-sweep.spec.ts.
#
# Por que o env acelera: o sweep do realtime (mini-services/realtime/index.ts,
# parseSweepIntervalMs) força o fechamento de sockets cuja sessão TTL expirou a
# cada REALTIME_TTL_SWEEP_MS. Com 60s (default), o socket expirado em TTL=15s
# (cookies forjados do spec) só cai no próximo tick — até ~75s por cenário.
# Com 2000ms, cai em ~17s por cenário (TTL + 1 tick + close delay 0.5s). O
# deadline do spec é só um limite superior (clamp no fallback de 60s); o loop
# de espera termina cedo no disconnect, então o tempo real acompanha o sweep
# do servidor — reduzindo a suíte de ~1.5min para ~40s.
#
# BOOT EXATO (mesmo do dev, com o env de aceleração):
#   cd mini-services/realtime
#   REALTIME_PORT=3199 REALTIME_TTL_SWEEP_MS=2000 \
#     SESSION_SECRET=<do .env.local> REALTIME_EMIT_TOKEN=<do .env.local> \
#     bun --hot index.ts
#
# Usage:
#   ./scripts/test-e2e-ttl-sweep.sh                 # boot + wait + spec + cleanup
#   ./scripts/test-e2e-ttl-sweep.sh --skip-cleanup  # mantém o realtime de pé (reuso)
#   ./scripts/test-e2e-ttl-sweep.sh -- --grep "sweep"  # args extras ao Playwright
#                                                      (o "--" inicial é consumido)
#
# Requisitos:
#   - dev server do app na :3000 (o spec registra providers via API no beforeAll)
#   - SESSION_SECRET + REALTIME_EMIT_TOKEN no .env.local (o realtime é
#     fail-closed sem eles: joins rejeitados e POST /emit recusado — o cenário
#     2 emite session:renew via /emit, então o token é obrigatório)
#
# Exit code:
#   0   — spec passou (exit do Playwright)
#   1   — pré-requisito ausente (app :3000 fora / envs de segurança faltando)
#   2   — realtime não subiu dentro do prazo (health check na porta dedicada)
#   >2  — repassa o exit do Playwright (falha de teste)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

PORT="${REALTIME_PORT:-3199}"
SWEEP_MS="${REALTIME_TTL_SWEEP_MS:-2000}"
SKIP_CLEANUP=false
PLAYWRIGHT_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --skip-cleanup) SKIP_CLEANUP=true ;;
    # Um "--" inicial (separador doc) é consumido — os demais args vão ao
    # Playwright sem o literal (que quebraria o parser de options).
    --) : ;;
    *) PLAYWRIGHT_ARGS+=("$arg") ;;
  esac
done

# ── Pré-requisitos ─────────────────────────────────────────────────────────
# O app está UP se responder qualquer HTTP (curl exit 0) — NÃO usamos -f (que
# falha em 4xx/5xx): o /api/health devolve 503 quando degraded (ex.: Redis
# fora) mas as APIs que o spec usa (/api/auth/me, /api/auth/register) seguem
# respondendo 200 — derrubar o pré-requisito por degraded derrotaria o target.
echo "[..] Verificando app na :3000..."
if ! curl -s -o /dev/null --max-time 5 http://localhost:3000/api/health; then
  echo "[✗] App dev não responde em http://localhost:3000/api/health — suba com 'bun run dev' primeiro."
  exit 1
fi

# Exporta os secrets do .env.local (o realtime é fail-closed sem eles).
if [ -f .env.local ]; then
  # Semântica de leitura IDÊNTICA ao readEnv do spec (realtime-emit.ts): só
  # aspas de BORDA são removidas — tr -d '"' removeria aspas internas e
  # divergiria do que o Playwright vê ao forjar o cookie.
  get_env() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }  # só aspas de borda
  export SESSION_SECRET="${SESSION_SECRET:-$(get_env SESSION_SECRET)}"
  export REALTIME_EMIT_TOKEN="${REALTIME_EMIT_TOKEN:-$(get_env REALTIME_EMIT_TOKEN)}"
  export DATABASE_URL="${DATABASE_URL:-$(get_env DATABASE_URL)}"
  export REDIS_URL="${REDIS_URL:-$(get_env REDIS_URL)}"
fi
if [ -z "${SESSION_SECRET:-}" ] || [ -z "${REALTIME_EMIT_TOKEN:-}" ]; then
  echo "[✗] SESSION_SECRET e REALTIME_EMIT_TOKEN são obrigatórios (env ou .env.local) — o realtime é fail-closed sem eles."
  exit 1
fi

# ── Boot do realtime na porta dedicada ─────────────────────────────────────
RT_PID=""
LOG_DIR="$SCRIPT_DIR/.next"
mkdir -p "$LOG_DIR"
if curl -sf --max-time 2 "http://localhost:${PORT}/health" >/dev/null 2>&1; then
  # Reuso intencional (--skip-cleanup do run anterior). O sweep interval da
  # instância reutilizada NÃO é verificado — um processo estranho na porta
  # com sweep de 60s rodaria a suíte no tempo LENTO; se suspeitar, derrube e
  # rode de novo (ou troque REALTIME_PORT).
  echo "[..] Realtime já responde na :${PORT} — reutilizando (sweep interval NÃO verificado)."
else
  echo "[..] Subindo realtime na :${PORT} com REALTIME_TTL_SWEEP_MS=${SWEEP_MS}ms..."
  # exec no subshell: o PID capturado ($!) é o do PROCESSO BUN — sem exec,
  # $! seria o PID do subshell e o kill do trap órfã o bun (socket vivo na
  # porta dedicada mascarado pelo reuse via /health no run seguinte).
  (
    cd mini-services/realtime
    exec env REALTIME_PORT="$PORT" REALTIME_TTL_SWEEP_MS="$SWEEP_MS" \
      bun --hot index.ts
  ) >"$LOG_DIR/realtime-ttl-${PORT}.log" 2>&1 &
  RT_PID=$!

  # Espera o /health responder (timeout 30s).
  for _ in $(seq 1 60); do
    if curl -sf --max-time 2 "http://localhost:${PORT}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
  if ! curl -sf --max-time 2 "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    echo "[✗] Realtime não subiu na :${PORT} em 30s (log: .next/realtime-ttl-${PORT}.log)"
    [ -n "$RT_PID" ] && kill "$RT_PID" 2>/dev/null || true
    exit 2
  fi
  echo "[OK] Realtime na :${PORT} com sweep ${SWEEP_MS}ms — health 200 (PID $RT_PID)"
fi

# Cleanup no exit (a menos que --skip-cleanup).
cleanup() {
  if [ "$SKIP_CLEANUP" = "false" ] && [ -n "$RT_PID" ]; then
    echo "[..] Derrubando realtime da :${PORT} (PID $RT_PID)..."
    kill "$RT_PID" 2>/dev/null || true
    wait "$RT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── Roda o spec ────────────────────────────────────────────────────────────
echo "[..] Rodando e2e/realtime-ttl-sweep.spec.ts (chromium)..."
REALTIME_PORT="$PORT" bunx playwright test e2e/realtime-ttl-sweep.spec.ts \
  --project=chromium --reporter=list "${PLAYWRIGHT_ARGS[@]}"
