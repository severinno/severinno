#!/bin/bash
# ==============================================================================
# Severinno Marketplace — PostgreSQL Database Restore
# ==============================================================================
# Uso:
#   # Listar backups disponíveis
#   ./scripts/restore-db.sh --list
#
#   # Restaurar do backup mais recente
#   ./scripts/restore-db.sh --latest
#
#   # Restaurar de um arquivo específico
#   ./scripts/restore-db.sh --file .backups/severinno_severinno_20260726_030000.dump.gz
#
#   # Restaurar de um backup no S3
#   ./scripts/restore-db.sh --s3 severinno_severinno_20260726_030000.dump.gz
#
#   # Dry-run (mostra o que seria feito sem executar)
#   ./scripts/restore-db.sh --latest --dry-run
#
# ⚠️  ATENÇÃO: restore sobrescreve o banco atual!
#    Use --dry-run primeiro para verificar o que será restaurado.
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
DB_SUPERUSER="${DB_SUPERUSER:-postgres}"
S3_ENDPOINT="${S3_ENDPOINT:-}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-}"
S3_SECRET_KEY="${S3_SECRET_KEY:-}"
S3_BUCKET="${S3_BUCKET:-severinno-backups}"

# ── Parse args ─────────────────────────────────────────────────────────────
MODE=""
INPUT_FILE=""
S3_FILE=""
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --list) MODE="list" ;;
    --latest) MODE="latest" ;;
    --dry-run) DRY_RUN=true ;;
    --file=*) INPUT_FILE="${arg#*=}" ;;
    --s3=*) S3_FILE="${arg#*=}" ;;
  esac
done

# ── Colors ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()    { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()   { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }
info()   { echo -e "${CYAN}[INFO]${NC} $*"; }
dry_run() { if [ "$DRY_RUN" = true ]; then echo "  [DRY-RUN] $*"; fi }

error_exit() { error "$*"; exit 1; }

