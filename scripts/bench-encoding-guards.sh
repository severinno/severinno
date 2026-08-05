#!/usr/bin/env bash
# =============================================================================
# scripts/bench-encoding-guards.sh — Bench do overhead local dos guards de CI
#
# Mede o custo REAL (wall-time em ms) de cada guard do
# scripts/run-encoding-guards.sh — o runner compartilhado que os hooks locais
# (pre-commit/pre-push) e o utf8-check.yml (CI) executam de forma idêntica.
# Roda CADA guard N vezes (default 5), imprime a tabela por guard (run1..N +
# min/mediana/média) e a linha TOTAL (o runner inteiro), no mesmo padrão do
# act-startup-bench.sh. É a fonte dos números do bloco "Overhead medido" da
# seção Git Hooks do README — revalide a cada otimização de guard.
#
# POR QUE: o overhead total dos 15 guards caiu de ~6.5s (quando o
# check-single-line-out-assign levava ~3s) para ~3.4s (otimização single-grep
# aplicada também ao check-utf8/check-crlf). O custo de CADA guard precisa ser
# mensurável em 1 comando — sem depender de memória nem de cronometragem
# manual ad-hoc — para (a) documentar com números reais, (b) detectar
# regressão de performance (um guard que passou a varrer mais arquivos) e
# (c) decidir onde otimizar (o topo da tabela é o maior retorno).
#
# MÉTRICA: wall-time do processo inteiro por run (date +%s%3N, em ms) — inclui
# o overhead de spawn do bash/node. O run1 de cada guard costuma ser ~10-50ms
# mais frio (warm-up do node + cache de fs) — a mediana sobre os runs absorve
# isso, não trate run1 como esperado. Runs que FALHAM (exit != 0 — o guard
# acusou violação) NÃO entram nas estatísticas — aparecem como FAIL na tabela
# e o bench termina em exit 1 (não confie em números de um guard quebrado).
#
# Pipeline:
#   1. Banner + pré-condição (runner existe, bash/node no PATH)
#   2. Bench por guard (lista fixa dos 15 do runner + linha TOTAL do runner):
#      RUNS execuções, mede wall-time e exit
#   3. Estatística por guard: min/mediana/média (só runs com exit 0)
#   4. Tabela: guard × run1..N × min/mediana/média + share % da mediana total
#   5. Asserção opcional (--assert-total-ms): falha se a mediana do TOTAL
#      exceder o limiar — revalidação automática de regressão de overhead
#
# Usage:
#   ./scripts/bench-encoding-guards.sh                  # 5 runs × 17 linhas
#   ./scripts/bench-encoding-guards.sh -n 3             # 3 runs por guard
#   ./scripts/bench-encoding-guards.sh --assert-total-ms 5000   # falha se TOTAL mediana > 5s
#   ./scripts/bench-encoding-guards.sh -h               # ajuda
#
# Exit codes:
#   0 — bench completo, tabela impressa, todos os runs passaram
#       (e asserção satisfeita, se --assert-total-ms foi dado)
#   1 — algum guard/runner falhou (exit != 0) ou asserção de total violada
#   2 — uso incorreto (flag inválida, RUNS < 1, limiar inválido)
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$SCRIPT_DIR"
RUNS=5
ASSERT_TOTAL_MS=""
RUN_TIMEOUT=120       # s por execução (nenhum guard passa de ~2s hoje)

