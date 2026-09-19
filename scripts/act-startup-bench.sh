#!/usr/bin/env bash
# =============================================================================
# scripts/act-startup-bench.sh — Bench do overhead de startup do act (imagem)
#
# Mede o custo REAL de subir o container do act por imagem base, ISOLANDO o
# overhead de startup (act + start do container) do custo de setup-bun: roda o
# job secrets-guard (propositalmente SEM setup-bun — só checkout +
# rotate-secrets --check) N vezes em cada imagem (default catthehacker vs
# custom ubuntu-bun) e imprime a tabela de delta (custom vs default, em ms e %).
# Suporta N imagens via --image 'label|tag' (repetível) — a 1ª vira baseline e
# o delta compara todas as demais contra ela (ex.: medir uma candidata alpine).
#
# POR QUE: o README (seção act / BUN_VERSION, tabela de evidência) documenta a
# decisão de usar a imagem custom ghcr.io/<owner>/ubuntu-bun:<versão> para o
# tier-1 fast path do setup-bun. A cada bump de versão da imagem (novo
# BUN_VERSION → re-sync do mirror ubuntu-bun) o custo de startup precisa ser
# REVALIDADO: se a custom ficar muito mais lenta que a default, o fast path
# deixa de compensar. Este script automatiza a medição em 1 comando — sem
# depender de memória nem de rodadas manuais ad-hoc.
#
# MÉTRICA: wall-time do `act` inteiro por run (date +%s%3N, em ms) — inclui o
# overhead do próprio act + start do container. run1 = cold (primeira
# execução da sessão — ~7-30s dependendo do estado de warm-up do docker/act,
# ~30s na 1ª sessão fria, ~5-7s com docker já aquecido); runs 2..N = warm
# (~5-11s observado). NÃO trate os números da header como esperados — a
# medição é o que o bench imprime.
# Runs que FALHAM (exit != 0) NÃO entram nas estatísticas/delta — aparecem
# como FAIL na tabela e o bench termina em exit 1, invalidando a medição.
# O job secrets-guard é o mesmo usado na medição manual documentada no README.
#
# Pipeline:
#   1. Pre-flight: act.exe, docker (daemon), .actrc e as DUAS imagens locais
#   2. Bench por imagem (baseline = 1ª imagem; default: catthehacker):
#      RUNS execuções do secrets-guard com --pull=false, mede wall-time e exit
#   3. Estatística por imagem (cold=run1, warm=runs 2..RUNS): min/mediana/média
#   4. Tabela de delta: cada imagem vs baseline (ms e %) para cold e warm
#   5. Asserção opcional (--assert-pct): falha se ALGUMA imagem exceder a
#      baseline além do percentual dado — revalidação automática no bump
#
# Usage:
#   ./scripts/act-startup-bench.sh                  # 5 runs × 2 imagens default
#   ./scripts/act-startup-bench.sh -n 3             # 3 runs × 2 imagens
#   ./scripts/act-startup-bench.sh --assert-pct 30  # falha se ALGUMA exceder a 1ª em +30%
#   ACT_BIN=/caminho/act ./scripts/act-startup-bench.sh  # binário alternativo (ex.: act Linux no CI)
#   ./scripts/act-startup-bench.sh --image 'alpine|act-bench-alpine:local' \
#                                   --image 'ubuntu-bun|<host>/<owner>/ubuntu-bun:<versao>'
#                                                   # lista custom (1ª imagem = baseline)
#   ./scripts/act-startup-bench.sh -h               # ajuda
#
# Exit codes:
#   0 — bench completo, tabela impressa, todos os runs passaram
#       (e asserção satisfeita, se --assert-pct foi dado)
#   1 — falha de infra/run (act/docker/imagem/.actrc ausente, algum run falhou,
#       ou asserção de delta violada)
#   2 — uso incorreto (flag inválida, RUNS < 1, pct inválido)
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
# (a auditoria de espelhos do check-bun-mirror julga este arquivo: a versão do
# Bun aqui só pode vir do .actrc — nenhum literal de BUN_VERSION.)

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$SCRIPT_DIR"
# Binário do act: ACT_BIN permite apontar para um binário alternativo (ex.:
# o act Linux baixado no CI — o default é o act.exe local do Windows em
# tool-results/act/). Usado pelo job semanal act-startup-bench do
# benchmark-weekly.yml.
ACT="${ACT_BIN:-$REPO_ROOT/tool-results/act/act.exe}"
WORKFLOW_DIR="$REPO_ROOT/.github/workflows"
JOB="secrets-guard"   # sem setup-bun → isola só o overhead de startup
RUNS=5
ASSERT_PCT=""
RUN_TIMEOUT=300       # s por execução (secrets-guard é ~11-33s; folga alta)

