import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { generateMEIAnnualReport } from "@/lib/mei-fiscal"

export async function POST(req: NextRequest) {
  await requireRole("PROVIDER")
  await assertRateLimit(req, RATE_LIMITS.general)
  try {
    const body = await req.json()
    const { providerId, providerName, year, bookings, cnpj } = body

    if (!providerId || !providerName || !year) {
      return NextResponse.json(
        { success: false, error: "providerId, providerName, and year are required" },
        { status: 400 },
      )
    }

    const bookingList = Array.isArray(bookings)
      ? bookings.map((b) => ({
          completedAt: new Date(b.completedAt || Date.now()),
          totalAmount: typeof b.totalAmount === "number" ? b.totalAmount : 0,
          distanceKm: typeof b.distanceKm === "number" ? b.distanceKm : 0,
          materialsCost: typeof b.materialsCost === "number" ? b.materialsCost : 0,
        }))
      : []

    const report = generateMEIAnnualReport(
      providerId,
      providerName,
      parseInt(String(year), 10),
      bookingList,
      cnpj,
    )

    return NextResponse.json({
      success: true,
      data: report,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate MEI report",
      },
      { status: 500 },
    )
  }
}
