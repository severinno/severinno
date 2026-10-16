/**
 * financial-reconciliation.ts — Auditoria e Reconciliação Contábil Noturna do Ledger
 *
 * Realiza a conferência de integridade das transações entre o banco de dados e o gateway:
 * 1. Auditoria da exatidão dos splits (15% taxa plataforma + 85% repasse líquido do prestador).
 * 2. Identificação e auto-reparo de cobranças órfãs (status PENDING local com status PAID no gateway).
 * 3. Identificação de custódias (escrow) não liberadas em agendamentos concluídos sem disputa.
 * 4. Detecção de divergências de centavos e emissão de relatório auditado para a administração.
 */

import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { toMoneyNumber, feeOf, netOf, roundMoney } from "@/lib/money"
import { FEE_RATE } from "@/lib/constants"
import { dispatchProactiveAlert } from "@/lib/proactive-alert-dispatcher"

const log =
  typeof logger?.child === "function"
    ? logger.child({ module: "financial-reconciliation" })
    : logger

export type DiscrepancyType =
  "SPLIT_DIVERGENCE" | "ORPHANED_PENDING_PAYMENT" | "UNRELEASED_ESCROW" | "PAYMENT_BOOKING_MISMATCH"

export interface ReconciliationDiscrepancy {
  id: string
  bookingId?: string
  paymentId?: string
  type: DiscrepancyType
  severity: "INFO" | "WARNING" | "CRITICAL"
  details: string
  amount: number
  expectedAmount?: number
  reconciled: boolean
  actionTaken?: string
}

export interface ReconciliationReport {
  timestamp: string
  windowHours: number
  totalPaymentsAudited: number
  totalBookingsAudited: number
  divergencesCount: number
  reconciledCount: number
  discrepancies: ReconciliationDiscrepancy[]
  status: "CLEAN" | "DISCREPANCIES_FOUND"
  totalGrossAmountAudited: number
  totalPlatformFeeAudited: number
}

export interface ReconciliationOptions {
  windowHours?: number
  autoRepair?: boolean
  dispatchAlerts?: boolean
}

/**
 * Executa a auditoria completa de reconciliação contábil no ledger.
 */