# Lista fixa dos guards — espelha scripts/run-encoding-guards.sh (ordem + cmd
# exatos). A linha TOTAL (runner inteiro) é medida separadamente no fim.
# label|comando — comando executado com `bash -c` a partir da raiz do repo.
GUARDS=(
  "check-utf8.sh|bash scripts/check-utf8.sh --dry-run --ci src/"
  "check-utf8-scope.mjs|node scripts/check-utf8-scope.mjs"
  "check-crlf.sh|bash scripts/check-crlf.sh --ci"
  "check-crlf-scope.mjs|node scripts/check-crlf-scope.mjs"
  "check-blob-crlf.sh|bash scripts/check-blob-crlf.sh --ci"
  "check-single-line-out-assign.sh|bash scripts/check-single-line-out-assign.sh --ci"
  "check-encoding-guards-badge.mjs|node scripts/check-encoding-guards-badge.mjs"
  "check-readme-repro-marker.mjs|node scripts/check-readme-repro-marker.mjs"
  "check-readme-anchors.mjs|node scripts/check-readme-anchors.mjs"
  "check-readme-toc.mjs|node scripts/check-readme-toc.mjs"
  "check-readme-images.mjs|node scripts/check-readme-images.mjs"
  "check-no-setup-bun.mjs|node scripts/check-no-setup-bun.mjs"
  "check-bun-mirror.mjs|node scripts/check-bun-mirror.mjs"
  "scan-lucide-icons.mjs|node scripts/scan-lucide-icons.mjs --check"
  "check-hooks-symmetry.mjs|node scripts/check-hooks-symmetry.mjs"
  "check-mutation-jobs.mjs|node scripts/check-mutation-jobs.mjs"
)

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

usage() {
  cat <<'HELP'
Uso: ./scripts/bench-encoding-guards.sh [opções]
  -n, --runs N            execuções por guard (default 5)
      --assert-total-ms X falha se a mediana do TOTAL (runner inteiro) > X ms
  -h, --help              mostra esta ajuda
HELP
}

# ── Flags ───────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--runs)
      RUNS="${2:-}"
      if [[ ! "$RUNS" =~ ^[0-9]+$ ]] || [ "$RUNS" -lt 1 ]; then
        echo "❌ --runs precisa ser inteiro >= 1 (recebido: '${2:-}')" >&2
        exit 2
      fi
      shift 2
      ;;
    --assert-total-ms)
      ASSERT_TOTAL_MS="${2:-}"
      if [[ ! "$ASSERT_TOTAL_MS" =~ ^[0-9]+$ ]] || [ "$ASSERT_TOTAL_MS" -lt 1 ]; then
        echo "❌ --assert-total-ms precisa ser inteiro > 0 (recebido: '${2:-}')" >&2
        exit 2
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "❌ Flag desconhecida: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# ── Banner ──────────────────────────────────────────────────────────────────

echo ""
echo "  ═══════════════════════════════════════════════════════════════════"
echo "   🚀 SEVERINNO — ENCODING GUARDS BENCH (${#GUARDS[@]} guards + TOTAL × $RUNS)"
echo "  ═══════════════════════════════════════════════════════════════════"
echo ""

# ── STEP 1 — Pré-condição ──────────────────────────────────────────────────

info "STEP 1: Pré-condição (runner, bash, node)..."
[ -f "$REPO_ROOT/scripts/run-encoding-guards.sh" ] || {
  fail "runner ausente: scripts/run-encoding-guards.sh"
  exit 1
}
command -v bash >/dev/null 2>&1 || { fail "bash não está no PATH."; exit 1; }
command -v node >/dev/null 2>&1 || { fail "node não está no PATH."; exit 1; }
pass "pré-condição ok"

# ── STEP 1.5 — Drift check: o bench espelha o runner? ───────────────────────

