#!/usr/bin/env bash
# =============================================================================
# scripts/test-restore.sh — Teste automático de restore do backup PostgreSQL
# =============================================================================
# Restaura o backup mais recente num banco DESCARTAVEL, valida a integridade
# (tabelas presentes, dados legíveis) e descarta o banco de teste em seguida.
# Se qualquer passo falhar, envia alerta no Telegram e sai com exit 1.
#
# Por que existe: backup que nunca foi restaurado NÃO é garantia de recovery.
# Este script valida semanalmente (cron) que o backup do dia serve pra um
# disaster recovery de verdade.
#
# Usage:
#   bash scripts/test-restore.sh                 # teste completo
#   bash scripts/test-restore.sh --keep          # mantém o banco de teste (debug)
#   bash scripts/test-restore.sh --dry-run       # mostra o que faria
#
# Exit codes:
#   0 — restore validado com sucesso
#   1 — falha (backup ausente, restore ou validação com erro)
#   2 — uso incorreto
#
# Env vars (opcional):
#   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — alertas (carregados do .env)
#   DB_HOST / DB_PORT / DB_USER / DB_NAME — conexão PostgreSQL
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

KEEP=false
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=true ;;
    --dry-run) DRY_RUN=true ;;
    *) echo "Uso: $0 [--keep] [--dry-run]" >&2; exit 2 ;;
  esac
done

# ── Config ──────────────────────────────────────────────────────────────────
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-severinno}"
DB_NAME="${DB_NAME:-severinno}"
DB_PASSWORD="${DB_PASSWORD:-}"
TEST_DB="${DB_NAME}_restore_test"
BACKUP_DIR="/tmp/severinno-backups"
LOG_FILE="$PROJECT_DIR/logs/restore-test.log"
mkdir -p "$(dirname "$LOG_FILE")" "$BACKUP_DIR"

# Load Telegram config from .env (like health-alert.sh)
[ -f "$PROJECT_DIR/.env" ] && source <(grep -E "^(TELEGRAM_|APP_URL|DB_|DATABASE_URL)" "$PROJECT_DIR/.env" 2>/dev/null || true)
# Se DATABASE_URL veio do .env, extrai credenciais (senão usa defaults acima)
if [ -n "${DATABASE_URL:-}" ]; then
  DB_HOST="$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')"
  DB_PORT="$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')"
  DB_USER="$(echo "$DATABASE_URL" | sed -E 's|.*://([^:]+):.*|\1|')"
  DB_PASSWORD="$(echo "$DATABASE_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')"
  DB_NAME="$(echo "$DATABASE_URL" | sed -E 's|.*/([^/?]+).*|\1|')"
  TEST_DB="${DB_NAME}_restore_test"
fi
export PGPASSWORD="$DB_PASSWORD"

log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

send_telegram() {
  local message="$1"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "text=${message}" \
      -d "parse_mode=HTML" \
      -o /dev/null 2>/dev/null || log "❌ Falha ao enviar alerta Telegram"
  else
    log "⚠️  Telegram não configurado — falha de restore NÃO notificada!"
  fi
}

# ── 1. Encontra o backup mais recente ──────────────────────────────────────
log "🔍 Procurando backup mais recente (local /tmp → S3/MinIO)..."
LATEST="$(ls -1t "$BACKUP_DIR"/severinno_*.sql.gz 2>/dev/null | head -1 || true)"

# Fallback: baixa o mais recente do MinIO/S3 (backup durável — /tmp é staging
# volátil, limpo no reboot; o backup de verdade vive no bucket)
if [ -z "$LATEST" ] && command -v mc >/dev/null 2>&1; then
  log "🔎 Local vazio — buscando no MinIO/S3..."
  MINIO_ALIAS="${MINIO_ALIAS:-local}"
  MINIO_BUCKET="${MINIO_BUCKET:-severinno-backups}"
  REMOTE="$(mc ls "$MINIO_ALIAS/$MINIO_BUCKET/daily/" 2>/dev/null | grep -oE 'severinno_[0-9_]+[0-9]\.sql\.gz' | sort | tail -1 || true)"
  if [ -n "$REMOTE" ]; then
    mc cp "$MINIO_ALIAS/$MINIO_BUCKET/daily/$REMOTE" "$BACKUP_DIR/$REMOTE" >/dev/null 2>&1 && \
      log "📥 Baixado do S3: $REMOTE" && LATEST="$BACKUP_DIR/$REMOTE"
  fi
fi

if [ -z "$LATEST" ]; then
  log "❌ Nenhum backup encontrado (local nem S3)"
  send_telegram "❌ <b>TESTE DE RESTORE FALHOU</b>%0ANenhum backup encontrado (local nem S3/MinIO)%0ATempo: $(date +'%d/%m/%Y %H:%M:%S')"
  exit 1
fi
log "📦 Backup: $(basename "$LATEST") ($(du -h "$LATEST" | cut -f1))"

