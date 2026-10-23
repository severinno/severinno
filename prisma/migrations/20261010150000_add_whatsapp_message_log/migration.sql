-- CreateTable (idempotente: retry após falha parcial converge em vez de
-- travar em 42P07/42710 — ver _prisma_migrations travada em 2026-10-10).
CREATE TABLE IF NOT EXISTS "WhatsAppMessageLog" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "userId" TEXT,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessageLog_pkey" PRIMARY KEY ("id")
);

-- Reparo de estado parcial: se a tabela já existia INCOMPLETA (DDL manual ou
-- falha fora de transação), o CREATE acima é pulado — estas colunas completam
-- o que faltar. Formas propositadamente sem NOT NULL/DEFAULT: nunca falham
-- por linhas pré-existentes; a convergência do retry é o que importa aqui.
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "text" TEXT;
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "context" TEXT;
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "messageId" TEXT;
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppMessageLog" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMessageLog_messageId_key" ON "WhatsAppMessageLog"("messageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppMessageLog_phone_idx" ON "WhatsAppMessageLog"("phone");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppMessageLog_userId_idx" ON "WhatsAppMessageLog"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppMessageLog_status_idx" ON "WhatsAppMessageLog"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppMessageLog_context_idx" ON "WhatsAppMessageLog"("context");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppMessageLog_createdAt_idx" ON "WhatsAppMessageLog"("createdAt");

-- AddForeignKey (DROP+ADD: converge tanto do zero quanto de estado parcial)
ALTER TABLE "WhatsAppMessageLog" DROP CONSTRAINT IF EXISTS "WhatsAppMessageLog_userId_fkey";
ALTER TABLE "WhatsAppMessageLog" ADD CONSTRAINT "WhatsAppMessageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
