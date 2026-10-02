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
# A RÉGUA TEMPORAL (igual para containers, networks e volumes): nenhum job
# legítimo desta forja roda mais de 2h (o mais longo é o Stack Per-Commit,
# ~40min medido). `GITEA-ACTIONS-*` com mais de --idade-horas é órfão por
# definição — não há como um job vivo ter essa idade.
#
# A RÉGUA CIRÚRGICA (só networks, 02/10/2026): uma network VAZIA cujo nome
# carrega o task id (`...TASK-<id>-...`) é órfã NA HORA se o banco diz que a
# task ENCERROU (action_task.status em 1..4: ok/falha/cancel/skip) — o runner
# só não a removeu se a task foi cancelada ou ele morreu no meio (a classe do
# incidente do pool, que mata em segundos, não em 2h). Task na fila/rodando
# (5/6) e id AUSENTE no banco FICAM — o attach acontece no arranque da task e,
# sem status, não há como distinguir "vai anexar" de "órfão jovem" (fail-
# closed). O cruzamento custa UM probe do banco por rodada (ids em batch) e o
# probe FALHANDO degrada a varredura inteira para a régua temporal.
# =============================================================================

set -euo pipefail

IDADE_HORAS=2
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --idade-horas) IDADE_HORAS="${2:?faltou o valor}"; shift ;;
    -h|--help) sed -n '2,39p' "$0"; exit 0 ;;
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

# --- Networks órfãs: VAZIAS (0 containers anexados) e ÓRFÃS por definição ---
# Roda DEPOIS da varredura de containers: network que ficou vazia porque o
# container órfão acabou de ser removido já cai nesta mesma passada.
#
# Duas réguas para a mesma rede vazia:
#   (a) TEMPORAL (> --idade-horas) — a original, vale para qualquer nome;
#   (b) CIRÚRGICA — o nome carrega o task id (`...TASK-<id>-...`) e o banco
#       (action_task.status) diz o que a task É: encerrada (1..4) com network
#       vazia sai NA HORA (regra (b) do cabeçalho); fila/rodando (5/6) e id
#       AUSENTE ficam para a régua temporal.
NETWORKS=0
declare -A JOVENS=()
IDS_JOVENS=""
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
  elif [[ "$n" =~ GITEA-ACTIONS-TASK-([0-9]+)- ]]; then
    JOVENS["$n"]="${BASH_REMATCH[1]}|${IDADE}"
    IDS_JOVENS+="${BASH_REMATCH[1]} "
  fi
done

# A passada cirúrgica: UM probe do banco para todos os ids jovens de uma vez.
# O probe FALHANDO (docker/image/sqlite fora) deixa MAPA vazio e TODAS as
# jovens ficam para a régua temporal — fail-closed.
if [ "${#JOVENS[@]}" -gt 0 ] && [ -n "$IDS_JOVENS" ]; then
  MAPA=$("$COMANDO" run --rm -v /var/lib/docker/volumes/gitea-data/_data:/data:ro \
    git.severinno.com/severinno/ubuntu-bun:1.3.14 bun -e "
const { Database } = require('bun:sqlite');
const db = new Database('/data/gitea/gitea.db', { readonly: true });
const q = db.query('SELECT status FROM action_task WHERE id = ?');
for (const id of '$IDS_JOVENS'.trim().split(/\s+/).map(Number)) {
  const r = q.get(id);
  console.log(id + '=' + (r ? r.status : 'AUSENTE'));
}" 2>/dev/null || true)
  for n in "${!JOVENS[@]}"; do
    TID="${JOVENS[$n]%%|*}"
    IDADE_N="${JOVENS[$n]##*|}"
    STATUS="$(sed -n "s/^${TID}=//p" <<<"$MAPA" | head -1)"
    case "$STATUS" in
      5|6|""|AUSENTE) continue ;; # viva (fila/rodando) ou desconhecida: só a régua temporal
    esac
    if [ "$DRY_RUN" = 1 ]; then
      echo "[dry-run] network vazia (task $STATUS, ${IDADE_N}s, cirúrgica): $n"
    else
      "$COMANDO" network rm "$n" >/dev/null
      echo "network vazia removida (task $STATUS, ${IDADE_N}s, cirúrgica): $n"
    fi
    NETWORKS=$((NETWORKS + 1))
  done
fi

# --- Volumes órfãos: acima da régua -----------------------------------------
# MEDIDO em 01/10/2026: 47 volumes `GITEA-ACTIONS-TASK-*` acumulados desde a
# task 14 — o runner remove os volumes no FIM do job, mas task CANCELADA ou
# runner morto no meio deixa o volume (e o `-env`) para sempre. Não esgotam
# pool nenhum, mas ocupam disco e crescem sem teto. A MESMA régua serve: o
# job mais longo dura ~40min e o volume dele é removido no fim — volume com
# >2h não tem job vivo que o use. (Não há "vazio" a checar: a régua temporal
# cobre o job vivo, pois o volume só existe enquanto a task existe.)
VOLUMES=0
for v in $("$COMANDO" volume ls --format '{{.Name}}' --filter "name=GITEA-ACTIONS-TASK-"); do
  CRIADO=$("$COMANDO" volume inspect "$v" --format '{{.CreatedAt}}')
  EPOCH=$(date -u -d "${CRIADO:0:19}" +%s 2>/dev/null || echo 0)
  IDADE=$((AGORA - EPOCH))
  if [ "$IDADE" -gt "$LIMITE" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      echo "[dry-run] volume órfão (${IDADE}s): ${v:0:60}..."
    else
      "$COMANDO" volume rm "$v" >/dev/null
      echo "volume órfão removido (${IDADE}s): ${v:0:60}..."
    fi
    VOLUMES=$((VOLUMES + 1))
  fi
done

echo "janitor: $CONTAINERS container(s) órfão(ões) + $NETWORKS network(s) vazia(s) + $VOLUMES volume(s) com idade > ${IDADE_HORAS}h"
