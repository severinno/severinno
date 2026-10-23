import { NextResponse } from "next/server"
import logger from "@/lib/logger"
import { webVitalsRegistry } from "@/lib/web-vitals-registry"

/**
 * POST /api/web-vitals
 *
 * Receives Web Vitals metrics from the client (LCP, INP, CLS, FCP, TTFB).
 * Records in webVitalsRegistry for the admin dashboard and logs for Loki/Promtail.
 *
 * Metrics are sent via navigator.sendBeacon (fire-and-forget).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, value, rating, id, navigationType, delta, timestamp } = body

    if (!name || typeof value !== "number") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    // Record in in-memory registry for real-time telemetry dashboard
    webVitalsRegistry.record({
      name,
      value,
      rating,
      id,
      navigationType,
      delta,
      timestamp,
    })

    // Log metric — structured for Loki/Promtail ingestion
    logger.info(
      {
        metric: name,
        value: Math.round(value * 100) / 100,
        rating,
        metricId: id,
        navigationType,
        delta: Math.round(delta * 100) / 100,
        ts: timestamp,
      },
      `[WebVitals] ${name}=${Math.round(value)}ms (${rating})`,
    )

    return NextResponse.json({ ok: true })
  } catch {
    // Silently ignore — beacon failures should never affect the user
    return NextResponse.json({ ok: true })
  }
}
