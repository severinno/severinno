/**
 * Cron route for automated WhatsApp flows and adaptive notification digest flush.
 *
 * Can be called by Vercel Cron, external cron (e.g. pg_cron or GitHub actions) or manual admin trigger.
 * Secured by CRON_SECRET header if configured.
 */

import { NextRequest, NextResponse } from "next/server"
import { runAllWhatsAppFlows } from "@/lib/whatsapp-flows"
import logger from "@/lib/logger"

const log = logger.child({ module: "cron-whatsapp-flows" })

export async function GET(request: NextRequest) {
  // Validate bearer secret if configured
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  try {
    const results = await runAllWhatsAppFlows()
    return NextResponse.json({ success: true, results, timestamp: new Date().toISOString() })
  } catch (err) {
    log.error({ err }, "Cron error running WhatsApp flows")
    return NextResponse.json(
      { error: "Erro ao executar fluxos", details: String(err) },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
