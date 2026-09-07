/**
 * search-queue.ts
 *
 * Resilient Outbox & In-Memory Queue for OpenSearch synchronization.
 *
 * Provides guaranteed eventual consistency between database mutations and
 * OpenSearch indices. When OpenSearch is unreachable or under heavy load,
 * operations are queued with exponential backoff retries rather than dropped.
 */

import logger from "./logger"

export type SearchSyncAction = "index" | "delete"

export interface SearchSyncJob {
  id: string
  action: SearchSyncAction
  index: string
  docId: string
  body?: Record<string, unknown>
  retries: number
  maxRetries: number
  nextAttemptAt: number
  createdAt: number
  lastError?: string
}

export interface SearchQueueStats {
  pendingCount: number
  dlqCount: number
  processedCount: number
  failedCount: number
}

const DEFAULT_MAX_RETRIES = 5
const INITIAL_BACKOFF_MS = 1000 // 1s
const MAX_BACKOFF_MS = 60_000 // 1m

declare const globalThis: {
  __searchSyncQueue?: {
    pending: SearchSyncJob[]
    dlq: SearchSyncJob[]
    processedCount: number
    failedCount: number
  }
}

function getQueueStore() {
  if (!globalThis.__searchSyncQueue) {
    globalThis.__searchSyncQueue = {
      pending: [],
      dlq: [],
      processedCount: 0,
      failedCount: 0,
    }
  }
  return globalThis.__searchSyncQueue
}

/**
 * Enqueue an OpenSearch document synchronization job.
 */
export function enqueueSearchSync(
  action: SearchSyncAction,
  index: string,
  docId: string,
  body?: Record<string, unknown>,
  options?: { maxRetries?: number; delayMs?: number },
): SearchSyncJob {
  const store = getQueueStore()
  const now = Date.now()
  const delayMs = options?.delayMs ?? 0

  const job: SearchSyncJob = {
    id: `search_job_${now}_${Math.random().toString(36).slice(2, 9)}`,
    action,
    index,
    docId,
    body,
    retries: 0,
    maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
    nextAttemptAt: now + delayMs,
    createdAt: now,
  }

  // Deduplicate existing pending job for same index + docId
  const existingIdx = store.pending.findIndex(
    (j) => j.index === index && j.docId === docId && j.action === action,
  )
  if (existingIdx >= 0) {
    store.pending[existingIdx] = job
  } else {
    store.pending.push(job)
  }

  logger.info({ jobId: job.id, action, index, docId }, "Enqueued OpenSearch sync job")
  return job
}

/**
 * Process pending synchronization jobs.
 *
 * @param executor - Async executor receiving the job (typically calling searchModule.indexDocument or deleteDocument)
 * @param maxBatchSize - Maximum jobs to process in this run
 */
export async function processSearchSyncQueue(
  executor: (job: SearchSyncJob) => Promise<boolean>,
  maxBatchSize = 50,
): Promise<{ processed: number; failed: number }> {
  const store = getQueueStore()
  const now = Date.now()

  // Select jobs due for processing
  const readyIndices: number[] = []
  for (let i = 0; i < store.pending.length && readyIndices.length < maxBatchSize; i++) {
    if (store.pending[i].nextAttemptAt <= now) {
      readyIndices.push(i)
    }
  }

  if (readyIndices.length === 0) {
    return { processed: 0, failed: 0 }
  }

  let processed = 0
  let failed = 0

  // Process in reverse index order so removals do not shift lower indices
  for (let i = readyIndices.length - 1; i >= 0; i--) {
    const jobIdx = readyIndices[i]
    const job = store.pending[jobIdx]

    try {
      const success = await executor(job)
      if (success) {
        store.pending.splice(jobIdx, 1)
        store.processedCount++
        processed++
      } else {
        throw new Error("Executor returned false")
      }
    } catch (err) {
      job.retries++
      job.lastError = err instanceof Error ? err.message : String(err)
      failed++

      if (job.retries >= job.maxRetries) {
        // Move to Dead Letter Queue
        store.pending.splice(jobIdx, 1)
        store.dlq.push(job)
        store.failedCount++
        logger.error(
          { jobId: job.id, index: job.index, docId: job.docId, error: job.lastError },
          "OpenSearch sync job exceeded max retries, moved to DLQ",
        )
      } else {
        // Exponential backoff with jitter
        const backoff = Math.min(
          INITIAL_BACKOFF_MS * Math.pow(2, job.retries - 1) + Math.random() * 500,
          MAX_BACKOFF_MS,
        )
        job.nextAttemptAt = Date.now() + backoff
        logger.warn(
          {
            jobId: job.id,
            retry: job.retries,
            maxRetries: job.maxRetries,
            nextAttemptInMs: backoff,
            error: job.lastError,
          },
          "OpenSearch sync job failed, scheduled for retry",
        )
      }
    }
  }

  return { processed, failed }
}

/**
 * Get current queue statistics.
 */
export function getSearchQueueStats(): SearchQueueStats {
  const store = getQueueStore()
  return {
    pendingCount: store.pending.length,
    dlqCount: store.dlq.length,
    processedCount: store.processedCount,
    failedCount: store.failedCount,
  }
}

/**
 * Clear all queue jobs and statistics (used in test setup and maintenance).
 */
export function clearSearchQueue(): void {
  const store = getQueueStore()
  store.pending = []
  store.dlq = []
  store.processedCount = 0
  store.failedCount = 0
}
