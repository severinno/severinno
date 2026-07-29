import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { geocodeCEP } from "@/lib/geo"
import { cacheControlPublic, handleError } from "@/lib/api-server"
import { withCache } from "@/lib/redis"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { geocodeCepSchema } from "@/lib/validators"

// Public: geocode a Brazilian CEP via ViaCEP.
// Returns a flat `CepResult` (UI: `apiGet<CepResult>("/api/geo/cep", { cep })`).
// Cached in Redis for 24h (CEP data rarely changes).
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.geo)
    const { searchParams } = new URL(request.url)
    const rawCep = searchParams.get("cep") || ""
    const { cep: clean } = geocodeCepSchema.parse({ cep: rawCep })

    const address = await withCache(
      `geo:cep:${clean}`,
      () => geocodeCEP(clean),
      604800, // 7 days (CEP data rarely changes)
    )
    return cacheControlPublic(NextResponse.json(address), 60)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "CEP inválido", details: e.issues }, { status: 400 })
    }
    return handleError(e)
  }
}
