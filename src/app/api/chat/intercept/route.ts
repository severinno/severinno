import { NextRequest, NextResponse } from "next/server"
import { processChatMessageWithSafety } from "@/lib/anti-disintermediation-guard"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { userId, text, bookingId, allowDirectContact } = body

    if (!userId || typeof text !== "string") {
      return NextResponse.json(
        { error: "Parâmetros inválidos: userId e text são obrigatórios" },
        { status: 400 },
      )
    }

    const result = processChatMessageWithSafety(userId, text, {
      bookingId,
      allowDirectContact: Boolean(allowDirectContact),
    })

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno no guardião anti-bypass"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
