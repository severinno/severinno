#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# backup-db.sh — PostgreSQL Backup Automático com Rotação
# ═══════════════════════════════════════════════════════════════════════════
# Cria backups do PostgreSQL usando pg_dump, com compressão gzip,
# rotação automática (mantém N backups), e envio opcional para S3.
#
# Uso:
#   bash scripts/backup-db.sh                          # Backup manual
#   bash scripts/backup-db.sh --cron                   # Modo cron (log + silent)
#   bash scripts/backup-db.sh --restore <arquivo.sql.gz>  # Restaurar backup
#
# Cron (todo dia às 03:00):
#   0 3 * * * /opt/severinno/scripts/backup-db.sh --cron
#
# Pré-requisitos:
#   - pg_dump instalado (vem com postgresql-client)
#   - Variáveis de ambiente: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
#   - (Opcional) aws-cli para envio ao S3
#
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuração ──────────────────────────────────────────────────────────

# Diretório de backups (bind mount no host ou volume Docker)
BACKUP_DIR="${BACKUP_DIR:-/var/backups/severinno/postgres}"

# Rotação: manter N backups locais
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Prefixo do arquivo de backup
BACKUP_PREFIX="${BACKUP_PREFIX:-severinno-db}"

# S3 bucket opcional (ex: s3://severinno-backups/db/)
S3_BUCKET="${S3_BUCKET:-}"

# Limite de compressão (0-9, 9=máxima)
GZIP_LEVEL="${GZIP_LEVEL:-6}"

# Timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# ── Cores ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}  ℹ${NC} $1"; }
ok()    { echo -e "${GREEN}  ✔${NC} $1"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $1"; }
err()   { echo -e "${RED}  ✘${NC} $1"; }

# ── Helpers ───────────────────────────────────────────────────────────────

log() {
  if [[ "${1:-}" == "--cron" ]]; then
    shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$BACKUP_DIR/backup.log"
  else
    echo "  $*"
  fi
}

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    err "Backup falhou (exit code: $exit_code)"
    # Remove backup corrompido se existir
    if [ -n "${BACKUP_FILE:-}" ] && [ -f "$BACKUP_FILE" ]; then
      rm -f "$BACKUP_FILE"
      warn "Backup corrompido removido: $BACKUP_FILE"
    fi
  fi
  exit $exit_code
}
trap cleanup EXIT

# ── Verificação de dependências ───────────────────────────────────────────

check_deps() {
  if ! command -v pg_dump &>/dev/null; then
    err "pg_dump not found. Install: apt install postgresql-client"
    exit 1
  fi

  if ! command -v gzip &>/dev/null; then
    err "gzip not found"
    exit 1
  fi
}

# ── Verificação de conexão ────────────────────────────────────────────────

check_connection() {
  local db_url="${DATABASE_URL:-}"
  local pg_host="${PGHOST:-}"
  local pg_port="${PGPORT:-5432}"

  # Se DATABASE_URL não está definida, tenta usar env vars individuais
  if [ -z "$db_url" ]; then
    if [ -z "$pg_host" ]; then
      err "Defina DATABASE_URL ou PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE"
      exit 1
    fi
  fi

  # Testa conexão (usa DATABASE_URL se disponível, senão monta da env)
  if [ -n "$DATABASE_URL" ]; then
    if ! psql "$DATABASE_URL" -At -c "SELECT 1" &>/dev/null; then
      err "Não foi possível conectar ao banco via DATABASE_URL"
      exit 1
    fi
  else
    if ! PGPASSWORD="${PGPASSWORD}" psql \
      -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
      -At -c "SELECT 1" &>/dev/null; then
      err "Não foi possível conectar ao banco: ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
      exit 1
    fi
  fi

  ok "Conexão com banco OK"
}

# ── Backup ─────────────────────────────────────────────────────────────────

