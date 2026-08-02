#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# act-repro-setup-bun.sh — reproduce the setup-bun CI performance bug via act
#
# WHY: the `oven-sh/setup-bun@v2` external action re-downloads the LATEST Bun
# release on EVERY job run (~24-35s, cache-hit=false) — confirmed empirically
# with 2 consecutive runs of the e2e-counts-guard job in act (35.5s / 24.2s,
# both cache-hit=false). After the migration to the local composite action
# (.github/actions/setup-bun), run #2 reuses actions/cache (cache-hit=true).
# This script automates the repro so future CI-performance validations do not
# depend on memory: it runs the job N times, extracts the setup-bun step
# duration from act's output, records the cache-hit status, and asserts the
# expected behavior.
#
# Expectation logic (default: auto):
#   - The workflow job uses ././.github/actions/setup-bun (local, FIXED) →
#     expect cache-hit on the LAST run (cache reuse works).
#   - The workflow job uses oven-sh/setup-bun@v2 (external, pre-migration) →
#     expect cache-miss on EVERY run (the bug: no reuse ever).
#
# NOTE (cache-hit): a asserção cache-hit depende do act PERSISTIR o cache
# actions/cache entre invocações SEPARADAS (o loop roda um `act` por run).
# Se o act do ambiente não persistir (~/.cache/act), a 2ª run volta a ser
# cache-miss → FAIL falso. A 1ª run de uma key nova é sempre cold (popula o
# cache) — rode o script 2× para um resultado confiável.
#
# Usage:
#   ./scripts/act-repro-setup-bun.sh                        # defaults below
#   ./scripts/act-repro-setup-bun.sh --job check --runs 3   # another job
#   ./scripts/act-repro-setup-bun.sh --expect cache-miss    # force bug repro
#   ./scripts/act-repro-setup-bun.sh --expect cache-hit     # force fix check
#   ./scripts/act-repro-setup-bun.sh --no-assert            # report only
#   ./scripts/act-repro-setup-bun.sh --act /path/act --image catthehacker/ubuntu:act-latest
#   ./scripts/act-repro-setup-bun.sh --out-dir /tmp/repro
#
# Env overrides: ACT_REPRO_ACT, ACT_REPRO_IMAGE, ACT_REPRO_JOB, ACT_REPRO_RUNS.
#
# Exit codes:
#   0 — all runs executed and assertion passed (or --no-assert)
#   1 — assertion failed (expected cache behavior did not hold)
#   2 — usage / setup error (missing act binary, bad args, no docker)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── defaults ────────────────────────────────────────────────────────────────
ACT_BIN="${ACT_REPRO_ACT:-$REPO_ROOT/tool-results/act/act.exe}"
IMAGE="${ACT_REPRO_IMAGE:-catthehacker/ubuntu:act-latest}"
JOB="${ACT_REPRO_JOB:-e2e-counts-guard}"
WORKFLOW="$REPO_ROOT/.github/workflows/pr-check.yml"
RUNS="${ACT_REPRO_RUNS:-2}"
EXPECT="auto"          # auto | cache-miss | cache-hit | none
OUT_DIR=""
VERBOSE=0

# ── arg parsing ─────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --job) JOB="$2"; shift 2 ;;
    --workflow) WORKFLOW="$2"; shift 2 ;;
    --runs) RUNS="$2"; shift 2 ;;
    --expect)
      case "$2" in
        auto|cache-miss|cache-hit|none) EXPECT="$2" ;;
        *) echo "act-repro: invalid --expect: $2 (auto|cache-miss|cache-hit|none)" >&2; exit 2 ;;
      esac
      shift 2 ;;
    --no-assert) EXPECT="none"; shift ;;
    --act) ACT_BIN="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    -v) VERBOSE=1; shift ;;
    -h|--help)
      # Robust to header growth: print from line 2 up to the 2nd '# ---' separator
      # (hardcoded ranges já deram drift 42→55→36 durante o desenvolvimento).
      END_SEP="$(grep -n '^# ---' "$0" | sed -n '2p' | cut -d: -f1)"
      [ -n "$END_SEP" ] || { echo "act-repro: header separators not found — cannot print --help" >&2; exit 2; }
      sed -n "2,${END_SEP}p" "$0"
      exit 0 ;;
    *) echo "act-repro: unknown argument: $1" >&2; echo "Usage: $0 [--job JOB] [--runs N] [--expect auto|cache-miss|cache-hit|none] [--act PATH] [--image IMG] [--out-dir DIR] [-v]" >&2; exit 2 ;;
  esac
done

