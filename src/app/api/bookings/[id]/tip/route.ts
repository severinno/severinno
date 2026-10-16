import { NextRequest, NextResponse } from "next/server"
import { processDigitalTip } from "@/lib/digital-tips-engine"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookingId } = await params
    const body = await req.json()
    const { clientName, providerName, providerPixKey, amount, message } = body

    if (!bookingId || !clientName || !providerName || !providerPixKey || amount === undefined) {
      return NextResponse.json(
        { error: "Dados incompletos para envio da gorjeta" },
        { status: 400 },
      )
    }

    const receipt = processDigitalTip({
      bookingId,
      clientName,
      providerName,
      providerPixKey,
      amount: Number(amount),
      message,
    })

    return NextResponse.json({
      success: true,
      message: "Gorjeta processada com sucesso (0% taxa da plataforma)",
      receipt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao processar gorjeta"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
