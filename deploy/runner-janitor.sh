#!/usr/bin/env bash
# =============================================================================
# deploy/runner-janitor.sh — remove containers órfãos do act_runner na VPS.
# =============================================================================
# Usage:
#   bash deploy/runner-janitor.sh                    # remove órfãos (>2h)
#   bash deploy/runner-janitor.sh --dry-run          # só lista
#   bash deploy/runner-janitor.sh --idade-horas 1    # outro limite
#
# Exit codes:
#   0 — ok (removeu 0..N órfãos, ou nada a fazer)
#   1 — erro de uso ou do docker
#
# POR QUE EXISTE (medido em 29/09/2026): quando o runner morre no MEIO de um
# job (recriação do container, OOM, restart do daemon), os SERVICE containers
# do job (postgis/redis publicando portas no HOST) ficam órfãos e continuam
# rodando para sempre — e toda rodada seguinte de Tests falha com
# "driver failed programming external connectivity" (colisão de porta no host).
#
# A RÉGUA: nenhum job legítimo desta forja roda mais de 2h (o mais longo é o
# Stack Per-Commit, ~40min medido). Container `GITEA-ACTIONS-*` com mais de
# --idade-horas é órfão por definição — não há como um job vivo ter essa idade.
# =============================================================================

set -euo pipefail

IDADE_HORAS=2
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --idade-horas) IDADE_HORAS="${2:?faltou o valor}"; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "argumento desconhecido: $1" >&2; exit 1 ;;
  esac
  shift
done

COMANDO="docker"
command -v "$COMANDO" >/dev/null || { echo "docker não disponível" >&2; exit 1; }

LIMITE=$((IDADE_HORAS * 3600))
AGORA=$(date +%s)
REMOVIDOS=0

for c in $("$COMANDO" ps -aq --filter "name=GITEA-ACTIONS"); do
  CRIADO=$("$COMANDO" inspect "$c" --format '{{.Created}}')
  TS=$("$COMANDO" inspect "$c" --format '{{.Created}}' | awk '{print substr($1,1,19)}')
  # Created vem em ISO; converter via date -d (disponível no host Ubuntu)
  EPOCH=$(date -d "$TS" +%s 2>/dev/null || echo 0)
  IDADE=$((AGORA - EPOCH))
  NOME=$("$COMANDO" inspect "$c" --format '{{.Name}}' | sed 's|^/||')
  if [ "$IDADE" -gt "$LIMITE" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      echo "[dry-run] órfão (${IDADE}s): $NOME"
    else
      "$COMANDO" rm -f "$c" >/dev/null
      echo "removido (${IDADE}s): $NOME"
    fi
    REMOVIDOS=$((REMOVIDOS + 1))
  fi
done

echo "janitor: $REMOVIDOS órfão(ões) com idade > ${IDADE_HORAS}h"