# ── preflight ───────────────────────────────────────────────────────────────
if [ ! -x "$ACT_BIN" ] && ! command -v "$ACT_BIN" >/dev/null 2>&1; then
  echo "act-repro: act binary not found at: $ACT_BIN" >&2
  echo "  (download it from https://github.com/nektos/act/releases, or pass --act)" >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "act-repro: docker not found — act needs the Docker daemon to run jobs" >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "act-repro: Docker daemon not running (docker info failed)" >&2
  exit 2
fi
if [ ! -f "$WORKFLOW" ]; then
  echo "act-repro: workflow not found: $WORKFLOW" >&2
  exit 2
fi
case "$RUNS" in
  ''|*[!0-9]*) echo "act-repro: --runs deve ser um inteiro positivo (obtido: '$RUNS')" >&2; exit 2 ;;
esac
if [ "$RUNS" -lt 1 ]; then
  echo "act-repro: --runs deve ser >= 1 (obtido: $RUNS)" >&2
  exit 2
fi

if ! grep -q "^  ${JOB}:" "$WORKFLOW" 2>/dev/null; then
  echo "act-repro: warning — job '$JOB' not found in $WORKFLOW (will let act decide)" >&2
fi

# ── detect the action type to derive the auto expectation ───────────────────
# IMPORTANTE: casa apenas a sintaxe `uses:` do action — NÃO o substring solto.
# O pr-check.yml cita 'oven-sh/setup-bun@v2' em COMENTÁRIOS (ex.: o guard
# no-setup-bun-guard documenta a migração) — um grep solto classificaria o
# checkout como 'external' no main já migrado e o assert falharia invertido.
ACTION_TYPE="unknown"
if grep -qE "uses:[[:space:]]*(\\./\\.github/actions/)?oven-sh/setup-bun" "$WORKFLOW"; then
  ACTION_TYPE="external"
else
  ACTION_TYPE="local"
fi

case "$EXPECT" in
  auto)
    if [ "$ACTION_TYPE" = "external" ]; then
      EXPECT="cache-miss"
    else
      EXPECT="cache-hit"
    fi
    ;;
esac

# ── output dir ───────────────────────────────────────────────────────────────
if [ -z "$OUT_DIR" ]; then
  OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/act-repro-setup-bun.XXXXXX")"
fi
mkdir -p "$OUT_DIR"

# ── helpers ──────────────────────────────────────────────────────────────────
# Extracts the setup-bun step duration from an act log. act prints:
#   [PR Check/check]   ✅  Success - Main ./.github/actions/setup-bun [31.6143455s]
# (the composite action is named by its path when the step has no explicit
# name; the external action shows as oven-sh/setup-bun@v2). Returns the
# numeric seconds (or ms suffix preserved) or "N/A".
extract_duration() {
  local log="$1" line dur
  line="$(grep -iE "Success - Main .*setup-bun" "$log" | tail -1 || true)"
  [ -z "$line" ] && { echo "N/A"; return; }
  dur="$(echo "$line" | grep -oE "\[[0-9.]+(ms|s)\]" | tail -1 | tr -d '[]' || true)"
  [ -z "$dur" ] && dur="N/A"
  echo "$dur"
}

# Extracts cache-hit status. The local action's restore step prints:
#   ⚙  ::set-output:: cache-hit=true|false
# The OLD external action has no actions/cache step → "n/a".
extract_cache_hit() {
  local log="$1" hit
  hit="$(grep -oE "cache-hit=(true|false)" "$log" | tail -1 | cut -d= -f2 || true)"
  [ -z "$hit" ] && hit="n/a"
  echo "$hit"
}

# ── run the job N times ──────────────────────────────────────────────────────
declare -a DURATIONS CACHE_HITS RUN_EXITS
for i in $(seq 1 "$RUNS"); do
  LOG="$OUT_DIR/run-$i.log"
  echo "▶ run $i/$RUNS — job '$JOB' (image: $IMAGE)..."
  # || true: um job que falhe (exit != 0) não deve abortar o script antes do
  # relatório — o exit code real fica em RUN_EXITS e PARTICIPA da asserção
  # (um job que falhou não prova nada sobre cache — N/A não é evidência).
  RUN_EXIT=0
  if [ "$VERBOSE" -eq 1 ]; then
    "$ACT_BIN" -W "$WORKFLOW" -j "$JOB" -P "ubuntu-latest=$IMAGE" 2>&1 | tee "$LOG" || RUN_EXIT=$?
  else
    "$ACT_BIN" -W "$WORKFLOW" -j "$JOB" -P "ubuntu-latest=$IMAGE" >"$LOG" 2>&1 || RUN_EXIT=$?
  fi
  echo "  (exit $RUN_EXIT)"
  RUN_EXITS[$((i-1))]="$RUN_EXIT"
  DURATIONS[$((i-1))]="$(extract_duration "$LOG")"
  CACHE_HITS[$((i-1))]="$(extract_cache_hit "$LOG")"
