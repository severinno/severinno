export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { dispatchAllMorningBriefings } from "@/lib/whatsapp-morning-briefing"

/**
 * Cron Job: Disparo Matinal do Briefing da Agenda para Prestadores.
 *
 * GET /api/cron/morning-briefing
 * Authorization: Bearer CRON_SECRET
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = request.headers.get("authorization")

    // Validação estrita do token bearer
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const result = await dispatchAllMorningBriefings()

    return NextResponse.json({
      success: true,
      result,
    })
  } catch (err) {
    return NextResponse.json(
      { error: "Erro interno no briefing matinal", details: (err as Error).message },
      { status: 500 },
    )
  }
}