do_backup() {
  local mode="${1:-manual}"
  local backup_file="$BACKUP_DIR/${BACKUP_PREFIX}_${TIMESTAMP}.sql.gz"

  mkdir -p "$BACKUP_DIR"

  info "Iniciando backup..."
  info "  Diretório: $BACKUP_DIR"
  info "  Arquivo:   $(basename "$backup_file")"

  # Estatísticas antes do backup
  local db_size
  if [ -n "${DATABASE_URL:-}" ]; then
    db_size=$(psql "$DATABASE_URL" -At -c \
      "SELECT pg_size_pretty(pg_database_size(current_database()));" 2>/dev/null || echo "desconhecido")
  else
    db_size=$(PGPASSWORD="${PGPASSWORD}" psql \
      -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
      -At -c "SELECT pg_size_pretty(pg_database_size(current_database()));" 2>/dev/null || echo "desconhecido")
  fi
  info "  Tamanho:   $db_size"

  # Executa pg_dump com compressão gzip
  local start_time
  start_time=$(date +%s)

  if [ -n "${DATABASE_URL:-}" ]; then
    pg_dump "$DATABASE_URL" --no-owner --no-acl \
      | gzip -"$GZIP_LEVEL" > "$backup_file"
  else
    PGPASSWORD="${PGPASSWORD}" pg_dump \
      -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
      --no-owner --no-acl \
      | gzip -"$GZIP_LEVEL" > "$backup_file"
  fi

  local end_time
  end_time=$(date +%s)
  local elapsed=$((end_time - start_time))

  # Verifica integridade do arquivo
  if [ ! -f "$backup_file" ] || [ ! -s "$backup_file" ]; then
    err "Arquivo de backup vazio ou não criado"
    exit 1
  fi

  local backup_size
  backup_size=$(du -h "$backup_file" | cut -f1)

  ok "Backup concluído: $backup_size em ${elapsed}s"
  log --cron "Backup concluído: $(basename "$backup_file") ($backup_size, ${elapsed}s, mode=$mode)"

  # Validação: testar integridade do gzip
  if ! gzip -t "$backup_file" 2>/dev/null; then
    err "Arquivo gzip corrompido"
    rm -f "$backup_file"
    exit 1
  fi
  ok "Integridade gzip verificada"

  BACKUP_FILE="$backup_file"
}

# ── Rotação ────────────────────────────────────────────────────────────────

do_rotation() {
  info "Rotação: removendo backups com mais de ${RETENTION_DAYS} dias..."

  local removed=0
  while IFS= read -r -d '' old_file; do
    rm -f "$old_file"
    removed=$((removed + 1))
  done < <(find "$BACKUP_DIR" -name "${BACKUP_PREFIX}_*.sql.gz" -mtime "+$RETENTION_DAYS" -print0)

  if [ "$removed" -gt 0 ]; then
    ok "$removed backup(s) antigo(s) removido(s)"
    log --cron "Rotação: $removed backups removidos (retenção: ${RETENTION_DAYS}d)"
  else
    info "Nenhum backup antigo para remover"
  fi
}

# ── Envio para S3 (opcional) ───────────────────────────────────────────────

do_s3_upload() {
  if [ -z "$S3_BUCKET" ]; then
    return 0
  fi

  if ! command -v aws &>/dev/null && ! command -v mc &>/dev/null; then
    warn "aws-cli ou mc não encontrados — pulando upload S3"
    warn "  Instale: apt install awscli"
    warn "  Ou configure S3_BUCKET vazio para pular"
    return 0
  fi

  local target="$S3_BUCKET/$(date +%Y/%m)/$(basename "$BACKUP_FILE")"

  info "Enviando para S3..."
  if command -v aws &>/dev/null; then
    if aws s3 cp "$BACKUP_FILE" "$target" --storage-class STANDARD_IA 2>&1; then
      ok "Backup enviado para S3: $target"
      log --cron "S3 upload OK: $target"
    else
      warn "Falha no upload S3 (contínua sem ele)"
    fi
  elif command -v mc &>/dev/null; then
    if mc cp "$BACKUP_FILE" "s3/$target" 2>&1; then
      ok "Backup enviado para S3 (mc): $target"
    else
      warn "Falha no upload S3 via mc"
    fi
  fi
}

