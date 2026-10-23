/**
 * offline-sync.ts — Offline-First & Background Sync Queue Engine
 *
 * Enables field service providers to operate smoothly in underground garages,
 * rural areas, or low-connectivity zones. Queues actions (check-ins, status changes,
 * chat messages, photos) locally and replays them atomically upon reconnection.
 *
 * 100% Pure TypeScript — Zero paid sync service dependencies (Firebase/Amplify).
 */

export type SyncActionType =
  | "CHECKIN"
  | "STATUS_UPDATE"
  | "SEND_MESSAGE"
  | "UPLOAD_PHOTO"
  | "COMPLETE_JOB"
  | "GENERATE_PIN"
  | "REQUEST_QUOTE"
  | "ADD_REVIEW"
  | "EMERGENCY_SOS"

export interface CacheEntry<T> {
  data: T
  cachedAt: number
  expiresAt: number
}

export interface QueuedMutation<T = Record<string, unknown>> {
  id: string
  action: SyncActionType
  entityId: string
  payload: T
  createdAt: number
  attempts: number
  maxAttempts: number
  status: "PENDING" | "SYNCING" | "COMPLETED" | "FAILED"
  lastError?: string
}

export interface SyncProcessResult {
  processed: number
  succeeded: number
  failed: number
  remaining: number
  errors: Array<{ id: string; error: string }>
}

// In-Memory queue store (backed by LocalStorage/IndexedDB when in browser)
let memoryQueue: QueuedMutation[] = []
const STORAGE_KEY = "severinno_offline_sync_queue_v1"

/**
 * Loads pending mutations from persistent storage
 */
export function loadOfflineQueue(): QueuedMutation[] {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        memoryQueue = JSON.parse(stored)
      }
    } catch {
      // Fallback to in-memory
    }
  }
  return memoryQueue
}

/**
 * Persists current queue to storage
 */
function saveOfflineQueue(): void {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryQueue))
    } catch {
      // Ignore storage quota errors in memory
    }
  }
}

/**
 * Enqueues a new mutation to be processed when online
 */
export function enqueueOfflineMutation<T extends Record<string, unknown>>(
  actionOrOpts:
    SyncActionType | { action: SyncActionType; entityId: string; payload: T; maxAttempts?: number },
  entityId?: string,
  payload?: T,
  maxAttempts: number = 5,
): QueuedMutation<T> {
  let action: SyncActionType
  let entId: string
  let pl: T
  let maxAtt: number

  if (typeof actionOrOpts === "object" && actionOrOpts !== null) {
    action = actionOrOpts.action
    entId = actionOrOpts.entityId
    pl = actionOrOpts.payload
    maxAtt = actionOrOpts.maxAttempts ?? 5
  } else {
    action = actionOrOpts
    entId = entityId!
    pl = payload!
    maxAtt = maxAttempts
  }

  const mutation: QueuedMutation<T> = {
    id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action,
    entityId: entId,
    payload: pl,
    createdAt: Date.now(),
    attempts: 0,
    maxAttempts: maxAtt,
    status: "PENDING",
  }

  memoryQueue.push(mutation as QueuedMutation)
  saveOfflineQueue()
  if (typeof window !== "undefined") {
    registerBackgroundSync("sync-offline-actions").catch(() => {})
  }
  return mutation
}

export const queueMutation = enqueueOfflineMutation

/**
 * Returns all pending mutations sorted by creation timestamp
 */
