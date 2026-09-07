/**
 * Redis diagnostics — cluster/standalone health for admin dashboard.
 */

import { Redis, Cluster } from "ioredis"
import { REDIS_CLUSTER_MODE, type Tier } from "./config"
import { activeTier, ensureConnected } from "./client"
import { degradationCount } from "./health"
import { memoryStore } from "./memory"
import { getCacheStats } from "./cache"

export type ClusterNodeInfo = {
  host: string
  port: number
  dbSize: number
  reachable: boolean
  sampleKeys: string[]
}

export type SlotRange = {
  start: number
  end: number
  node: { host: string; port: number }
}

export type RedisDiagnostics = {
  available: boolean | null
  clusterMode: boolean
  activeTier: Tier
  degradationCount: number
  clusterNodes: ClusterNodeInfo[]
  slotDistribution: SlotRange[]
  standalone: {
    dbSize: number
    sampleKeys: string[]
  } | null
  hitRatio: number | null
  hits: number
  misses: number
  memoryStoreSize: number
  timestamp: number
}

export async function getRedisDiagnostics(): Promise<RedisDiagnostics> {
  const timestamp = Date.now()
  const stats = getCacheStats()

  const base: Omit<RedisDiagnostics, "clusterNodes" | "slotDistribution" | "standalone"> = {
    available: activeTier !== "memory",
    clusterMode: REDIS_CLUSTER_MODE,
    activeTier,
    degradationCount,
    hitRatio: stats.hitRatio,
    hits: stats.hits,
    misses: stats.misses,
    memoryStoreSize: memoryStore.size,
    timestamp,
  }

  if (activeTier === "memory") {
    return {
      ...base,
      available: false,
      clusterNodes: [],
      slotDistribution: [],
      standalone: null,
    }
  }

  const c = await ensureConnected()
  if (!c) {
    return {
      ...base,
      available: false,
      clusterNodes: [],
      slotDistribution: [],
      standalone: null,
    }
  }

  if (activeTier === "cluster" && c instanceof Cluster) {
    let clusterNodes: ClusterNodeInfo[] = []
    let slotDistribution: SlotRange[] = []

    try {
      const rawSlots = (await c.cluster("SLOTS")) as unknown as Array<
        [number, number, [string, number, string], ...[string, number, string][]]
      >
      slotDistribution = rawSlots.map(([start, end, master]) => ({
        start,
        end,
        node: {
          host: master[0],
          port: master[1],
        },
      }))
    } catch {
      // Slot info may not be available if cluster is degraded
    }

    try {
      const masters = c.nodes("master")
      const nodeInfos = await Promise.all(
        masters.map(async (node) => {
          const addr = node.options
          const host = (addr as { host?: string; port?: number }).host ?? "unknown"
          const port = (addr as { host?: string; port?: number }).port ?? 6379

          let dbSize = 0
          let sampleKeys: string[] = []
          let reachable = false

          try {
            await node.ping()
            reachable = true

            try {
              dbSize = Number(await node.dbsize()) || 0
            } catch {
              /* ignore */
            }

            try {
              const keys: string[] = []
              let cursor = 0
              do {
                const [nextCursor, batch] = await node.scan(cursor, "COUNT", "50")
                cursor = Number(nextCursor)
                for (const k of batch) {
                  if (!keys.includes(k)) keys.push(k)
                  if (keys.length >= 20) break
                }
              } while (cursor !== 0 && keys.length < 20)
              sampleKeys = keys
            } catch {
              /* SCAN may fail */
            }
          } catch {
            /* Node unreachable */
          }

          return { host, port, dbSize, reachable, sampleKeys }
        }),
      )
      clusterNodes = nodeInfos
    } catch {
      /* Nodes info may not be available */
    }

    return {
      ...base,
      available: true,
      clusterNodes,
      slotDistribution,
      standalone: null,
    }
  }

  try {
    const dbSize = Number(await (c as Redis).dbsize()) || 0
    let sampleKeys: string[] = []
    try {
      const keys = await (c as Redis).keys("*")
      sampleKeys = keys.slice(0, 100)
    } catch {
      /* KEYS may fail on large datasets */
    }

    return {
      ...base,
      standalone: { dbSize, sampleKeys },
      clusterNodes: [],
      slotDistribution: [],
    }
  } catch {
    return {
      ...base,
      available: false,
      standalone: { dbSize: 0, sampleKeys: [] },
      clusterNodes: [],
      slotDistribution: [],
    }
  }
}