done

# ── report ───────────────────────────────────────────────────────────────────
echo ""
echo "=== setup-bun repro — job=$JOB runs=$RUNS action=$ACTION_TYPE expect=$EXPECT ==="
echo "  run | setup-bun step | cache-hit | job exit"
echo "  ----|----------------|-----------|---------"
for i in $(seq 1 "$RUNS"); do
  printf "  %2d  | %14s | %9s | %s\n" "$i" "${DURATIONS[$((i-1))]}" "${CACHE_HITS[$((i-1))]}" "${RUN_EXITS[$((i-1))]}"
done
echo "  logs: $OUT_DIR"

# ── assertion ────────────────────────────────────────────────────────────────
if [ "$EXPECT" = "none" ]; then
  echo "✅ (--no-assert) — report only"
  exit 0
fi

# Um job que falhou invalida a asserção (N/A não é evidência de cache).
ANY_FAILED=0
for i in $(seq 1 "$RUNS"); do
  if [ "${RUN_EXITS[$((i-1))]}" != "0" ]; then ANY_FAILED=1; fi
done

# O step setup-bun nunca apareceu no output de NENHUMA run bem-sucedida,
# embora o workflow o referencie → N/A em todas NÃO é evidência: a asserção
# seria vazia (falso PASS se o step foi renomeado/removido ou se o padrão de
# extração regrediu). Mesma classe de falso-positivo que o ANY_FAILED resolve.
if [ "$ANY_FAILED" -eq 0 ] && grep -qE "uses:.*setup-bun" "$WORKFLOW"; then
  STEP_MISSING=1
  for i in $(seq 1 "$RUNS"); do
    if [ "${DURATIONS[$((i-1))]}" != "N/A" ]; then STEP_MISSING=0; fi
  done
  if [ "$STEP_MISSING" -eq 1 ]; then
    echo "❌ INCONCLUSIVO — step setup-bun não encontrado no output de nenhuma run (N/A em todas)"
    echo "   (revise os logs em $OUT_DIR — o step sumiu/foi renomeado ou o padrão de extração regrediu?)"
    exit 1
  fi
fi

if [ "$EXPECT" = "cache-miss" ]; then
  # The bug: NO run reuses the cache (every run re-downloads).
  if [ "$ANY_FAILED" -eq 1 ]; then
    echo "❌ INCONCLUSIVO — pelo menos um job falhou (exit != 0); N/A não é evidência de cache-miss"
    echo "   (revise os logs em $OUT_DIR — ex.: o action externo pode falhar no act como root)"
    exit 1
  fi
  MISS_OK=1
  for i in $(seq 1 "$RUNS"); do
    if [ "${CACHE_HITS[$((i-1))]}" = "true" ]; then MISS_OK=0; fi
  done
  if [ "$MISS_OK" -eq 1 ]; then
    echo "✅ PASS — nenhuma run teve cache-hit=true (bug reproduzido: re-download em cada execução)"
    exit 0
  else
    echo "❌ FAIL — esperado cache-miss em todas as runs, mas alguma teve cache-hit=true"
    echo "   (o bug do oven-sh/setup-bun@v2 não está reproduzível neste checkout)"
    exit 1
  fi
fi

if [ "$EXPECT" = "cache-hit" ]; then
  # The fix: the LAST run reuses actions/cache (only the first can be cold).
  LAST="${CACHE_HITS[$((RUNS-1))]}"
  if [ "$ANY_FAILED" -eq 1 ]; then
    echo "❌ INCONCLUSIVO — pelo menos um job falhou (exit != 0); N/A não é evidência de cache-hit"
    echo "   (revise os logs em $OUT_DIR)"
    exit 1
  fi
  if [ "$LAST" = "true" ]; then
    echo "✅ PASS — última run com cache-hit=true (fix ativo: cache keyed na versão)"
    exit 0
  else
    echo "❌ FAIL — esperado cache-hit=true na última run, obtido: $LAST"
    echo "   (dica: se for a 1ª execução da key, rode o script de novo — o cache é populado no 1º run)"
    exit 1
  fi
fi

echo "❌ FAIL — expect inválido: $EXPECT" >&2
exit 2
