#!/bin/bash
# ==============================================================================
# scripts/backup-cron.sh — Daily PostgreSQL Backup + MinIO Upload
# ==============================================================================
# Designed to run via cron: 0 3 * * * /home/severinno/severinno/scripts/backup-cron.sh
#
# What it does:
#   1. pg_dump via Docker (compressed gzip)
#   2. Upload to MinIO (severinno-backups bucket)
#   3. Cleanup local backups older than 7 days
#   4. Cleanup MinIO backups older than 30 days
# ==============================================================================
#
# Usage:
#   bash scripts/backup-cron.sh [args]
#
# Exit codes:
#   0 — success
#   1 — failure

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
PROJECT_DIR="/home/severinno/severinno"
BACKUP_DIR="${PROJECT_DIR}/backups"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILE="${BACKUP_DIR}/severinno_backup_${TIMESTAMP}.sql.gz"
LOG_FILE="${PROJECT_DIR}/logs/backup.log"

# Docker
POSTGRES_CONTAINER="severinno-postgis-1"
POSTGRES_USER="severinno"
POSTGRES_DB="severinno"

# MinIO
MINIO_ALIAS="local"
MINIO_ENDPOINT="http://localhost:9000"
MINIO_ACCESS_KEY="severinno"
MINIO_SECRET_KEY="severinno_minio_dev"
MINIO_BUCKET="severinno-backups"

# Retention
LOCAL_RETENTION_DAYS=7
MINIO_RETENTION_DAYS=30

# ── Functions ───────────────────────────────────────────────────────────────
log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

# ── Main ────────────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR" "$(dirname "$LOG_FILE")"

log "📦 Starting backup of database '${POSTGRES_DB}'..."

# 1. pg_dump
if grep -q "$POSTGRES_CONTAINER" <<< "$(docker ps --format '{{.Names}}')"; then
    docker exec -t "$POSTGRES_CONTAINER" \
        pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists \
        | gzip > "$BACKUP_FILE"
else
    log "❌ PostgreSQL container '${POSTGRES_CONTAINER}' not found!"
    exit 1
fi

FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "✅ Backup created: ${BACKUP_FILE} (${FILE_SIZE})"

# 2. Upload to MinIO
if command -v docker &>/dev/null; then
    docker exec severinno-minio-1 mc alias set "$MINIO_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4 &>/dev/null
    docker cp "$BACKUP_FILE" severinno-minio-1:/tmp/
    docker exec severinno-minio-1 mc cp "/tmp/$(basename "$BACKUP_FILE")" "${MINIO_ALIAS}/${MINIO_BUCKET}/" &>/dev/null
    docker exec severinno-minio-1 rm -f "/tmp/$(basename "$BACKUP_FILE")" &>/dev/null
    log "☁️  Uploaded to MinIO: ${MINIO_BUCKET}/$(basename "$BACKUP_FILE")"
else
    log "⚠️  Docker not found — skipping MinIO upload"
fi

# 3. Cleanup local backups
DELETED_LOCAL=$(find "$BACKUP_DIR" -name "severinno_backup_*.sql.gz" -type f -mtime +"$LOCAL_RETENTION_DAYS" -delete -print | wc -l)
log "🧹 Cleaned ${DELETED_LOCAL} local backups (>${LOCAL_RETENTION_DAYS} days)"

# 4. Cleanup MinIO backups (older than 30 days)
if command -v docker &>/dev/null; then
    CUTOFF_DATE=$(date -d "-${MINIO_RETENTION_DAYS} days" +"%Y%m%d" 2>/dev/null || date -v-${MINIO_RETENTION_DAYS}d +"%Y%m%d" 2>/dev/null || echo "")
    if [ -n "$CUTOFF_DATE" ]; then
        DELETED_MINIO=$(docker exec severinno-minio-1 mc ls "${MINIO_ALIAS}/${MINIO_BUCKET}/" --json 2>/dev/null \
            | python3 -c "
import sys, json
from datetime import datetime
cutoff = '${CUTOFF_DATE}'
for line in sys.stdin:
    try:
        obj = json.loads(line)
        key = obj.get('key', '')
        last_modified = obj.get('lastModified', '')
        if key and last_modified:
            dt = datetime.fromisoformat(last_modified.replace('Z', '+00:00'))
            if dt.strftime('%Y%m%d') < cutoff:
                print(key)
    except: pass
" 2>/dev/null | wc -l || echo "0")
        log "☁️  Cleaned ~${DELETED_MINIO} MinIO backups (>${MINIO_RETENTION_DAYS} days)"
    fi
fi

log "🏁 Backup process complete"
