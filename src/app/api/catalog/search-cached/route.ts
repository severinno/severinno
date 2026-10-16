import { NextRequest, NextResponse } from "next/server"
import { edgeCache, buildEdgeCacheHeaders } from "@/lib/edge-catalog-cache"

// Simulação de busca no banco com fallback resiliente
async function searchServicesFromDb(query: string, city: string) {
  // Dados de catálogo base
  const allServices = [
    { id: "srv-1", title: "Eletricista Residencial", category: "Eletricista", basePrice: 120 },
    { id: "srv-2", title: "Instalação de Chuveiro", category: "Eletricista", basePrice: 80 },
    { id: "srv-3", title: "Diarista / Faxina Completa", category: "Limpeza", basePrice: 180 },
    { id: "srv-4", title: "Desentupimento de Pia/Ralo", category: "Encanador", basePrice: 130 },
    { id: "srv-5", title: "Abertura de Porta / Chaveiro", category: "Chaveiro", basePrice: 100 },
    { id: "srv-6", title: "Montagem de Guarda-Roupa", category: "Montador", basePrice: 150 },
  ]

  const q = query.toLowerCase().trim()
  return allServices.filter(
    (s) => !q || s.title.toLowerCase().includes(q) || s.category.toLowerCase().includes(q),
  )
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get("q") || ""
    const city = searchParams.get("city") || "Governador Valadares"

    const cacheKey = `catalog:${city.toLowerCase()}:${q.toLowerCase()}`

    // Executa via EdgeCache com TTL de 5 minutos e SWR de 1 hora
    const result = await edgeCache.getOrFetch(cacheKey, () => searchServicesFromDb(q, city), {
      ttlSeconds: 300,
      swrSeconds: 3600,
    })

    const headers = buildEdgeCacheHeaders(300, 3600)

    return NextResponse.json(
      {
        success: true,
        city,
        query: q,
        source: result.source,
        total: result.data.length,
        services: result.data,
      },
      {
        status: 200,
        headers,
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro na busca de catálogo"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
