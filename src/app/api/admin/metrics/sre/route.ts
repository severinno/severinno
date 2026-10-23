export const dynamic = "force-dynamic"

/**
 * GET /api/admin/metrics/sre
 * POST /api/admin/metrics/sre
 *
 * Unified SRE & Resilience Telemetry Endpoint:
 * - Aggregates all external Circuit Breaker states, failure rates, and uptimes
 * - Exposes real-time Core Web Vitals SLA compliance
 * - Exposes process and memory saturation metrics
 * - Provides administrative operations: manual breaker resets and on-demand synthetic probe execution
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import {
  getAllCircuitBreakersStats,
  resetCircuitBreaker,
  resetAllCircuitBreakers,
} from "@/lib/circuit-breaker"
import { webVitalsRegistry } from "@/lib/web-vitals-registry"
import { runSyntheticProbe } from "@/lib/synthetic-prober"

export const GET = withRoute("api.admin.metrics.sre.GET", async () => {
  await requireRole("ADMIN")

  const circuitStats = getAllCircuitBreakersStats()
  const summary = {
    total: circuitStats.length,
    closed: circuitStats.filter((c) => c.state === "closed").length,
    halfOpen: circuitStats.filter((c) => c.state === "half-open").length,
    open: circuitStats.filter((c) => c.state === "open").length,
  }

  const webVitalsSummary = webVitalsRegistry.getSummary()

  const mem = process.memoryUsage()
  const system = {
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    nodeVersion: process.version,
    env: process.env.NODE_ENV || "development",
  }

  let status: "HEALTHY" | "DEGRADED" | "UNHEALTHY" = "HEALTHY"
  if (summary.open > 0 || webVitalsSummary.complianceScore < 70) {
    status = summary.open >= 2 ? "UNHEALTHY" : "DEGRADED"
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    status,
    circuitBreakers: {
      summary,
      items: circuitStats,
    },
    webVitals: {
      complianceScore: webVitalsSummary.complianceScore,
      totalSamples: webVitalsSummary.totalSamples,
      metrics: webVitalsSummary.metrics,
    },
    system,
  })
})

export const POST = withRoute("api.admin.metrics.sre.POST", async (request: Request) => {
  await requireRole("ADMIN")

  try {
    const body = await request.json()
    const { action, circuit } = body as { action?: string; circuit?: string }

    if (action === "reset_circuit") {
      if (!circuit || typeof circuit !== "string") {
        return NextResponse.json({ error: "Missing circuit name" }, { status: 400 })
      }
      const success = resetCircuitBreaker(circuit)
      if (!success) {
        return NextResponse.json(
          { error: `Circuit breaker '${circuit}' not found or not initialized` },
          { status: 404 },
        )
      }
      return NextResponse.json({
        success: true,
        message: `Circuit breaker '${circuit}' reset to CLOSED`,
      })
    }

    if (action === "reset_all_circuits") {
      resetAllCircuitBreakers()
      return NextResponse.json({
        success: true,
        message: "All circuit breakers reset to CLOSED",
      })
    }

    if (action === "run_synthetic_probe") {
      const probeReport = await runSyntheticProbe()
      return NextResponse.json({
        success: true,
        report: probeReport,
      })
    }

    return NextResponse.json(
      {
        error: "Invalid action. Supported: reset_circuit, reset_all_circuits, run_synthetic_probe",
      },
      { status: 400 },
    )
  } catch {
    return NextResponse.json({ error: "Malformed request payload" }, { status: 400 })
  }
})
