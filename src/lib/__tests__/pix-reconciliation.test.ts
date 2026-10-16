import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = vi.hoisted(() => ({
  payment: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  booking: {
    update: vi.fn(),
  },
  $transaction: vi.fn().mockImplementation(async (txs) => Promise.all(txs)),
}))

vi.mock("@/lib/db", () => ({ default: mockDb, db: mockDb }))

const mockLytex = vi.hoisted(() => ({
  getCharge: vi.fn(),
}))

vi.mock("@/lib/lytex", () => mockLytex)

const mockAlerting = vi.hoisted(() => ({
  reportOutage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/alerting-service", () => ({
  AlertingService: mockAlerting,
}))

import { runPixReconciliation } from "../pix-reconciliation"

describe("runPixReconciliation: Motor de Conciliação Diária D+1", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("identifica conciliação perfeitamente balanceada quando Lytex e DB coincidem", async () => {
    mockDb.payment.findMany.mockResolvedValueOnce([
      {
        id: "pay-1",
        bookingId: "book-1",
        amount: 200.0,
        status: "PAID",
        lytexId: "lytex-1",
        booking: { id: "book-1", status: "COMPLETED", paymentStatus: "PAID", amount: 200.0 },
      },
    ])

    mockLytex.getCharge.mockResolvedValueOnce({
      id: "lytex-1",
      status: "paid",
      amount: 200.0,
    })

    const report = await runPixReconciliation({ lookbackHours: 24, autoHeal: true })

    expect(report.totalAudited).toBe(1)
    expect(report.totalGrossAmount).toBe(200.0)
    expect(report.totalPlatformFees).toBe(30.0) // 15% de 200
    expect(report.totalProviderPayouts).toBe(170.0) // 85% de 200
    expect(report.discrepanciesCount).toBe(0)
    expect(report.status).toBe("BALANCED")
    expect(report.auditHash).toBeDefined()
  })

  it("aplica auto-cura quando Lytex está pago mas banco de dados ainda estava PENDING", async () => {
    mockDb.payment.findMany.mockResolvedValueOnce([
      {
        id: "pay-2",
        bookingId: "book-2",
        amount: 150.0,
        status: "PENDING",
        lytexId: "lytex-2",
        booking: { id: "book-2", status: "PENDING", paymentStatus: "PENDING", amount: 150.0 },
      },
    ])

    mockLytex.getCharge.mockResolvedValueOnce({
      id: "lytex-2",
      status: "paid",
      amount: 150.0,
      paidAt: "2026-10-16T08:00:00Z",
    })

    const report = await runPixReconciliation({ lookbackHours: 24, autoHeal: true })

    expect(report.totalAudited).toBe(1)
    expect(report.autoHealedCount).toBe(1)
    expect(report.discrepanciesCount).toBe(1)
    expect(report.status).toBe("AUTO_HEALED")
    expect(mockDb.$transaction).toHaveBeenCalled()
  })

  it("alerta a torre de controle quando há discrepância de valor financeiro", async () => {
    mockDb.payment.findMany.mockResolvedValueOnce([
      {
        id: "pay-3",
        bookingId: "book-3",
        amount: 300.0,
        status: "PAID",
        lytexId: "lytex-3",
        booking: { id: "book-3", status: "COMPLETED", paymentStatus: "PAID", amount: 300.0 },
      },
    ])

    mockLytex.getCharge.mockResolvedValueOnce({
      id: "lytex-3",
      status: "paid",
      amount: 250.0, // Divergência de R$ 50,00!
    })

    const report = await runPixReconciliation({ lookbackHours: 24, autoHeal: true })

    expect(report.status).toBe("DISCREPANCY_ALERT")
    expect(report.discrepancies[0].reason).toBe("AMOUNT_MISMATCH")
    expect(mockAlerting.reportOutage).toHaveBeenCalledWith(
      "Finance/Reconciliation",
      expect.stringContaining("Divergência contábil"),
    )
  })
})
