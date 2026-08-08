import { NextResponse } from "next/server"
import { geocodeSearch, geocodeSearchStructured } from "@/lib/geo"
import { cacheControlPublic, HttpError } from "@/lib/api-server"
import { withCache } from "@/lib/redis"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { rateLimitedNominatim } from "@/lib/nominatim-rate-limit"

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
    const limitRaw = searchParams.get("limit")
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : Number.NaN
    // `|| 5` would coerce "0" to the default (5), violating the documented
    // minimum of 1 — so only fall back to 5 when the value is not a number.
    const limit = limitRaw
      ? Math.max(1, Math.min(10, Number.isNaN(parsedLimit) ? 5 : parsedLimit))
      : 5

    // Detect structured mode: if any of street/city/state is present, use structured
    const street = searchParams.get("street")
    const city = searchParams.get("city")
    const state = searchParams.get("state")
    const country = searchParams.get("country")
    const postcode = searchParams.get("postcode")
    const hasStructured = !!(street?.trim() || city?.trim() || state?.trim())

    if (hasStructured) {
      return await handleStructured({
        street, city, state, country, postcode, limit,
      })
    }

    // Fallback to free-form query
    const q = searchParams.get("q") || ""
    if (!q.trim()) {
      return NextResponse.json(
        { error: "Parâmetro \"q\" é obrigatório (endereço textual) ou informe street/city/state" },
        { status: 400 },
      )
    }

    return await handleFreeForm(q, limit)
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    const msg = e instanceof Error ? e.message : "Erro ao buscar endereço"
    return NextResponse.json({ error: msg }, { status: 502 })
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
