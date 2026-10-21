import "server-only"
import { db } from "./db"
import { FEE_RATE } from "./constants"
import { toDecimal, feeOf, netOf } from "./money"
import { Prisma } from "@prisma/client"
import DecimalJS from "decimal.js"

const DecimalCtor = DecimalJS as unknown as typeof Prisma.Decimal

export { FEE_RATE }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Transaction = {
  id: string
  bookingId: string
  amount: number
  fee: number
  netAmount: number
  status: "paid" | "pending" | "refunded" | "withdrawn"
  description: string
  clientName: string
  date: string
}

export type SimulatedWallet = {
  balance: number
  pendingBalance: number
  totalReceived: number
  totalBookings: number
  avgTicket: number
  totalWithdrawn: number
  pendingWithdrawalsAmount: number
  pendingWithdrawalsCount: number
  escrowInCustody: number
  escrowReleased: number
  transactions: Transaction[]
}

// ---------------------------------------------------------------------------
// Balance computation — acumulação em Decimal puro (comissão em base 10
// exata, sem roundtrip por number); conversão para `number` acontece só na
// montagem do payload (fronteira de serialização, contrato da API).
// ---------------------------------------------------------------------------

/**
 * Compute the base balance from PAID bookings, returning detailed breakdown
 * with transactions grouped by status.
 */
