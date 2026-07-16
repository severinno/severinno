import { NextResponse } from "next/server"
import { geocodeCEP } from "@/lib/geo"
import { handleError } from "@/lib/api-server"

// Public: geocode a Brazilian CEP via ViaCEP.
// Returns a flat `CepResult` (UI: `apiGet<CepResult>("/api/geo/cep", { cep })`).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const cep = searchParams.get("cep") || ""
    const address = await geocodeCEP(cep)
    return NextResponse.json(address)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "CEP inválido"
    if (msg.toLowerCase().includes("não encontrado")) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
