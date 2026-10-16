import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { items } = body

    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: "Payload inválido: 'items' deve ser um array de ações offline" },
        { status: 400 },
      )
    }

    const results = items.map((item: { id: string; type: string; bookingId: string }) => {
      // Simulação atômica de processamento por item
      return {
        id: item.id,
        bookingId: item.bookingId,
        type: item.type,
        status: "SYNCED",
        syncedAt: new Date().toISOString(),
      }
    })

    return NextResponse.json({
      success: true,
      processed: results.length,
      synced: results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao processar lote offline"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
