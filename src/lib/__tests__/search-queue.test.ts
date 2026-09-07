import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  enqueueSearchSync,
  processSearchSyncQueue,
  getSearchQueueStats,
  clearSearchQueue,
} from "../search-queue"

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe("SearchQueue (Outbox / Resilient OpenSearch Sync)", () => {
  beforeEach(() => {
    clearSearchQueue()
    vi.clearAllMocks()
  })

  it("enqueues jobs and tracks initial queue stats", () => {
    const job = enqueueSearchSync("index", "severinno-providers", "prov-123", {
      name: "Severino Silva",
    })

    expect(job.id).toBeDefined()
    expect(job.docId).toBe("prov-123")
    expect(job.action).toBe("index")
    expect(job.retries).toBe(0)

    const stats = getSearchQueueStats()
    expect(stats.pendingCount).toBe(1)
    expect(stats.dlqCount).toBe(0)
  })

  it("deduplicates multiple jobs for the same docId and index", () => {
    enqueueSearchSync("index", "severinno-providers", "prov-123", { name: "Version 1" })
    enqueueSearchSync("index", "severinno-providers", "prov-123", { name: "Version 2" })

    const stats = getSearchQueueStats()
    expect(stats.pendingCount).toBe(1)
  })

  it("processes jobs successfully through executor", async () => {
    enqueueSearchSync("index", "severinno-providers", "prov-1", { name: "Alpha" })
    enqueueSearchSync("index", "severinno-providers", "prov-2", { name: "Beta" })

    const executor = vi.fn().mockResolvedValue(true)
    const result = await processSearchSyncQueue(executor)

    expect(result.processed).toBe(2)
    expect(result.failed).toBe(0)
    expect(executor).toHaveBeenCalledTimes(2)

    const stats = getSearchQueueStats()
    expect(stats.pendingCount).toBe(0)
    expect(stats.processedCount).toBe(2)
  })

  it("retries failed jobs with exponential backoff", async () => {
    enqueueSearchSync(
      "index",
      "severinno-providers",
      "prov-fail",
      { name: "Gamma" },
      { maxRetries: 3 },
    )

    const failingExecutor = vi.fn().mockRejectedValue(new Error("Connection refused"))
    const result = await processSearchSyncQueue(failingExecutor)

    expect(result.processed).toBe(0)
    expect(result.failed).toBe(1)

    const stats = getSearchQueueStats()
    expect(stats.pendingCount).toBe(1)
    expect(stats.dlqCount).toBe(0)
  })

  it("moves job to DLQ after exceeding maxRetries", async () => {
    const job = enqueueSearchSync(
      "index",
      "severinno-providers",
      "prov-dead",
      { name: "Dead Doc" },
      { maxRetries: 2 },
    )

    const failingExecutor = vi.fn().mockRejectedValue(new Error("Cluster offline"))

    // Attempt 1
    await processSearchSyncQueue(failingExecutor)
    // Force next attempt timestamp to now
    job.nextAttemptAt = Date.now() - 10

    // Attempt 2 (reaches maxRetries: 2)
    await processSearchSyncQueue(failingExecutor)

    const stats = getSearchQueueStats()
    expect(stats.pendingCount).toBe(0)
    expect(stats.dlqCount).toBe(1)
    expect(stats.failedCount).toBe(1)
  })
})
