#!/bin/bash
# ==============================================================================
# Severinno Marketplace — PostgreSQL Automated Backup
# ==============================================================================
# Usage:
#   ./scripts/backup-db.sh                        # Backup padrão (gzip)
#   ./scripts/backup-db.sh --s3                    # Backup + upload para S3
#   ./scripts/backup-db.sh --local-only            # Só backup local
#   ./scripts/backup-db.sh --list                  # Listar backups existentes
#   ./scripts/backup-db.sh --clean                 # Apagar backups antigos
#   ./scripts/backup-db.sh --cron                  # Modo cron (sem output)
#
# Pode ser rodado como cron job diário:
#   0 3 * * * /app/scripts/backup-db.sh --cron --s3
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Config ─────────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/.backups}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-severinno}"
DB_NAME="${DB_NAME:-severinno}"
DB_PASSWORD="${DB_PASSWORD:-}"
S3_BUCKET="${S3_BUCKET:-severinno-backups}"
S3_ENDPOINT="${S3_ENDPOINT:-}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-}"
S3_SECRET_KEY="${S3_SECRET_KEY:-}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"  # keep local backups for 30 days
S3_RETENTION_DAYS="${S3_RETENTION_DAYS:-90}"  # keep S3 backups for 90 days
COMPRESS_CMD="gzip"
COMPRESS_EXT=".gz"

# ── Parse args ─────────────────────────────────────────────────────────────
MODE="local"
DO_CRON=false
for arg in "$@"; do
  case "$arg" in
    --s3) MODE="s3" ;;
    --local-only) MODE="local" ;;
    --list) MODE="list" ;;
    --clean) MODE="clean" ;;
    --cron) DO_CRON=true ;;
  esac
done

# ── Utils ──────────────────────────────────────────────────────────────────
log() {
  if [ "$DO_CRON" = false ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  fi
}

warn() {
  echo "[WARN] $*" >&2
}

error_exit() {
  echo "[ERROR] $*" >&2
  exit 1
}

# ── List backups ───────────────────────────────────────────────────────────
if [ "$MODE" = "list" ]; then
  echo "=== Local Backups ==="
  if [ -d "$BACKUP_DIR" ]; then
    ls -lh "$BACKUP_DIR"/*.dump* 2>/dev/null || echo "  (nenhum)"
  else
    echo "  (diretório não existe)"
  fi

  if [ "$MODE" = "list" ] && [ -n "$S3_ENDPOINT" ] && [ -n "$S3_ACCESS_KEY" ]; then
    echo ""
    echo "=== S3 Backups ==="
    if command -v aws &>/dev/null; then
      aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$S3_BUCKET/" 2>/dev/null || echo "  (nenhum ou bucket não acessível)"
    elif command -v mc &>/dev/null; then
      mc ls "local/$S3_BUCKET/" 2>/dev/null || echo "  (mc alias não configurado)"
    else
      echo "  (aws CLI ou mc não disponível)"
    fi
  fi
  exit 0
fi

# ── Clean old backups ──────────────────────────────────────────────────────
if [ "$MODE" = "clean" ]; then
  log "Limpando backups locais mais antigos que $RETENTION_DAYS dias..."
  find "$BACKUP_DIR" -name "*.dump*" -type f -mtime "+$RETENTION_DAYS" -delete 2>/dev/null
  log "Limpeza local concluída."

  if [ -n "$S3_ENDPOINT" ] && [ -n "$S3_ACCESS_KEY" ]; then
    log "Limpando backups S3 mais antigos que $S3_RETENTION_DAYS dias..."
    if command -v aws &>/dev/null; then
      aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$S3_BUCKET/" --recursive 2>/dev/null \
        | while read -r line; do
            key=$(echo "$line" | awk '{print $4}')
            date_str=$(echo "$line" | awk '{print $1" "$2}')
            if [ -n "$date_str" ] && [ -n "$key" ]; then
              cutoff=$(date -d "-${S3_RETENTION_DAYS} days" +%s 2>/dev/null || echo "")
              file_ts=$(date -d "$date_str" +%s 2>/dev/null || echo "")
              if [ -n "$cutoff" ] && [ -n "$file_ts" ] && [ "$file_ts" -lt "$cutoff" ]; then
                aws --endpoint-url "$S3_ENDPOINT" s3 rm "s3://$S3_BUCKET/$key"
              fi
            fi
          done
    fi
    log "Limpeza S3 concluída."
  fi
  exit 0
fi

# ── Create backup ──────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
FILENAME="severinno_${DB_NAME}_${TIMESTAMP}.dump"
FILEPATH="$BACKUP_DIR/$FILENAME"

log "Iniciando backup de $DB_NAME..."
log "  Host: $DB_HOST:$DB_PORT"
log "  Destino: $FILEPATH$COMPRESS_EXT"

# Export password so pg_dump doesn't prompt
export PGPASSWORD="$DB_PASSWORD"

# pg_dump in custom format (-Fc) — compressed, parallel-restore capable
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -Fc --no-owner --no-privileges --verbose \
  2>"$FILEPATH.log" \
  | $COMPRESS_CMD > "$FILEPATH$COMPRESS_EXT"

PGPASSWORD=""

# Check result
if [ -f "$FILEPATH$COMPRESS_EXT" ]; then
  SIZE=$(du -h "$FILEPATH$COMPRESS_EXT" | cut -f1)
  log "Backup concluído: $SIZE"
else
  error_exit "Falha ao criar backup — log: $FILEPATH.log"
fi

# ── Upload to S3 ──────────────────────────────────────────────────────────
if [ "$MODE" = "s3" ] && [ -n "$S3_ENDPOINT" ] && [ -n "$S3_ACCESS_KEY" ]; then
  log "Fazendo upload para S3 ($S3_ENDPOINT / $S3_BUCKET)..."

  if command -v aws &>/dev/null; then
    AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
      aws --endpoint-url "$S3_ENDPOINT" s3 cp "$FILEPATH$COMPRESS_EXT" "s3://$S3_BUCKET/$FILENAME$COMPRESS_EXT" \
      --only-show-errors && log "Upload S3 concluído."
  elif command -v mc &>/dev/null; then
    mc cp "$FILEPATH$COMPRESS_EXT" "local/$S3_BUCKET/$FILENAME$COMPRESS_EXT" 2>/dev/null \
      && log "Upload MinIO/S3 concluído."
  else
    warn "aws CLI e mc não disponíveis — pulando upload S3"
  fi
fi

# ── Clean old backups ──────────────────────────────────────────────────────
log "Limpando backups locais com mais de $RETENTION_DAYS dias..."
find "$BACKUP_DIR" -name "*.dump*" -type f -mtime "+$RETENTION_DAYS" -delete 2>/dev/null

log "Backup finalizado com sucesso."
exit 0