# ── Restauração ────────────────────────────────────────────────────────────

do_restore() {
  local restore_file="$1"

  if [ ! -f "$restore_file" ]; then
    err "Arquivo de backup não encontrado: $restore_file"
    exit 1
  fi

  info "⚠️  RESTAURAÇÃO — Isso vai SUBSTITUIR o banco de dados atual!"
  info "  Arquivo: $restore_file"
  info "  Pressione Ctrl+C para cancelar (5s)..."

  for i in 5 4 3 2 1; do
    echo -n "  $i..."
    sleep 1
  done
  echo

  local backup_size
  backup_size=$(du -h "$restore_file" | cut -f1)
  info "Restaurando $backup_size..."

  local start_time
  start_time=$(date +%s)

  if [ -n "${DATABASE_URL:-}" ]; then
    gunzip -c "$restore_file" | psql "$DATABASE_URL" 2>&1
  else
    gunzip -c "$restore_file" | PGPASSWORD="${PGPASSWORD}" psql \
      -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" 2>&1
  fi

  local end_time
  end_time=$(date +%s)
  local elapsed=$((end_time - start_time))

  ok "Restauração concluída em ${elapsed}s"
}

# ── Main ───────────────────────────────────────────────────────────────────

main() {
  local mode="manual"
  local action="backup"

  # Parse args
  for arg in "$@"; do
    case "$arg" in
      --cron) mode="cron" ;;
      --restore) action="restore" ;;
      --restore=*) action="restore"; RESTORE_FILE="${arg#*=}" ;;
      --help|-h)
        echo ""
        echo "  Uso: bash scripts/backup-db.sh [opções]"
        echo ""
        echo "  Opções:"
        echo "    --cron                Modo cron (logs silenciosos para arquivo)"
        echo "    --restore <arquivo>   Restaurar backup"
        echo "    --help                Esta ajuda"
        echo ""
        echo "  Configuração (env vars):"
        echo "    BACKUP_DIR          Diretório de backups (padrão: /var/backups/severinno/postgres)"
        echo "    RETENTION_DAYS     Retenção em dias (padrão: 30)"
        echo "    S3_BUCKET           Bucket S3 opcional (ex: s3://severinno-backups/db/)"
        echo "    GZIP_LEVEL          Nível de compressão 0-9 (padrão: 6)"
        echo "    DATABASE_URL        URL de conexão (ou use PGHOST, PGPORT, PGUSER, ...)"
        echo ""
        exit 0
        ;;
    esac
  done

  echo ""
  echo "  ╔══════════════════════════════════════════════════════════════╗"
  echo "  ║   PostgreSQL Backup — Severinno Marketplace                 ║"
  echo "  ╚══════════════════════════════════════════════════════════════╝"
  echo ""

  check_deps
  check_connection

  if [ "$action" = "restore" ]; then
    do_restore "${RESTORE_FILE:-}"
    exit $?
  fi

  do_backup "$mode"
  do_rotation

  if [ -n "$S3_BUCKET" ]; then
    do_s3_upload
  fi

  # Cron: limpa log antigo (mantém últimos 1000 backups no log)
  if [ "$mode" = "cron" ]; then
    tail -n 1000 "$BACKUP_DIR/backup.log" > "$BACKUP_DIR/backup.log.tmp" 2>/dev/null || true
    mv "$BACKUP_DIR/backup.log.tmp" "$BACKUP_DIR/backup.log" 2>/dev/null || true
  fi

  echo ""
  ok "Backup finalizado com sucesso!"
  echo ""
}

main "$@"
