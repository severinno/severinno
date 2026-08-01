import { PrismaClient, Prisma } from "@prisma/client"
import { SOFT_DELETE_MODELS } from "./soft-delete"

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
// findUnique / findUniqueOrThrow are excluded because Prisma does not allow
// non-unique fields (like deletedAt) in their `where` — those ops use unique
// constraints and would throw "Unknown arg `deletedAt`" at runtime.
const READ_OPS = ["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy"]

/**
 * Build per-model query extensions for soft-delete.
 *
 * Prisma v6 removed `$use`. Using `$extends` instead:
 *   - READ ops: add `deletedAt: null` to WHERE (unless caller explicitly queries deletedAt)
 *   - DELETE ops: throw a clear error guiding devs to use `update()` with `deletedAt`
 */
function buildSoftDeleteQueries() {
  const queries: Record<string, Record<string, (opts: QueryArgs) => Promise<unknown>>> = {}

  for (const model of SOFT_DELETE_MODEL_KEYS) {
    queries[model] = {}
    const modelName = model.charAt(0).toUpperCase() + model.slice(1)

    // Read operations: auto-filter deleted rows
    for (const op of READ_OPS) {
      queries[model][op] = async ({ args, query }: QueryArgs) => {
        if (!(args.where as Record<string, unknown> | undefined)?.deletedAt) {
          args.where = { ...((args.where as Record<string, unknown>) ?? {}), deletedAt: null }
        }
        return query(args)
      }
    }

    // Block hard-delete with helpful message
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

/** Extended client type — compatible with `PrismaClient` in usage */
type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>

function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  })

  // Prisma's $extends query option is a per-model operation map. The outer
  // extension object stays inline so $extends keeps its contextual typing
  // (preserving the full PrismaClient model delegates); only the interceptor
  // map is cast to the exact type Prisma expects.
  return base.$extends({
    name: "soft-delete",
    query: buildSoftDeleteQueries() as unknown as PrismaQueryExtension,
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db
