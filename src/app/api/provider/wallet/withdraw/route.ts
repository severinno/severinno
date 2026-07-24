import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { computeAvailableBalance } from "@/lib/wallet"
import logger from "@/lib/logger"

export async function POST(request: Request) {
  try {
    const session = await requireUser()

    const body = await request.json()
    const { amount } = body as { amount?: number }

    // Validate amount
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Valor de saque inválido. Informe um valor positivo." },
        { status: 400 },
      )
    }

    // Round to 2 decimal places
    const withdrawAmount = Math.round(amount * 100) / 100

    // Minimum withdrawal
    if (withdrawAmount < 10) {
      return NextResponse.json(
        { error: "Saque mínimo de R$ 10,00." },
        { status: 400 },
      )
    }

    // Maximum withdrawal
    if (withdrawAmount > 50000) {
      return NextResponse.json(
        { error: "Saque máximo de R$ 50.000,00 por transação." },
        { status: 400 },
      )
    }

    // Compute current available balance via shared lib
    const availableBalance = await computeAvailableBalance(session.userId)

    if (withdrawAmount > availableBalance) {
      return NextResponse.json(
        {
          error: `Saldo insuficiente. Disponível: R$ ${availableBalance.toFixed(2)}.`,
          availableBalance,
        },
        { status: 400 },
      )
    }

    // Create withdrawal record
    const withdrawal = await db.walletTransaction.create({
      data: {
        providerId: session.userId,
        amount: withdrawAmount,
        status: "completed",
        description: `Saque simulado de R$ ${withdrawAmount.toFixed(2)}`,
      },
    })

    const newBalance = Math.round((availableBalance - withdrawAmount) * 100) / 100

    logger.info(
      { providerId: session.userId, amount: withdrawAmount, newBalance },
      "simulated withdrawal completed",
    )

    return NextResponse.json({
      id: withdrawal.id,
      amount: withdrawAmount,
      newBalance,
      message: `Saque de R$ ${withdrawAmount.toFixed(2)} realizado com sucesso!`,
    })
  } catch (e) {
    return handleError(e)
  }
}
