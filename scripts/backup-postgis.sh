#!/usr/bin/env bash
# =============================================================================
# PostgreSQL + PostGIS Automated Backup Script
# =============================================================================
# Backs up the severinno database using pg_dump and uploads to MinIO (S3).
# Retains last 7 daily + 4 weekly backups.
#
# Usage:
#   sudo bash scripts/backup-postgis.sh
#   crontab: 0 2 * * * /home/severinno/severinno/scripts/backup-postgis.sh
#
# Exit codes:
#   0 — success (backup and upload succeeded)
#   1 — failure (pg_dump or upload error)
#
# Env vars (with defaults):
#   DATABASE_URL  — PostgreSQL connection string
#   MINIO_ALIAS   — MinIO mc alias (default: local)
#   MINIO_BUCKET  — Bucket name (default: severinno-backups)
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-severinno}"
DB_USER="${DB_USER:-severinno}"
BACKUP_DIR="/tmp/severinno-backups"
MINIO_ALIAS="${MINIO_ALIAS:-local}"
MINIO_BUCKET="${MINIO_BUCKET:-severinno-backups}"
DATE=$(date +%Y-%m-%d_%H%M%S)
KEEP_DAILY=7
KEEP_WEEKLY=4

# ── Modo Restauração (--restore) ──────────────────────────────────────────
if [[ "${1:-}" == "--restore" ]]; then
  RESTORE_FILE="${2:-}"
  if [[ -z "$RESTORE_FILE" || ! -f "$RESTORE_FILE" ]]; then
    echo "[$(date)] ERROR: Arquivo de dump não especificado ou inexistente: $RESTORE_FILE"
    exit 1
  fi
  echo "[$(date)] Restaurando backup do PostgreSQL + PostGIS a partir de $RESTORE_FILE..."
  CONTAINER=$(docker ps --format '{{.Names}}' | grep postgis | head -1)
  if command -v psql &>/dev/null; then
    gunzip -c "$RESTORE_FILE" | PGPASSWORD="${DB_PASSWORD:-severinno}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
  elif [ -n "$CONTAINER" ]; then
    gunzip -c "$RESTORE_FILE" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"
  else
    echo "[$(date)] ERROR: psql não encontrado e nenhum container PostGIS em execução"
    exit 1
  fi
  echo "[$(date)] Restauração concluída com sucesso! Verificando extensões PostGIS..."
  if command -v psql &>/dev/null; then
    PGPASSWORD="${DB_PASSWORD:-severinno}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT PostGIS_Version();"
  elif [ -n "$CONTAINER" ]; then
    docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT PostGIS_Version();"
  fi
  echo "[$(date)] Verificação PostGIS OK."
  exit 0
fi

# ── Setup ───────────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
DUMP_FILE="$BACKUP_DIR/severinno_${DATE}.sql.gz"

echo "[$(date)] Starting backup of ${DB_NAME}..."

# ── pg_dump with PostGIS support ────────────────────────────────────────────
# Use Docker exec if pg_dump is not installed locally
CONTAINER=$(docker ps --format '{{.Names}}' | grep postgis | head -1)
if command -v pg_dump &>/dev/null; then
  PGPASSWORD="${DB_PASSWORD:-severinno}" pg_dump \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --no-privileges --no-comments -F p \
    --serializable-deferrable 2>/dev/null | gzip -9 > "$DUMP_FILE"
elif [ -n "$CONTAINER" ]; then
  docker exec "$CONTAINER" pg_dump \
    -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --no-privileges --no-comments -F p 2>/dev/null | gzip -9 > "$DUMP_FILE"
else
  echo "[$(date)] ERROR: pg_dump not found and no PostGIS container running"
  exit 1
fi

FILESIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "[$(date)] Dump created: $DUMP_FILE ($FILESIZE)"

# ── Upload to MinIO ────────────────────────────────────────────────────────
if command -v mc &>/dev/null; then
  # Ensure bucket exists
  mc mb "$MINIO_ALIAS/$MINIO_BUCKET" 2>/dev/null || true

  # Upload daily backup
  mc cp "$DUMP_FILE" "$MINIO_ALIAS/$MINIO_BUCKET/daily/severinno_${DATE}.sql.gz" 2>/dev/null
  echo "[$(date)] Uploaded to $MINIO_ALIAS/$MINIO_BUCKET/daily/"

  # Weekly backup (Sunday)
  if [ "$(date +%u)" -eq 7 ]; then
    mc cp "$DUMP_FILE" "$MINIO_ALIAS/$MINIO_BUCKET/weekly/severinno_${DATE}.sql.gz" 2>/dev/null
    echo "[$(date)] Weekly backup saved"
  fi

  # ── Cleanup old backups ─────────────────────────────────────────────────
  # Remove daily backups older than KEEP_DAILY days
  CUTOFF_DAILY=$(date -d "-${KEEP_DAILY} days" +%Y-%m-%d 2>/dev/null || date -v-${KEEP_DAILY}d +%Y-%m-%d)
  mc ls "$MINIO_ALIAS/$MINIO_BUCKET/daily/" 2>/dev/null | awk '{print $NF}' | while read -r f; do
    FILE_DATE=$(echo "$f" | grep -oP '\d{4}-\d{2}-\d{2}' | head -1)
    if [[ -n "$FILE_DATE" && "$FILE_DATE" < "$CUTOFF_DAILY" ]]; then
      mc rm "$MINIO_ALIAS/$MINIO_BUCKET/daily/$f" 2>/dev/null && echo "[$(date)] Cleaned: $f"
    fi
  done

  # Remove weekly backups older than KEEP_WEEKLY weeks
  CUTOFF_WEEKLY=$(date -d "-$((KEEP_WEEKLY * 7)) days" +%Y-%m-%d 2>/dev/null || date -v-$((KEEP_WEEKLY * 7))d +%Y-%m-%d)
  mc ls "$MINIO_ALIAS/$MINIO_BUCKET/weekly/" 2>/dev/null | awk '{print $NF}' | while read -r f; do
    FILE_DATE=$(echo "$f" | grep -oP '\d{4}-\d{2}-\d{2}' | head -1)
    if [[ -n "$FILE_DATE" && "$FILE_DATE" < "$CUTOFF_WEEKLY" ]]; then
      mc rm "$MINIO_ALIAS/$MINIO_BUCKET/weekly/$f" 2>/dev/null && echo "[$(date)] Cleaned weekly: $f"
    fi
  done
else
  echo "[$(date)] WARNING: mc (MinIO CLI) not found — backup saved locally only"
fi

# ── Local cleanup (keep last 3) ────────────────────────────────────────────
ls -t "$BACKUP_DIR"/severinno_*.sql.gz 2>/dev/null | tail -n +4 | xargs rm -f 2>/dev/null || true

echo "[$(date)] Backup completed successfully!"
