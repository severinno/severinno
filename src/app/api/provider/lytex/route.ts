import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { getWallet, listSplits } from "@/lib/lytex"
import { handleError } from "@/lib/api-server"

function isLytexConfigured(): boolean {
  return !!(process.env.LYTEX_CLIENT_ID && process.env.LYTEX_CLIENT_SECRET)
}

export async function GET() {
  try {
    const session = await requireUser()

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { lytexRecipientId: true },
    })

    if (!isLytexConfigured() || !user?.lytexRecipientId) {
      // Simulate wallet and splits from database bookings for local development
      const bookings = await db.booking.findMany({
        where: {
          providerId: session.userId,
          paymentStatus: "PAID",
        },
        select: {
          id: true,
          amount: true,
          status: true,
          createdAt: true,
        },
      })

      let balance = 0
      let pendingBalance = 0

      for (const b of bookings) {
        const earned = b.amount * 0.85
        if (b.status === "COMPLETED") {
          balance += earned
        } else if (b.status === "CONFIRMED" || b.status === "IN_PROGRESS") {
          pendingBalance += earned
        }
      }

      const wallet = {
        balance,
        pendingBalance,
        totalReceived: balance,
      }

      const splits = bookings
        .filter((b) => b.status === "COMPLETED")
        .map((b) => ({
          _id: `SIM-SPLIT-${b.id.slice(0, 8).toUpperCase()}`,
          _invoiceId: `SIM-INV-${b.id.slice(0, 8).toUpperCase()}`,
          value: b.amount * 0.85,
          status: "paid",
          createdAt: b.createdAt.toISOString(),
        }))

      return NextResponse.json({ wallet, splits })
    }

    const [wallet, splits] = await Promise.all([
      getWallet(user.lytexRecipientId).catch(() => null),
      listSplits(user.lytexRecipientId).catch(() => []),
    ])

    return NextResponse.json({ wallet, splits })
  } catch (e) {
    return handleError(e)
  }
}
