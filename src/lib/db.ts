import { PrismaClient } from '@prisma/client'

// Models that support soft delete (have a `deletedAt` column)
const SOFT_DELETE_MODELS = ['User', 'Service', 'Booking'] as const
type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number]

function isSoftDeleteModel(model: string): model is SoftDeleteModel {
  return (SOFT_DELETE_MODELS as readonly string[]).includes(model)
}

function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  })

  // ── Soft-delete middleware ──────────────────────────────────────────────
  // 1. findMany / findFirst / findFirstOrThrow / findUnique / findUniqueOrThrow / count / aggregate / groupBy
  //    → automatically add `deletedAt: null` filter (skip if caller explicitly queries deletedAt)
  // 2. delete → rewrite to update with deletedAt = now()
  // 3. deleteMany → rewrite to updateMany with deletedAt = now()

  // READ filter: exclude soft-deleted rows by default
  client.$use(async (params, next) => {
    if (!params.model || !isSoftDeleteModel(params.model)) return next(params)

    const readActions = [
      'findFirst',
      'findFirstOrThrow',
      'findUnique',
      'findUniqueOrThrow',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
    ]

    if (readActions.includes(params.action)) {
      // Don't override if caller explicitly filters by deletedAt
      const where = params.args?.where
      if (where && 'deletedAt' in where) return next(params)

      params.args = params.args ?? {}
      params.args.where = { ...params.args.where, deletedAt: null }
    }

    return next(params)
  })

  // WRITE intercept: convert delete → soft-delete update
  client.$use(async (params, next) => {
    if (!params.model || !isSoftDeleteModel(params.model)) return next(params)

    if (params.action === 'delete') {
      params.action = 'update'
      params.args.data = { deletedAt: new Date() }
    }

    if (params.action === 'deleteMany') {
      params.action = 'updateMany'
      params.args = params.args ?? {}
      params.args.data = { ...params.args.data, deletedAt: new Date() }
    }

    return next(params)
  })

  return client
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db