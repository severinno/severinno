#!/usr/bin/env bash
# =============================================================================
# deploy/runner-janitor.sh — remove containers E networks órfãos do act_runner.
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
# NETWORKS (incidente 01/10/2026 14:34 UTC): 28 networks vazias
# `GITEA-ACTIONS-TASK-*` (restos de runs canceladas) consumiram o pool default
# do Docker (172.17–172.31 + 192.168.x) e mataram 14 tasks seguidas em
# segundos com "all predefined address pools have been fully subnetted". O
# daemon NÃO limpa network de task cancelada — acumula até esgotar o pool.
#
# A RÉGUA (igual para containers e networks): nenhum job legítimo desta forja
# roda mais de 2h (o mais longo é o Stack Per-Commit, ~40min medido).
# `GITEA-ACTIONS-*` com mais de --idade-horas é órfão por definição — não há
# como um job vivo ter essa idade. Network só é removida VAZIA (0 containers
# anexados) E velha: a janela de 2h elimina a corrida de attach no início do
# job (containers anexam no arranque da task, nunca 2h depois).
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

CONTAINERS=0
for c in $("$COMANDO" ps -aq --filter "name=GITEA-ACTIONS"); do
  CRIADO=$("$COMANDO" inspect "$c" --format '{{.Created}}')
  # .Created de container é ISO (ex.: 2026-10-01T12:17:13.790Z); os 19
  # primeiros caracteres são "YYYY-MM-DDTHH:MM:SS" — -u lê como UTC.
  EPOCH=$(date -u -d "${CRIADO:0:19}" +%s 2>/dev/null || echo 0)
  IDADE=$((AGORA - EPOCH))
  NOME=$("$COMANDO" inspect "$c" --format '{{.Name}}' | sed 's|^/||')
  if [ "$IDADE" -gt "$LIMITE" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      echo "[dry-run] órfão (${IDADE}s): $NOME"
    else
      "$COMANDO" rm -f "$c" >/dev/null
      echo "removido (${IDADE}s): $NOME"
    fi
    CONTAINERS=$((CONTAINERS + 1))
  fi
done

# --- Networks órfãs: VAZIAS (0 containers anexados) e acima da régua --------
# Roda DEPOIS da varredura de containers: network que ficou vazia porque o
# container órfão acabou de ser removido já cai nesta mesma passada.
NETWORKS=0
for n in $("$COMANDO" network ls --format '{{.Name}}' --filter "name=GITEA-ACTIONS"); do
  ANEXOS=$("$COMANDO" network inspect "$n" --format '{{len .Containers}}')
  [ "$ANEXOS" -gt 0 ] && continue
  # DIFERENTE de containers: o .Created de network vem com ESPAÇOS e
  # nanosegundos ("2026-10-01 17:30:07.610158752 +0000 UTC") — o GNU date
  # NÃO parseia a forma cheia (cai no fallback EPOCH=0). Cortar em 19
  # caracteres dá "YYYY-MM-DD HH:MM:SS", que ele parseia; se um dia voltar
  # a ser ISO com T, os 19 primeiros também servem.
  CRIADA=$("$COMANDO" network inspect "$n" --format '{{.Created}}')
  EPOCH=$(date -u -d "${CRIADA:0:19}" +%s 2>/dev/null || echo 0)
  IDADE=$((AGORA - EPOCH))
  if [ "$IDADE" -gt "$LIMITE" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      echo "[dry-run] network vazia (${IDADE}s): $n"
    else
      "$COMANDO" network rm "$n" >/dev/null
      echo "network vazia removida (${IDADE}s): $n"
    fi
    NETWORKS=$((NETWORKS + 1))
  fi
done

echo "janitor: $CONTAINERS container(s) órfão(ões) + $NETWORKS network(s) vazia(s) com idade > ${IDADE_HORAS}h"
