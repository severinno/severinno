/**
 * Redis caching layer for the Severinno Marketplace.
 *
 * Supports both standalone Redis and Redis Cluster mode with automatic
 * three-tier fallback:
 *   Tier 1 — Redis Cluster
 *   Tier 2 — Standalone Redis
 *   Tier 3 — In-memory Map
 */

// Config
export {
  REDIS_URL,
  REDIS_PASSWORD,
  REDIS_TLS,
  REDIS_CLUSTER_MODE,
  REDIS_CLUSTER_NODES,
  configMode,
} from "./config"
export type { Tier } from "./config"

// Memory store
export { memoryStore, startCleanupTimer } from "./memory"
export type { MemoryItem } from "./memory"

// Client management
export {
  clusterClient,
  standaloneClient,
  activeTier,
  everConnected,
  syncState,
  createClient,
  ensureClient,
  getClient,
  ensureConnected,
  isActiveTierMemory,
} from "./client"

// State setters (for health module)
export { setClusterClient, setStandaloneClient, setActiveTier, setEverConnected } from "./state"

// Health & degradation
export {
  degradationCount,
  degradeTier,
  tryRecoverTier,
  startRecheckTimer,
  __testing__degradeTier,
  __testing__tryRecoverTier,
  __testing__resetDegradationState,
} from "./health"

// Degradation state
export { setDegradationCount, incrementDegradationCount } from "./degradation"

// Cache operations
export {
  cacheGet,
  cacheSet,
  cacheInvalidate,
  withCache,
  isRedisAvailable,
  resetCacheCounters,
  getCacheStats,
  getMemoryCacheDiagnostics,
} from "./cache"

// Diagnostics
export { getRedisDiagnostics } from "./diagnostics"
export type { ClusterNodeInfo, SlotRange, RedisDiagnostics } from "./diagnostics"

// Tier info aliases
export { activeTier as currentTier } from "./client"
export { everConnected as hasEverConnected } from "./client"

// Start background timers (safe in Node.js, gracefully skipped in Edge)
import { startCleanupTimer } from "./memory"
import { startRecheckTimer } from "./health"

if (typeof setInterval !== "undefined" && process.env.NEXT_RUNTIME === "nodejs") {
  startCleanupTimer()
  startRecheckTimer()
}
