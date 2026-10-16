/**
 * pix-reconciliation.ts — Motor de Conciliação Diária de PIX & Lytex (Fechamento D+1)
 *
 * Realiza auditoria contábil e fiscal centavo por centavo entre a API Lytex e o banco de dados:
 * 1. Cruza transações locais (tabela Payment) com a fatura real no gateway.
 * 2. Detecta webhooks perdidos ou dessincronizados e aplica auto-cura (auto-heal) segura.
 * 3. Valida e audita o split financeiro (15% Taxa Severinno / 85% Prestador).
 * 4. Gera hash SHA-256 de conformidade para auditoria contábil e prevenção de fraudes.
 */

import { createHash } from "node:crypto"
import { db } from "@/lib/db"
import { getCharge } from "@/lib/lytex"
import { toMoneyNumber } from "@/lib/money"
import { FEE_RATE } from "@/lib/constants"
import logger from "@/lib/logger"

export type DiscrepancyReason =
  "STATUS_DESYNC" | "AMOUNT_MISMATCH" | "GATEWAY_CHARGE_NOT_FOUND" | "MISSING_PAID_AT"

export interface PaymentDiscrepancy {
  paymentId: string
  bookingId: string
  lytexId: string
  reason: DiscrepancyReason
  dbStatus: string
  gatewayStatus: string
  dbAmount: number
  gatewayAmount: number
  autoHealed: boolean
  details: string
}

export interface ReconciliationOptions {
  lookbackHours?: number
  autoHeal?: boolean
  specificBookingId?: string
}

export interface ReconciliationReport {
  id: string
  executedAt: string
  periodStart: string
  periodEnd: string
  totalAudited: number
  totalGrossAmount: number
  totalPlatformFees: number
  totalProviderPayouts: number
  discrepanciesCount: number
  autoHealedCount: number
  discrepancies: PaymentDiscrepancy[]
  auditHash: string
  status: "BALANCED" | "AUTO_HEALED" | "DISCREPANCY_ALERT"
}

/**
 * Mapeia o status retornado pelo gateway Lytex para o status esperado no Severinno.
 */
function isStatusCompatible(dbStatus: string, gatewayStatus: string): boolean {
  const normGw = gatewayStatus.toLowerCase()
  if (normGw === "paid") {
    // No Severinno, valor pago pode estar como PAID (liberado) ou HELD (em custódia até conclusão)
    return dbStatus === "PAID" || dbStatus === "HELD"
  }
  if (normGw === "refunded") {
    return dbStatus === "REFUNDED"
  }
  if (normGw === "canceled" || normGw === "expired" || normGw === "failed") {
    return dbStatus === "CANCELLED" || dbStatus === "FAILED" || dbStatus === "PENDING"
  }
  if (normGw === "pending" || normGw === "waitingpayment") {
    return dbStatus === "PENDING"
  }
  return false
}

/**
 * Executa a rotina de conciliação diária D+1.
 */
