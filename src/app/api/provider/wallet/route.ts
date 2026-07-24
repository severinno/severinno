import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import {
  computeBaseBalance,
  getWithdrawals,
  buildWallet,
} from "@/lib/wallet"

export async function GET() {
  try {
    const session = await requireUser()

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
