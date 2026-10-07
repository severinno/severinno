export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { computeBaseBalance, getWithdrawals, buildWallet } from "@/lib/wallet"

import { withRoute } from "@/lib/api-route"

export const GET = withRoute("api.provider.wallet.GET", async (request) => {
  const session = await requireUser()
  await assertRateLimit(request, RATE_LIMITS.wallet)

  const [base, withdrawals] = await Promise.all([
    computeBaseBalance(session.userId),
    getWithdrawals(session.userId),
  ])

  const wallet = buildWallet(base, withdrawals)

  return NextResponse.json(wallet)
})
