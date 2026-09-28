export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { geocodeSearch, geocodeSearchStructured } from "@/lib/geo"
import { cacheControlPublic, handleError } from "@/lib/api-server"
import { assertGeoRateLimit } from "@/lib/geo-rate-limit"
import { geocodeSearchSchema, geocodeSearchStructuredSchema } from "@/lib/validators"

// ---------------------------------------------------------------------------
// GET /api/geo/search
// ---------------------------------------------------------------------------

/**
 * Forward-geocode an address via Nominatim Search (OpenStreetMap).
 *
 * Two modes:
 *
 * **Free-form** (default):
 *   `GET /api/geo/search?q=Rua+Augusta,+São+Paulo&limit=5`
 *
 * **Structured** (mais preciso — use quando tiver campos separados):
 *   `GET /api/geo/search?street=Rua+Augusta&city=São+Paulo&state=SP&limit=5`
 *
 * Parâmetros comuns:
 *   - `limit` (opcional, default 5, max 10): número máximo de resultados
 *
 * Parâmetros estruturados (todos opcionais, mas ao menos um deve ser informado):
 *   - `street`  – logradouro (opcionalmente com número), ex.: "Av. Paulista, 1000"
 *   - `city`    – cidade ou localidade, ex.: "São Paulo"
 *   - `state`   – estado (sigla ou nome), ex.: "SP"
 *   - `country` – país (default inferido pelo Nominatim como Brasil)
 *   - `postcode`– CEP, ex.: "01310-100"
 *
 * Cache Redis de 24h. Rate limiting de 1 req/s para respeitar política OSM.
 */
export async function GET(request: Request) {
  try {
    await assertGeoRateLimit(request, "search")

    const { searchParams } = new URL(request.url)

    // Detect structured mode: if any of street/city/state is present, use structured
    const street = searchParams.get("street")
    const city = searchParams.get("city")
    const state = searchParams.get("state")
    const country = searchParams.get("country")
    const postcode = searchParams.get("postcode")
    const hasStructured = !!(street?.trim() || city?.trim() || state?.trim())

    if (hasStructured) {
      const parsed = geocodeSearchStructuredSchema.parse({
        street: street ?? undefined,
        city: city ?? undefined,
        state: state ?? undefined,
        country: country ?? undefined,
        postcode: postcode ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
      })
      // Convert undefined → null for handleStructured's nullable params
      return await handleStructured({
        street: parsed.street ?? null,
        city: parsed.city ?? null,
        state: parsed.state ?? null,
        country: parsed.country ?? null,
        postcode: parsed.postcode ?? null,
        limit: parsed.limit,
      })
    }

    // Free-form query with Zod validation
    const raw = searchParams.get("q") || ""
    if (!raw.trim()) {
      return noStoreJson(
        { error: 'Parâmetro "q" é obrigatório (endereço textual) ou informe street/city/state' },
        400,
      )
    }
    // `searchParams.get()` retorna null quando o param está ausente; o schema
    // Zod usa `.optional()` (undefined, não null) e `coerce.number(null)` → 0
    // quebraria o min(1). Converter null → undefined antes do parse.
    const parsed = geocodeSearchSchema.parse({
      q: raw,
      limit: searchParams.get("limit") ?? undefined,
    })

    return await handleFreeForm(parsed.q, parsed.limit)
  } catch (e) {
    if (e instanceof ZodError) {
      return noStoreJson({ error: "Dados inválidos", details: e.issues }, 400)
    }
    return handleError(e)
  }
}

/**
 * JSON error response that must NEVER be cached (house rule: errors carry
 * `Cache-Control: no-store`). Same contract as geo-middleware and all other
 * routes — a cached 4xx would pin an invalid request result for the TTL.
 */
function noStoreJson(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set("Cache-Control", "no-store")
  return response
}

// ---------------------------------------------------------------------------
// Handler: free-form query (q)
// ---------------------------------------------------------------------------

async function handleFreeForm(q: string, limit: number) {
  // Cache é gerenciado internamente por geocodeSearch (via withCachedGeo)
  const results = await geocodeSearch(q, limit)
  return cacheControlPublic(NextResponse.json(results), 60)
}

// ---------------------------------------------------------------------------
// Handler: structured query (street + city + state + ...)
// ---------------------------------------------------------------------------

async function handleStructured(opts: {
  street: string | null
  city: string | null
  state: string | null
  country: string | null
  postcode: string | null
  limit: number
}) {
  const { street, city, state, country, postcode, limit } = opts

  // Cache é gerenciado internamente por geocodeSearchStructured (via withCachedGeo)
  const results = await geocodeSearchStructured({
    street,
    city,
    state,
    country: country || "Brazil",
    postcode,
    limit,
  })

  return cacheControlPublic(NextResponse.json(results), 60)
}