# ═════════════════════════════════════════════════════════════════════════════
# MODE: LIST
# ═════════════════════════════════════════════════════════════════════════════
if [ "$MODE" = "list" ]; then
  echo "=== Backups Locais ==="
  echo "  Diretório: $BACKUP_DIR"
  echo ""

  if [ -d "$BACKUP_DIR" ]; then
    count=$(find "$BACKUP_DIR" -name "*.dump*" -type f | wc -l)
    if [ "$count" -eq 0 ]; then
      echo "  (nenhum backup local encontrado)"
    else
      ls -lhS "$BACKUP_DIR"/*.dump* 2>/dev/null | awk '{printf "  %s  %s  %s\n", $6, $5, $9}'
    fi
  else
    echo "  (diretório $BACKUP_DIR não existe)"
  fi
  exit 0
fi

# ═════════════════════════════════════════════════════════════════════════════
# Discover backup file
# ═════════════════════════════════════════════════════════════════════════════
case "$MODE" in
  latest)
    # Find the most recent backup
    latest_file=$(find "$BACKUP_DIR" -name "*.dump*" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | awk '{print $2}')
    if [ -z "$latest_file" ]; then
      error_exit "Nenhum backup encontrado em $BACKUP_DIR"
    fi
    INPUT_FILE="$latest_file"
    info "Usando backup mais recente: $INPUT_FILE"
    ;;

  "")
    if [ -n "$INPUT_FILE" ]; then
      if [ ! -f "$INPUT_FILE" ]; then
        error_exit "Arquivo não encontrado: $INPUT_FILE"
      fi
      info "Usando arquivo especificado: $INPUT_FILE"
    elif [ -n "$S3_FILE" ]; then
      # Download from S3 to temp dir
      TMP_DIR="$PROJECT_DIR/.tmp"
      mkdir -p "$TMP_DIR"
      INPUT_FILE="$TMP_DIR/$S3_FILE"

      if [ ! -f "$INPUT_FILE" ]; then
        info "Baixando $S3_FILE do S3..."
        if command -v aws &>/dev/null; then
          AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
            aws --endpoint-url "$S3_ENDPOINT" s3 cp "s3://$S3_BUCKET/$S3_FILE" "$INPUT_FILE" \
            --only-show-errors || error_exit "Falha ao baixar do S3"
        else
          error_exit "aws CLI não disponível"
        fi
      fi
    else
      echo "Uso: $0 --latest | --file=<path> | --s3=<file> | --list"
      echo ""
      echo "Exemplos:"
      echo "  $0 --latest                    # Restaura o backup mais recente"
      echo "  $0 --file=.backups/backup.gz   # Restaura arquivo específico"
      echo "  $0 --s3=backup.gz              # Restaura do S3"
      echo "  $0 --list                      # Lista backups disponíveis"
      echo "  $0 --latest --dry-run          # Mostra o que será feito"
      exit 1
    fi
    ;;
esac

# ═════════════════════════════════════════════════════════════════════════════
# Pre-flight checks
# ═════════════════════════════════════════════════════════════════════════════
if [ ! -f "$INPUT_FILE" ]; then
  error_exit "Arquivo de backup não encontrado: $INPUT_FILE"
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║     ⚠️  RESTAURAR BANCO DE DADOS                      ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Isso irá SOBRESCREVER o banco atual '$DB_NAME'  ║"
echo "║  Todas as alterações não salvas serão PERDIDAS !     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Arquivo:    $INPUT_FILE"
echo "  Host:       $DB_HOST:$DB_PORT"
echo "  Database:   $DB_NAME"
echo "  Usuário:    $DB_USER"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "=== DRY-RUN: Comandos que seriam executados ==="
  echo ""
  echo "  1. Terminar conexões ativas:"
  echo "    SELECT pg_terminate_backend(pid)"
  echo "    FROM pg_stat_activity WHERE datname = '$DB_NAME';"
  echo ""
  echo "  2. Dropar e recriar banco:"
  echo "    DROP DATABASE IF EXISTS $DB_NAME;"
  echo "    CREATE DATABASE $DB_NAME;"
  echo ""
  echo "  3. Restaurar:"
  echo "    gunzip -c $INPUT_FILE | pg_restore -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
  echo ""
  echo "⚠️  Dry-run concluído — nenhuma alteração foi feita."
  exit 0
fi

# ═════════════════════════════════════════════════════════════════════════════
# Confirm
# ═════════════════════════════════════════════════════════════════════════════
echo -n "Digite 'RESTORE' para confirmar ou 'N' para cancelar: "
read -r CONFIRM
if [ "$CONFIRM" != "RESTORE" ]; then
  info "Restauração cancelada."
  exit 0
fi

# ═════════════════════════════════════════════════════════════════════════════
# Execute restore
# ═════════════════════════════════════════════════════════════════════════════
export PGPASSWORD="$DB_PASSWORD"

# 1. Kill active connections
info "Terminando conexões ativas..."
PGPASSWORD="${DB_PASSWORD:-}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_SUPERUSER" -d "postgres" \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_get_activity(NULL::integer) WHERE datname = '$DB_NAME';" 2>/dev/null || \
  warn "Não foi possível terminar conexões (pode ser necessário manualmente)"

# 2. Drop and recreate the database
info "Recriando banco de dados..."
PGPASSWORD="${DB_PASSWORD:-}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_SUPERUSER" -d "postgres" \
  -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || \
  error_exit "Falha ao dropar banco — confira se todas as conexões foram terminadas"
PGPASSWORD="${DB_PASSWORD:-}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_SUPERUSER" -d "postgres" \
  -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || \
  error_exit "Falha ao criar banco"

# 3. Restore from backup
info "Restaurando backup..."
SIZE=$(du -h "$INPUT_FILE" | cut -f1)
info "Tamanho do backup: $SIZE"

if echo "$INPUT_FILE" | grep -q "\.gz$"; then
  # Compressed with gzip — pipe decompressed to pg_restore
  gunzip -c "$INPUT_FILE" | pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --no-privileges --verbose 2>&1 | tail -20 || \
    warn "pg_restore emitiu warnings (verificar logs)"
else
  # Custom format — direct pg_restore
  pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --no-privileges --verbose "$INPUT_FILE" 2>&1 | tail -20 || \
    warn "pg_restore emitiu warnings (verificar logs)"
fi

PGPASSWORD=""

# 4. Verify
info "Verificando restauração..."
export PGPASSWORD="$DB_PASSWORD"
TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ' || echo "0")
PGPASSWORD=""

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅  Restauração concluída!                          ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Tabelas restauradas: $TABLE_COUNT                     ║"
echo "║  Backup usado: $INPUT_FILE"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Próximos passos recomendados:"
echo "  1. Rodar 'bun run db:generate' para regenerar Prisma Client"
echo "  2. Verificar dados: 'bunx prisma studio' ou consultas SQL"
echo "  3. Reindexar busca: 'bun run db:search:refresh'"
echo ""

exit 0