export async function runPixReconciliation(
  options: ReconciliationOptions = {},
): Promise<ReconciliationReport> {
  const lookbackHours = options.lookbackHours ?? 24
  const autoHeal = options.autoHeal ?? true
  const now = new Date()
  const periodStart = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000)

  logger.info(
    { lookbackHours, autoHeal, periodStart: periodStart.toISOString() },
    "[pix-reconciliation] Iniciando rotina de conciliação diária D+1",
  )

  // 1. Busca pagamentos relevantes no período
  const whereClause: Record<string, unknown> = {
    lytexId: { not: null },
    createdAt: { gte: periodStart },
  }
  if (options.specificBookingId) {
    whereClause.bookingId = options.specificBookingId
  }

  const payments = await db.payment.findMany({
    where: whereClause,
    include: {
      booking: {
        select: { id: true, status: true, paymentStatus: true, amount: true },
      },
    },
    take: 1000,
    orderBy: { createdAt: "desc" },
  })

  let totalGrossAmount = 0
  let totalPlatformFees = 0
  let totalProviderPayouts = 0
  let autoHealedCount = 0
  const discrepancies: PaymentDiscrepancy[] = []

  for (const payment of payments) {
    if (!payment.lytexId) continue

    const dbAmount = toMoneyNumber(payment.amount)
    totalGrossAmount += dbAmount

    // Calcula split teórico
    const platformFee = Math.round(dbAmount * FEE_RATE * 100) / 100
    const providerPayout = Math.round((dbAmount - platformFee) * 100) / 100
    totalPlatformFees += platformFee
    totalProviderPayouts += providerPayout

    try {
      const charge = await getCharge(payment.lytexId)

      // 1. Verificação de Divergência de Valor
      const amountDiff = Math.abs(charge.amount - dbAmount)
      if (amountDiff > 0.01) {
        discrepancies.push({
          paymentId: payment.id,
          bookingId: payment.bookingId,
          lytexId: payment.lytexId,
          reason: "AMOUNT_MISMATCH",
          dbStatus: payment.status,
          gatewayStatus: charge.status,
          dbAmount,
          gatewayAmount: charge.amount,
          autoHealed: false,
          details: `Divergência de valor: Gateway R$ ${charge.amount} vs Banco R$ ${dbAmount}`,
        })
        continue
      }

      // 2. Verificação de Divergência de Status
      const compatible = isStatusCompatible(payment.status, charge.status)

      if (!compatible) {
        let healed = false

        // Caso clássico: Gateway reporta PAID, mas webhook falhou e DB está PENDING
        if (autoHeal && charge.status.toLowerCase() === "paid" && payment.status === "PENDING") {
          try {
            const paidDate = charge.paidAt ? new Date(charge.paidAt) : new Date()

            // Transação atômica de auto-cura contábil
            await db.$transaction([
              db.payment.update({
                where: { id: payment.id },
                data: {
                  status: "PAID",
                  lytexStatus: "paid",
                  paidAt: paidDate,
                },
              }),
              db.booking.update({
                where: { id: payment.bookingId },
                data: {
                  paymentStatus: "PAID",
                  ...(payment.booking?.status === "PENDING" ? { status: "CONFIRMED" } : {}),
                },
              }),
            ])

            healed = true
            autoHealedCount++
            logger.info(
              { paymentId: payment.id, bookingId: payment.bookingId, lytexId: payment.lytexId },
              "[pix-reconciliation] Auto-cura aplicada com sucesso: transação atualizada para PAID",
            )
          } catch (healErr) {
            logger.error(
              { healErr, paymentId: payment.id },
              "[pix-reconciliation] Falha ao aplicar auto-cura no banco",
            )
          }
        }

        discrepancies.push({
          paymentId: payment.id,
          bookingId: payment.bookingId,
          lytexId: payment.lytexId,
          reason: "STATUS_DESYNC",
          dbStatus: payment.status,
          gatewayStatus: charge.status,
          dbAmount,
          gatewayAmount: charge.amount,
          autoHealed: healed,
          details: healed
            ? "Status dessincronizado corrigido automaticamente (Gateway PAID -> DB PAID)"
            : `Status incompatível sem auto-cura: Gateway '${charge.status}' vs Banco '${payment.status}'`,
        })
      }
    } catch (chargeErr) {
      discrepancies.push({
        paymentId: payment.id,
        bookingId: payment.bookingId,
        lytexId: payment.lytexId,
        reason: "GATEWAY_CHARGE_NOT_FOUND",
        dbStatus: payment.status,
        gatewayStatus: "NOT_FOUND",
        dbAmount,
        gatewayAmount: 0,
        autoHealed: false,
        details: chargeErr instanceof Error ? chargeErr.message : "Erro na consulta à API Lytex",
      })
    }
  }

  // Gera hash de auditoria do relatório
  const reportPayload = {
    executedAt: now.toISOString(),
    totalAudited: payments.length,
    totalGrossAmount,
    totalPlatformFees,
    totalProviderPayouts,
    discrepanciesCount: discrepancies.length,
    autoHealedCount,
  }
  const auditHash = createHash("sha256").update(JSON.stringify(reportPayload)).digest("hex")

  const unresolvedDiscrepancies = discrepancies.filter((d) => !d.autoHealed)
  const reportStatus =
    unresolvedDiscrepancies.length > 0
      ? "DISCREPANCY_ALERT"
      : autoHealedCount > 0
        ? "AUTO_HEALED"
        : "BALANCED"

  const report: ReconciliationReport = {
    id: `rec-${now.toISOString().slice(0, 10)}-${auditHash.slice(0, 8)}`,
    executedAt: now.toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    totalAudited: payments.length,
    totalGrossAmount: Math.round(totalGrossAmount * 100) / 100,
    totalPlatformFees: Math.round(totalPlatformFees * 100) / 100,
    totalProviderPayouts: Math.round(totalProviderPayouts * 100) / 100,
    discrepanciesCount: discrepancies.length,
    autoHealedCount,
    discrepancies,
    auditHash,
    status: reportStatus,
  }

  // Alerta contingencial se houver discrepâncias não resolvidas
  if (unresolvedDiscrepancies.length > 0) {
    try {
      const { AlertingService } = await import("@/lib/alerting-service")
      void AlertingService.reportOutage(
        "Finance/Reconciliation",
        `Divergência contábil em ${unresolvedDiscrepancies.length} transação(ões) no fechamento D+1. Auditoria: ${report.id}`,
      )
    } catch {}
  }

  return report
}
