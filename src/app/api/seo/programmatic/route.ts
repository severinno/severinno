import { NextRequest, NextResponse } from "next/server"
import {
  generateProgrammaticSeo,
  generateProgrammaticSitemapSlugs,
} from "@/lib/seo-programmatic-engine"
import { buildEdgeCacheHeaders } from "@/lib/edge-catalog-cache"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const mode = searchParams.get("mode")

    // Modo sitemap: retorna todos os slugs programáticos
    if (mode === "sitemap") {
      const slugs = generateProgrammaticSitemapSlugs()
      return NextResponse.json({ success: true, count: slugs.length, slugs })
    }

    const citySlug = searchParams.get("city") || "governador-valadares"
    const serviceSlug = searchParams.get("service") || "eletricista"
    const neighborhoodSlug = searchParams.get("neighborhood") || undefined

    const seoData = generateProgrammaticSeo({
      citySlug,
      serviceSlug,
      neighborhoodSlug,
    })

    // Cabeçalhos de Edge Cache para SEO (1 hora de TTL, 24 horas de SWR)
    const headers = buildEdgeCacheHeaders(3600, 86400)

    return NextResponse.json(
      {
        success: true,
        data: seoData,
      },
      {
        status: 200,
        headers,
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao gerar metadados de SEO"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
