/**
 * Redis health checks — degradation, recovery, and periodic monitoring.
 */

import { captureMessage } from "@/lib/sentry"
import logger from "@/lib/logger"
import { type Tier, configMode } from "./config"
import {
  clusterClient,
  standaloneClient,
  activeTier,
  syncState,
  setActiveTier,
  setClusterClient,
  setStandaloneClient,
  setEverConnected,
} from "./state"
import { createClient, ensureClient } from "./client"
import { degradationCount, incrementDegradationCount, setDegradationCount } from "./degradation"

// Re-export for external consumers
export { degradationCount } from "./degradation"
let lastDegradationAlertAt: number | null = null
let lastProactiveRecoveryAt: number | null = null

const DEGRADATION_ALERT_DEBOUNCE_MS = 15 * 60 * 1000
const PROACTIVE_RECOVERY_DEBOUNCE_MS = 60 * 60 * 1000

export function degradeTier(failedTier: Tier): void {
  const TIER_ORDER: Tier[] = ["cluster", "standalone", "memory"]
  const failedIdx = TIER_ORDER.indexOf(failedTier)
  if (failedIdx === -1) return

  const activeIdx = TIER_ORDER.indexOf(activeTier)
  if (failedIdx > activeIdx) return

  const nextTier = TIER_ORDER[activeIdx + 1]
  if (!nextTier) return

  incrementDegradationCount()
  logger.warn(
    { degradationCount, failedTier, activeTier, nextTier },
    `[redis] degrading from ${activeTier} to ${nextTier}`,
  )

  if (degradationCount >= 3) {
    const now = Date.now()
    if (
      lastDegradationAlertAt !== null &&
      now - lastDegradationAlertAt < DEGRADATION_ALERT_DEBOUNCE_MS
    ) {
      // Skip — still within debounce window
    } else {
      lastDegradationAlertAt = now
      void captureMessage(
        `[Redis] Múltiplas degradações — ${degradationCount} desde o início`,
        "error",
        {
          degradationCount,
          currentTier: activeTier,
          nextTier,
          failedTier,
          configMode: configMode === "cluster" ? "cluster" : "standalone",
          degradationChain: `${activeTier} → ${nextTier}`,
        },
      )
    }
  }

  if (degradationCount === 5 || (degradationCount > 5 && degradationCount % 10 === 0)) {
    const now = Date.now()
    if (
      lastProactiveRecoveryAt === null ||
      now - lastProactiveRecoveryAt >= PROACTIVE_RECOVERY_DEBOUNCE_MS
    ) {
      lastProactiveRecoveryAt = now
      proactiveRecovery().catch(() => {
        /* fire-and-forget */
      })
    }
  }

  setActiveTier(nextTier)

  if (nextTier !== "memory") {
    ensureClient(nextTier as "cluster" | "standalone")
  }
}

// ── Proactive recovery ───────────────────────────────────────────────────

const SPATIAL_INDEXES = [
  "idx_user_location_gist",
  "idx_booking_location_gist",
  "idx_quoterequest_location_gist",
] as const

