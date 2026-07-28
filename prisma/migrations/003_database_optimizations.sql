-- ============================================================================
-- Migration 003: Database Optimizations
-- ============================================================================
-- Aplicar em produção via: psql $DATABASE_URL -f prisma/migrations/003_database_optimizations.sql
-- Ou via Prisma: DATABASE_URL=... npx prisma migrate dev --name add_database_optimizations
-- ============================================================================

BEGIN;

-- ── 1. ADICIONAR @updatedAt AOS MODELOS QUE NÃO TINHAM ──────────────────

-- QuoteItem
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

-- Review
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

-- Favorite
ALTER TABLE "Favorite" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

-- Message
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

-- Notification
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

-- ResetToken
ALTER TABLE "ResetToken" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

-- PushSubscription
ALTER TABLE "PushSubscription" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

-- PushAnalytics
ALTER TABLE "PushAnalytics" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

-- WebhookExecutionLog
ALTER TABLE "WebhookExecutionLog" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

-- SearchReindexQueue
ALTER TABLE "SearchReindexQueue" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();


-- ── 2. ADICIONAR SEARCH_VECTOR À CATEGORY ──────────────────────────────

ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;


-- ── 3. COMPOUND INDEXES PARA QUERIES FREQUENTES ────────────────────────

-- Service: busca por categoria + ativos
CREATE INDEX IF NOT EXISTS "Service_categoryId_active_idx" ON "Service" ("categoryId", "active");

-- Booking: queries do provider + status + data
CREATE INDEX IF NOT EXISTS "Booking_providerId_status_scheduledAt_idx" ON "Booking" ("providerId", "status", "scheduledAt");

-- Booking: queries do client + status + data
CREATE INDEX IF NOT EXISTS "Booking_clientId_status_scheduledAt_idx" ON "Booking" ("clientId", "status", "scheduledAt");

-- Notification: notificações do usuário ordenadas por data
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification" ("userId", "createdAt");

-- Message: conversa entre dois usuários (para ORDER BY createdAt)
CREATE INDEX IF NOT EXISTS "Message_fromId_toId_createdAt_idx" ON "Message" ("fromId", "toId", "createdAt");

-- User: busca por cidade + ativo + verificado (filtros da vitrine)
CREATE INDEX IF NOT EXISTS "User_city_active_verified_idx" ON "User" ("city", "active", "verified");


-- ── 4. ATUALIZAR FOREIGN KEYS COM onDelete: Restrict ────────────────────

-- Proíbe deletar categoria que tenha serviços vinculados
ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS "Service_categoryId_fkey",
  ADD CONSTRAINT "Service_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
    ON DELETE RESTRICT;

-- Proíbe deletar serviço que tenha bookings vinculados
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_serviceId_fkey",
  ADD CONSTRAINT "Booking_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
    ON DELETE RESTRICT;

-- Proíbe deletar usuário que tenha settlements pendentes
ALTER TABLE "ProviderSettlement" DROP CONSTRAINT IF EXISTS "ProviderSettlement_providerId_fkey",
  ADD CONSTRAINT "ProviderSettlement_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "User"("id")
    ON DELETE RESTRICT;


-- ── 5. ATUALIZAR ÍNDICES EXISTENTES (REMOVER REDUNDÂNCIAS) ─────────────

-- O index simples Notification_userId_idx agora está coberto pelo composto
DROP INDEX IF EXISTS "Notification_userId_idx";


COMMIT;

-- ============================================================================
-- VERIFICAÇÃO PÓS-MIGRAÇÃO
-- ============================================================================
-- Execute após a migration:
--   \dt+  — ver tabelas
--   \di+  — ver índices
--   SELECT count(*) FROM "QuoteItem" WHERE "updatedAt" IS NOT NULL;
-- ============================================================================
