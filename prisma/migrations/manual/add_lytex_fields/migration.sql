-- Migration: add Lytex Pagamentos fields to Payment table
-- Run after: npx prisma migrate dev (or manually in production)

BEGIN;

-- Add new columns to Payment table
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "lytexId" TEXT UNIQUE;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "lytexStatus" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "qrCode" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "qrCodeImage" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "cardLastDigits" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "cardBrand" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "installments" INTEGER;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMPTZ;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "lytexRawResponse" JSONB;

-- Indexes for Lytex queries
CREATE INDEX IF NOT EXISTS "Payment_lytexId_idx" ON "Payment" ("lytexId");
CREATE INDEX IF NOT EXISTS "Payment_lytexStatus_idx" ON "Payment" ("lytexStatus");

-- Trigger to auto-set paidAt when status changes to PAID
CREATE OR REPLACE FUNCTION update_payment_paid_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID' THEN
    NEW.paidAt = COALESCE(NEW.paidAt, NOW());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_paid_at ON "Payment";
CREATE TRIGGER trg_payment_paid_at
  BEFORE UPDATE OF status ON "Payment"
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_paid_at();

COMMIT;
