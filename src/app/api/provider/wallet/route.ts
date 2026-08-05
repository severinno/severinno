import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { computeBaseBalance, getWithdrawals, buildWallet } from "@/lib/wallet"

export async function GET(request: Request) {
  try {
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.wallet)

    const [base, withdrawals] = await Promise.all([
      computeBaseBalance(session.userId),
      getWithdrawals(session.userId),
    ])

    const wallet = buildWallet(base, withdrawals)

    return NextResponse.json(wallet)
  } catch (e) {
    return handleError(e)
  }
}
