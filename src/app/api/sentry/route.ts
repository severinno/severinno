import { NextRequest, NextResponse } from "next/server"

/**
 * Tunnel for Sentry/GlitchTip client-side errors.
 * Proxies envelope requests to the self-hosted GlitchTip instance
 * to bypass ad-blockers that block direct requests to error trackers.
 */
const GLITCHTIP_INTERNAL_URL = process.env.GLITCHTIP_INTERNAL_URL ?? "http://glitchtip-web:8000"

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
    })

    return new NextResponse(response.body, { status: response.status })
  } catch {
    return new NextResponse(null, { status: 200 })
  }
}
