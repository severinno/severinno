import { describe, it, expect } from "vitest"
import {
  generateProgrammaticSeo,
  generateProgrammaticSitemapSlugs,
} from "../seo-programmatic-engine"

describe("seo-programmatic-engine", () => {
  it("gera metadados e Schema.org para combinação de Cidade + Bairro + Serviço", () => {
    const seo = generateProgrammaticSeo({
      citySlug: "governador-valadares",
      neighborhoodSlug: "centro",
      serviceSlug: "eletricista",
    })

    expect(seo.title).toContain("Eletricista no bairro Centro (Governador Valadares)")
    expect(seo.metaDescription).toContain("Governador Valadares")
    expect(seo.h1).toContain("Centro")
    expect(seo.canonicalUrl).toBe(
      "https://severinno.com.br/mg/governador-valadares/centro/eletricista",
    )
    expect(seo.priceRange).toBe("R$ 80 - R$ 350")
    expect(seo.estimatedArrival).toBe("35 min")

    // Verifica Schema.org LocalBusiness
    const localBusiness = seo.jsonLdLocalBusiness as {
      "@type": string
      name: string
      geo: { latitude: number; longitude: number }
    }
    expect(localBusiness["@type"]).toBe("LocalBusiness")
    expect(localBusiness.name).toContain("Eletricista")
    expect(localBusiness.geo.latitude).toBeCloseTo(-18.851)

    // Verifica Schema.org FAQPage
    const faq = seo.jsonLdFaq as { "@type": string; mainEntity: unknown[] }
    expect(faq["@type"]).toBe("FAQPage")
    expect(faq.mainEntity.length).toBe(2)
  })

  it("gera metadados para nível municipal quando o bairro não é informado", () => {
    const seo = generateProgrammaticSeo({
      citySlug: "governador-valadares",
      serviceSlug: "chaveiro",
    })

    expect(seo.title).toContain("Chaveiro em Governador Valadares - MG")
    expect(seo.canonicalUrl).toBe("https://severinno.com.br/mg/governador-valadares/chaveiro")
    expect(seo.neighborhood).toBeUndefined()
  })

  it("rejeita cidade ou serviço inválido", () => {
    expect(() =>
      generateProgrammaticSeo({
        citySlug: "cidade-inexistente",
        serviceSlug: "eletricista",
      }),
    ).toThrow()

    expect(() =>
      generateProgrammaticSeo({
        citySlug: "governador-valadares",
        serviceSlug: "astronauta",
      }),
    ).toThrow()
  })

  it("gera catálogo completo de slugs de sitemap", () => {
    const sitemap = generateProgrammaticSitemapSlugs()
    expect(sitemap.length).toBeGreaterThanOrEqual(400)

    const hasCentroEletricista = sitemap.some(
      (item) => item.path === "/mg/governador-valadares/centro/eletricista",
    )
    expect(hasCentroEletricista).toBe(true)

    const hasIlhaVidraceiro = sitemap.some(
      (item) => item.path === "/mg/governador-valadares/ilha-dos-araujos/vidraceiro",
    )
    expect(hasIlhaVidraceiro).toBe(true)

    const hasVilaIsaCalheiro = sitemap.some(
      (item) => item.path === "/mg/governador-valadares/vila-isa/calheiro",
    )
    expect(hasVilaIsaCalheiro).toBe(true)
  })
})
