#!/bin/bash
# =============================================================================
# scripts/backup-db.sh — PostgreSQL Backup Automatizado (Severinno Marketplace)
# =============================================================================
# Realiza dump comprimido do PostgreSQL com suporte a Docker e rotação de retenção.
#
# Usage:
#   bash scripts/backup-db.sh
#   bash scripts/backup-db.sh --retention-days 14
#
# Exit codes:
#   0 — Sucesso
#   1 — Falha na execução do dump ou container não encontrado
#
# Variáveis de ambiente opcionais:
#   POSTGRES_CONTAINER — nome do container (default: severinno_postgres_1 ou postgres)
#   POSTGRES_USER      — usuário (default: severinno)
#   POSTGRES_DB        — banco (default: severinno)
#   BACKUP_DIR         — diretório destino (default: ./backups)
#   RETENTION_DAYS     — dias para retenção (default: 7)
# =============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
POSTGRES_USER="${POSTGRES_USER:-severinno}"
POSTGRES_DB="${POSTGRES_DB:-severinno}"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILE="${BACKUP_DIR}/severinno_backup_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "📦 [$(date +"%Y-%m-%d %H:%M:%S")] Iniciando backup do banco '${POSTGRES_DB}'..."

# Detectar se está rodando via Docker ou pg_dump local
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q -E "postgres|postgis"; then
  CONTAINER_NAME="$(docker ps --format '{{.Names}}' | grep -E "postgres|postgis" | head -n 1)"
  echo "🐳 Executando pg_dump via container Docker '${CONTAINER_NAME}'..."
  docker exec -t "${CONTAINER_NAME}" pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --clean --if-exists | gzip > "${BACKUP_FILE}"
elif command -v pg_dump >/dev/null 2>&1; then
  echo "🐘 Executando pg_dump nativo..."
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --clean --if-exists | gzip > "${BACKUP_FILE}"
else
  echo "❌ Erro: Nem Docker nem pg_dump foram encontrados no sistema."
  exit 1
fi

FILE_SIZE="$(du -h "${BACKUP_FILE}" | cut -f1)"
echo "✅ Backup concluído com sucesso: ${BACKUP_FILE} (${FILE_SIZE})"

# Limpeza de backups antigos conforme a política de retenção
echo "🧹 Limpando backups com mais de ${RETENTION_DAYS} dias..."
find "${BACKUP_DIR}" -name "severinno_backup_*.sql.gz" -type f -mtime +"${RETENTION_DAYS}" -exec rm -f {} \;

echo "🏁 Processo de backup finalizado."
