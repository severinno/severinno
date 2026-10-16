/**
 * apply-partial-indexes.ts — Criação idempotente de índices parciais no PostgreSQL
 *
 * Aplica índices condicionais (WHERE status = '...') nas tabelas quentes do banco
 * para otimizar queries frequentes sem inflar o buffer cache nem gerar bloat.
 *
 * Usage:
 *   bun scripts/apply-partial-indexes.ts
 *
 * Exit codes:
 *   0 — success (índices verificados/criados com sucesso)
 *   1 — failure (erro de conexão ou execução DDL)
 */

import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

interface PartialIndexDef {
  name: string
  table: string
  columns: string
  whereClause: string
}

export const PARTIAL_INDEXES: PartialIndexDef[] = [
  {
    name: "idx_booking_pending_partial",
    table: "Booking",
    columns: '("providerId", "scheduledAt", "createdAt")',
    whereClause: "status = 'PENDING'",
  },
  {
    name: "idx_booking_in_progress_partial",
    table: "Booking",
    columns: '("providerId", "clientId", "scheduledAt")',
    whereClause: "status = 'IN_PROGRESS'",
  },
  {
    name: "idx_booking_active_partial",
    table: "Booking",
    columns: '("id", "providerId", "clientId", "status", "scheduledAt")',
    whereClause: "status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS')",
  },
  {
    name: "idx_notification_unread_partial",
    table: "Notification",
    columns: '("userId", "createdAt" DESC)',
    whereClause: "read = false",
  },
  {
    name: "idx_payment_held_escrow_partial",
    table: "Payment",
    columns: '("bookingId", "amount", "updatedAt")',
    whereClause: "status = 'HELD'",
  },
  {
    name: "idx_payment_pending_partial",
    table: "Payment",
    columns: '("bookingId", "amount", "createdAt")',
    whereClause: "status = 'PENDING'",
  },
  {
    name: "idx_quoterequest_pending_partial",
    table: "QuoteRequest",
    columns: '("providerId", "expiresAt", "createdAt")',
    whereClause: "status = 'PENDING'",
  },
  {
    name: "idx_dispute_open_partial",
    table: "Dispute",
    columns: '("bookingId", "createdAt")',
    whereClause: "status = 'OPEN'",
  },
  {
    name: "idx_user_active_provider_partial",
    table: "User",
    columns: '("city", "avgRating" DESC, "id", "slug")',
    whereClause: `role = 'PROVIDER' AND active = true AND "deletedAt" IS NULL`,
  },
]

async function main() {
  console.log(
    "⚡ [apply-partial-indexes] Verificando e aplicando índices parciais no PostgreSQL...",
  )

  let createdCount = 0
  let existingCount = 0

  for (const idx of PARTIAL_INDEXES) {
    try {
      // 1. Verifica se o índice já existe
      const checkResult = await db.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = ${idx.name};
      `

      if (Array.isArray(checkResult) && checkResult.length > 0) {
        console.log(`  ✓ [EXISTENTE] ${idx.name} na tabela "${idx.table}"`)
        existingCount++
        continue
      }

      // 2. Cria o índice se não existir
      const ddl = `CREATE INDEX IF NOT EXISTS "${idx.name}" ON "${idx.table}" ${idx.columns} WHERE ${idx.whereClause};`
      await db.$executeRawUnsafe(ddl)
      console.log(`  ⚡ [CRIADO] ${idx.name} na tabela "${idx.table}"`)
      createdCount++
    } catch (err) {
      console.error(`  ❌ [ERRO] Falha ao processar índice ${idx.name}:`, err)
      process.exit(1)
    }
  }

  console.log(
    `\n✅ [apply-partial-indexes] Concluído: ${createdCount} criados, ${existingCount} já existiam.`,
  )
  await db.$disconnect()
  process.exit(0)
}

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  void main()
}
