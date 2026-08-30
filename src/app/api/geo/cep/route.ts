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
    const message = err instanceof Error ? err.message : "Erro ao consultar CEP"
    return {
      data: { error: message } as unknown as import("@/lib/geo").ViaCEPResult,
      status: 400,
      cacheSeconds: 0,
    }
  }
})