# Imagens comparadas — passamos -P explícito em TODAS (apples-to-apples),
# mesmo a default, para a medição não depender do mapeamento implícito do act.
# A tag da custom ubuntu-bun é DERIVADA do .actrc (--var BUN_VERSION=... —
# fonte única LOCAL da versão do Bun): a cada bump de BUN_VERSION o bench
# compara a imagem NOVA automaticamente, sem editar este script.
#
# NÃO existe literal de reserva (era `:-1.3.14` até a auditoria de espelhos):
# um default aqui sobrevive ao bump e o bench passa a comparar `ubuntu-bun:1.3.14`
# — uma imagem velha, ou inexistente — como se fosse a ATUAL, sem nada acusar.
# Sem a linha no .actrc o script PARA e diz onde declarar (fail-closed).
ACTRC_BUN="$(sed -n 's/^--var BUN_VERSION=//p' "$REPO_ROOT/.actrc" 2>/dev/null | head -1 || true)"
if [ -z "$ACTRC_BUN" ]; then
  echo "❌ .actrc não declara '--var BUN_VERSION=' — a tag da imagem ubuntu-bun é DERIVADA dele" >&2
  echo "   (é o espelho local da repository variable BUN_VERSION). Sem a linha, um default" >&2
  echo "   silencioso compararia uma imagem velha/inexistente como se fosse a atual — por isso" >&2
  echo "   não há reserva. Declare em .actrc '--var BUN_VERSION=<X.Y.Z>' (ou rode bump-bun.sh)." >&2
  exit 2
fi
IMG_LABEL=("catthehacker:act-latest" "ubuntu-bun:$ACTRC_BUN")
IMG_ID=("default" "custom")
# FONTE ÚNICA do host (invariante 1 do check:registry-source): o registry sai de
# IMAGE_REGISTRY/IMAGE_NAMESPACE (repo variable; no act local, `--var` do .actrc)
# — NUNCA de um `ghcr.io` cravado aqui. O default acompanha o do compose.
REGISTRY="${IMAGE_REGISTRY:-ghcr.io}"
NAMESPACE="${IMAGE_NAMESPACE:-severinno}"
IMG_TAG=("catthehacker/ubuntu:act-latest" "$REGISTRY/$NAMESPACE/ubuntu-bun:$ACTRC_BUN")
IMG_ARGS=()   # --image 'label|tag' repetível — substitui a lista acima (1ª = baseline)

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; }
info() { echo -e "  ${YELLOW}ℹ️${NC} $1"; }

