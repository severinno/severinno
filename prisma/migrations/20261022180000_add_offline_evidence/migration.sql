-- Migration: OfflineEvidence — sincronização real de evidências do PWA offline
--
-- Contexto: POST /api/sync/offline-batch respondia "SYNCED" para itens que
-- nunca eram gravados (o prestador perdia fotos/check-in de locais sem sinal,
-- sem erro). Esta tabela é o destino durável do lote.
--
-- `externalId` é o id gerado no cliente e a chave de IDEMPOTÊNCIA: o mesmo
-- lote pode ser reenviado (retry de rede) sem duplicar prova.
--
-- Idempotente (IF NOT EXISTS): retry após falha parcial converge em vez de
-- travar em 42P07/42701 — mesma convenção das migrations anteriores.

CREATE TABLE IF NOT EXISTS "OfflineEvidence" (
  "id" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "accuracy" DOUBLE PRECISION,
  "photoUrl" TEXT,
  "photoDigest" TEXT,
  "notes" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OfflineEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OfflineEvidence_externalId_key"
  ON "OfflineEvidence" ("externalId");

CREATE INDEX IF NOT EXISTS "OfflineEvidence_bookingId_recordedAt_idx"
  ON "OfflineEvidence" ("bookingId", "recordedAt");

CREATE INDEX IF NOT EXISTS "OfflineEvidence_providerId_createdAt_idx"
  ON "OfflineEvidence" ("providerId", "createdAt");

-- FK com CASCADE: apagar o booking (LGPD/exclusão de conta) apaga a evidência.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OfflineEvidence_bookingId_fkey'
  ) THEN
    ALTER TABLE "OfflineEvidence"
      ADD CONSTRAINT "OfflineEvidence_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
