export const dynamic = "force-dynamic"

/**
 * GET & POST /api/admin/whatsapp/status
 *
 * Torre de Controle Admin — Monitoramento e Gestão da Conexão WhatsApp (Evolution API).
 * Permite checagem em tempo real de heartbeat, status da sessão, e ações de reconexão.
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { checkWhatsAppSessionHeartbeat, connectInstance, restartInstance } from "@/lib/evolution"

export const GET = withRoute("api.admin.whatsapp.status.GET", async () => {
  await requireRole("ADMIN")

  const heartbeat = await checkWhatsAppSessionHeartbeat()

  return NextResponse.json({
    ok: true,
    heartbeat,
  })
})

export const POST = withRoute("api.admin.whatsapp.status.POST", async (request) => {
  await requireRole("ADMIN")

  const body = (await request.json().catch(() => ({}))) as { action?: string }
  const action = body?.action ?? "heartbeat"

  if (action === "reconnect") {
    const qrData = await connectInstance()
    return NextResponse.json({
      ok: true,
      action: "reconnect",
      qrData,
    })
  }

  if (action === "restart") {
    const restartResult = await restartInstance()
    return NextResponse.json({
      ok: true,
      action: "restart",
      result: restartResult,
    })
  }

  const heartbeat = await checkWhatsAppSessionHeartbeat()
  return NextResponse.json({
    ok: true,
    heartbeat,
  })
})