export function getPendingMutations(): QueuedMutation[] {
  return memoryQueue
    .filter((m) => m.status === "PENDING" || m.status === "FAILED")
    .sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * Processes the queue with a provided handler executor function
 */
export async function processSyncQueue(
  executor: (mutation: QueuedMutation) => Promise<boolean>,
): Promise<SyncProcessResult> {
  const pending = getPendingMutations()
  let succeeded = 0
  let failed = 0
  const errors: Array<{ id: string; error: string }> = []

  for (const mutation of pending) {
    mutation.status = "SYNCING"
    mutation.attempts += 1

    try {
      const success = await executor(mutation)
      if (success) {
        mutation.status = "COMPLETED"
        succeeded += 1
      } else {
        mutation.status = mutation.attempts >= mutation.maxAttempts ? "FAILED" : "PENDING"
        mutation.lastError = "Executor returned false"
        failed += 1
        errors.push({ id: mutation.id, error: "Executor returned false" })
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown sync error"
      mutation.status = mutation.attempts >= mutation.maxAttempts ? "FAILED" : "PENDING"
      mutation.lastError = errorMsg
      failed += 1
      errors.push({ id: mutation.id, error: errorMsg })
    }
  }

  // Remove completed mutations
  memoryQueue = memoryQueue.filter((m) => m.status !== "COMPLETED")
  saveOfflineQueue()

  return {
    processed: pending.length,
    succeeded,
    failed,
    remaining: memoryQueue.length,
    errors,
  }
}

/**
 * Clears the entire offline queue (useful for testing or full resets)
 */
export function clearOfflineQueue(): void {
  memoryQueue = []
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.removeItem(STORAGE_KEY)
  }
}

/**
 * Stores arbitrary item in local cache with TTL
 */
export function cacheItemLocally<T>(
  key: string,
  data: T,
  ttlMs: number = 24 * 60 * 60 * 1000,
): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    const entry: CacheEntry<T> = {
      data,
      cachedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    }
    localStorage.setItem(`severinno_cache_${key}`, JSON.stringify(entry))
  } catch {
    // Ignore storage quota limits
  }
}

/**
 * Retrieves cached item if not expired
 */
export function getCachedItem<T>(key: string): T | null {
  if (typeof window === "undefined" || !window.localStorage) return null
  try {
    const raw = localStorage.getItem(`severinno_cache_${key}`)
    if (!raw) return null
    const entry: CacheEntry<T> = JSON.parse(raw)
    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(`severinno_cache_${key}`)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

/**
 * Caches public provider profile for offline viewing (48h TTL)
 */
export function cacheProviderProfileLocally(slug: string, profile: unknown): void {
  cacheItemLocally(`provider_profile_${slug}`, profile, 48 * 60 * 60 * 1000)
}

/**
 * Gets cached public provider profile
 */
export function getCachedProviderProfile<T = unknown>(slug: string): T | null {
  return getCachedItem<T>(`provider_profile_${slug}`)
}

/**
 * Caches user bookings for offline consultation (12h TTL)
 */
export function cacheBookingsLocally(userId: string, bookings: unknown[]): void {
  cacheItemLocally(`user_bookings_${userId}`, bookings, 12 * 60 * 60 * 1000)
}

/**
 * Gets cached bookings
 */
export function getCachedBookings<T = unknown[]>(userId: string): T | null {
  return getCachedItem<T>(`user_bookings_${userId}`)
}

/**
 * Checks current browser online connectivity
 */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true
  return navigator.onLine ?? true
}

/**
 * Registers background sync with Service Worker (SyncManager) or sets an online event fallback
 */
export async function registerBackgroundSync(
  tag: string = "sync-offline-actions",
): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return false
  }

  try {
    const reg = await navigator.serviceWorker.ready
    const syncManager = (reg as unknown as { sync?: { register: (t: string) => Promise<void> } })
      .sync
    if (syncManager && typeof syncManager.register === "function") {
      await syncManager.register(tag)
      return true
    }
  } catch {
    // Background Sync may be restricted by permissions or browser policy
  }

  // Fallback: listen to window "online" event to auto-flush
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener(
      "online",
      () => {
        window.dispatchEvent(new CustomEvent("severinno:trigger-offline-sync"))
      },
      { once: true },
    )
  }

  return false
}

/**
 * Enqueues an outgoing network request directly into the Service Worker sync cache (severinno-sync-v1)
 */
export async function queueBackgroundSyncRequest(
  url: string,
  body: Record<string, unknown>,
  method: string = "POST",
): Promise<boolean> {
  if (typeof window === "undefined") return false

  try {
    if ("caches" in window) {
      const cache = await window.caches.open("severinno-sync-v1")
      const syncId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const requestUrl = url.includes("?")
        ? `${url}&_offline_sync_id=${syncId}`
        : `${url}?_offline_sync_id=${syncId}`

      const req = new Request(requestUrl, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      await cache.put(req, new Response(JSON.stringify({ status: "queued", syncId })))
    }

    await registerBackgroundSync("sync-offline-actions")
    return true
  } catch {
    return false
  }
}
