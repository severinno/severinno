#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# bench-setup-bun.sh — medir o tempo REAL do step setup-bun em runner
# GitHub-hosted (cold→warm) via jobs API e comparar com a emulação do act
#
# WHY: a emulação local do act (~29-33s composite no catthehacker default)
# NÃO representa o CI real: o act emula o actions/cache sem o serviço do
# GitHub, e o tier-1 fast path não engaja na imagem default. Este script
# automatiza a medição real: dispara o workflow bench-setup-bun.yml N× via
# workflow_dispatch (1º = cold cache, 2º = warm cache), espera concluir, lê
# a duração do step ./.github/actions/setup-bun da jobs API e imprime a
# tabela comparativa real vs act.
#
# MEDIÇÃO (jobs API): o GitHub expande composite actions em sub-steps na
# jobs API (Resolve Bun version, Detect pre-installed Bun, Restore Bun
# release from cache, Download Bun release, ...). O "tempo do setup-bun" é o
# span do 1º ao último sub-step RODADO do action (started_at do 1º →
# completed_at do último), calculado com precisão de ms via node. Steps
# SKIPPED têm started_at/completed_at nulos na API — são filtrados com
# select(.status == "completed"). O tier (1/2/3) é detectado do log do run.
#
# Pré-requisitos:
#   - gh autenticado com acesso ao repo real (gh auth login)
#   - vars.BUN_VERSION criada em Settings → Secrets and variables → Actions
#   - o workflow bench-setup-bun.yml presente no ref de dispatch (--ref)
#     (o ref deve ser uma branch PUSHADA que contenha o workflow)
#
# Usage:
#   ./scripts/bench-setup-bun.sh                       # defaults abaixo
#   ./scripts/bench-setup-bun.sh --ref main            # dispatch em outro ref
#   ./scripts/bench-setup-bun.sh --runs 3              # 3 execuções
#   ./scripts/bench-setup-bun.sh --dry-run             # só valida pré-requisitos
#   ./scripts/bench-setup-bun.sh --json out.json       # salva timings em JSON
#   ./scripts/bench-setup-bun.sh -v                    # verbose (polling)
#
# Env overrides: BENCH_GH_REPO (owner/repo; default: deriva do remote origin),
#                BENCH_REF, BENCH_RUNS, BENCH_TIMEOUT_S.
#
# Exit codes:
#   0 — runs executados e timings extraídos
#   1 — algum run falhou ou timing não encontrado
#   2 — usage / auth / setup error
#   3 — vars.BUN_VERSION não existe (crie em Settings → Secrets and variables → Actions)
#   4 — API bloqueada (SSH confirmou o workflow no ref remoto; o ÚNICO
#       bloqueio restante é o acesso à API via gh — sem ele não há
#       workflow_dispatch nem jobs API para medir)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── defaults ────────────────────────────────────────────────────────────────
# Deriva owner/repo do remote origin (ex.: git@github.com:severinno/severinno.git)
REMOTE_URL="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null || true)"
case "$REMOTE_URL" in
  git@github.com:*)   GH_REPO="${REMOTE_URL#git@github.com:}" ;;
  https://github.com/*) GH_REPO="${REMOTE_URL#https://github.com/}" ;;
  *) GH_REPO="" ;;
esac
GH_REPO="${GH_REPO%.git}"
GH_REPO="${BENCH_GH_REPO:-$GH_REPO}"
REF="${BENCH_REF:-$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || true)}"
[ -z "$REF" ] && REF="main"
RUNS="${BENCH_RUNS:-2}"
TIMEOUT_S="${BENCH_TIMEOUT_S:-600}"
WORKFLOW_NAME="bench-setup-bun.yml"
JSON_OUT=""
VERBOSE=0
DRY_RUN=0

# ── arg parsing ─────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) GH_REPO="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --runs) RUNS="$2"; shift 2 ;;
    --timeout) TIMEOUT_S="$2"; shift 2 ;;
    --json) JSON_OUT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -v) VERBOSE=1; shift ;;
    -h|--help)
      END_SEP="$(grep -n '^# ---' "$0" | sed -n '2p' | cut -d: -f1)"
      [ -n "$END_SEP" ] || { echo "bench-setup-bun: header separators not found — cannot print --help" >&2; exit 2; }
      sed -n "2,${END_SEP}p" "$0"
      exit 0 ;;
    *) echo "bench-setup-bun: unknown argument: $1" >&2
       echo "Usage: $0 [--repo owner/repo] [--ref BRANCH] [--runs N] [--timeout S] [--json FILE] [--dry-run] [-v]" >&2
       exit 2 ;;
  esac
done

