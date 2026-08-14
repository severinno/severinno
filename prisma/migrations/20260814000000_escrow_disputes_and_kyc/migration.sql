-- Migration: Escrow, Disputes and KYC fields
-- Author: Severinno Platform
-- Date: 2026-08-14

-- 1. Add 'HELD' to PaymentStatus enum if not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'PaymentStatus' AND e.enumlabel = 'HELD'
    ) THEN
        ALTER TYPE "PaymentStatus" ADD VALUE 'HELD';
    END IF;
END$$;

-- 2. Add identity verification fields to User
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "identityDocUrl" TEXT,
ADD COLUMN IF NOT EXISTS "identitySelfieUrl" TEXT,
ADD COLUMN IF NOT EXISTS "identityVerifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "identityStatus" TEXT;

-- 3. Add escrow & proof photos to Booking
ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "escrowReleasedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "escrowDisputeReason" TEXT,
ADD COLUMN IF NOT EXISTS "beforePhotos" JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "afterPhotos" JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "completionNote" TEXT;

-- 4. Create index on Booking(paymentStatus)
CREATE INDEX IF NOT EXISTS "Booking_paymentStatus_idx" ON "Booking"("paymentStatus");

-- 5. Create Dispute table
CREATE TABLE IF NOT EXISTS "Dispute" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Dispute_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Dispute_bookingId_idx" ON "Dispute"("bookingId");
CREATE INDEX IF NOT EXISTS "Dispute_status_idx" ON "Dispute"("status");
