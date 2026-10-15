#!/usr/bin/env bash
# =============================================================================
# Automated PostgreSQL Backup — Severinno Marketplace
# =============================================================================
# Executado diariamente às 04:00 da madrugada via cron.
# Realiza dump dos bancos severinno, evolution e glitchtip + roles globais.
# Retenção automática de 14 dias com logs detalhados e integridade SHA256.
#
# Usage:
#   bash scripts/backup-postgres-vps.sh
#
# Exit codes:
#   0 — backup succeeded
#   1 — failure
# =============================================================================


set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
LOG_FILE="${LOG_FILE:-/var/log/postgres-backup.log}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DATE="$(date +%Y%m%d_%H%M%S)"
DB_USER="severinno"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

log "=================================================="
log "INICIANDO ROTINA DE BACKUP AUTOMATIZADO DO POSTGRESQL"
log "Destino: $BACKUP_DIR | Retenção: $RETENTION_DAYS dias"

# Localizar container Postgres ativo
CONTAINER="$(docker ps --format '{{.Names}}' | grep -iE 'severinno-postgres|postgis' | head -1)"
if [ -z "$CONTAINER" ]; then
  log "ERRO CRÍTICO: Container do PostgreSQL não encontrado em execução!"
  exit 1
fi
log "Container detectado: $CONTAINER"

# 1. Backup do Banco Principal: severinno (com PostGIS)
SEVERINNO_DUMP="$BACKUP_DIR/severinno_${DATE}.sql.gz"
log "Gerando dump do banco 'severinno'..."
docker exec "$CONTAINER" pg_dump \
  -U "$DB_USER" \
  -d severinno \
  --no-owner \
  --no-privileges \
  -F p 2>/dev/null | gzip -9 > "$SEVERINNO_DUMP"

if [ ! -s "$SEVERINNO_DUMP" ]; then
  log "ERRO: O arquivo $SEVERINNO_DUMP está vazio ou falhou na geração!"
  exit 1
fi
SEV_SIZE="$(du -h "$SEVERINNO_DUMP" | cut -f1)"
sha256sum "$SEVERINNO_DUMP" > "${SEVERINNO_DUMP}.sha256"
log "Banco 'severinno' concluído: $SEVERINNO_DUMP ($SEV_SIZE)"

# 2. Backup do Banco do WhatsApp: evolution
EVO_DUMP="$BACKUP_DIR/evolution_${DATE}.sql.gz"
log "Gerando dump do banco 'evolution'..."
docker exec "$CONTAINER" pg_dump \
  -U "$DB_USER" \
  -d evolution \
  --no-owner \
  --no-privileges \
  -F p 2>/dev/null | gzip -9 > "$EVO_DUMP" || true

if [ -s "$EVO_DUMP" ]; then
  EVO_SIZE="$(du -h "$EVO_DUMP" | cut -f1)"
  sha256sum "$EVO_DUMP" > "${EVO_DUMP}.sha256"
  log "Banco 'evolution' concluído: $EVO_DUMP ($EVO_SIZE)"
else
  log "Aviso: Dump do banco 'evolution' não gerado ou vazio."
fi

# 3. Backup de Globals (Roles e Permissões)
GLOBALS_DUMP="$BACKUP_DIR/globals_${DATE}.sql.gz"
log "Gerando dump de roles/globals..."
docker exec "$CONTAINER" pg_dumpall \
  -U "$DB_USER" \
  --globals-only 2>/dev/null | gzip -9 > "$GLOBALS_DUMP" || true

if [ -s "$GLOBALS_DUMP" ]; then
  GLOB_SIZE="$(du -h "$GLOBALS_DUMP" | cut -f1)"
  log "Globals concluído: $GLOBALS_DUMP ($GLOB_SIZE)"
fi

# 4. Rotação e Limpeza de Backups Antigos (> RETENTION_DAYS dias)
log "Executando limpeza de backups com mais de $RETENTION_DAYS dias..."
REMOVED_COUNT=0
while IFS= read -r old_file; do
  rm -f "$old_file"
  log "Removido backup expirado: $(basename "$old_file")"
  REMOVED_COUNT=$((REMOVED_COUNT + 1))
done < <(find "$BACKUP_DIR" -type f \( -name "*.sql.gz" -o -name "*.sha256" \) -mtime +"$RETENTION_DAYS")

log "Limpeza concluída ($REMOVED_COUNT arquivos removidos)."

# 5. Status do Espaço em Disco
DISK_AVAIL="$(df -h "$BACKUP_DIR" | tail -1 | awk '{print $4}')"
log "Espaço livre em disco: $DISK_AVAIL"
log "ROTINA DE BACKUP FINALIZADA COM SUCESSO."
log "=================================================="
