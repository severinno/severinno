/**
 * db-replica.ts
 *
 * Read replica database connection for the Severinno Marketplace.
 *
 * Strategy:
 *   - Primary (db.ts): All writes, transactions, and critical reads
 *   - Replica (db-replica.ts): Heavy read queries (listings, searches, dashboards)
 *
 * The replica connection is optional — if REPLICATE_DATABASE_URL is not set,
 * all queries fall back to the primary database.
 *
 * Usage:
 *   import { dbRead } from "@/lib/db-replica"
 *
 *   // Use for read-heavy queries
 *   const providers = await dbRead.user.findMany({ where: { role: "PROVIDER" } })
 *
 *   // Use primary for writes
 *   import { db } from "@/lib/db"
 *   await db.user.create({ data: { ... } })
 */

import { PrismaClient } from "@prisma/client"

// ── Configuration ──────────────────────────────────────────────────────────

const REPLICA_URL = process.env.REPLICATE_DATABASE_URL

// ── Replica Client ─────────────────────────────────────────────────────────

let replicaClient: PrismaClient | null = null

/**
 * Get the read replica client.
 * Returns primary client if no replica URL is configured.
 */
function getReplicaClient(): PrismaClient {
  // If no replica URL, return the primary client (imported lazily)
  if (!REPLICA_URL) {
    // Lazy dynamic import to avoid circular dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { db } = require("./db") as { db: PrismaClient }
    return db
  }

  if (!replicaClient) {
    replicaClient = new PrismaClient({
      datasources: {
        db: {
          url: REPLICA_URL,
        },
      },
      log: process.env.NODE_ENV === "development" ? ["error"] : [],
    })
  }

  return replicaClient
}

// ── Export ─────────────────────────────────────────────────────────────────

/**
 * Read-optimized database client.
 *
 * Uses read replica when REPLICATE_DATABASE_URL is set.
 * Falls back to primary database when replica is not available.
 *
 * @example
 * ```ts
 * // Heavy read query (uses replica)
 * const providers = await dbRead.user.findMany({
 *   where: { role: "PROVIDER", active: true },
 *   include: { services: true },
 * })
 *
 * // Write query (must use primary)
 * import { db } from "@/lib/db"
 * await db.user.update({ where: { id }, data: { name: "New" } })
 * ```
 */
export const dbRead = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getReplicaClient()
    const value = (client as unknown as Record<string | symbol, unknown>)[prop]

    if (typeof value === "function") {
      return value.bind(client)
    }

    return value
  },
})

// ── Health check ──────────────────────────────────────────────────────────

/**
 * Check if the read replica is available.
 */
export async function checkReplicaHealth(): Promise<{
  available: boolean
  url: string | null
  latencyMs: number | null
}> {
  if (!REPLICA_URL) {
    return { available: false, url: null, latencyMs: null }
  }

  try {
    const start = performance.now()
    const client = getReplicaClient()
    await client.$queryRaw`SELECT 1`
    const latencyMs = Math.round(performance.now() - start)

    return {
      available: true,
      url: REPLICA_URL.replace(/\/\/.*@/, "//***@"), // Mask credentials
      latencyMs,
    }
  } catch {
    return {
      available: false,
      url: REPLICA_URL.replace(/\/\/.*@/, "//***@"),
      latencyMs: null,
    }
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────

/**
 * Disconnect the replica client.
 * Call on process shutdown.
 */
export async function disconnectReplica(): Promise<void> {
  if (replicaClient) {
    await replicaClient.$disconnect()
    replicaClient = null
  }
}