async function tryReindexGiST(): Promise<void> {
  try {
    const { db } = await import("@/lib/db")
    for (const name of SPATIAL_INDEXES) {
      try {
        const start = performance.now()
        await db.$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY IF EXISTS "${name}"`)
        logger.info(
          { indexName: name, durationMs: Math.round(performance.now() - start) },
          "[proactive] GiST REINDEX completed",
        )
      } catch (err) {
        logger.warn({ indexName: name, err }, "[proactive] GiST REINDEX failed (non-blocking)")
      }
    }
    void captureMessage("[Redis] Proactive recovery — GiST REINDEX concluído", "info", {
      degradationCount,
    })
  } catch (err) {
    logger.warn({ err }, "[proactive] GiST REINDEX unavailable (Prisma not loaded)")
  }
}

async function restartRedisClients(): Promise<void> {
  if (clusterClient) {
    try {
      clusterClient.disconnect()
    } catch {
      /* ignore */
    }
  }
  if (standaloneClient) {
    try {
      standaloneClient.disconnect()
    } catch {
      /* ignore */
    }
  }

  setClusterClient(null)
  setStandaloneClient(null)
  setActiveTier(configMode)
  ensureClient(configMode)
  syncState()

  logger.info(
    { newTier: configMode, degradationCount },
    "[proactive] Redis clients restarted with clean configuration",
  )

  void captureMessage("[Redis] Proactive recovery — clients reiniciados", "info", {
    degradationCount,
    newTier: configMode,
  })
}

async function proactiveRecovery(): Promise<void> {
  logger.warn({ degradationCount }, "[proactive] Starting proactive recovery")
  await tryReindexGiST()
  await restartRedisClients()
}

// ── Periodic health check + recovery (every 30s) ──────────────────────────

const REDIS_RECHECK_MS = 30_000
let recheckTimer: ReturnType<typeof setInterval> | null = null
let isRecovering = false

export async function tryRecoverTier(): Promise<void> {
  const TIER_ORDER: Tier[] = ["cluster", "standalone", "memory"]
  const activeIdx = TIER_ORDER.indexOf(activeTier)

  if (activeIdx <= 0) return

  for (let i = activeIdx - 1; i >= 0; i--) {
    const targetTier = TIER_ORDER[i]

    if (targetTier === "cluster" && configMode !== "cluster") continue
    if (targetTier === "standalone" && activeTier === "standalone" && activeIdx === 1) continue

    let tempClient: ReturnType<typeof createClient> | null = null
    try {
      tempClient = createClient(targetTier as "cluster" | "standalone")
      tempClient.on("error", () => {})
      await tempClient.ping()

      if (targetTier === "cluster") {
        if (clusterClient && clusterClient !== tempClient) {
          try {
            clusterClient.disconnect()
          } catch {
            /* ignore */
          }
        }
        const newClusterClient = tempClient as import("ioredis").Cluster
        setClusterClient(newClusterClient)
        newClusterClient.on("error", (err: Error) => {
          logger.error({ err }, "[redis] cluster error")
          degradeTier("cluster")
        })
        newClusterClient.on("ready", () => {
          setActiveTier("cluster")
          setEverConnected(true)
        })
        newClusterClient.on("node error", (err: Error, node: unknown) => {
          logger.warn({ err, node: JSON.stringify(node) }, "[redis] cluster node error")
        })
        newClusterClient.on("+node", (node: unknown) => {
          logger.info({ node: JSON.stringify(node) }, "[redis] cluster node added")
        })
        newClusterClient.on("-node", (node: unknown) => {
          logger.warn({ node: JSON.stringify(node) }, "[redis] cluster node removed")
        })
      } else if (targetTier === "standalone") {
        if (standaloneClient && standaloneClient !== tempClient) {
          try {
            standaloneClient.disconnect()
          } catch {
            /* ignore */
          }
        }
        const newStandaloneClient = tempClient as import("ioredis").Redis
        setStandaloneClient(newStandaloneClient)
        newStandaloneClient.on("error", (err: Error) => {
          logger.error({ err }, "[redis] standalone error")
          degradeTier("standalone")
        })
        newStandaloneClient.on("ready", () => {
          setActiveTier("standalone")
          setEverConnected(true)
        })
      }

      setActiveTier(targetTier)
      setEverConnected(true)
      logger.info({ targetTier }, "[redis] recovered tier")

      if (targetTier === "standalone" && configMode === "cluster") {
        return
      }

      return
    } catch {
      if (tempClient) {
        try {
          tempClient.disconnect()
        } catch {
          /* ignore */
        }
      }
      continue
    }
  }
}

async function checkRedis(): Promise<void> {
  if (isRecovering) return
  isRecovering = true

  try {
    if (activeTier === "cluster") return
    await tryRecoverTier()
    if (activeTier === "standalone" && configMode === "cluster") {
      await tryRecoverTier()
    }
  } finally {
    isRecovering = false
  }
}

export function startRecheckTimer(): void {
  if (recheckTimer) return
  recheckTimer = setInterval(async () => {
    await checkRedis()
  }, REDIS_RECHECK_MS)
  if (typeof recheckTimer?.unref === "function") {
    recheckTimer.unref()
  }
}

// ── Testing exports ─────────────────────────────────────────────────────

export { degradeTier as __testing__degradeTier, tryRecoverTier as __testing__tryRecoverTier }

export function __testing__resetDegradationState(): void {
  setActiveTier(configMode)
  setDegradationCount(0)
  lastDegradationAlertAt = null
  lastProactiveRecoveryAt = null
  setEverConnected(false)
}