# ── preflight ───────────────────────────────────────────────────────────────
if [ -z "$GH_REPO" ]; then
  echo "bench-setup-bun: não consegui derivar owner/repo do remote origin — passe --repo owner/repo" >&2
  exit 2
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "bench-setup-bun: gh CLI não encontrado — instale o GitHub CLI e rode gh auth login" >&2
  exit 2
fi

# ── Fallback SSH (git) para o check do workflow no ref remoto ──────────────
# Quando o gh está SEM acesso à API (token sem escopo/conta errada) mas o git
# SSH alcança o remoto (como no ambiente local deste projeto), este fallback
# confirma que (a) o ref existe e (b) o workflow está no ref — permitindo
# reportar com clareza que o ÚNICO bloqueio restante é a API.
ssh_workflow_on_ref() { # $1=ref  $2=workflow.yml → 0 se confirmado no remoto
  local ref="$1" wf="$2"
  # ref existe no remoto? (SSH reachability + presença do branch). grep -F:
  # o ref é tratado como STRING fixa (não regex) — nomes como v1.0 não casam
  # por engano. NOTA: o fallback usa o remote `origin` local — se o usuário
  # passar --repo de OUTRO repositório, a verificação SSH é do origin (o
  # caso típico deriva GH_REPO do próprio origin).
  if ! git -C "$REPO_ROOT" ls-remote --heads origin "$ref" 2>/dev/null | grep -qF "refs/heads/$ref"; then
    return 1
  fi
  # fetch do ref (sem tags — só o commit do branch) e verificação do arquivo
  # do workflow via ls-tree (efeito colateral local: grava FETCH_HEAD).
  git -C "$REPO_ROOT" fetch --quiet --no-tags origin "$ref" 2>/dev/null || return 1
  git -C "$REPO_ROOT" ls-tree -r --name-only FETCH_HEAD 2>/dev/null | grep -qx ".github/workflows/$wf"
}

# ── API ok? (auth + acesso ao repo) ───────────────────────────────────────
# Se NÃO, o preflight cai no fallback SSH e reporta o bloqueio único (exit 4).
API_OK=1
if ! gh auth status >/dev/null 2>&1; then API_OK=0; fi
if [ "$API_OK" = "1" ] && ! gh api "repos/$GH_REPO" >/dev/null 2>&1; then API_OK=0; fi

BUN_VERSION=""
if [ "$API_OK" = "1" ]; then
  BUN_VERSION="$(gh api "repos/$GH_REPO/actions/variables/BUN_VERSION" --jq .value 2>/dev/null || true)"
  if [ -z "$BUN_VERSION" ]; then
    echo "bench-setup-bun: vars.BUN_VERSION NÃO EXISTE em $GH_REPO — exit 3 (variável ausente, não erro de auth/uso)" >&2
    echo "  Crie a repository variable (FONTE ÚNICA da versão do Bun):" >&2
    echo "    URL: https://github.com/$GH_REPO/settings/variables/actions" >&2
    echo "    Nome: BUN_VERSION   Valor: ex.: 1.3.14" >&2
    echo "  Ou via CLI (mesmo efeito): gh variable set BUN_VERSION 1.3.14 -R $GH_REPO" >&2
    echo "  Depois re-rode. Sem a variável, TODO CI que usa o setup-bun também falha em runtime (Resolve Bun version)." >&2
    exit 3
  fi
fi

# ── Workflow no ref: via API (normal) ou via SSH (fallback sem auth) ───────
WORKFLOW_ON_REF=0
SSH_OK=0
if [ "$API_OK" = "1" ]; then
  if gh api "repos/$GH_REPO/contents/.github/workflows/$WORKFLOW_NAME?ref=$REF" >/dev/null 2>&1; then
    WORKFLOW_ON_REF=1
  fi
elif ssh_workflow_on_ref "$REF" "$WORKFLOW_NAME"; then
  WORKFLOW_ON_REF=1
  SSH_OK=1
elif git -C "$REPO_ROOT" ls-remote --heads origin "$REF" >/dev/null 2>&1; then
  # SSH alcança o remoto mas o workflow não está no ref (ou o ref não existe)
  SSH_OK=1
fi

