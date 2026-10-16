import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  enqueueOfflineEvidence,
  getPendingOfflineEvidence,
  getOfflineQueueSummary,
  processOfflineEvidenceBatch,
  clearOfflineEvidenceQueue,
} from "../pwa-offline-sync-queue"

describe("pwa-offline-sync-queue", () => {
  beforeEach(() => {
    clearOfflineEvidenceQueue()
  })

  it("enfileira evidência fotográfica offline e calcula digest SHA-256", () => {
    const rawPhotoBase64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP..."

    const item = enqueueOfflineEvidence({
      bookingId: "booking-gv-55",
      providerId: "prov-123",
      type: "BEFORE_PHOTO",
      latitude: -18.8542,
      longitude: -41.9511,
      accuracy: 8,
      photoBase64: rawPhotoBase64,
      notes: "Foto do quadro elétrico antes do reparo",
    })

    expect(item.id).toMatch(/^off_/)
    expect(item.status).toBe("PENDING")
    expect(item.photoDigestSha256).toHaveLength(64) // SHA-256
    expect(item.notes).toContain("quadro elétrico")

    const pending = getPendingOfflineEvidence()
    expect(pending).toHaveLength(1)
  })

  it("calcula o resumo de status da fila offline para exibição no PWA", () => {
    enqueueOfflineEvidence({
      bookingId: "b-1",
      providerId: "p-1",
      type: "CHECKIN",
      latitude: -18.85,
      longitude: -41.95,
    })

    enqueueOfflineEvidence({
      bookingId: "b-1",
      providerId: "p-1",
      type: "BEFORE_PHOTO",
      photoBase64: "dummyphoto1",
    })

    enqueueOfflineEvidence({
      bookingId: "b-1",
      providerId: "p-1",
      type: "AFTER_PHOTO",
      photoBase64: "dummyphoto2",
    })

    const summary = getOfflineQueueSummary()
    expect(summary.totalPending).toBe(3)
    expect(summary.checkinsPending).toBe(1)
    expect(summary.photosPending).toBe(2)
    expect(summary.hasFailures).toBe(false)
  })

  it("processa a sincronização em lote com sucesso e esvazia a fila", async () => {
    enqueueOfflineEvidence({
      bookingId: "b-1",
      providerId: "p-1",
      type: "CHECKIN",
    })

    const mockSyncExecutor = vi.fn(async () => true)

    const result = await processOfflineEvidenceBatch(mockSyncExecutor)

    expect(result.processed).toBe(1)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.remainingPending).toBe(0)
    expect(mockSyncExecutor).toHaveBeenCalledTimes(1)
  })

  it("marca como FAILED quando as tentativas atingem maxAttempts", async () => {
    enqueueOfflineEvidence({
      bookingId: "b-error",
      providerId: "p-1",
      type: "AFTER_PHOTO",
      maxAttempts: 1,
    })

    const failingExecutor = vi.fn(async () => false)

    const result = await processOfflineEvidenceBatch(failingExecutor)
    expect(result.failed).toBe(1)
    expect(result.remainingPending).toBe(1)

    const summary = getOfflineQueueSummary()
    expect(summary.hasFailures).toBe(true)
  })
})
