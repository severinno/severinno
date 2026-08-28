/**
 * Soft-delete middleware logic — extracted as pure functions so they can be
 * tested without mocking Prisma.
 *
 * NOTE: The primary soft-delete implementation lives in db.ts via Prisma
 * $extends middleware. These functions are legacy helpers retained for
 * backward compatibility and direct unit testing.
 */

// Models that support soft delete (have a `deletedAt` column)
export const SOFT_DELETE_MODELS = ["User", "Service", "Booking"] as const
export type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number]

export function isSoftDeleteModel(model: string): model is SoftDeleteModel {
  return (SOFT_DELETE_MODELS as readonly string[]).includes(model)
}

/** Prisma middleware action names that read data (may need deletedAt filter) */
export const READ_ACTIONS = [
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
] as const

/**
 * Soft-delete READ filter.
 * Automatically adds `deletedAt: null` to where clauses for soft-delete models
 * unless the caller explicitly queries `deletedAt`.
 */
export function softDeleteReadFilter(params: Record<string, unknown>): Record<string, unknown> {
  if (!params.model || !isSoftDeleteModel(params.model as string)) return params

  if (READ_ACTIONS.includes(params.action as (typeof READ_ACTIONS)[number])) {
    const where = (params.args as Record<string, unknown> | undefined)?.where as
      Record<string, unknown> | undefined
    if (where && "deletedAt" in where) return params

    const args = (params.args as Record<string, unknown>) ?? {}
    args.where = { ...(args.where as Record<string, unknown>), deletedAt: null }
    params.args = args
  }

  return params
}

/**
 * Soft-delete WRITE interceptor.
 * Converts `delete` → `update` and `deleteMany` → `updateMany` with `deletedAt = now()`.
 */
export function softDeleteWriteInterceptor(
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (!params.model || !isSoftDeleteModel(params.model as string)) return params

  if (params.action === "delete") {
    params.action = "update"
    const args = (params.args as Record<string, unknown>) ?? {}
    args.data = { deletedAt: new Date() }
    params.args = args
  }

  if (params.action === "deleteMany") {
    params.action = "updateMany"
    const args = (params.args as Record<string, unknown>) ?? {}
    args.data = { ...(args.data as Record<string, unknown>), deletedAt: new Date() }
    params.args = args
  }

  return params
}

/**
 * Pass params through both soft-delete middlewares.
 * Order matters: READ filter first, then WRITE interceptor.
 */
export function applySoftDeleteMiddlewares(
  params: Record<string, unknown>,
): Record<string, unknown> {
  return softDeleteWriteInterceptor(softDeleteReadFilter(params))
}
