import { NextResponse } from "next/server"
import { geocodeCEP } from "@/lib/geo"
import { handleError } from "@/lib/api-server"
import { withCache } from "@/lib/redis"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

// Public: geocode a Brazilian CEP via ViaCEP.
// Returns a flat `CepResult` (UI: `apiGet<CepResult>("/api/geo/cep", { cep })`).
// Cached in Redis for 24h (CEP data rarely changes).
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.geo)
    const { searchParams } = new URL(request.url)
    const cep = searchParams.get("cep") || ""
    const clean = cep.replace(/\D/g, "")

    const address = await withCache(
      `geo:cep:${clean}`,
      () => geocodeCEP(clean),
      86400, // 24h
    )
    return NextResponse.json(address)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "CEP inválido"
    if (msg.toLowerCase().includes("não encontrado")) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
