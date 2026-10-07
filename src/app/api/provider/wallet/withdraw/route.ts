export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import logger from "@/lib/logger"

import { withRoute } from "@/lib/api-route"
import { toDecimal, netOf, roundMoney } from "@/lib/money"

export const POST = withRoute("api.provider.wallet.withdraw.POST", async (request) => {
  const session = await requireUser()

  // Rate limit específico para saques (3 a cada 10 min)
  await assertRateLimit(request, RATE_LIMITS.walletWithdraw)

  const body = await request.json()
  const { amount } = body as { amount?: number }

  // Validate amount
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "Valor de saque inválido. Informe um valor positivo." },
      { status: 400 },
    )
  }

  // Arredonda a 2 casas em Decimal (mesma semântica do legado, sem drift)
  const withdrawAmount = roundMoney(amount)

  // Minimum withdrawal
  if (withdrawAmount.lt(10)) {
    return NextResponse.json({ error: "Saque mínimo de R$ 10,00." }, { status: 400 })
  }

  // Maximum withdrawal
  if (withdrawAmount.gt(50000)) {
    return NextResponse.json(
      { error: "Saque máximo de R$ 50.000,00 por transação." },
      { status: 400 },
    )
  }

  // Serializable transaction: balance check + withdrawal creation
  // are atomic to prevent double-spend race conditions.
  const { withdrawal, availableBalance } = await db.$transaction(
    async (tx) => {
      // Compute balance via aggregation (no full table load)
      const [bookingAgg, withdrawalAgg] = await Promise.all([
        tx.booking.aggregate({
          where: { providerId: session.userId, paymentStatus: "PAID", status: "COMPLETED" },
          _sum: { amount: true },
        }),
        tx.walletTransaction.aggregate({
          where: { providerId: session.userId, status: "completed" },
          _sum: { amount: true },
        }),
      ])

      // Decimal puro: soma dos líquidos por linha (netOf) menos os saques.
      // Fórmula por LINHA — a mesma do wallet.ts — para o limite batido aqui
      // ser idêntico ao exibido no extrato (fee sobre agregado pode divergir
      // centavos da soma dos fees por transação).
      const totalWithdrawn = toDecimal(withdrawalAgg._sum.amount)
      const available = bookingAgg._sum.amount
        ? netOf(bookingAgg._sum.amount).minus(totalWithdrawn)
        : totalWithdrawn.neg()
      const availableCapped = available.isNegative() ? toDecimal("0") : available

      if (withdrawAmount.gt(availableCapped)) {
        throw badRequest(`Saldo insuficiente. Disponível: R$ ${availableCapped.toFixed(2)}.`)
      }

      const w = await tx.walletTransaction.create({
        data: {
          providerId: session.userId,
          amount: withdrawAmount,
          status: "completed",
          description: `Saque de R$ ${withdrawAmount.toFixed(2)}`,
        },
      })

      return { withdrawal: w, availableBalance: availableCapped }
    },
    { isolationLevel: "Serializable" },
  )

  const newBalance = availableBalance.minus(withdrawAmount).toDecimalPlaces(2)

  logger.info(
    {
      providerId: session.userId,
      amount: withdrawAmount.toString(),
      newBalance: newBalance.toString(),
    },
    "simulated withdrawal completed",
  )

  return NextResponse.json({
    id: withdrawal.id,
    amount: withdrawAmount.toNumber(),
    newBalance: newBalance.toNumber(),
    message: `Saque de R$ ${withdrawAmount.toFixed(2)} realizado com sucesso!`,
  })
})
