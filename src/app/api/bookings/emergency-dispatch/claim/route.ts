export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { claimEmergencyDispatch } from "@/lib/emergency-matchmaking"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { escapeHtml } from "@/lib/sanitize"

/**
 * POST /api/bookings/emergency-dispatch/claim
 *
 * Endpoint atômico para prestador aceitar uma chamada de emergência.
 * Implementa concorrência first-to-claim com proteção contra race conditions.
 */
export const POST = withRoute("api.bookings.emergency-dispatch.claim.POST", async (req) => {
  await assertRateLimit(req, RATE_LIMITS.bookings)
  const body = await req.json()

  if (!body.requestId || !body.providerId) {
    return NextResponse.json(
      { success: false, error: "requestId e providerId são obrigatórios." },
      { status: 400 },
    )
  }

  const result = await claimEmergencyDispatch({
    requestId: String(body.requestId),
    providerId: String(body.providerId),
    providerName: body.providerName ? String(body.providerName) : undefined,
  })

  return NextResponse.json({
    success: result.success,
    data: result,
  })
})

/**
 * GET /api/bookings/emergency-dispatch/claim
 *
 * Link de 1-toque enviado via WhatsApp para o prestador aceitar instantaneamente.
 */
export const GET = withRoute("api.bookings.emergency-dispatch.claim.GET", async (req) => {
  await assertRateLimit(req, RATE_LIMITS.bookings)
  const { searchParams } = new URL(req.url)
  const requestId = searchParams.get("requestId")
  const providerId = searchParams.get("providerId")

  if (!requestId || !providerId) {
    return NextResponse.json({ success: false, error: "Parâmetros inválidos." }, { status: 400 })
  }

  const result = await claimEmergencyDispatch({
    requestId,
    providerId,
  })

  // Se cliente requerer JSON
  const acceptHeader = req.headers.get("accept") || ""
  if (acceptHeader.includes("application/json")) {
    return NextResponse.json({
      success: result.success,
      data: result,
    })
  }

  // Resposta HTML amigável para celular (abertura via navegador do WhatsApp)
  const isOk = result.success
  const safeMessage = escapeHtml(result.message)
  const safeReqId = escapeHtml(result.requestId)

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>Severinno Emergência — ${isOk ? "Confirmado" : "Aviso"}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1.5rem; box-sizing: border-box; }
    .card { background: #18181b; border: 1px solid ${isOk ? "#10b981" : "#f59e0b"}; border-radius: 1.5rem; padding: 2rem; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
    .icon { font-size: 3.5rem; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; font-weight: 800; color: ${isOk ? "#34d399" : "#fbbf24"}; }
    p { color: #a1a1aa; line-height: 1.5; margin: 0 0 1.5rem; font-size: 1rem; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; background: #27272a; font-size: 0.75rem; color: #71717a; margin-bottom: 1.5rem; }
    .btn { display: block; width: 100%; background: #059669; color: white; text-decoration: none; font-weight: 700; padding: 0.875rem 1rem; border-radius: 0.75rem; transition: background 0.2s; box-sizing: border-box; }
    .btn:hover { background: #047857; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isOk ? "⚡" : "⏳"}</div>
    <h1>${isOk ? "Atendimento Garantido!" : "Chamada Já Atendida"}</h1>
    <div class="badge">Chamada #${safeReqId}</div>
    <p>${safeMessage}</p>
    <a href="/?view=provider.bookings" class="btn">Abrir Painel do Prestador</a>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    status: isOk ? 200 : 409,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'none';",
    },
  })
})