if [ "$DRY_RUN" = true ]; then
  log "🔎 DRY-RUN — restauraria $LATEST no banco $TEST_DB e validaria."
  exit 0
fi

# ── Detecta client psql (local ou via container postgis) ───────────────────
PSQL_BIN=""
if command -v psql >/dev/null 2>&1; then
  PSQL_BIN="psql"
  CREATE_DB="createdb"
  DROP_DB="dropdb"
else
  CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i postgis | head -1 || true)"
  if [ -n "$CONTAINER" ]; then
    PSQL_BIN="docker exec -i $CONTAINER psql"
    CREATE_DB="docker exec $CONTAINER createdb"
    DROP_DB="docker exec $CONTAINER dropdb"
  else
    log "❌ Sem psql local nem container postgis — impossível testar restore"
    send_telegram "❌ <b>TESTE DE RESTORE FALHOU</b>%0ASem psql local nem container postgis"
    exit 1
  fi
fi

# ── 2. Cria banco descartável ──────────────────────────────────────────────
log "🧹 Removendo banco de teste anterior (se existir)..."
$DROP_DB -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$TEST_DB" 2>>"$LOG_FILE" || true
log "🗄️  Criando banco de teste $TEST_DB..."
$CREATE_DB -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$TEST_DB" 2>>"$LOG_FILE"
if [ $? -ne 0 ]; then
  log "❌ Falha ao criar banco de teste"
  send_telegram "❌ <b>TESTE DE RESTORE FALHOU</b>%0AFalha ao criar banco de teste ${TEST_DB}"
  exit 1
fi

# ── 3. Restaura o backup no banco de teste ─────────────────────────────────
log "🔄 Restaurando backup no banco de teste..."
gunzip -c "$LATEST" | $PSQL_BIN -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEST_DB" >/dev/null 2>>"$LOG_FILE"
RESTORE_STATUS=$?

if [ "$RESTORE_STATUS" -ne 0 ]; then
  log "❌ Restore FALHOU (exit $RESTORE_STATUS)"
  send_telegram "❌ <b>TESTE DE RESTORE FALHOU</b>%0AArquivo: $(basename "$LATEST")%0AExit: ${RESTORE_STATUS}%0ATempo: $(date +'%d/%m/%Y %H:%M:%S')"
  if [ "$KEEP" != true ]; then
    $DROP_DB -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$TEST_DB" 2>/dev/null || true
  fi
  exit 1
fi

# ── 4. Valida a integridade do restore ─────────────────────────────────────
log "✅ Restore concluído — validando integridade..."

# 4a. Conta as tabelas do schema public
TABLE_COUNT=$($PSQL_BIN -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEST_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>>"$LOG_FILE" || echo "0")
log "📊 Tabelas no schema public: $TABLE_COUNT"

# 4b. Verifica se há dados (amostra de tabelas core)
HAVE_DATA=$($PSQL_BIN -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEST_DB" -tAc \
  "SELECT CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname='public') > 0 THEN 'yes' ELSE 'no' END" 2>>"$LOG_FILE" || echo "no")
log "🔎 Estrutura presente: $HAVE_DATA"

# 4c. PostGIS ativo?
POSTGIS_OK=$($PSQL_BIN -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEST_DB" -tAc \
  "SELECT CASE WHEN count(*) > 0 THEN 'yes' ELSE 'no' END FROM pg_extension WHERE extname='postgis'" 2>>"$LOG_FILE" || echo "no")
log "🧭 PostGIS: $POSTGIS_OK"

if [ "$TABLE_COUNT" -lt 5 ] || [ "$HAVE_DATA" != "yes" ]; then
  log "❌ VALIDAÇÃO FALHOU — $TABLE_COUNT tabelas, dados: $HAVE_DATA"
  send_telegram "❌ <b>TESTE DE RESTORE FALHOU</b>%0AValidação: ${TABLE_COUNT} tabelas, PostGIS: ${POSTGIS_OK}%0AArquivo: $(basename "$LATEST")"
  if [ "$KEEP" != true ]; then
    $DROP_DB -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$TEST_DB" 2>/dev/null || true
  fi
  exit 1
fi

# ── 5. Sucesso — limpa e notifica ──────────────────────────────────────────
log "✅✅ TESTE DE RESTORE OK — backup válido para DR!"
if [ "$KEEP" != true ]; then
  log "🧹 Removendo banco de teste..."
  $DROP_DB -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$TEST_DB" 2>>"$LOG_FILE" || true
else
  log "🔧 --keep: banco de teste $TEST_DB mantido (debug)"
fi

send_telegram "✅ <b>TESTE DE RESTORE OK</b>%0ABackup: $(basename "$LATEST")%0ATabelas: ${TABLE_COUNT} | PostGIS: ${POSTGIS_OK}%0ATempo: $(date +'%d/%m/%Y %H:%M:%S')"

exit 0