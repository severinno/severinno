export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * Tunnel for Sentry/GlitchTip client-side errors.
 * Proxies envelope requests to the self-hosted GlitchTip instance
 * to bypass ad-blockers that block direct requests to error trackers.
 *
 * Validates DSN against expected project ID to prevent abuse.
 */
function getGlitchtipInternalUrl(): string {
  return process.env.GLITCHTIP_INTERNAL_URL ?? "http://glitchtip-web:8000"
}

function getExpectedProjectId(): string | null {
  return process.env.SENTRY_PROJECT_ID ?? process.env.GLITCHTIP_PROJECT_ID ?? null
}

export async function POST(request: NextRequest) {
  try {
    await assertRateLimit(request, RATE_LIMITS.webhookSentry)

    const envelope = await request.text()
    const piece = envelope.split("\n")[0]
    const header = JSON.parse(piece)
    const dsn = new URL(header.dsn as string)
    const projectId = dsn.pathname.replace("/", "")

    // Validate DSN project ID to prevent proxying arbitrary requests
    const expectedId = getExpectedProjectId()
    if (expectedId && projectId !== expectedId) {
      return NextResponse.json({ error: "Invalid project" }, { status: 403 })
    }

    const glitchtipUrl = `${getGlitchtipInternalUrl()}/api/${projectId}/envelope/`

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
