/**
 * In-memory fallback store — always available, process-local.
 */

export interface MemoryItem {
  value: string
  expiresAt: number | null
}

export const memoryStore = new Map<string, MemoryItem>()

const MEMORY_CLEANUP_MS = 60_000
let cleanupTimer: ReturnType<typeof setInterval> | null = null

export function startCleanupTimer(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, item] of memoryStore) {
      if (item.expiresAt !== null && item.expiresAt < now) {
        memoryStore.delete(key)
      }
    }
  }, MEMORY_CLEANUP_MS)
  if (typeof cleanupTimer?.unref === "function") {
    cleanupTimer.unref()
  }
}
