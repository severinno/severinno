import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { geocodeCEP } from "@/lib/geo"
import { cacheControlPublic, handleError } from "@/lib/api-server"
import { assertGeoRateLimit } from "@/lib/geo-rate-limit"
import { geocodeCepSchema } from "@/lib/validators"

// Public: geocode a Brazilian CEP via ViaCEP.
// Returns a flat `CepResult` (UI: `apiGet<CepResult>("/api/geo/cep", { cep })`).
// Cached internally by geocodeCEP via withCachedGeo (Redis, 7d TTL).
export async function GET(request: Request) {
  try {
    await assertGeoRateLimit(request, "cep")
    const { searchParams } = new URL(request.url)
    const rawCep = searchParams.get("cep") || ""
    const { cep: clean } = geocodeCepSchema.parse({ cep: rawCep })

    const address = await geocodeCEP(clean)
    return cacheControlPublic(NextResponse.json(address), 60)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "CEP inválido", details: e.issues }, { status: 400 })
    }
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message || "Erro ao consultar CEP" }, { status: 400 })
    }
    return handleError(e)
  }
}
