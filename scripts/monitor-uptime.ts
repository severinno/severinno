/**
 * monitor-uptime.ts — Real-time Uptime, Latency & SLA Prober
 *
 * Continuously or one-shot probes critical platform endpoints,
 * measures response times against target SLAs, and triggers alerts
 * upon degradation or outage.
 *
 * Target SLAs:
 * - /api/health: < 80ms
 * - /api/health/extended: < 150ms
 * - /api/search/bbox: < 200ms
 * - /api/geo/route-eta: < 350ms
 *
 * Usage:
 *   bun scripts/monitor-uptime.ts --dry-run
 *   bun scripts/monitor-uptime.ts --interval=30 --url=http://localhost:3000
 */

import { AlertingService } from "../src/lib/alerting-service"

interface EndpointProbe {
  name: string
  path: string
  maxLatencyMs: number
  critical: boolean
}

const PROBES: EndpointProbe[] = [
  {
    name: "Base Health Check",
    path: "/api/health",
    maxLatencyMs: 100,
    critical: true,
  },
  {
    name: "Extended Deep Health Diagnostic",
    path: "/api/health/extended",
    maxLatencyMs: 250,
    critical: true,
  },
  {
    name: "Geo PostGIS & BBox Spatial Search",
    path: "/api/search/bbox?minLat=-23.60&maxLat=-23.50&minLng=-46.70&maxLng=-46.60",
    maxLatencyMs: 200,
    critical: false,
  },
  {
    name: "OSRM Road Route & Driving ETA",
    path: "/api/geo/route-eta?originLat=-23.5505&originLng=-46.6333&destLat=-23.5650&destLng=-46.6870",
    maxLatencyMs: 350,
    critical: false,
  },
]

async function probeEndpoint(baseUrl: string, probe: EndpointProbe) {
  const url = `${baseUrl}${probe.path}`
  const start = performance.now()

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    })
    const elapsed = Math.round(performance.now() - start)
    const isOk = res.status >= 200 && res.status < 400

    if (!isOk) {
      console.log(`❌ [FAIL] ${probe.name.padEnd(38)} HTTP ${res.status} (${elapsed}ms)`)
      await AlertingService.reportOutage(
        probe.name,
        `Endpoint ${probe.path} retornou status HTTP ${res.status} em ${elapsed}ms.`
      )
      return { success: false, latency: elapsed, status: res.status }
    }

    if (elapsed > probe.maxLatencyMs) {
      console.log(`⚠️ [SLOW] ${probe.name.padEnd(38)} HTTP ${res.status} (${elapsed}ms > SLA ${probe.maxLatencyMs}ms)`)
      await AlertingService.reportLatencySpike(probe.path, elapsed, probe.maxLatencyMs)
      return { success: true, latency: elapsed, status: res.status, slaBreach: true }
    }

    console.log(`✅ [OK]   ${probe.name.padEnd(38)} HTTP ${res.status} (${elapsed}ms)`)
    return { success: true, latency: elapsed, status: res.status }
  } catch (error) {
    const elapsed = Math.round(performance.now() - start)
    const msg = error instanceof Error ? error.message : String(error)
    console.log(`❌ [ERR]  ${probe.name.padEnd(38)} Connection Timeout/Error (${elapsed}ms) — ${msg}`)

    if (probe.critical) {
      await AlertingService.reportOutage(probe.name, `Falha de rede ao conectar em ${url}: ${msg}`)
    }
    return { success: false, latency: elapsed, error: msg }
  }
}

export async function runMonitoringCycle(baseUrl: string) {
  console.log(`\n🩺 [MONITOR] Probing ${PROBES.length} platform endpoints at ${baseUrl} — ${new Date().toLocaleTimeString()}...`)
  console.log("-------------------------------------------------------------------------------------------------")

  let passed = 0
  let failed = 0

  for (const probe of PROBES) {
    const res = await probeEndpoint(baseUrl, probe)
    if (res.success) passed++
    else failed++
  }

  console.log("-------------------------------------------------------------------------------------------------")
  console.log(`📊 Result: ${passed}/${PROBES.length} passed | ${failed} failed\n`)
  return { passed, failed }
}

async function main() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes("--dry-run")
  const urlArg = args.find((a) => a.startsWith("--url="))
  const baseUrl = urlArg ? urlArg.split("=")[1] : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

  console.log("=================================================================")
  console.log("  ⚡ SEVERINNO UPTIME & SLA HEALTH PROBER")
  console.log(`  🌐 Target Base URL: ${baseUrl}`)
  console.log(`  Mode: ${isDryRun ? "One-shot dry run" : "Continuous monitoring"}`)
  console.log("=================================================================")

  if (isDryRun) {
    await runMonitoringCycle(baseUrl)
    process.exit(0)
  }

  // Continuous monitoring loop
  const intervalArg = args.find((a) => a.startsWith("--interval="))
  const intervalSec = intervalArg ? parseInt(intervalArg.split("=")[1], 10) : 30

  console.log(`⏱️ Running continuous probe every ${intervalSec} seconds... (Press Ctrl+C to stop)\n`)

  await runMonitoringCycle(baseUrl)
  setInterval(async () => {
    await runMonitoringCycle(baseUrl)
  }, intervalSec * 1000)
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes("monitor-uptime")) {
  main().catch((e) => {
    console.error("Monitor error:", e)
    process.exit(1)
  })
}
