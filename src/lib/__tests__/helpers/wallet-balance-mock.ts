/**
 * Helper de teste para a agregação de saldo do prestador.
 *
 * `computeProviderBalance` (src/lib/wallet.ts) lê o saldo em UMA query SQL —
 * de propósito: a versão anterior somava uma página de linhas (`take: 1000`) e
 * truncava o saldo de prestadores grandes. Os testes de rota da carteira
 * mockam `findMany` como fixture (bookings/withdrawals da tela); este helper
 * converte a MESMA fixture na linha que a agregação devolveria, para que os
 * testes continuem verificando o payload (formatação, sinais, arredondamento)
 * sem reimplementar SQL.
 *
 * O contrato da agregação em si (sem LIMIT, com filtro de soft delete) é
 * testado em src/lib/__tests__/wallet.test.ts.
 */

/** Taxa da plataforma — espelha FEE_RATE de src/lib/constants.ts. */
const FEE_RATE = 0.15

const round2 = (n: number) => Math.round(n * 100) / 100

export type BookingFixture = {
  amount: number | string
  status?: string
  paymentStatus?: string
}

export type WithdrawalFixture = {
  amount: number | string
  status?: string
}

export function balanceRowFrom(
  bookings: BookingFixture[] = [],
  withdrawals: WithdrawalFixture[] = [],
) {
  let earnedNet = 0
  let grossReceived = 0
  let grossCompleted = 0
  let completedCount = 0
  let pendingNet = 0

  for (const b of bookings) {
    if (b.paymentStatus !== "PAID") continue
    const amount = Number(b.amount)
    const net = round2(amount) - round2(amount * FEE_RATE)
    grossReceived += amount

    if (b.status === "COMPLETED") {
      earnedNet += net
      grossCompleted += amount
      completedCount++
    } else if (b.status === "CONFIRMED" || b.status === "IN_PROGRESS") {
      pendingNet += net
    }
  }

  let totalWithdrawn = 0
  let totalPending = 0
  let pendingCount = 0

  for (const w of withdrawals) {
    const amount = Number(w.amount)
    if (w.status === "pending") {
      totalPending += amount
      pendingCount++
    } else if (!w.status || w.status === "completed") {
      totalWithdrawn += amount
    }
  }

  return {
    earnedNet: earnedNet.toFixed(2),
    grossReceived: grossReceived.toFixed(2),
    grossCompleted: grossCompleted.toFixed(2),
    completedCount,
    pendingNet: pendingNet.toFixed(2),
    totalWithdrawn: totalWithdrawn.toFixed(2),
    totalPending: totalPending.toFixed(2),
    pendingCount,
  }
}

/**
 * Implementação de `$queryRaw` derivada das fixtures já configuradas em
 * `findMany` — `computeProviderBalance` não usa `findMany`, então a chamada
 * devolve exatamente o que o teste configurou.
 */
export function queryRawFromFindMany(db: {
  booking: { findMany: (args?: unknown) => Promise<unknown> }
  walletTransaction: { findMany: (args?: unknown) => Promise<unknown> }
}) {
  return async () => [
    balanceRowFrom(
      (await db.booking.findMany()) as BookingFixture[],
      (await db.walletTransaction.findMany()) as WithdrawalFixture[],
    ),
  ]
}
