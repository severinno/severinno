import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { geocodeSearch, geocodeSearchStructured } from "@/lib/geo"
import { cacheControlPublic, HttpError, handleError } from "@/lib/api-server"
import { withCache } from "@/lib/redis"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { rateLimitedNominatim } from "@/lib/nominatim-rate-limit"
import {
  geocodeSearchSchema,
  geocodeSearchStructuredSchema,
} from "@/lib/validators"

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
    await assertRateLimit(request, RATE_LIMITS.geo)

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
        street,
        city,
        state,
        country,
        postcode,
        limit: searchParams.get("limit"),
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
      return NextResponse.json(
        { error: "Parâmetro \"q\" é obrigatório (endereço textual) ou informe street/city/state" },
        { status: 400 },
      )
    }
    const parsed = geocodeSearchSchema.parse({
      q: raw,
      limit: searchParams.get("limit"),
    })

    return await handleFreeForm(parsed.q, parsed.limit)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: e.issues },
        { status: 400 },
      )
    }
    return handleError(e)
  }
}

// ---------------------------------------------------------------------------
// Handler: free-form query (q)
// ---------------------------------------------------------------------------

async function handleFreeForm(q: string, limit: number) {
  const normalised = q.trim().toLowerCase().replace(/\s+/g, " ")
  const cacheKey = `geo:search:${normalised}:${limit}`

  const results = await withCache(
    cacheKey,
    () => rateLimitedNominatim(() => geocodeSearch(q, limit)),
    86400,
  )

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

  // Build a deterministic cache key from the structured fields
  const parts = [
    street?.trim().toLowerCase() ?? "",
    city?.trim().toLowerCase() ?? "",
    state?.trim().toLowerCase() ?? "",
    country?.trim().toLowerCase() ?? "",
    postcode?.trim() ?? "",
    String(limit),
  ].join(":")
  const cacheKey = `geo:search:structured:${parts}`

  const results = await withCache(
    cacheKey,
    () =>
      rateLimitedNominatim(() =>
        geocodeSearchStructured({
          street,
          city,
          state,
          country: country || "Brazil",
          postcode,
          limit,
        }),
      ),
    86400,
  )

  return cacheControlPublic(NextResponse.json(results), 60)
}
