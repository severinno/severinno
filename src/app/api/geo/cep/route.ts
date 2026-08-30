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

  try {
    const address = await geocodeCEP(cep)
    return { data: address, cacheSeconds: 60 }
  } catch (err) {
    // Map ViaCEP errors to 400 with the upstream message
    const message = err instanceof Error ? err.message : "Erro ao consultar CEP"
    return {
      data: { error: message },
      status: 400,
      cacheSeconds: 0,
    }
  }
})