export async function computeBaseBalance(providerId: string) {
  const bookings = await db.booking.findMany({
    where: { providerId, paymentStatus: "PAID" },
    select: {
      id: true,
      amount: true,
      status: true,
      paymentStatus: true,
      createdAt: true,
      service: { select: { title: true } },
      client: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  let balance = new DecimalCtor(0)
  let pendingBalance = new DecimalCtor(0)
  let totalReceived = new DecimalCtor(0)
  let completedSum = new DecimalCtor(0)
  let completedCount = 0
  const transactions: Transaction[] = []

  for (const b of bookings) {
    const amountD = toDecimal(b.amount)
    const feeD = feeOf(amountD)
    const netD = amountD.minus(feeD) // gross − fee já arredondado: soma exata

    if (b.paymentStatus === "PAID") {
      totalReceived = totalReceived.plus(amountD)

      if (b.status === "COMPLETED") {
        balance = balance.plus(netD)
        completedCount++
        completedSum = completedSum.plus(amountD)

        transactions.push({
          id: `SIM-TXN-${b.id.slice(0, 8).toUpperCase()}`,
          bookingId: b.id,
          amount: amountD.toNumber(),
          fee: feeD.toNumber(),
          netAmount: netD.toNumber(),
          status: "paid",
          description: b.service.title,
          clientName: b.client.name,
          date: b.createdAt.toISOString(),
        })
      } else if (b.status === "CONFIRMED" || b.status === "IN_PROGRESS") {
        pendingBalance = pendingBalance.plus(netD)

        transactions.push({
          id: `SIM-TXN-${b.id.slice(0, 8).toUpperCase()}`,
          bookingId: b.id,
          amount: amountD.toNumber(),
          fee: feeD.toNumber(),
          netAmount: netD.toNumber(),
          status: "pending",
          description: b.service.title,
          clientName: b.client.name,
          date: b.createdAt.toISOString(),
        })
      }
    }
  }

  return {
    balance,
    pendingBalance,
    totalReceived,
    completedCount,
    completedSum,
    transactions,
  }
}

/**
 * Fetch all completed and pending withdrawals for a provider, returning
 * both totals and individual transaction records.
 */
export async function getWithdrawals(providerId: string) {
  const [completedWithdrawals, pendingWithdrawalsList] = await Promise.all([
    db.walletTransaction.findMany({
      where: { providerId, status: "completed" },
      select: { id: true, amount: true, description: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    db.walletTransaction.findMany({
      where: { providerId, status: "pending" },
      select: { id: true, amount: true, description: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
  ])

  // Backward compatible filtering in case generic mocks returned all records
  const actualCompleted = completedWithdrawals.filter((w) => !w.status || w.status === "completed")
  const actualPending = pendingWithdrawalsList.filter((w) => w.status === "pending")

  let totalWithdrawn = new DecimalCtor(0)
  let pendingWithdrawalsAmount = new DecimalCtor(0)
  const withdrawalTxns: Transaction[] = []

  for (const w of actualCompleted) {
    const amountD = toDecimal(w.amount)
    totalWithdrawn = totalWithdrawn.plus(amountD)
    withdrawalTxns.push({
      id: `SIM-WTH-${w.id.slice(0, 8).toUpperCase()}`,
      bookingId: "",
      amount: amountD.toNumber(),
      fee: 0,
      netAmount: amountD.toNumber(),
      status: "withdrawn",
      description: w.description ?? "Saque PIX realizado",
      clientName: "—",
      date: w.createdAt.toISOString(),
    })
  }

  for (const pw of actualPending) {
    const amountD = toDecimal(pw.amount)
    pendingWithdrawalsAmount = pendingWithdrawalsAmount.plus(amountD)
    withdrawalTxns.push({
      id: `SIM-WTH-PEND-${pw.id.slice(0, 8).toUpperCase()}`,
      bookingId: "",
      amount: amountD.toNumber(),
      fee: 0,
      netAmount: amountD.toNumber(),
      status: "pending",
      description: pw.description ?? "Saque PIX em processamento",
      clientName: "—",
      date: pw.createdAt.toISOString(),
    })
  }

  return {
    totalWithdrawn,
    pendingWithdrawalsAmount,
    pendingWithdrawalsCount: actualPending.length,
    withdrawalTxns,
  }
}

/**
 * Compute the current available balance for a provider (used by POST withdraw
 * to validate if there's enough balance). Only considers COMPLETED + PAID
 * bookings minus total completed AND pending withdrawals (prevents double-spending).
 *
 * Decimal puro de ponta a ponta — o retorno é `Prisma.Decimal`.
 */
export async function computeAvailableBalance(providerId: string): Promise<Prisma.Decimal> {
  const bookings = await db.booking.findMany({
    where: {
      providerId,
      paymentStatus: "PAID",
      status: "COMPLETED",
    },
    select: { amount: true },
  })

  const earnedBalance = bookings.reduce((acc, b) => acc.plus(netOf(b.amount)), new DecimalCtor(0))

  const [completedWithdrawals, pendingWithdrawals] = await Promise.all([
    db.walletTransaction.findMany({
      where: { providerId, status: "completed" },
      select: { amount: true, status: true },
    }),
    db.walletTransaction.findMany({
      where: { providerId, status: "pending" },
      select: { amount: true, status: true },
    }),
  ])

  const actualCompleted = completedWithdrawals.filter((w) => !w.status || w.status === "completed")
  const actualPending = pendingWithdrawals.filter((w) => w.status === "pending")

  const totalWithdrawn = actualCompleted.reduce(
    (acc, w) => acc.plus(toDecimal(w.amount)),
    new DecimalCtor(0),
  )
  const totalPending = actualPending.reduce(
    (acc, w) => acc.plus(toDecimal(w.amount)),
    new DecimalCtor(0),
  )

  const available = earnedBalance.minus(totalWithdrawn).minus(totalPending)
  return available.isNegative() ? new DecimalCtor(0) : available.toDecimalPlaces(2)
}

/**
 * Build the full SimulatedWallet object from base balance + withdrawals.
 * ÚNICA fronteira de conversão Decimal → number do módulo (payload JSON).
 */
export function buildWallet(
  base: Awaited<ReturnType<typeof computeBaseBalance>>,
  withdrawals: {
    totalWithdrawn: Prisma.Decimal
    pendingWithdrawalsAmount?: Prisma.Decimal
    pendingWithdrawalsCount?: number
    withdrawalTxns: Transaction[]
  },
): SimulatedWallet {
  const adjustedBalance = base.balance.minus(withdrawals.totalWithdrawn)
  const adjusted = adjustedBalance.isNegative() ? new DecimalCtor(0) : adjustedBalance

  const allTxns = [...withdrawals.withdrawalTxns, ...base.transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )

  const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toNumber()
  const pendingWithdrawn = withdrawals.pendingWithdrawalsAmount ?? new DecimalCtor(0)

  return {
    balance: round2(adjusted),
    pendingBalance: round2(base.pendingBalance),
    totalReceived: round2(base.totalReceived),
    totalBookings: base.completedCount,
    avgTicket:
      base.completedCount > 0
        ? base.completedSum.dividedBy(base.completedCount).toDecimalPlaces(2).toNumber()
        : 0,
    totalWithdrawn: round2(withdrawals.totalWithdrawn),
    pendingWithdrawalsAmount: round2(pendingWithdrawn),
    pendingWithdrawalsCount: withdrawals.pendingWithdrawalsCount ?? 0,
    escrowInCustody: round2(base.pendingBalance),
    escrowReleased: round2(base.balance),
    transactions: allTxns,
  }
}
