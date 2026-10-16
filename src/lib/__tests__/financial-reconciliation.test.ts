import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  runFinancialReconciliationAudit,
  formatReconciliationSummary,
} from "../financial-reconciliation"
import { db } from "@/lib/db"
import DecimalJS from "decimal.js"

vi.mock("@/lib/logger", () => {
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => mockLog,
  }
  return { default: mockLog }
})

vi.mock("@/lib/proactive-alert-dispatcher", () => ({
  dispatchProactiveAlert: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/db", () => ({
  db: {
    payment: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

describe("financial-reconciliation — Auditoria Contábil do Ledger", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("identifica agendamento e pagamento em conformidade (status CLEAN)", async () => {
    ;(db.payment.findMany as any).mockResolvedValueOnce([
      {
        id: "pay-1",
        bookingId: "book-1",
        amount: new DecimalJS(100.0) as any,
        status: "PAID",
        lytexStatus: "paid",
        createdAt: new Date(),
        paidAt: new Date(),
        booking: {
          id: "book-1",
          amount: new DecimalJS(100.0) as any,
          paymentStatus: "PAID",
          status: "CONFIRMED",
          escrowReleasedAt: null,
          escrowDisputeReason: null,
        },
      } as any,
    ])

    ;(db.booking.findMany as any).mockResolvedValueOnce([])

    const report = await runFinancialReconciliationAudit({
      dispatchAlerts: false,
    })

    expect(report.status).toBe("CLEAN")
    expect(report.totalPaymentsAudited).toBe(1)
    expect(report.divergencesCount).toBe(0)
    expect(report.totalGrossAmountAudited).toBe(100)
    expect(report.totalPlatformFeeAudited).toBe(15) // 15% de 100
  })

  it("detecta pagamento pendente órfão já pago no gateway e realiza auto-reparo para PAID", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)

    ;(db.payment.findMany as any).mockResolvedValueOnce([
      {
        id: "pay-orphan",
        bookingId: "book-orphan",
        amount: new DecimalJS(200.0) as any,
        status: "PENDING",
        lytexStatus: "paid", // gateway diz que foi pago!
        createdAt: threeHoursAgo,
        paidAt: null,
        booking: {
          id: "book-orphan",
          amount: new DecimalJS(200.0) as any,
          paymentStatus: "PENDING",
          status: "CONFIRMED",
          escrowReleasedAt: null,
          escrowDisputeReason: null,
        },
      } as any,
    ])

    ;(db.booking.findMany as any).mockResolvedValueOnce([])
    ;(db.payment.update as any).mockResolvedValueOnce({} as any)
    ;(db.booking.update as any).mockResolvedValueOnce({} as any)

    const report = await runFinancialReconciliationAudit({
      autoRepair: true,
      dispatchAlerts: false,
    })

    expect(db.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay-orphan" },
        data: expect.objectContaining({ status: "PAID" }),
      }),
    )
    expect(report.reconciledCount).toBe(1)
    expect(report.discrepancies[0].type).toBe("ORPHANED_PENDING_PAYMENT")
    expect(report.discrepancies[0].reconciled).toBe(true)
  })

  it("detecta custódia HELD em serviço COMPLETED com mais de 24h e auto-libera para RELEASED", async () => {
    ;(db.payment.findMany as any).mockResolvedValueOnce([])

    ;(db.booking.findMany as any).mockResolvedValueOnce([
      {
        id: "book-held-24h",
        amount: new DecimalJS(150.0) as any,
        status: "COMPLETED",
        paymentStatus: "HELD",
        escrowReleasedAt: null,
        escrowDisputeReason: null,
        updatedAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
      } as any,
    ])

    ;(db.booking.update as any).mockResolvedValueOnce({} as any)

    const report = await runFinancialReconciliationAudit({
      autoRepair: true,
      dispatchAlerts: false,
    })

    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "book-held-24h" },
        data: expect.objectContaining({ paymentStatus: "PAID" }),
      }),
    )
    expect(report.reconciledCount).toBe(1)
    expect(report.discrepancies[0].type).toBe("UNRELEASED_ESCROW")
    expect(report.discrepancies[0].reconciled).toBe(true)
  })

  it("formata sumário legível com emojis e detalhes de auditoria", () => {
    const summary = formatReconciliationSummary({
      timestamp: new Date().toISOString(),
      windowHours: 24,
      totalPaymentsAudited: 12,
      totalBookingsAudited: 15,
      divergencesCount: 0,
      reconciledCount: 2,
      discrepancies: [],
      status: "CLEAN",
      totalGrossAmountAudited: 1850.5,
      totalPlatformFeeAudited: 277.58,
    })

    expect(summary).toContain("✅ *Relatório de Reconciliação Contábil — Severinno*")
    expect(summary).toContain("Transações Auditadas: 12")
    expect(summary).toContain("Volume Auditado: R$ 1850.50")
    expect(summary).toContain("Itens Reconciliados Automaticamente: 2")
  })
})
