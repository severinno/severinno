export const dynamic = "force-dynamic"

import { requireRole } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { generateMEIAnnualReport } from "@/lib/mei-fiscal"
import { meiReportSchema } from "@/lib/validators"

import { withRoute } from "@/lib/api-route"

export const POST = withRoute("api.provider.financial.mei-report.POST", async (req) => {
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
})
