import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, handleError } from "@/lib/api-server"

/**
 * GET /api/provider/financial-summary
 * Returns comprehensive financial analytics for the authenticated provider:
 * - Gross and Net Revenue
 * - In-Custody Escrow Balance
 * - Available Balance
 * - Transaction history with receipt links
 */
export async function GET() {
  try {
    const session = await requireUser()
    if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
      throw forbidden("Acesso restrito a prestadores")
    }

    const providerId = session.userId

    // 1. Fetch completed bookings (released or settled)
    const completedBookings = await db.booking.findMany({
      where: {
        providerId,
        status: "COMPLETED",
      },
      select: {
        id: true,
        amount: true,
        paymentStatus: true,
        escrowReleasedAt: true,
        createdAt: true,
        updatedAt: true,
        service: { select: { title: true } },
        client: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
    })

    // 2. Fetch bookings currently in custody (PAID or HELD, waiting for completion/escrow release)
    const custodyBookings = await db.booking.findMany({
      where: {
        providerId,
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
        paymentStatus: { in: ["PAID", "HELD"] },
      },
      select: {
        id: true,
        amount: true,
        paymentStatus: true,
        createdAt: true,
        service: { select: { title: true } },
        client: { select: { name: true } },
      },
    })

    const totalGross = completedBookings.reduce((sum, b) => sum + b.amount, 0)
    // Platform standard fee is 10%
    const totalPlatformFee = Math.round(totalGross * 0.1 * 100) / 100
    const totalNet = Math.round((totalGross - totalPlatformFee) * 100) / 100

    const custodyBalance = custodyBookings.reduce((sum, b) => sum + b.amount, 0)
    const availableBalance = completedBookings
      .filter((b) => b.escrowReleasedAt !== null || b.paymentStatus === "PAID")
      .reduce((sum, b) => sum + b.amount * 0.9, 0)

    const recentTransactions = completedBookings.slice(0, 15).map((b) => ({
      id: b.id,
      date: b.updatedAt,
      serviceTitle: b.service.title,
      clientName: b.client.name,
      grossAmount: b.amount,
      netAmount: Math.round(b.amount * 0.9 * 100) / 100,
      receiptUrl: `/api/bookings/${b.id}/receipt`,
    }))

    return NextResponse.json({
      ok: true,
      summary: {
        totalGross,
        totalNet,
        totalPlatformFee,
        custodyBalance: Math.round(custodyBalance * 100) / 100,
        availableBalance: Math.round(availableBalance * 100) / 100,
        completedCount: completedBookings.length,
        inProgressCount: custodyBookings.length,
      },
      transactions: recentTransactions,
    })
  } catch (e) {
    return handleError(e)
  }
}
