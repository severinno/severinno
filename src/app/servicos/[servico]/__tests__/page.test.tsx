import { describe, it, expect, vi } from "vitest"
import {
  getAllLandingPageSlugs,
  resolveLandingPage,
  generateMetadata,
  generateStaticParams,
  LANDING_PAGES,
} from "../page"
import sitemap from "@/app/sitemap"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    category: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

describe("Programmatic SEO & Landing Pages (/servicos/[servico])", () => {
  it("gera lista completa de slugs para Governador Valadares e seus bairros", () => {
    const slugs = getAllLandingPageSlugs()
    expect(slugs.length).toBe(420) // 20 serviços × (1 municipal + 20 bairros) = 420 páginas

    // Verifica páginas municipais
    expect(slugs).toContain("encanador-em-governador-valadares")
    expect(slugs).toContain("eletricista-em-governador-valadares")
    expect(slugs).toContain("diarista-em-governador-valadares")
    expect(slugs).toContain("vidraceiro-em-governador-valadares")
    expect(slugs).toContain("marceneiro-em-governador-valadares")
    expect(slugs).toContain("serralheiro-em-governador-valadares")

    // Verifica páginas por bairro de GV
    expect(slugs).toContain("eletricista-em-ilha-dos-araujos")
    expect(slugs).toContain("diarista-em-vila-isa")
    expect(slugs).toContain("pintor-em-centro")
    expect(slugs).toContain("pedreiro-em-sao-pedro")
    expect(slugs).toContain("vidraceiro-em-ilha-dos-araujos")
    expect(slugs).toContain("calheiro-em-esplanada")
    expect(slugs).toContain("marido-de-aluguel-em-lourdes")
    expect(slugs).toContain("desentupidora-em-santa-rita")
  })

  it("resolve metadados corretos para slug estática", () => {
    const page = resolveLandingPage("eletricista-em-ilha-dos-araujos")
    expect(page).not.toBeNull()
    expect(page?.service).toBe("Eletricista")
    expect(page?.city).toBe("Governador Valadares")
    expect(page?.neighborhood).toBe("Ilha dos Araújos")
    expect(page?.priceRange).toBe("R$ 80 - R$ 350")
  })

  it("resolve dinamicamente combinações válidas de serviço e bairro", () => {
    const page = resolveLandingPage("montador-de-moveis-em-esplanada")
    expect(page).not.toBeNull()
    expect(page?.service).toBe("Montador de Móveis")
    expect(page?.city).toBe("Governador Valadares")
    expect(page?.neighborhood).toBe("Esplanada")
  })

  it("retorna null para slug inválida", () => {
    const page = resolveLandingPage("astronauta-em-marte")
    expect(page).toBeNull()
  })

  it("generateStaticParams retorna todas as slugs para pré-renderização estática", () => {
    const params = generateStaticParams()
    expect(params.length).toBe(Object.keys(LANDING_PAGES).length)
    expect(params[0]).toHaveProperty("servico")
  })

  it("generateMetadata retorna título formatado e canonical URL", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ servico: "encanador-em-ilha-dos-araujos" }),
    })

    expect(meta.title).toContain("Encanador em Ilha dos Araújos, Governador Valadares - MG")
    expect(meta.description).toContain("Ilha dos Araújos em Governador Valadares")
    expect(meta.openGraph?.url).toBe(
      "https://severinno.com.br/servicos/encanador-em-ilha-dos-araujos",
    )
  })

  it("sitemap() inclui as URLs programáticas de serviços com prioridade 0.8", async () => {
    const siteUrls = await sitemap()
    const serviceUrls = siteUrls.filter((u) => u.url.includes("/servicos/"))
    expect(serviceUrls.length).toBeGreaterThan(50)

    const sample = serviceUrls.find((u) => u.url.includes("eletricista-em-ilha-dos-araujos"))
    expect(sample).toBeDefined()
    expect(sample?.priority).toBe(0.8)
    expect(sample?.changeFrequency).toBe("weekly")
  })
})
