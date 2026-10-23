import { describe, it, expect, vi, beforeEach } from "vitest"
import { getDatabaseHealthReport } from "@/lib/db-health-sentinel"
import { db } from "@/lib/db"

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),
  },
}))

describe("db-health-sentinel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retorna status HEALTHY quando métricas estão dentro dos limites normais", async () => {
    vi.mocked(db.$queryRaw)
      .mockResolvedValueOnce([
        {
          tableName: "Booking",
          liveTuples: 1000,
          deadTuples: 50,
          lastVacuum: new Date("2026-10-15T12:00:00Z"),
          lastAutovacuum: new Date("2026-10-15T12:00:00Z"),
          lastAnalyze: new Date("2026-10-15T12:00:00Z"),
          lastAutoanalyze: new Date("2026-10-15T12:00:00Z"),
          totalBytes: 2048000,
          totalSizePretty: "2 MB",
        },
      ])
      .mockResolvedValueOnce([{ cacheHitRatioPct: 99.8 }])
      .mockResolvedValueOnce([{ activeCount: 12 }])
      .mockResolvedValueOnce([{ maxConn: 150 }])
      .mockResolvedValueOnce([
        { indexname: "idx_booking_pending_partial" },
        { indexname: "idx_booking_in_progress_partial" },
        { indexname: "idx_booking_active_partial" },
        { indexname: "idx_notification_unread_partial" },
        { indexname: "idx_payment_held_escrow_partial" },
        { indexname: "idx_payment_pending_partial" },
        { indexname: "idx_quoterequest_pending_partial" },
        { indexname: "idx_dispute_open_partial" },
        { indexname: "idx_user_active_provider_partial" },
      ])

    const report = await getDatabaseHealthReport()

    expect(report.status).toBe("HEALTHY")
    expect(report.cacheHitRatioPct).toBe(99.8)
    expect(report.activeConnections).toBe(12)
    expect(report.maxConnections).toBe(150)
    expect(report.tables).toHaveLength(1)
    expect(report.tables[0].bloatRisk).toBe("LOW")
    expect(report.partialIndexes).toHaveLength(9)
    expect(report.partialIndexes.every((p) => p.active)).toBe(true)
    expect(report.warnings).toHaveLength(0)
  })

  it("identifica risco HIGH de bloat e recomenda VACUUM quando dead ratio >= 20% e dead > 200", async () => {
    vi.mocked(db.$queryRaw)
      .mockResolvedValueOnce([
        {
          tableName: "AuditLog",
          liveTuples: 500,
          deadTuples: 300,
          lastVacuum: null,
          lastAutovacuum: null,
          lastAnalyze: null,
          lastAutoanalyze: null,
          totalBytes: 5242880,
          totalSizePretty: "5 MB",
        },
      ])
      .mockResolvedValueOnce([{ cacheHitRatioPct: 99.1 }])
      .mockResolvedValueOnce([{ activeCount: 8 }])
      .mockResolvedValueOnce([{ maxConn: 100 }])

    const report = await getDatabaseHealthReport()

    expect(report.status).toBe("WARNING")
    expect(report.tables[0].bloatRisk).toBe("HIGH")
    expect(report.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Tabela "AuditLog" possui')]),
    )
    expect(report.recommendations).toEqual(
      expect.arrayContaining([expect.stringContaining('VACUUM (ANALYZE, VERBOSE) "AuditLog"')]),
    )
  })

  it("alerta quando Cache Hit Ratio está abaixo de 90%", async () => {
    vi.mocked(db.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cacheHitRatioPct: 82.4 }])
      .mockResolvedValueOnce([{ activeCount: 10 }])
      .mockResolvedValueOnce([{ maxConn: 100 }])

    const report = await getDatabaseHealthReport()

    expect(report.status).toBe("WARNING")
    expect(report.cacheHitRatioPct).toBe(82.4)
    expect(report.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Cache Hit Ratio abaixo do recomendado")]),
    )
  })

  it("retorna status correto para índices parciais ativos e inativos", async () => {
    vi.mocked(db.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cacheHitRatioPct: 99.0 }])
      .mockResolvedValueOnce([{ activeCount: 5 }])
      .mockResolvedValueOnce([{ maxConn: 100 }])
      .mockResolvedValueOnce([
        { indexname: "idx_booking_pending_partial" },
        // outros 8 ausentes
      ])

    const report = await getDatabaseHealthReport()

    expect(report.partialIndexes).toHaveLength(9)
    const bookingPending = report.partialIndexes.find(
      (idx) => idx.name === "idx_booking_pending_partial",
    )
    expect(bookingPending?.active).toBe(true)

    const paymentHeld = report.partialIndexes.find(
      (idx) => idx.name === "idx_payment_held_escrow_partial",
    )
    expect(paymentHeld?.active).toBe(false)
  })

  it("retorna fallback gracioso quando o banco de dados falha", async () => {
    vi.mocked(db.$queryRaw).mockRejectedValueOnce(new Error("Connection timeout"))

    const report = await getDatabaseHealthReport()

    expect(report).toBeDefined()
    expect(report.timestamp).toBeDefined()
    expect(Array.isArray(report.tables)).toBe(true)
    expect(report.partialIndexes).toHaveLength(9)
  })
})