usage() {
  cat <<'HELP'
Uso: ./scripts/act-startup-bench.sh [opções]
  -n, --runs N          execuções por imagem (default 5)
      --assert-pct P    falha se ALGUMA imagem for mais lenta que a 1ª em >P%
      --image L|T       substitui a lista default (label|tag; a 1ª vira baseline)
  -h, --help            mostra esta ajuda
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
    --assert-pct)
      ASSERT_PCT="${2:-}"
      if [[ ! "$ASSERT_PCT" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
        echo "❌ --assert-pct precisa ser um percentual numérico (ex.: 30)" >&2
        exit 2
      fi
      shift 2
      ;;
    --image)
      IMG_ARGS+=("${2:-}")
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

# Lista de imagens: se --image foi passado, substitui a default (1ª = baseline).
if [ "${#IMG_ARGS[@]}" -gt 0 ]; then
  IMG_LABEL=()
  IMG_ID=()
  IMG_TAG=()
  for entry in "${IMG_ARGS[@]}"; do
    if [[ "$entry" != *"|"* ]] || [ -z "${entry%%|*}" ] || [ -z "${entry#*|}" ]; then
      echo "❌ --image espera 'label|tag' (recebido: '$entry')" >&2
      exit 2
    fi
    IMG_LABEL+=("${entry%%|*}")
    IMG_TAG+=("${entry#*|}")
  done
  for i in "${!IMG_TAG[@]}"; do
    IMG_ID+=("img$i")
  done
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# ── Banner ──────────────────────────────────────────────────────────────────

echo ""
echo "  ═══════════════════════════════════════════════════════════════════"
echo "   🚀 SEVERINNO — ACT STARTUP BENCH (job $JOB × $RUNS por imagem)"
echo "  ═══════════════════════════════════════════════════════════════════"
echo ""

# ── STEP 1 — Pre-flight ─────────────────────────────────────────────────────

info "STEP 1: Pre-flight (act.exe, docker, .actrc, imagens locais)..."

[ -x "$ACT" ] || {
  fail "act.exe não encontrado em $ACT — faça o download do act primeiro."
  exit 1
}
ACT_VERSION="$("$ACT" --version 2>&1 | head -1 || true)"
info "act: $ACT_VERSION"

command -v docker >/dev/null 2>&1 || {
  fail "docker não está no PATH."
  exit 1
}
docker version --format '{{.Server.Version}}' >/dev/null 2>&1 || {
  fail "daemon docker não responde (Docker Desktop rodando?)."
  exit 1
}

[ -f "$REPO_ROOT/.actrc" ] || {
  fail ".actrc ausente na raiz — o act local quebraria (--var BUN_VERSION)."
  exit 1
}

for img in "${IMG_TAG[@]}"; do
  if docker image inspect "$img" >/dev/null 2>&1; then
    pass "imagem local: $img"
  else
    fail "imagem ausente: $img — rode 'docker pull $img' ou construa/baixe a imagem primeiro."
    exit 1
  fi
done

# ── Helpers de estatística ──────────────────────────────────────────────────

# stats <arquivo-ms>: imprime "min|mediana|média" sobre TODOS os runs
# (ordenados). O cold (run1 cronológico) e a warm-mediana (runs 2..N) são
# calculados separadamente — NUNCA confundir min com run1!
stats() {
  local f="$1"
  sort -n "$f" | awk '
    { a[NR]=$1; s+=$1 }
    END {
      if (NR == 0) { print "-|-|-"; exit }
      n = NR
      min = a[1]
      med = (n % 2 == 1) ? a[(n+1)/2] : int((a[n/2] + a[n/2+1]) / 2)
      printf "%d|%d|%d\n", min, med, int(s / n + 0.5)
    }'
}

# warm_median <arquivo-ms>: mediana dos runs 2..N CRONOLÓGICOS — descarta o
# run1 (cold) ANTES de ordenar. "-" se houver só 1 run.
warm_median() {
  local f="$1"
  tail -n +2 "$f" | sort -n | awk '
    { a[NR]=$1 }
    END {
      if (NR == 0) { print "-"; exit }
      n = NR
      if (n % 2 == 1) print a[(n+1)/2]
      else print int((a[n/2] + a[n/2+1]) / 2)
    }'
}

# pct_diff <custom> <default>: imprime "+X ms (+Y%)" ou "n/a"
pct_diff() {
  local c="${1:-}" d="${2:-}"
  if [ "$c" = "-" ] || [ "$d" = "-" ] || [ -z "$c" ] || [ -z "$d" ]; then
    echo "n/a"
    return
  fi
  awk -v c="$c" -v d="$d" '
    BEGIN {
      if (d > 0) {
        diff = c - d
        pct = diff * 100 / d
        sign = (diff >= 0) ? "+" : "-"
        if (diff < 0) diff = -diff
        if (pct < 0) pct = -pct
        printf "%s%d ms (%s%.1f%%)", sign, diff, sign, pct
      } else {
        print "n/a"
      }
    }'
}

# ── STEP 2+3 — Bench por imagem ─────────────────────────────────────────────

declare -A VALUES

for idx in "${!IMG_TAG[@]}"; do
  label="${IMG_LABEL[$idx]}"
  id="${IMG_ID[$idx]}"
  img="${IMG_TAG[$idx]}"
  fvals="$TMP_DIR/values-$id.txt"
  fexits="$TMP_DIR/exits-$id.txt"
  frun="$TMP_DIR/runs-$id.txt"
  : > "$fvals"
  : > "$fexits"
  : > "$frun"

  info "Bench imagem [$label] ($img) — $RUNS execuções do job $JOB..."
  for i in $(seq 1 "$RUNS"); do
    log="$TMP_DIR/run-$id-$i.log"
    start=$(date +%s%3N)
    set +e
    (cd "$REPO_ROOT" && timeout "$RUN_TIMEOUT" "$ACT" -b -W "$WORKFLOW_DIR" -j "$JOB" \
      -P "ubuntu-latest=$img" --pull=false) >"$log" 2>&1
    code=$?
    set -e
    end=$(date +%s%3N)
    ms=$((end - start))
    echo "$code" >> "$fexits"
    echo "$ms|$code" >> "$frun"   # par por run (ordem fixa) — tabela sem shift
    if [ "$code" -eq 0 ]; then
      echo "$ms" >> "$fvals"   # só runs com exit 0 entram nas estatísticas
      printf '    run %d/%d: %d ms (exit 0)\n' "$i" "$RUNS" "$ms"
    else
      printf '    run %d/%d: %d ms (exit %d ⚠️ — fora das estatísticas)\n' "$i" "$RUNS" "$ms" "$code"
    fi
  done
  VALUES["$id"]="$(stats "$fvals")"
  echo ""
done

# ── STEP 4 — Tabela de resultados + delta ───────────────────────────────────

info "STEP 4: Tabela de resultados (ms por run + estatística)..."

printf '%-22s' "Imagem"
for i in $(seq 1 "$RUNS"); do printf '%9s' "run$i"; done
printf '%9s%9s%9s%11s\n' "min" "mediana" "média" "warm-med"

printf '%-22s' "------------------------"
for i in $(seq 1 "$RUNS"); do printf '%9s' "---------"; done
printf '%9s%9s%9s%11s\n' "---------" "---------" "---------" "-----------"

for idx in "${!IMG_TAG[@]}"; do
  id="${IMG_ID[$idx]}"
  fvals="$TMP_DIR/values-$id.txt"
  fexits="$TMP_DIR/exits-$id.txt"
  frun="$TMP_DIR/runs-$id.txt"   # par ms|exit por run DESTA imagem (não o da última!)
  IFS='|' read -r min med avg <<< "${VALUES[$id]}"
  wmed="$(warm_median "$fvals")"
  printf '%-22s' "${IMG_LABEL[$idx]}"
  for i in $(seq 1 "$RUNS"); do
    IFS='|' read -r ms code < <(sed -n "${i}p" "$frun")
    if [ "$code" -eq 0 ]; then
      printf '%9s' "$ms"
    else
      printf '%9s' "FAIL"
    fi
  done
  printf '%9s%9s%9s%11s\n' "$min" "$med" "$avg" "$wmed"
done
echo ""

# Delta (baseline = 1ª imagem; compara as demais) — cold = run1 CRONOLÓGICO
# (não o min!); warm = mediana dos runs 2..N (warm_median descarta o run1
# antes de ordenar).
BASE_ID="${IMG_ID[0]}"
IFS='|' read -r _ bmed _ <<< "${VALUES[$BASE_ID]}"
bcold="$(sed -n '1p' "$TMP_DIR/values-$BASE_ID.txt")"
bwmed="$(warm_median "$TMP_DIR/values-$BASE_ID.txt")"

NIMGS="${#IMG_TAG[@]}"
echo "  ── Δ DELTA (baseline = ${IMG_LABEL[0]}) ───────────────────────────"
if [ "$NIMGS" -gt 1 ]; then
  for idx in $(seq 1 $((NIMGS - 1))); do
    id="${IMG_ID[$idx]}"
    ccold="$(sed -n '1p' "$TMP_DIR/values-$id.txt")"
    cwmed="$(warm_median "$TMP_DIR/values-$id.txt")"
    printf '    %-20s\n' "${IMG_LABEL[$idx]}"
    printf '      cold (run1):       %-12s  vs  %-12s  →  %s\n' \
      "$ccold" "$bcold" "$(pct_diff "$ccold" "$bcold")"
    printf '      warm (runs 2..%d):  %-12s  vs  %-12s  →  %s\n' \
      "$RUNS" "$cwmed" "$bwmed" "$(pct_diff "$cwmed" "$bwmed")"
  done
fi
echo "    (nota: o cold do README (~30s na 1ª sessão) é o run1 da 1ª imagem — o run1 das"
echo "     demais já tem o act aquecido; a comparação run1×run1 segue justa"
echo "     para o overhead de container entre as imagens.)"
echo ""

# ── STEP 5 — Validação de exit + asserção opcional ──────────────────────────

ANY_FAIL=0
for idx in "${!IMG_TAG[@]}"; do
  fexits="$TMP_DIR/exits-${IMG_ID[$idx]}.txt"
  if grep -vq '^0$' "$fexits"; then
    ANY_FAIL=1
    fail "Imagem ${IMG_LABEL[$idx]}: algum run falhou (exits: $(paste -sd, "$fexits"))."
  fi
done

if [ "$ANY_FAIL" -eq 1 ]; then
  fail "BENCH INVALIDADO — infra/imagem com problema; corrige antes de confiar na tabela."
  exit 1
fi

if [ -n "$ASSERT_PCT" ]; then
  # métrica da asserção: warm-med se houver (runs 2..N), senão a mediana geral
  if [ "$bwmed" = "-" ]; then METRIC_B="$bmed"; else METRIC_B="$bwmed"; fi
  ASSERT_OK=1
  if [ "$NIMGS" -gt 1 ]; then
    for idx in $(seq 1 $((NIMGS - 1))); do
      id="${IMG_ID[$idx]}"
      IFS='|' read -r _ cmed _ <<< "${VALUES[$id]}"
      cwmed="$(warm_median "$TMP_DIR/values-$id.txt")"
      if [ "$cwmed" = "-" ]; then METRIC_C="$cmed"; else METRIC_C="$cwmed"; fi
      if awk -v c="$METRIC_C" -v d="$METRIC_B" -v p="$ASSERT_PCT" \
        'BEGIN { if (d > 0 && c > d * (1 + p/100)) exit 1; exit 0 }'; then
        pass "Asserção OK: ${IMG_LABEL[$idx]} ${METRIC_C} ms dentro de +$ASSERT_PCT% da baseline (${METRIC_B} ms)"
      else
        fail "ASSERÇÃO VIOLADA: ${IMG_LABEL[$idx]} ${METRIC_C} ms > baseline ${METRIC_B} ms + $ASSERT_PCT%"
        ASSERT_OK=0
      fi
    done
  fi
  if [ "$ASSERT_OK" -eq 0 ]; then
    fail "Reavalie a decisão da imagem (fast path vs overhead de startup)."
    exit 1
  fi
fi

# ── Result (cleanup roda no trap EXIT) ──────────────────────────────────────

echo ""
pass "BENCH COMPLETO — tabela acima. Revalide a decisão da imagem a cada bump"
pass "de versão (novo BUN_VERSION → re-sync do mirror ubuntu-bun → rodar de novo)."
exit 0
