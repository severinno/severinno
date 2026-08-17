import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { FEE_RATE } from "@/lib/constants"

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
        const earned = b.amount * (1 - FEE_RATE)
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
          value: b.amount * (1 - FEE_RATE),
          status: "paid",
          createdAt: b.createdAt.toISOString(),
        }))

      return NextResponse.json({ wallet, splits })
    }

    // getWallet and listSplits are not yet implemented in @/lib/lytex
    // For now, return simulated data from the bookings
    const bookingsForWallet = await db.booking.findMany({
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
    for (const b of bookingsForWallet) {
      const earned = b.amount * (1 - FEE_RATE)
      if (b.status === "COMPLETED") {
        balance += earned
      }
    }

    const wallet = {
      balance,
      pendingBalance: 0,
      totalReceived: balance,
    }

    const splits = bookingsForWallet
      .filter((b) => b.status === "COMPLETED")
      .map((b) => ({
        _id: `SIM-SPLIT-${b.id.slice(0, 8).toUpperCase()}`,
        _invoiceId: `SIM-INV-${b.id.slice(0, 8).toUpperCase()}`,
        value: b.amount * (1 - FEE_RATE),
        status: "paid",
        createdAt: b.createdAt.toISOString(),
      }))

    return NextResponse.json({ wallet, splits })
  } catch (e) {
    return handleError(e)
  }
}
