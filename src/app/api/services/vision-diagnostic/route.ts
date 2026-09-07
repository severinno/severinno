export const dynamic = "force-dynamic"

import { NextRequest } from "next/server"
import { analyzeServicePhoto } from "@/lib/vision-diagnostic"
import { requireUser } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { handleError } from "@/lib/api-server"
import { visionDiagnosticSchema } from "@/lib/validators"

export async function POST(req: NextRequest) {
  try {
    await requireUser()
    await assertRateLimit(req, RATE_LIMITS.general)
    const body = await req.json()
    const parsed = visionDiagnosticSchema.parse(body)

    const result = await analyzeServicePhoto(parsed)

    return Response.json({
      success: true,
      data: result,
    })
  } catch (error) {
    return handleError(error)
  }
}
