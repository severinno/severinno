import "server-only"
import { db } from "./db"
import { FEE_RATE } from "./constants"

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
  transactions: Transaction[]
}

// ---------------------------------------------------------------------------
// Balance computation
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

  let balance = 0
  let pendingBalance = 0
  let totalReceived = 0
  let completedCount = 0
  let completedSum = 0
  const transactions: Transaction[] = []

  for (const b of bookings) {
    const fee = Math.round(b.amount * FEE_RATE * 100) / 100
    const netAmount = Math.round((b.amount - fee) * 100) / 100

    if (b.paymentStatus === "PAID") {
      totalReceived += b.amount

      if (b.status === "COMPLETED") {
        balance += netAmount
        completedCount++
        completedSum += b.amount

        transactions.push({
          id: `SIM-TXN-${b.id.slice(0, 8).toUpperCase()}`,
          bookingId: b.id,
          amount: b.amount,
          fee,
          netAmount,
          status: "paid",
          description: b.service.title,
          clientName: b.client.name,
          date: b.createdAt.toISOString(),
        })
      } else if (b.status === "CONFIRMED" || b.status === "IN_PROGRESS") {
        pendingBalance += netAmount

        transactions.push({
          id: `SIM-TXN-${b.id.slice(0, 8).toUpperCase()}`,
          bookingId: b.id,
          amount: b.amount,
          fee,
          netAmount,
          status: "pending",
          description: b.service.title,
          clientName: b.client.name,
          date: b.createdAt.toISOString(),
        })
      }
    }
  }

  return { balance, pendingBalance, totalReceived, completedCount, completedSum, transactions }
}

/**
 * Fetch all completed withdrawals for a provider and compute the total
 * withdrawn amount, returning both the total and individual transaction records.
 */
export async function getWithdrawals(providerId: string) {
  const withdrawals = await db.walletTransaction.findMany({
    where: { providerId, status: "completed" },
    select: { id: true, amount: true, description: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })

  let totalWithdrawn = 0
  const withdrawalTxns: Transaction[] = []

  for (const w of withdrawals) {
    totalWithdrawn += w.amount
    withdrawalTxns.push({
      id: `SIM-WTH-${w.id.slice(0, 8).toUpperCase()}`,
      bookingId: "",
      amount: w.amount,
      fee: 0,
      netAmount: w.amount,
      status: "withdrawn",
      description: w.description ?? "Saque simulado",
      clientName: "—",
      date: w.createdAt.toISOString(),
    })
  }

  return { totalWithdrawn, withdrawalTxns }
}

/**
 * Compute the current available balance for a provider (used by POST withdraw
 * to validate if there's enough balance). Only considers COMPLETED + PAID
 * bookings minus total withdrawn. Simpler and faster than computeBaseBalance.
 */
export async function computeAvailableBalance(providerId: string) {
  const bookings = await db.booking.findMany({
    where: {
      providerId,
      paymentStatus: "PAID",
      status: "COMPLETED",
    },
    select: { amount: true },
  })

  const earnedBalance = bookings.reduce(
    (acc, b) => acc + Math.round(b.amount * (1 - FEE_RATE) * 100) / 100,
    0,
  )

  const withdrawals = await db.walletTransaction.findMany({
    where: { providerId, status: "completed" },
    select: { amount: true },
  })

  const totalWithdrawn = withdrawals.reduce((acc, w) => acc + w.amount, 0)

  return Math.max(0, Math.round((earnedBalance - totalWithdrawn) * 100) / 100)
}

/**
 * Build the full SimulatedWallet object from base balance + withdrawals.
 */
export function buildWallet(
  base: Awaited<ReturnType<typeof computeBaseBalance>>,
  withdrawals: Awaited<ReturnType<typeof getWithdrawals>>,
): SimulatedWallet {
  const adjustedBalance = Math.max(0, Math.round((base.balance - withdrawals.totalWithdrawn) * 100) / 100)

  const allTxns = [...withdrawals.withdrawalTxns, ...base.transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )

  return {
    balance: adjustedBalance,
    pendingBalance: Math.round(base.pendingBalance * 100) / 100,
    totalReceived: Math.round(base.totalReceived * 100) / 100,
    totalBookings: base.completedCount,
    avgTicket:
      base.completedCount > 0
        ? Math.round((base.completedSum / base.completedCount) * 100) / 100
        : 0,
    totalWithdrawn: Math.round(withdrawals.totalWithdrawn * 100) / 100,
    transactions: allTxns,
  }
}
