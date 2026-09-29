#!/usr/bin/env bash
# forge-backup-pull.sh — o lado OFF-SITE do backup da forja.
#
# RODA NA MÁQUINA LOCAL (não na VPS): puxa o pacote do dia de
# /root/backups-forja/<hoje> da VPS para o disco local, VERIFICA os
# checksums contra o manifest da VPS e mantém janela de retenção própria.
#
# Por que o pull e não o push: a VPS não guarda chave de acesso ao destino
# off-site (menor superfície — a VPS comprometida não apaga nem corrompe a
# cópia que fica FORA dela); quem cruza a fronteira é a máquina local.
#
# FAIL-CLOSED: sha256 divergente, manifest ausente ou rsync com erro saem 1
# — um off-site silenciosamente corrompido é pior que nenhum.
#
# Uso (local):
#   bash scripts/forge-backup-pull.sh                  # puxa o dia de hoje
#   bash scripts/forge-backup-pull.sh 2026-09-29       # puxa um dia específico
#   crontab: 15 5 * * * cd ~/projetos/severinno && bash scripts/forge-backup-pull.sh >> /tmp/forge-backup-pull.log 2>&1
#
# Usage:
#   bash scripts/forge-backup-pull.sh                # puxa o dia de hoje
#   bash scripts/forge-backup-pull.sh 2026-09-29     # puxa um dia específico
#   VPS=root@host DEST=/tmp/x bash scripts/forge-backup-pull.sh
#
# Exit codes:
#   0 — pacote puxado, checksums conferidos, bundles verificados
#   1 — rsync falhou, checksum divergente, manifest ausente ou bundle inválido
set -euo pipefail

VPS="${VPS:-root@187.127.16.136}"
DIA="${1:-$(date +%F)}"
DEST="${DEST:-$HOME/backups-forja}"
RETENCAO_DIAS="${RETENCAO_DIAS:-30}"

SAIDA="$DEST/$DIA"
mkdir -p "$SAIDA"
echo "[$(date +%H:%M:%S)] puxando $VPS:/root/backups-forja/$DIA → $SAIDA"

rsync -az --delete "$VPS:/root/backups-forja/$DIA/" "$SAIDA/" || {
  echo "ERRO: rsync falhou (a VPS tem o dia $DIA? rodou o forge-backup.sh?)"
  exit 1
}

# A VERIFICAÇÃO: o sha256 local tem de bater com o da VPS (o manifest foi
# escrito LÁ; aqui ele é conferido, não reescrito).
if [ -f "$SAIDA/sha256sums.txt" ]; then
  ( cd "$SAIDA" && sha256sum -c sha256sums.txt ) || {
    echo "ERRO: checksum divergente — o off-site NÃO é confiável"
    exit 1
  }
  echo "[$(date +%H:%M:%S)] checksums: OK ($(grep -c . "$SAIDA/sha256sums.txt") artefato(s))"
else
  echo "ERRO: sha256sums.txt ausente — manifest da VPS não veio no rsync"
  exit 1
fi

# A CONFERÊNCIA dos bundles: um bundle que não é um remote válido não
# restaura nada. O verify é barato e é o que distingue backup de esperança.
for b in "$SAIDA"/git-*.bundle; do
  [ -e "$b" ] || continue
  git bundle verify "$b" >/dev/null 2>&1 || {
    echo "ERRO: bundle inválido: $b"
    exit 1
  }
done
echo "[$(date +%H:%M:%S)] bundles: $(ls "$SAIDA"/git-*.bundle 2>/dev/null | wc -l) verificado(s)"

find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$RETENCAO_DIAS" -exec rm -rf {} + 2>/dev/null || true
echo "[$(date +%H:%M:%S)] FIM OK — retenção local de $RETENCAO_DIAS dias em $DEST"
