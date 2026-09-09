import "server-only"

import { db } from "@/lib/db"
import { trackGeoLatency } from "./geo-metrics"
import { withCache } from "./redis"
import { rateLimitedViaCEP } from "./viacep-rate-limit"
import { viacepBreaker } from "./geo-circuit-breakers"
import { recordCEP } from "./geo-query-log"
import { getGeoSettings } from "./geo-settings"
import { geoFetchWithRetry } from "./geo-fetch"
import logger from "./logger"
import { traceSpan } from "./tracing"
import { geoCallCounts, geoFallbackCounts } from "./geo-stats"

// ── Cache-aside wrapper ───────────────────────────────────────────────────

function withCachedGeo<T>(
  key: string,
  fn: () => Promise<T>,
  ttl: number,
  limiter: (f: () => Promise<T>) => Promise<T> = rateLimitedViaCEP,
): Promise<T> {
  return withCache(key, () => limiter(fn), ttl, {
    staleGraceSeconds: Math.round(ttl * 0.1),
  })
}

// ── Types ─────────────────────────────────────────────────────────────────

/** Result from ViaCEP API — Brazilian postal code lookup. */
export type ViaCEPResult = {
  cep: string
  street: string
  district: string
  city: string
  state: string
}

// ── Internal implementations ──────────────────────────────────────────────

async function _geocodeCEP(cep: string): Promise<ViaCEPResult> {
  const clean = cep.length === 8 && /^\d{8}$/.test(cep) ? cep : cep.replace(/\D/g, "")
  if (clean.length !== 8) {
    throw new Error("CEP inválido (deve ter 8 dígitos)")
  }

  try {
    const settings = await getGeoSettings()
    if (!settings.viacepEnabled) return geocodeCEPLocal(clean)

    const res = await viacepBreaker.execute(async () => {
      const url = `${settings.viacepBaseUrl}/ws/${clean}/json/`
      const r = await geoFetchWithRetry(url, {
        headers: { Accept: "application/json" },
        next: { revalidate: 86400 },
        timeoutMs: 5000,
        maxRetries: 1,
        label: "viacep",
      })
      if (!r.ok) throw new Error(`ViaCEP HTTP ${r.status}`)
      return r
    })

    const data = (await res.json()) as {
      cep?: string
      logradouro?: string
      bairro?: string
      localidade?: string
      uf?: string
      erro?: boolean
    }
    if (data.erro) throw new Error("CEP não encontrado")

    return {
      cep: data.cep ?? clean,
      street: data.logradouro ?? "",
      district: data.bairro ?? "",
      city: data.localidade ?? "",
      state: data.uf ?? "",
    }
  } catch (err) {
    logger.debug({ err }, "geo: CEP fallback to local")
    geoFallbackCounts.cep++
    return geocodeCEPLocal(clean)
  }
}

/**
 * Fallback local CEP lookup when ViaCEP is unavailable.
 *
 * Searches the User table for a provider whose `cep` matches the given CEP.
 * Returns a ViaCEPResult-compatible object so the caller receives the same
 * shape regardless of whether ViaCEP or the fallback was used.
 */
async function geocodeCEPLocal(cep: string): Promise<ViaCEPResult> {
  try {
    const withHyphen = `${cep.slice(0, 5)}-${cep.slice(5)}`
    const user = await db.user.findFirst({
      where: {
        role: "PROVIDER",
        active: true,
        OR: [{ cep: cep }, { cep: withHyphen }],
      },
      select: { cep: true, street: true, district: true, city: true, state: true },
      orderBy: { avgRating: "desc" as const },
    })

    if (!user) {
      throw new Error("CEP não encontrado")
    }

    return {
      cep: user.cep ?? cep,
      street: user.street ?? "",
      district: user.district ?? "",
      city: user.city ?? "",
      state: user.state ?? "",
    }
  } catch (err) {
    logger.debug({ err }, "geo: local CEP DB fallback failed")
    throw new Error("CEP não encontrado")
  }
}

// ── Public instrumented + cached wrapper ──────────────────────────────────

/** Wraps geocodeCEP with Redis cache (24h TTL) + ViaCEP latency tracking + limiter 60 req/min. */
export async function geocodeCEP(cep: string): Promise<ViaCEPResult> {
  return traceSpan("geo.geocodeCEP", async (span) => {
    geoCallCounts.cep++
    const clean = cep.replace(/\D/g, "")
    span.setAttribute("geo.cep", clean)
    const result = await withCachedGeo(
      `geo:cep:${clean}`,
      () => trackGeoLatency("viacep", () => _geocodeCEP(clean)),
      86400,
      rateLimitedViaCEP,
    )
    span.setAttribute("geo.result.city", result.city)
    span.setAttribute("geo.result.state", result.state)
    recordCEP(clean)
    return result
  })
}
