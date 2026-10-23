import { NextRequest, NextResponse } from "next/server"
import { findRouteBatchOpportunities } from "@/lib/provider-route-batcher"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { schedule, candidates, maxDetourKm } = body

    if (!Array.isArray(schedule) || !Array.isArray(candidates)) {
      return NextResponse.json(
        { error: "Parâmetros inválidos: schedule e candidates devem ser arrays" },
        { status: 400 },
      )
    }

    const opportunities = findRouteBatchOpportunities(schedule, candidates, {
      maxDetourKm: maxDetourKm ? Number(maxDetourKm) : undefined,
    })

    return NextResponse.json({
      success: true,
      totalOpportunities: opportunities.length,
      opportunities,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao processar rotas inteligentes"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
