export const dynamic = "force-dynamic"

import { NextRequest } from "next/server"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { generateMEIAnnualReport } from "@/lib/mei-fiscal"
import { meiReportSchema } from "@/lib/validators"

export async function POST(req: NextRequest) {
  try {
    await requireRole("PROVIDER")
    await assertRateLimit(req, RATE_LIMITS.general)
    const body = await req.json()
    const parsed = meiReportSchema.parse(body)

    const report = generateMEIAnnualReport(
      parsed.providerId,
      parsed.providerName,
      parsed.year,
      parsed.bookings.map((b) => ({
        completedAt: b.completedAt || new Date(),
        totalAmount: b.totalAmount,
        distanceKm: b.distanceKm,
        materialsCost: b.materialsCost,
      })),
      parsed.cnpj,
    )

    return Response.json({
      success: true,
      data: report,
    })
  } catch (e) {
    return handleError(e)
  }
}
