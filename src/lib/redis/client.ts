/**
 * Redis client management — creation, connection, and tier state.
 */

import { Redis, Cluster } from "ioredis"
import logger from "@/lib/logger"
import { REDIS_URL, REDIS_PASSWORD, REDIS_TLS, REDIS_CLUSTER_NODES, type Tier } from "./config"
import {
  clusterClient,
  standaloneClient,
  activeTier,
  everConnected,
  syncState,
  setClusterClient,
  setStandaloneClient,
  setActiveTier,
  setEverConnected,
} from "./state"
import { degradeTier } from "./health"

// Re-export state for external consumers
export { clusterClient, standaloneClient, activeTier, everConnected, syncState }

// ── Client factory ─────────────────────────────────────────────────────────

export function createClient(mode: "cluster" | "standalone"): Cluster | Redis {
  if (mode === "cluster") {
    const nodes = REDIS_CLUSTER_NODES.split(",").map((s) => {
      const [host, portStr] = s.trim().split(":")
      return { host: host || "localhost", port: Number(portStr) || 6379 }
    })

    return new Cluster(nodes, {
      clusterRetryStrategy(times) {
        if (times > 5) return null
        return Math.min(times * 200, 2000)
      },
      enableOfflineQueue: true,
      scaleReads: "master",
      redisOptions: {
        password: REDIS_PASSWORD,
        tls: REDIS_TLS ? { rejectUnauthorized: process.env.NODE_ENV === "production" } : undefined,
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        connectTimeout: 10_000,
      },
    })
  }

  return new Redis(REDIS_URL, {
    password: REDIS_PASSWORD,
    tls: REDIS_TLS ? { rejectUnauthorized: process.env.NODE_ENV === "production" } : undefined,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null
      return Math.min(times * 200, 2000)
    },
    lazyConnect: true,
    enableOfflineQueue: false,
  })
}

// ── Ensure a client exists for the given tier ─────────────────────────────

const connectingLocks: Record<string, boolean> = {}

export async function ensureClient(tier: Tier): Promise<Cluster | Redis | null> {
  if (tier === "memory") return null

  if (tier === "cluster") {
    if (clusterClient) return clusterClient
    if (connectingLocks["cluster"]) return clusterClient
    connectingLocks["cluster"] = true

    try {
      const client = createClient("cluster") as Cluster

      client.on("error", (err: Error) => {
        logger.error({ err }, "[redis] cluster error")
        degradeTier("cluster")
      })
      client.on("ready", () => {
        setActiveTier("cluster")
        setEverConnected(true)
      })
      client.on("node error", (err: Error, node: unknown) => {
        logger.warn({ err, node: JSON.stringify(node) }, "[redis] cluster node error")
      })
      client.on("+node", (node: unknown) => {
        logger.info({ node: JSON.stringify(node) }, "[redis] cluster node added")
      })
      client.on("-node", (node: unknown) => {
        logger.warn({ node: JSON.stringify(node) }, "[redis] cluster node removed")
      })

      if (typeof client.connect === "function") {
        await client.connect()
      }
      setClusterClient(client)
      return client
    } catch (err) {
      logger.warn({ err }, "[redis] cluster connect failed on creation")
      setClusterClient(null)
      return null
    } finally {
      connectingLocks["cluster"] = false
    }
  }

  if (standaloneClient) return standaloneClient
  if (connectingLocks["standalone"]) return standaloneClient
  connectingLocks["standalone"] = true

  try {
    const client = createClient("standalone") as Redis

    client.on("error", (err: Error) => {
      logger.error({ err }, "[redis] standalone error")
      degradeTier("standalone")
    })
    client.on("ready", () => {
      setActiveTier("standalone")
      setEverConnected(true)
    })

    if (typeof client.connect === "function") {
      await client.connect()
    }
    setStandaloneClient(client)
    return client
  } catch (err) {
    logger.warn({ err }, "[redis] standalone connect failed on creation")
    setStandaloneClient(null)
    return null
  } finally {
    connectingLocks["standalone"] = false
  }
}

// ── Getters ─────────────────────────────────────────────────────────────

export function getClient(): Redis | Cluster | null {
  if (activeTier === "memory") return null
  if (activeTier === "cluster") return clusterClient
  return standaloneClient
}

export async function ensureConnected(): Promise<Redis | Cluster | null> {
  if (activeTier === "memory") return null
  return ensureClient(activeTier as "cluster" | "standalone")
}

export function isActiveTierMemory(): boolean {
  return activeTier === "memory"
}
