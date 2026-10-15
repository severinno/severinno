import { describe, it, expect } from "vitest"
import {
  formatTransparentQuoteNote,
  parseTransparentQuoteNote,
  getPartnerStoresForCategory,
  GV_PARTNER_STORES,
  type TransparentQuoteBreakdown,
} from "../materials-breakdown"

describe("Materials Breakdown & Transparent Quotes Tests", () => {
  it("formats and parses transparent quote notes with complete fidelity", () => {
    const breakdown: TransparentQuoteBreakdown = {
      laborCost: 180,
      materialsCost: 95.5,
      payer: "CLIENT",
      suggestedStoreId: "construgil-ilha",
      materials: [
        {
          id: "mat-1",
          name: "Tubo PVC Tigre 25mm 3m",
          quantity: 2,
          unit: "barra",
          estimatedPrice: 35,
        },
        {
          id: "mat-2",
          name: "Cola para cano PVC 75g",
          quantity: 1,
          unit: "tubo",
          estimatedPrice: 12.5,
        },
        {
          id: "mat-3",
          name: "Fita veda-rosca 18mm",
          quantity: 1,
          unit: "rolo",
          estimatedPrice: 13,
        },
      ],
    }

    const note = formatTransparentQuoteNote(breakdown, "Serviço com garantia de 90 dias")
    expect(note).toContain("[ORCAMENTO_TRANSPARENTE:")
    expect(note).toContain("Mão de obra: R$ 180.00")
    expect(note).toContain("Materiais: R$ 95.50")
    expect(note).toContain("Serviço com garantia de 90 dias")

    const parsed = parseTransparentQuoteNote(note)
    expect(parsed).toEqual(breakdown)
  })

  it("returns null when parsing note without transparent quote metadata", () => {
    expect(parseTransparentQuoteNote(null)).toBeNull()
    expect(parseTransparentQuoteNote("")).toBeNull()
    expect(parseTransparentQuoteNote("Orçamento padrão sem discriminação de materiais")).toBeNull()
  })

  it("filters partner stores in Governador Valadares based on service category", () => {
    // Hidráulica should return Construgil Ilha or Depósito Central
    const hidraulicaStores = getPartnerStoresForCategory("Encanamento e Hidráulica")
    expect(hidraulicaStores.some((s) => s.id === "construgil-ilha")).toBe(true)

    // Elétrica should return Elétrica Valadares
    const eletricaStores = getPartnerStoresForCategory("Eletricista Residencial")
    expect(eletricaStores.some((s) => s.id === "eletrica-valadares")).toBe(true)

    // Pintura should return Casa & Tinta
    const pinturaStores = getPartnerStoresForCategory("Pintura e Textura")
    expect(pinturaStores.some((s) => s.id === "casa-tinta-bretas")).toBe(true)

    // General fallback
    const allStores = getPartnerStoresForCategory(null)
    expect(allStores).toEqual(GV_PARTNER_STORES)
  })
})