info "STEP 1.5: Drift check (lista do bench vs run-encoding-guards.sh)..."
# Se um guard novo for adicionado ao runner sem entry neste bench, a medição
# fica silenciosamente incompleta — o drift check avisa (não falha: o bench é
# ferramenta de medição, o gate de paridade real é o check-hooks-symmetry).
# Exclui a auto-referência do runner (linha Usage do próprio header) — o
# runner é medido como TOTAL, não é um guard da lista GUARDS.
runner_refs="$(grep -oE 'scripts/[A-Za-z0-9._-]+' "$REPO_ROOT/scripts/run-encoding-guards.sh" | grep -v 'scripts/run-encoding-guards.sh' | sort -u)"
bench_refs="$(for e in "${GUARDS[@]}"; do printf '%s ' "${e#*|}" | grep -oE 'scripts/[A-Za-z0-9._-]+'; done | sort -u)"
missing_refs="$(comm -23 <(printf '%s\n' "$runner_refs") <(printf '%s\n' "$bench_refs") || true)"
extra_refs="$(comm -13 <(printf '%s\n' "$runner_refs") <(printf '%s\n' "$bench_refs") || true)"
if [ -n "$missing_refs" ] || [ -n "$extra_refs" ]; then
  [ -n "$missing_refs" ] && info "⚠️  no runner sem entry no bench: $(echo $missing_refs | tr '\n' ' ')"
  [ -n "$extra_refs" ] && info "⚠️  no bench sem comando no runner: $(echo $extra_refs | tr '\n' ' ')"
  info "→ a medição pode estar incompleta — sincronize a lista GUARDS com o runner."
else
  pass "bench espelha o runner (${#GUARDS[@]} guards, sem órfão)"
fi
echo ""

# ── Helpers de estatística (mesmo padrão do act-startup-bench.sh) ──────────

# stats <arquivo-ms>: imprime "min|mediana|média" sobre TODOS os runs
# (ordenados). Runs com exit != 0 NÃO entram no arquivo (fora da medição).
stats() {
  local f="$1"
  if [ ! -s "$f" ]; then echo "-|-|-"; return; fi
  sort -n "$f" | awk '
    { a[NR]=$1; s+=$1 }
    END {
      n = NR
      min = a[1]
      med = (n % 2 == 1) ? a[(n+1)/2] : int((a[n/2] + a[n/2+1]) / 2)
      printf "%d|%d|%d\n", min, med, int(s / n + 0.5)
    }'
}

# ── STEP 2+3 — Bench por guard ──────────────────────────────────────────────

declare -A VALUES

run_one() {  # <arquivo-values> <arquivo-exits> <arquivo-runs> <comando> <label> <seq> <total>
  local fvals="$1" fexits="$2" frun="$3" cmd="$4" label="$5" i="$6" total="$7" log
  log="$TMP_DIR/run-$(echo "$label" | tr -c '[:alnum:]' '_').log"
  local start end ms code
  start=$(date +%s%3N)
  set +e
  (cd "$REPO_ROOT" && timeout "$RUN_TIMEOUT" bash -c "$cmd") >"$log" 2>&1
  code=$?
  set -e
  end=$(date +%s%3N)
  ms=$((end - start))
  echo "$code" >> "$fexits"
  echo "$ms|$code" >> "$frun"
  if [ "$code" -eq 0 ]; then
    echo "$ms" >> "$fvals"
    printf '    run %d/%d: %d ms (exit 0)\n' "$i" "$total" "$ms"
  else
    printf '    run %d/%d: %d ms (exit %d ⚠️ — fora das estatísticas)\n' "$i" "$total" "$ms" "$code"
  fi
}

for entry in "${GUARDS[@]}"; do
  label="${entry%%|*}"
  cmd="${entry#*|}"
  id="$(echo "$label" | tr -c '[:alnum:]' '_')"
  fvals="$TMP_DIR/values-$id.txt"
  fexits="$TMP_DIR/exits-$id.txt"
  frun="$TMP_DIR/runs-$id.txt"
  : > "$fvals"; : > "$fexits"; : > "$frun"

  info "Bench guard [$label] — $RUNS execuções..."
  for i in $(seq 1 "$RUNS"); do
    run_one "$fvals" "$fexits" "$frun" "$cmd" "$label" "$i" "$RUNS"
  done
  VALUES["$id"]="$(stats "$fvals")"
  echo ""
done

# Linha TOTAL: o runner inteiro (o que os hooks realmente pagam)
TOTAL_ID="runner"
fvals="$TMP_DIR/values-$TOTAL_ID.txt"
fexits="$TMP_DIR/exits-$TOTAL_ID.txt"
frun="$TMP_DIR/runs-$TOTAL_ID.txt"
: > "$fvals"; : > "$fexits"; : > "$frun"
info "Bench TOTAL (runner inteiro) — $RUNS execuções..."
for i in $(seq 1 "$RUNS"); do
  run_one "$fvals" "$fexits" "$frun" "bash scripts/run-encoding-guards.sh" "$TOTAL_ID" "$i" "$RUNS"
done
VALUES["$TOTAL_ID"]="$(stats "$fvals")"

# ── STEP 4 — Tabela de resultados ───────────────────────────────────────────

info "STEP 4: Tabela de resultados (ms por run + estatística)..."
echo ""
printf '%-32s' "Guard"
for i in $(seq 1 "$RUNS"); do printf '%9s' "run$i"; done
printf '%9s%9s%9s%9s\n' "min" "mediana" "média" "share%"
printf '%-32s' "--------------------------------"
for i in $(seq 1 "$RUNS"); do printf '%9s' "---------"; done
printf '%9s%9s%9s%9s\n' "---------" "---------" "---------" "---------"

IFS='|' read -r _ tmed _ <<< "${VALUES[$TOTAL_ID]}"

print_row() {  # <label> <id> <is-total>
  local label="$1" id="$2" is_total="$3" fvals frun
  fvals="$TMP_DIR/values-$id.txt"
  frun="$TMP_DIR/runs-$id.txt"
  IFS='|' read -r min med avg <<< "${VALUES[$id]}"
  printf '%-32s' "$label"
  for i in $(seq 1 "$RUNS"); do
    IFS='|' read -r ms code < <(sed -n "${i}p" "$frun")
    if [ "$code" -eq 0 ]; then printf '%9s' "$ms"; else printf '%9s' "FAIL"; fi
  done
  if [ "$is_total" = "1" ]; then
    printf '%9s%9s%9s%9s\n' "$min" "$med" "$avg" "100%"
  else
    local share
    if [ "$med" != "-" ] && [ -n "$tmed" ] && [ "$tmed" != "-" ] && [ "$tmed" -gt 0 ]; then
      share="$(awk -v m="$med" -v t="$tmed" 'BEGIN { printf "%.0f", m*100/t }')"
    else
      share="-"
    fi
    printf '%9s%9s%9s%9s\n' "$min" "$med" "$avg" "$share%"
  fi
}

for entry in "${GUARDS[@]}"; do
  label="${entry%%|*}"
  print_row "$label" "$(echo "$label" | tr -c '[:alnum:]' '_')" 0
done
print_row "TOTAL (runner)" "$TOTAL_ID" 1
echo ""
echo "  (share% = mediana do guard / mediana do TOTAL — o topo da tabela é o"
echo "   maior retorno de otimização; ~3.4s total, dominado por check-crlf/"
echo "   check-utf8 que varrem 784 arquivos .ts/.tsx + todos os .sh.)"
echo ""

# ── STEP 5 — Validação de exit + asserção opcional ──────────────────────────

ANY_FAIL=0
for entry in "${GUARDS[@]}"; do
  label="${entry%%|*}"
  fexits="$TMP_DIR/exits-$(echo "$label" | tr -c '[:alnum:]' '_').txt"
  if grep -vq '^0$' "$fexits"; then
    ANY_FAIL=1
    fail "Guard $label: algum run falhou (exits: $(paste -sd, "$fexits"))."
  fi
done
if grep -vq '^0$' "$TMP_DIR/exits-$TOTAL_ID.txt"; then
  ANY_FAIL=1
  fail "TOTAL (runner): algum run falhou (exits: $(paste -sd, "$TMP_DIR/exits-$TOTAL_ID.txt"))."
fi

if [ "$ANY_FAIL" -eq 1 ]; then
  fail "BENCH INVALIDADO — algum guard acusou violação; corrija antes de confiar na tabela."
  exit 1
fi

if [ -n "$ASSERT_TOTAL_MS" ]; then
  if awk -v t="$tmed" -v x="$ASSERT_TOTAL_MS" \
    'BEGIN { if (t != "-" && t > x) exit 1; exit 0 }'; then
    pass "Asserção OK: TOTAL mediana ${tmed} ms dentro do limiar ${ASSERT_TOTAL_MS} ms"
  else
    fail "ASSERÇÃO VIOLADA: TOTAL mediana ${tmed} ms > limiar ${ASSERT_TOTAL_MS} ms — reavalie a otimização dos guards."
    exit 1
  fi
fi

# ── Result (cleanup roda no trap EXIT) ──────────────────────────────────────

echo ""
pass "BENCH COMPLETO — tabela acima. Documente/revalide o overhead local a"
pass "cada otimização de guard (o README cita os números na seção Git Hooks)."
exit 0
