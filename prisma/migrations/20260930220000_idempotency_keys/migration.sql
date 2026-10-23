-- ============================================================================
-- Migration: idempotency keys (proteção contra cobrança duplicada no Lytex)
-- ============================================================================
-- Tabela de registros de idempotência para rotas que CRIAM cobranças no
-- gateway. Uma chave (header Idempotency-Key) = UMA criação de cobrança.
-- Retry com a mesma chave devolve a resposta da primeira execução (replay)
-- ou, se ela falhou, falha sem criar segunda cobrança.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'pay:create',
    "context" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "response" JSONB,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- Uma chave só pode existir UMA vez: a corrida entre dois requests simultâneos
-- é resolvida pelo banco (o segundo INSERT falha com unique violation).
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_key_key" ON "IdempotencyRecord"("key");

CREATE INDEX IF NOT EXISTS "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_scope_createdAt_idx" ON "IdempotencyRecord"("scope", "createdAt");
