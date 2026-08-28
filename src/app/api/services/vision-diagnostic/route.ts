import { NextRequest, NextResponse } from "next/server"
import { analyzeServicePhoto } from "@/lib/vision-diagnostic"
import { requireUser } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { handleError } from "@/lib/api-server"

export async function POST(req: NextRequest) {
  try {
    await requireUser()
    await assertRateLimit(req, RATE_LIMITS.general)
    const body = await req.json()
    const { imageBase64, imageUrl, clientDescription } = body

    if (!imageBase64 && !imageUrl && !clientDescription) {
      return NextResponse.json(
        { success: false, error: "Provide imageBase64, imageUrl, or clientDescription" },
        { status: 400 },
      )
    }

    const result = await analyzeServicePhoto({ imageBase64, imageUrl, clientDescription })

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    return handleError(error)
  }
}
