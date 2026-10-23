export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import logger from "@/lib/logger"

import { withRoute } from "@/lib/api-route"
import { roundMoney } from "@/lib/money"
import { computeProviderBalance } from "@/lib/wallet"

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
      // MESMA função do extrato (GET /api/provider/wallet): comissão por
      // LINHA, sem teto de linhas e descontando saques pendentes. Antes este
      // caminho usava `netOf(soma)` enquanto o extrato usava `netOf(linha)` —
      // os dois podiam divergir centavos, e o teto de 1.000 linhas do extrato
      // subestimava o saldo de prestadores grandes.
      const snapshot = await computeProviderBalance(session.userId, tx)
      const availableCapped = snapshot.available

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
