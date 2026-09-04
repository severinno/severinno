#!/usr/bin/env bash
# =============================================================================
# PostgreSQL Backup — Severinno Marketplace
# =============================================================================
# Performs pg_dump of the PostGIS database and uploads to MinIO (S3-compatible).
# Retention: 7 daily, 4 weekly, 12 monthly backups.
#
# Usage:
#   bash scripts/backup-postgres.sh [daily|weekly|monthly]
#
# Environment variables:
#   DATABASE_URL  — PostgreSQL connection string (default: from .env)
#   MINIO_ALIAS   — mc alias name (default: local)
#   MINIO_BUCKET  — S3 bucket name (default: severinno-backups)
#
# Exit codes:
#   0 — backup succeeded
#   1 — pg_dump or upload failed
# =============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env if available
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | grep -v '^\s*$' | xargs) 2>/dev/null || true
fi

BACKUP_TYPE="${1:-daily}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_HOST="${PGHOST:-localhost}"
DB_PORT="${PGPORT:-5433}"
DB_NAME="${PGDATABASE:-severinno}"
DB_USER="${PGUSER:-severinno}"
BACKUP_DIR="/tmp/severinno-backups"
MINIO_ALIAS="${MINIO_ALIAS:-local}"
MINIO_BUCKET="${MINIO_BUCKET:-severinno-backups}"

# Retention settings
DAILY_RETENTION=7
WEEKLY_RETENTION=4
MONTHLY_RETENTION=12

# ── Functions ────────────────────────────────────────────────────────────────

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

cleanup_old_backups() {
  local prefix=$1
  local keep=$2
  log "Cleaning up old backups: keeping $keep of type '$prefix'..."
  
  local count
  count=$(docker exec severinno-minio-1 mc ls "${MINIO_ALIAS}/${MINIO_BUCKET}/${prefix}/" 2>/dev/null | wc -l) || true
  
  if [ "$count" -gt "$keep" ]; then
    local to_delete=$((count - keep))
    docker exec severinno-minio-1 mc ls "${MINIO_ALIAS}/${MINIO_BUCKET}/${prefix}/" 2>/dev/null \
      | head -n "$to_delete" \
      | awk '{print $NF}' \
      | while read -r file; do
          docker exec severinno-minio-1 mc rm "${MINIO_ALIAS}/${MINIO_BUCKET}/${prefix}/${file}" 2>/dev/null || true
          log "  Deleted: ${prefix}/${file}"
        done
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

log "Starting $BACKUP_TYPE backup..."

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Setup MinIO alias
docker exec severinno-minio-1 mc alias set "${MINIO_ALIAS}" http://localhost:9000 minioadmin minioadmin123 2>/dev/null || true

# Create bucket
docker exec severinno-minio-1 mc mb "${MINIO_ALIAS}/${MINIO_BUCKET}" --ignore-existing 2>/dev/null || true

# Dump database
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${BACKUP_TYPE}_${TIMESTAMP}.sql.gz"
log "Dumping database ${DB_NAME}..."

docker exec severinno-postgis-new pg_dump \
  -U "${DB_USER}" \
  -h localhost \
  -p 5432 \
  -d "${DB_NAME}" \
  --no-owner \
  --no-privileges \
  -F p \
  | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "Dump complete: $BACKUP_SIZE"

# Upload to MinIO
log "Uploading to MinIO..."
docker cp "$BACKUP_FILE" "severinno-minio-1:/tmp/$(basename "$BACKUP_FILE")"
docker exec severinno-minio-1 mc cp "/tmp/$(basename "$BACKUP_FILE")" "${MINIO_ALIAS}/${MINIO_BUCKET}/${BACKUP_TYPE}/" 2>/dev/null
docker exec severinno-minio-1 rm "/tmp/$(basename "$BACKUP_FILE")" 2>/dev/null || true

log "Upload complete!"

# Cleanup local file
rm -f "$BACKUP_FILE"

# Cleanup old backups based on retention policy
case "$BACKUP_TYPE" in
  daily)
    cleanup_old_backups "daily" "$DAILY_RETENTION"
    ;;
  weekly)
    cleanup_old_backups "weekly" "$WEEKLY_RETENTION"
    ;;
  monthly)
    cleanup_old_backups "monthly" "$MONTHLY_RETENTION"
    ;;
esac

# Verify backup exists in MinIO
if docker exec severinno-minio-1 mc ls "${MINIO_ALIAS}/${MINIO_BUCKET}/${BACKUP_TYPE}/" 2>/dev/null | grep -q "$TIMESTAMP"; then
  log "✅ Backup verified in MinIO: ${BACKUP_TYPE}/${DB_NAME}_${BACKUP_TYPE}_${TIMESTAMP}.sql.gz ($BACKUP_SIZE)"
else
  log "❌ Backup verification failed!"
  exit 1
fi
