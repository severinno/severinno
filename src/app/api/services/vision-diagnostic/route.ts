import { NextRequest, NextResponse } from "next/server"
import { analyzeServicePhoto } from "@/lib/vision-diagnostic"

export async function POST(req: NextRequest) {
  try {
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
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Vision analysis failed" },
      { status: 500 },
    )
  }
}
