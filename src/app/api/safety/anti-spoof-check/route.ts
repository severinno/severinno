export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { evaluateGeoTelemetry, type GeoTelemetrySample } from "@/lib/geo-spoof-detector"

export const POST = withRoute("api.safety.anti-spoof-check.POST", async (req) => {
  await assertRateLimit(req, RATE_LIMITS.general)

  try {
    const body = await req.json()
    const { current, previous } = body as {
      current?: GeoTelemetrySample
      previous?: GeoTelemetrySample
    }

    if (!current || typeof current.latitude !== "number" || typeof current.longitude !== "number") {
      return NextResponse.json(
        { error: "Amostra de telemetria atual 'current' com latitude e longitude é obrigatória" },
        { status: 400 },
      )
    }

    const verdict = evaluateGeoTelemetry(current, previous)

    return NextResponse.json({
      success: true,
      verdict,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro interno na verificação anti-spoof"
    return NextResponse.json({ error: message }, { status: 500 })
  }
})
