import { PrismaClient } from "@prisma/client"
import { SOFT_DELETE_MODELS } from "./soft-delete"
import { buildQueryMonitorExtensions } from "./db-query-monitor"

// The `query` option type Prisma's `$extends` accepts for per-model operation
// interceptors — extracted from the generated client's extension signature so
// we never depend on Prisma's internal generic names.
type PrismaQueryExtension = Extract<
  Parameters<PrismaClient["$extends"]>[0],
  { query: unknown }
>["query"]

// ── Type helper for $extends query interceptor args ───────────────────────
type QueryArgs = {
  args: Record<string, unknown>
  query: (args: Record<string, unknown>) => Promise<unknown>
}

// Prisma model names in the JS API are camelCase (user, service, booking)
const SOFT_DELETE_MODEL_KEYS = SOFT_DELETE_MODELS.map((m) => m.charAt(0).toLowerCase() + m.slice(1))

// Only operations that accept arbitrary WHERE clauses.
const READ_OPS = ["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"]

/**
 * Build per-model query extensions for soft-delete.
 */
function buildSoftDeleteQueries() {
  const queries: Record<string, Record<string, (opts: QueryArgs) => Promise<unknown>>> = {}

  for (const model of SOFT_DELETE_MODEL_KEYS) {
    queries[model] = {}
    const modelName = model.charAt(0).toUpperCase() + model.slice(1)

    for (const op of READ_OPS) {
      queries[model][op] = async ({ args, query }: QueryArgs) => {
        if (!(args.where as Record<string, unknown> | undefined)?.deletedAt) {
          args.where = { ...((args.where as Record<string, unknown>) ?? {}), deletedAt: null }
        }
        return query(args)
      }
    }

    queries[model].delete = async ({ args: _a, query: _q }: QueryArgs) => {
      throw new Error(
        `[soft-delete] Cannot hard-delete a '${modelName}' record. ` +
          `Use db.${model}.update({ where, data: { deletedAt: new Date() } }) instead.`,
      )
    }
    queries[model].deleteMany = async ({ args: _a, query: _q }: QueryArgs) => {
      throw new Error(
        `[soft-delete] Cannot hard-delete '${modelName}' records. ` +
          `Use db.${model}.updateMany({ where, data: { deletedAt: new Date() } }) instead.`,
      )
    }
  }

  return queries
}

// ── Create the extended Prisma client ──────────────────────────────────────

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>

function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  })

  // Merge soft-delete + slow query monitor extensions
  const softDeleteQueries = buildSoftDeleteQueries()
  const monitorQueries = buildQueryMonitorExtensions()

  // Merge query extensions: monitor wraps soft-delete (outer = monitor, inner = soft-delete)
  const mergedQueries: Record<string, Record<string, (opts: QueryArgs) => Promise<unknown>>> = {}
  const allModels = new Set([...Object.keys(softDeleteQueries), ...Object.keys(monitorQueries)])

  for (const model of allModels) {
    mergedQueries[model] = {}
    const allOps = new Set([
      ...Object.keys(softDeleteQueries[model] ?? {}),
      ...Object.keys(monitorQueries[model] ?? {}),
    ])
    for (const op of allOps) {
      const monitorFn = monitorQueries[model]?.[op]
      const softDeleteFn = softDeleteQueries[model]?.[op]

      if (monitorFn && softDeleteFn) {
        // Monitor wraps soft-delete
        mergedQueries[model][op] = async ({ args, query }: QueryArgs) => {
          return monitorFn({
            args,
            query: async (innerArgs: Record<string, unknown>) => softDeleteFn({ args: innerArgs, query }),
          })
        }
      } else if (monitorFn) {
        mergedQueries[model][op] = monitorFn
      } else if (softDeleteFn) {
        mergedQueries[model][op] = softDeleteFn
      }
    }
  }

  return base.$extends({
    name: "soft-delete+monitor",
    query: mergedQueries as unknown as PrismaQueryExtension,
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db
