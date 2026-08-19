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
  "CHECKIN" | "STATUS_UPDATE" | "SEND_MESSAGE" | "UPLOAD_PHOTO" | "COMPLETE_JOB" | "GENERATE_PIN"

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
  action: SyncActionType,
  entityId: string,
  payload: T,
  maxAttempts: number = 5,
): QueuedMutation<T> {
  const mutation: QueuedMutation<T> = {
    id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action,
    entityId,
    payload,
    createdAt: Date.now(),
    attempts: 0,
    maxAttempts,
    status: "PENDING",
  }

  memoryQueue.push(mutation as QueuedMutation)
  saveOfflineQueue()
  return mutation
}

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
