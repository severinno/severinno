export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import {
  computeBaseBalance,
  computeProviderBalance,
  getWithdrawals,
  buildWallet,
} from "@/lib/wallet"

import { withRoute } from "@/lib/api-route"

export const GET = withRoute("api.provider.wallet.GET", async (request) => {
  const session = await requireUser()
  await assertRateLimit(request, RATE_LIMITS.wallet)

  // UM snapshot de saldo por request: as duas funções consomem o mesmo
  // agregado (antes cada uma somava a própria página de linhas).
  const snapshot = await computeProviderBalance(session.userId)
  const [base, withdrawals] = await Promise.all([
    computeBaseBalance(session.userId, snapshot),
    getWithdrawals(session.userId, snapshot),
  ])

  const wallet = buildWallet(base, withdrawals)

  return NextResponse.json(wallet)
})