export async function runFinancialReconciliationAudit(
  options: ReconciliationOptions = {},
): Promise<ReconciliationReport> {
  const { windowHours = 48, autoRepair = true, dispatchAlerts = true } = options
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const discrepancies: ReconciliationDiscrepancy[] = []
  let reconciledCount = 0
  let totalGross = 0
  let totalFee = 0

  // ── 1. Auditar Pagamentos e Integridade com o Booking ─────────────────────
  const payments = await db.payment.findMany({
    where: {
      createdAt: { gte: since },
    },
    include: {
      booking: {
        select: {
          id: true,
          amount: true,
          paymentStatus: true,
          status: true,
          escrowReleasedAt: true,
          escrowDisputeReason: true,
        },
      },
    },
    take: 500,
  })

  for (const payment of payments) {
    const paymentAmount = toMoneyNumber(payment.amount)
    totalGross += paymentAmount

    const expectedFee = toMoneyNumber(feeOf(payment.amount, FEE_RATE))
    const expectedNet = toMoneyNumber(netOf(payment.amount, FEE_RATE))
    totalFee += expectedFee

    // 1.1 Conferência da identidade contábil do split (gross === fee + net)
    const sumSplit = Math.round((expectedFee + expectedNet) * 100) / 100
    if (sumSplit !== paymentAmount) {
      discrepancies.push({
        id: `split-${payment.id}`,
        paymentId: payment.id,
        bookingId: payment.bookingId,
        type: "SPLIT_DIVERGENCE",
        severity: "CRITICAL",
        details: `Split diverge do valor bruto: Gross R$ ${paymentAmount} != Fee R$ ${expectedFee} + Net R$ ${expectedNet}`,
        amount: paymentAmount,
        expectedAmount: sumSplit,
        reconciled: false,
      })
    }

    // 1.2 Conferência entre Payment.amount e Booking.amount
    if (payment.booking) {
      const bookingAmount = toMoneyNumber(payment.booking.amount)
      if (bookingAmount !== paymentAmount) {
        discrepancies.push({
          id: `mismatch-${payment.id}`,
          paymentId: payment.id,
          bookingId: payment.bookingId,
          type: "PAYMENT_BOOKING_MISMATCH",
          severity: "CRITICAL",
          details: `Valor do Payment (R$ ${paymentAmount}) diverge do Booking (R$ ${bookingAmount})`,
          amount: paymentAmount,
          expectedAmount: bookingAmount,
          reconciled: false,
        })
      }
    }

    // 1.3 Cobranças órfãs com status PENDING criadas há mais de 2 horas
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    if (payment.status === "PENDING" && payment.createdAt <= twoHoursAgo) {
      // Se no gateway o status já for 'paid' ou 'waitingPayment' expirado
      const isGatewayPaid =
        payment.lytexStatus?.toLowerCase() === "paid" ||
        payment.lytexStatus?.toLowerCase() === "settled"

      if (isGatewayPaid && autoRepair) {
        try {
          await db.payment.update({
            where: { id: payment.id },
            data: {
              status: "PAID",
              paidAt: payment.paidAt || new Date(),
            },
          })
          if (payment.bookingId) {
            await db.booking.update({
              where: { id: payment.bookingId },
              data: { paymentStatus: "PAID" },
            })
          }
          reconciledCount++
          discrepancies.push({
            id: `orphan-${payment.id}`,
            paymentId: payment.id,
            bookingId: payment.bookingId,
            type: "ORPHANED_PENDING_PAYMENT",
            severity: "WARNING",
            details: `Cobrança pendente reconciliada para PAID (sincronizada com gateway)`,
            amount: paymentAmount,
            reconciled: true,
            actionTaken: "Atualizado status local para PAID",
          })
        } catch (err) {
          log.warn({ err }, "Falha ao auto-reparar pagamento órfão")
        }
      } else if (!isGatewayPaid) {
        discrepancies.push({
          id: `orphan-${payment.id}`,
          paymentId: payment.id,
          bookingId: payment.bookingId,
          type: "ORPHANED_PENDING_PAYMENT",
          severity: "INFO",
          details: `Cobrança PENDING há mais de 2h (Gateway status: ${payment.lytexStatus || "sem resposta"})`,
          amount: paymentAmount,
          reconciled: false,
        })
      }
    }
  }

  // ── 2. Auditar Custódias (Escrow) de Agendamentos Concluídos ──────────────
  const completedWithoutRelease = await db.booking.findMany({
    where: {
      status: "COMPLETED",
      paymentStatus: "HELD",
      escrowReleasedAt: null,
      escrowDisputeReason: null,
      updatedAt: { lte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // janela de contestação de 24h vencida
    },
    take: 100,
  })

  for (const booking of completedWithoutRelease) {
    const bookingAmount = toMoneyNumber(booking.amount)
    if (autoRepair) {
      try {
        await db.booking.update({
          where: { id: booking.id },
          data: {
            paymentStatus: "PAID",
            escrowReleasedAt: new Date(),
          },
        })
        reconciledCount++
        discrepancies.push({
          id: `escrow-${booking.id}`,
          bookingId: booking.id,
          type: "UNRELEASED_ESCROW",
          severity: "WARNING",
          details: `Custódia liberada automaticamente após expirar janela de 24h sem contestação`,
          amount: bookingAmount,
          reconciled: true,
          actionTaken: "Liberado status para PAID com escrowReleasedAt",
        })
      } catch (err) {
        log.warn({ err }, "Falha ao liberar custódia retida")
      }
    } else {
      discrepancies.push({
        id: `escrow-${booking.id}`,
        bookingId: booking.id,
        type: "UNRELEASED_ESCROW",
        severity: "WARNING",
        details: `Agendamento COMPLETED há mais de 24h com custódia HELD pendente de liberação`,
        amount: bookingAmount,
        reconciled: false,
      })
    }
  }

  const report: ReconciliationReport = {
    timestamp: new Date().toISOString(),
    windowHours,
    totalPaymentsAudited: payments.length,
    totalBookingsAudited: payments.length + completedWithoutRelease.length,
    divergencesCount: discrepancies.filter((d) => !d.reconciled).length,
    reconciledCount,
    discrepancies,
    status:
      discrepancies.filter((d) => !d.reconciled).length === 0 ? "CLEAN" : "DISCREPANCIES_FOUND",
    totalGrossAmountAudited: Math.round(totalGross * 100) / 100,
    totalPlatformFeeAudited: Math.round(totalFee * 100) / 100,
  }

  // Se houver discrepâncias críticas não reconciliadas e alertas habilitados, notifica
  if (dispatchAlerts && report.divergencesCount > 0) {
    try {
      await dispatchProactiveAlert({
        title: "⚠️ Divergência Contábil Detectada na Reconciliação Noturna",
        message: formatReconciliationSummary(report),
        severity: "CRITICAL",
        category: "PAYMENT_FAILURE",
        metadata: {
          divergencesCount: report.divergencesCount,
          reconciledCount: report.reconciledCount,
          totalGrossAudited: report.totalGrossAmountAudited,
        },
      })
    } catch {
      // Best-effort
    }
  }

  return report
}

/**
 * Formata um sumário legível da reconciliação para relatórios e notificações.
 */
export function formatReconciliationSummary(report: ReconciliationReport): string {
  const statusEmoji = report.status === "CLEAN" ? "✅" : "⚠️"
  const lines = [
    `${statusEmoji} *Relatório de Reconciliação Contábil — Severinno*`,
    `📅 Janela: Últimas ${report.windowHours} horas`,
    `🔢 Transações Auditadas: ${report.totalPaymentsAudited}`,
    `💰 Volume Auditado: R$ ${report.totalGrossAmountAudited.toFixed(2)} (Taxas: R$ ${report.totalPlatformFeeAudited.toFixed(2)})`,
    `🛠️ Itens Reconciliados Automaticamente: ${report.reconciledCount}`,
    `🚨 Divergências Pendentes: ${report.divergencesCount}`,
  ]

  if (report.discrepancies.length > 0) {
    lines.push("\n*Principais Ocorrências:*")
    for (const d of report.discrepancies.slice(0, 5)) {
      const icon = d.reconciled ? "✅" : d.severity === "CRITICAL" ? "🔴" : "🟡"
      lines.push(`${icon} [${d.type}] R$ ${d.amount.toFixed(2)} — ${d.details}`)
    }
  }

  return lines.join("\n")
}
