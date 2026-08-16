import { NextRequest, NextResponse } from "next/server"

/**
 * Tunnel for Sentry/GlitchTip client-side errors.
 * Proxies envelope requests to the self-hosted GlitchTip instance
 * to bypass ad-blockers that block direct requests to error trackers.
 */
const GLITCHTIP_INTERNAL_URL = process.env.GLITCHTIP_INTERNAL_URL ?? "http://glitchtip-web:8000"
// Timeout (ms) do fetch para o GlitchTip (tunnel de envelopes do Sentry).
// Um GlitchTip que aceita o TCP mas nunca responde deixaria o POST
// pendurado — atrasando o 200 ao browser. AbortSignal.timeout() aborta após
// o prazo (o catch abaixo responde 200 mesmo assim). Guarda contra valores
// inválidos: NaN → default; negativo/zero → Math.max(1).
const GLITCHTIP_TIMEOUT_MS = Math.max(1, Number(process.env.GLITCHTIP_TIMEOUT_MS) || 5_000)

export async function POST(request: NextRequest) {
  try {
    const envelope = await request.text()
    const piece = envelope.split("\n")[0]
    const header = JSON.parse(piece)
    const dsn = new URL(header.dsn as string)
    const projectId = dsn.pathname.replace("/", "")
    const glitchtipUrl = `${GLITCHTIP_INTERNAL_URL}/api/${projectId}/envelope/`

    const response = await fetch(glitchtipUrl, {
      method: "POST",
      body: envelope,
      headers: { "Content-Type": "application/x-sentry-envelope" },
      signal: AbortSignal.timeout(GLITCHTIP_TIMEOUT_MS),
    })

    return new NextResponse(response.body, { status: response.status })
  } catch {
    return new NextResponse(null, { status: 200 })
  }
}
