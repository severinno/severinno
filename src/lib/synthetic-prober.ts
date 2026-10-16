import { db } from "@/lib/db"
import { ensureConnected, activeTier } from "@/lib/redis"
import { generateEscrowOtp, verifyEscrowOtp } from "@/lib/escrow-otp-challenge"
import { haversineKm } from "@/lib/geo-server"
import { AlertingService } from "@/lib/alerting-service"

export interface PhaseProbeResult {
  status: "PASS" | "WARN" | "FAIL"
  latencyMs: number
  details?: string
}

export interface SyntheticProbeReport {
  status: "PASS" | "WARN" | "FAIL"
  timestamp: string
  totalDurationMs: number
  phases: {
    database: PhaseProbeResult
    redis: PhaseProbeResult
    escrowOtp: PhaseProbeResult
    geoDistance: PhaseProbeResult
  }
  warnings: string[]
}

/**
 * Executa uma transação sintética ponta a ponta para aferição real de saúde e SRE.
 */
export async function runSyntheticProbe(): Promise<SyntheticProbeReport> {
  const overallStart = performance.now()
  const timestamp = new Date().toISOString()
  const warnings: string[] = []

  let overallStatus: "PASS" | "WARN" | "FAIL" = "PASS"

  // ── Fase 1: Database & PostGIS ───────────────────────────────────────────
  let dbResult: PhaseProbeResult
  const dbStart = performance.now()
  try {
    // 1.1 Consulta simples
    const userCount = await db.user.count()

    // 1.2 Checagem PostGIS
    const postgis = await db.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'postgis';
    `
    const hasPostgis = Array.isArray(postgis) && postgis.length > 0
    const dbLatency = Math.round(performance.now() - dbStart)

    dbResult = {
      status: "PASS",
      latencyMs: dbLatency,
      details: `${userCount} usuários indexados. PostGIS: ${hasPostgis ? "Ativo" : "Fallback"}`,
    }

    if (dbLatency > 800) {
      dbResult.status = "WARN"
      warnings.push(`Latência do PostgreSQL elevada: ${dbLatency}ms.`)
    }
  } catch (err) {
    const dbLatency = Math.round(performance.now() - dbStart)
    dbResult = {
      status: "FAIL",
      latencyMs: dbLatency,
      details: err instanceof Error ? err.message : "Falha na query PostgreSQL",
    }
    overallStatus = "FAIL"
    warnings.push(`PostgreSQL indisponível: ${dbResult.details}`)
  }

  // ── Fase 2: Redis Roundtrip ──────────────────────────────────────────────
  let redisResult: PhaseProbeResult
  const redisStart = performance.now()
  try {
    const client = await ensureConnected()
    if (client && activeTier !== "memory") {
      const testKey = `synthetic:probe:${Date.now()}`
      await client.set(testKey, "1", "EX", 10)
      const val = await client.get(testKey)
      await client.del(testKey)

      const redisLatency = Math.round(performance.now() - redisStart)
      if (val === "1") {
        redisResult = {
          status: "PASS",
          latencyMs: redisLatency,
          details: `Tier ativo: ${activeTier}`,
        }
      } else {
        redisResult = {
          status: "WARN",
          latencyMs: redisLatency,
          details: "Leitura divergente no Redis",
        }
      }
    } else {
      redisResult = {
        status: "WARN",
        latencyMs: 1,
        details: "Operando em fallback de memória local",
      }
    }
  } catch (err) {
    const redisLatency = Math.round(performance.now() - redisStart)
    redisResult = {
      status: "WARN",
      latencyMs: redisLatency,
      details: err instanceof Error ? err.message : "Falha na comunicação Redis",
    }
    warnings.push("Redis degradado; fallback ativo.")
  }

  // ── Fase 3: Escrow & OTP Handshake ───────────────────────────────────────
  let escrowResult: PhaseProbeResult
  const escrowStart = performance.now()
  try {
    const syntheticBookingId = `probe-${Date.now()}`
    const syntheticClientId = "client-synthetic-probe"
    const { otp } = await generateEscrowOtp(syntheticBookingId, syntheticClientId)

    // Valida o OTP gerado (deve aprovar)
    const verification = await verifyEscrowOtp(syntheticBookingId, otp, syntheticClientId)
    const escrowLatency = Math.round(performance.now() - escrowStart)

    if (verification.success) {
      escrowResult = {
        status: "PASS",
        latencyMs: escrowLatency,
        details: "Geração e validação de OTP com crypto em tempo constante",
      }
    } else {
      escrowResult = {
        status: "FAIL",
        latencyMs: escrowLatency,
        details: verification.error || "Falha na validação do OTP sintético",
      }
      overallStatus = "FAIL"
    }
  } catch (err) {
    const escrowLatency = Math.round(performance.now() - escrowStart)
    escrowResult = {
      status: "FAIL",
      latencyMs: escrowLatency,
      details: err instanceof Error ? err.message : "Erro no pipeline de custódia",
    }
    overallStatus = "FAIL"
  }

  // ── Fase 4: Geo Distance Engine ──────────────────────────────────────────
  let geoResult: PhaseProbeResult
  const geoStart = performance.now()
  try {
    // Distância Centro -> Ilha dos Araújos em GV
    const distKm = haversineKm(-18.8546, -41.9443, -18.8414, -41.9484)
    const geoLatency = Math.round(performance.now() - geoStart)

    // Distância conhecida entre Centro e Ilha é de ~1.5 km
    if (distKm > 1.0 && distKm < 2.0) {
      geoResult = {
        status: "PASS",
        latencyMs: geoLatency,
        details: `Cálculo geodésico calibrado (${distKm.toFixed(2)} km)`,
      }
    } else {
      geoResult = {
        status: "WARN",
        latencyMs: geoLatency,
        details: `Distância anômala calculada: ${distKm} km`,
      }
    }
  } catch (err) {
    const geoLatency = Math.round(performance.now() - geoStart)
    geoResult = {
      status: "FAIL",
      latencyMs: geoLatency,
      details: err instanceof Error ? err.message : "Erro no cálculo geográfico",
    }
  }

  const totalDurationMs = Math.round(performance.now() - overallStart)

  if (totalDurationMs > 2500 && overallStatus !== "FAIL") {
    overallStatus = "WARN"
    warnings.push(`Duração total da transação sintética elevada: ${totalDurationMs}ms.`)
  }

  if (overallStatus === "FAIL") {
    void AlertingService.reportOutage(
      "SyntheticProber",
      `Falha na transação sintética: ${warnings.join(" | ") || "Erro em fases vitais"}`,
    )
  }

  return {
    status: overallStatus,
    timestamp,
    totalDurationMs,
    phases: {
      database: dbResult,
      redis: redisResult,
      escrowOtp: escrowResult,
      geoDistance: geoResult,
    },
    warnings,
  }
}