# ── Reporte final do preflight ─────────────────────────────────────────────
if [ "$API_OK" = "0" ]; then
  echo "▶ bench-setup-bun — repo=$GH_REPO ref=$REF runs=$RUNS"
  if [ "$SSH_OK" = "1" ]; then
    echo "  ✅ SSH (git) alcança o remoto"
    if [ "$WORKFLOW_ON_REF" = "1" ]; then
      echo "  ✅ workflow $WORKFLOW_NAME CONFIRMADO no ref remoto '$REF' (via git SSH)"
    else
      echo "  ❌ workflow $WORKFLOW_NAME NÃO confirmado no ref '$REF' via git SSH — push uma branch que o contenha (ou use --ref)"
    fi
  else
    echo "  ❌ SSH (git) NÃO alcançou o remoto origin — verifique a chave SSH / remote URL"
  fi
  echo "  ❌ API do GitHub BLOQUEADA — este é o ÚNICO bloqueio restante (a medição exige API: workflow_dispatch + jobs API)."
  echo "     Desbloqueie: gh auth login (conta com acesso a $GH_REPO) OU token com escopos repo+workflow."
  echo "     Também crie vars.BUN_VERSION em Settings → Secrets and variables → Actions (não verificável sem API)."
  exit 4
fi

if [ "$WORKFLOW_ON_REF" != "1" ]; then
  echo "bench-setup-bun: workflow $WORKFLOW_NAME não existe no ref '$REF' — push a branch que o contenha (ou use --ref)" >&2
  exit 2
fi

echo "▶ bench-setup-bun — repo=$GH_REPO ref=$REF runs=$RUNS BUN_VERSION=$BUN_VERSION"
if [ "$DRY_RUN" = "1" ]; then
  echo "  ✅ gh autenticado + acesso ao repo + vars.BUN_VERSION=$BUN_VERSION + workflow no ref '$REF'"
  echo "  (dry-run — nada foi disparado)"
  exit 0
fi

# ── helpers ─────────────────────────────────────────────────────────────────
# A medição do span vive em scripts/bench-setup-bun-span.mjs (funções puras
# testadas em src/lib/__tests__/bench-setup-bun-span.test.ts) — o .sh apenas
# consome o modo CLI (stdin = array JSON de steps da jobs API).

detect_tier() { # $1=run_id → tier label
  local log_txt run_id="$1"
  log_txt="$(gh run view "$run_id" --log 2>/dev/null | tr -d '\r' || true)"
  if echo "$log_txt" | grep -q "Usando Bun pré-instalado"; then
    echo "tier-1 (bun pré-instalado)"
  elif echo "$log_txt" | grep -qi "Cache hit"; then
    echo "tier-2 (cache hit)"
  elif echo "$log_txt" | grep -q "Download Bun release (cold cache)"; then
    echo "tier-3 (cold download)"
  else
    echo "tier desconhecido"
  fi
}

# Dispara o workflow e imprime "duration|tier|conclusion|run_id" em stdout.
# Retorna 1 se o run falhar antes de produzir timing (timeout / steps ausentes).
run_once() { # $1=nº do run  $2=label
  local run_num="$1" label="$2" before run_id="" run_status="" conclusion=""
  local now deadline line steps_json first last start_iso end_iso tier dur

  # Precisão ms: created_at da API tem ms (ex.: ...T12:00:00.123Z) e a
  # comparação é LEXICOGRÁFICA — sem ".000Z" o run disparado no MESMO segundo
  # seria excluído (. < Z) e o polling nunca o acharia (timeout).
  before="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  echo "  ▶ Run #$run_num ($label): dispatch $WORKFLOW_NAME em $REF..."
  gh workflow run "$WORKFLOW_NAME" --ref "$REF" || { echo "bench-setup-bun: dispatch falhou" >&2; return 1; }

  deadline=$(( $(date +%s) + TIMEOUT_S ))
  while [ -z "$run_id" ] || [ "$run_status" != "completed" ]; do
    sleep 8
    line="$(gh run list --workflow "$WORKFLOW_NAME" --limit 5 --json databaseId,status,created_at --jq ".[] | select(.created_at >= \"$before\") | \"\(.databaseId) \(.status)\"" 2>/dev/null | tail -1 || true)"
    if [ -n "$line" ]; then read -r run_id run_status <<< "$line"; fi
    now=$(date +%s)
    if [ "$now" -ge "$deadline" ]; then
      echo "bench-setup-bun: timeout (${TIMEOUT_S}s) aguardando o run #$run_num concluir" >&2
      return 1
    fi
    [ "$VERBOSE" = "1" ] && echo "    ... status=$run_status run=$run_id"
  done

  conclusion="$(gh run view "$run_id" --json conclusion --jq .conclusion 2>/dev/null || echo 'unknown')"
  tier="$(detect_tier "$run_id")"

  # Span do 1º ao último sub-step RODADO (status=completed) do action na jobs
  # API. Steps skipped têm timestamps nulos — o módulo
  # bench-setup-bun-span.mjs filtra (evita NaN no cold run, ex.: "Add cached
  # Bun to PATH" é skipped quando cache-hit != true) e calcula o span.
  steps_json="$(gh api "repos/$GH_REPO/actions/runs/$run_id/jobs" --jq '.jobs[0].steps' 2>/dev/null || true)"
  dur="$(printf '%s' "$steps_json" | node "$SCRIPT_DIR/bench-setup-bun-span.mjs" 2>/dev/null || true)"
  if [ -z "$dur" ]; then
    echo "bench-setup-bun: run #$run_num — não encontrei sub-steps RODADOS do setup-bun na jobs API (run $run_id, conclusion=$conclusion)" >&2
    return 1
  fi

  echo "  ✅ Run #$run_num ($label): ${dur}s | $tier | conclusion=$conclusion | run=$run_id"
  echo "${dur}|${tier}|${conclusion}|${run_id}"
}

