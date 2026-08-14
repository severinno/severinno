/**
 * Apply escrow, disputes, and KYC migration statements to PostgreSQL.
 *
 * Usage:
 *   bun run scripts/apply-escrow-migration.ts
 *
 * Exit codes:
 *   0 - Migration executed successfully
 *   1 - Database connection or execution failure
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient({
  datasources: { db: { url: "postgresql://severinno:severinno@localhost:5432/severinno" } },
})

async function main() {
  console.log("Applying escrow & KYC migration statements...")

  // 1. Enum
  await prisma.$executeRawUnsafe(`
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
  `)

  // 2. User fields
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "identityDocUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "identitySelfieUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "identityVerifiedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "identityStatus" TEXT;
  `)

  // 3. Booking fields
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Booking"
    ADD COLUMN IF NOT EXISTS "escrowReleasedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "escrowDisputeReason" TEXT,
    ADD COLUMN IF NOT EXISTS "beforePhotos" JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS "afterPhotos" JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS "completionNote" TEXT;
  `)

  // 4. Index
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Booking_paymentStatus_idx" ON "Booking"("paymentStatus");
  `)

  // 5. Dispute table
  await prisma.$executeRawUnsafe(`
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
  `)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Dispute_bookingId_idx" ON "Dispute"("bookingId");
  `)

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Dispute_status_idx" ON "Dispute"("status");
  `)

  console.log("✅ All statements executed successfully!")
}

main()
  .catch((e) => {
    console.error("Migration error:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
