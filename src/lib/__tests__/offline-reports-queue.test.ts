import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  enqueueOfflineReport,
  getPendingOfflineReports,
  getPendingOfflineReportsCount,
  removeOfflineReport,
  syncOfflineReports,
  type OfflineReportData,
} from "../offline-reports-queue"

describe("offline-reports-queue", () => {
  const sampleReport: OfflineReportData = {
    bookingId: "booking-offline-1",
    serviceTitle: "Reparo Hidráulico",
    clientName: "Maria Silva",
    beforePhotos: ["data:image/jpeg;base64,before123"],
    afterPhotos: ["data:image/jpeg;base64,after123"],
    completionNote: "Troca de vedação e pressurização concluída.",
    checklist: [
      { id: "1", label: "Registro desligado", checked: true, required: true },
      { id: "2", label: "Teste de estanqueidade", checked: true, required: true },
    ],
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.clear()
    }
  })

  it("enqueues an offline report and increments pending count", async () => {
    const record = await enqueueOfflineReport(sampleReport)

    expect(record.id).toBeDefined()
    expect(record.bookingId).toBe("booking-offline-1")
    expect(record.status).toBe("PENDING")

    const pending = await getPendingOfflineReports()
    expect(pending.length).toBeGreaterThanOrEqual(1)

    const count = await getPendingOfflineReportsCount()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it("removes a report by id", async () => {
    const record = await enqueueOfflineReport({
      ...sampleReport,
      bookingId: "booking-to-delete",
    })

    await removeOfflineReport(record.id)
    const pending = await getPendingOfflineReports()
    const found = pending.find((r) => r.id === record.id)
    expect(found).toBeUndefined()
  })

  it("syncs pending reports successfully when online", async () => {
    const record = await enqueueOfflineReport({
      ...sampleReport,
      bookingId: "booking-sync-test",
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    globalThis.fetch = fetchMock

    const result = await syncOfflineReports()
    expect(result.synced).toBeGreaterThanOrEqual(1)

    const pending = await getPendingOfflineReports()
    const found = pending.find((r) => r.id === record.id)
    expect(found).toBeUndefined()
  })

  it("handles server failure gracefully during sync", async () => {
    await enqueueOfflineReport({
      ...sampleReport,
      bookingId: "booking-fail-test",
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })
    globalThis.fetch = fetchMock

    const result = await syncOfflineReports()
    expect(result.failed).toBeGreaterThanOrEqual(1)
  })
})