# ── execução ────────────────────────────────────────────────────────────────
case "$RUNS" in
  ''|*[!0-9]*) echo "bench-setup-bun: --runs deve ser um inteiro positivo (obtido: '$RUNS')" >&2; exit 2 ;;
esac
if [ "$RUNS" -lt 1 ]; then echo "bench-setup-bun: --runs deve ser >= 1" >&2; exit 2; fi

DURATIONS=()
TIERS=()
CONCLS=()
RUNIDS=()
FAILED=0

for n in $(seq 1 "$RUNS"); do
  label="cold"; [ "$n" -gt 1 ] && label="warm"
  if out="$(run_once "$n" "$label")"; then
    IFS='|' read -r dur tier concl rid <<< "$out"
    DURATIONS+=("$dur"); TIERS+=("$tier"); CONCLS+=("$concl"); RUNIDS+=("$rid")
    [ "$concl" != "success" ] && FAILED=1
  else
    FAILED=1
  fi
done

# ── tabela comparativa ──────────────────────────────────────────────────────
echo ""
echo "Tabela comparativa — setup-bun real (GitHub-hosted) vs act (medido 08/2026):"
printf '  %-46s | %s\n' "Ambiente" "Tempo"
printf '  %-46s-+-%s\n' "----------------------------------------------" "---------"
for n in $(seq 1 "$RUNS"); do
  idx=$((n-1))
  lab="cold"; [ "$n" -gt 1 ] && lab="warm"
  printf '  %-46s | %ss  (%s, run=%s)\n' "CI real — run #$n ($lab)" \
    "${DURATIONS[$idx]:-N/A}" "${TIERS[$idx]:-?}" "${RUNIDS[$idx]:-?}"
done
printf '  %-46s | ~33s (cache emulado pelo act, sem serviço real)\n' "act local — catthehacker default"
if [ "${#DURATIONS[@]}" -ge 2 ]; then
  GAP="$(node -e "const a=Number(process.argv[1]),b=Number(process.argv[2]);console.log((a/b).toFixed(1))" "${DURATIONS[1]}" "${DURATIONS[0]}")"
  echo ""
  echo "  Gap warm vs cold: ${DURATIONS[1]}s / ${DURATIONS[0]}s = ${GAP}× (cache real do GitHub)"
fi

if [ -n "$JSON_OUT" ]; then
  # Monta o array de rows em bash (valores sem pipes/quotes — tier/concl/rid
  # são controlados por nós) e passa ao node como argv[1] JSON, evitando o
  # aninhamento de node -e que quebrava o quoting.
  ROWS_JSON="["
  for n in $(seq 1 "$RUNS"); do
    idx=$((n-1))
    [ "$n" -gt 1 ] && ROWS_JSON+=","
    ROWS_JSON+="[\"${DURATIONS[$idx]:-N/A}\",\"${TIERS[$idx]:-?}\",\"${CONCLS[$idx]:-?}\",\"${RUNIDS[$idx]:-?}\"]"
  done
  ROWS_JSON+="]"
  if node -e "
    const fs = require('fs');
    const rows = JSON.parse(process.argv[1]);
    const runs = rows.map((d, i) => ({ run: i + 1, duration_s: Number(d[0]), tier: d[1], conclusion: d[2], run_id: d[3] }));
    fs.writeFileSync(process.argv[2], JSON.stringify({ repo: process.argv[3], ref: process.argv[4], bun_version: process.argv[5], measured: '2026-08', runs }, null, 2));
  " "$ROWS_JSON" "$JSON_OUT" "$GH_REPO" "$REF" "$BUN_VERSION" 2>/dev/null; then
    echo "  JSON salvo em $JSON_OUT"
  else
    echo "bench-setup-bun: aviso — falha ao salvar JSON em $JSON_OUT" >&2
  fi
fi

exit "$FAILED"
