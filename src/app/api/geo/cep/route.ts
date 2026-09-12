export const dynamic = "force-dynamic"

/**
 * GET /api/geo/cep?cep=30130-000
 *
 * Geocode a Brazilian CEP via ViaCEP.
 * Returns: { cep, street, district, city, state }
 *
 * Uses withGeoMiddleware for unified rate limiting, caching, and error handling.
 */
import { geocodeCEP } from "@/lib/geo"
import { withGeoMiddleware } from "@/lib/geo-middleware"
import { geocodeCepSchema } from "@/lib/validators"

export const GET = withGeoMiddleware(async ({ searchParams }) => {
  const rawCep = searchParams.get("cep") || ""
  const { cep } = geocodeCepSchema.parse({ cep: rawCep })

  const address = await geocodeCEP(cep).catch((err) => {
    const e = err instanceof Error ? err : new Error("Erro ao consultar CEP")
    ;(e as Error & { statusCode?: number }).statusCode = 400
    throw e
  })
  return { data: address, cacheSeconds: 60 }
})
