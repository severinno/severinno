#!/bin/bash
# ==============================================================================
# Severinno — Limpeza Automatica de Registros Efemeros no Postgres
# ==============================================================================
# Executa purge seguro de registros antigos:
# - IdempotencyRecord expirados (> 48 horas)
# - ResetToken expirados (> 24 horas)
# - PushSendLog antigos (> 30 dias)
# - WebhookExecutionLog antigos (> 30 dias)
# ==============================================================================

set -euo pipefail

POSTGRES_PASS=$(cat /home/deploy/severinno/secrets/postgres_password.secret 2>/dev/null || echo "")

if [ -z "$POSTGRES_PASS" ]; then
    echo "Erro: Segredo postgres_password.secret nao encontrado." >&2
    exit 1
fi

docker exec -e PGPASSWORD="$POSTGRES_PASS" severinno-postgres-1 psql -U severinno -d severinno << 'SQL'
BEGIN;
DELETE FROM "IdempotencyRecord" WHERE "createdAt" < NOW() - INTERVAL '48 hours';
DELETE FROM "ResetToken" WHERE "expiresAt" < NOW() - INTERVAL '24 hours';
DELETE FROM "PushSendLog" WHERE "createdAt" < NOW() - INTERVAL '30 days';
DELETE FROM "WebhookExecutionLog" WHERE "createdAt" < NOW() - INTERVAL '30 days';
COMMIT;
SQL

echo "[$(date -Iseconds)] Purge de registros efemeros concluido com sucesso."
