/**
 * materials-breakdown.ts — Orçamento Transparente: Divisão Mão de Obra vs. Materiais + Lojas Parceiras em GV
 *
 * Implements Jakob Nielsen H2 (Match between system and real world) by segregating
 * pure labor costs (guaranteed via platform Escrow) from materials and parts.
 * Connects clients to verified local construction and hardware stores in Governador Valadares.
 */

export type PartnerStoreCategory =
  "HIDRAULICA" | "ELETRICA" | "PINTURA" | "CONSTRUCAO" | "CHAVEIRO" | "GERAL"

export type PartnerStoreGV = {
  id: string
  name: string
  neighborhood: string
  address: string
  phone: string
  whatsapp: string
  categories: PartnerStoreCategory[]
  discountNote?: string
  mapsUrl: string
}

export const GV_PARTNER_STORES: PartnerStoreGV[] = [
  {
    id: "deposito-central-gv",
    name: "Depósito Central GV",
    neighborhood: "Centro",
    address: "Rua Peçanha, 450 - Centro, Gov. Valadares - MG",
    phone: "(33) 3271-1000",
    whatsapp: "5533999112233",
    categories: ["CONSTRUCAO", "HIDRAULICA", "GERAL"],
    discountNote: "5% de desconto para clientes Severinno",
    mapsUrl: "https://maps.google.com/?q=Rua+Pecanha+450+Governador+Valadares",
  },
  {
    id: "construgil-ilha",
    name: "Construgil Materiais & Acabamentos",
    neighborhood: "Ilha dos Araújos",
    address: "Av. Rio Doce, 1200 - Ilha dos Araújos, Gov. Valadares - MG",
    phone: "(33) 3275-2200",
    whatsapp: "5533998844552",
    categories: ["HIDRAULICA", "CONSTRUCAO", "GERAL"],
    discountNote: "Entrega expressa na Ilha e região",
    mapsUrl: "https://maps.google.com/?q=Av+Rio+Doce+1200+Governador+Valadares",
  },
  {
    id: "casa-tinta-bretas",
    name: "Casa & Tinta Tintas e Ferramentas",
    neighborhood: "Vila Bretas",
    address: "Av. Brasil, 3400 - Vila Bretas, Gov. Valadares - MG",
    phone: "(33) 3225-8800",
    whatsapp: "5533997766551",
    categories: ["PINTURA", "GERAL"],
    discountNote: "Simulação de cores e entrega rápida",
    mapsUrl: "https://maps.google.com/?q=Av+Brasil+3400+Governador+Valadares",
  },
  {
    id: "eletrica-valadares",
    name: "Elétrica Valadares & Iluminação LED",
    neighborhood: "Esplanada",
    address: "Rua Israel Pinheiro, 2100 - Esplanada, Gov. Valadares - MG",
    phone: "(33) 3272-4400",
    whatsapp: "5533991234567",
    categories: ["ELETRICA", "GERAL"],
    discountNote: "Preço especial em cabos e disjuntores",
    mapsUrl: "https://maps.google.com/?q=Rua+Israel+Pinheiro+2100+Governador+Valadares",
  },
  {
    id: "chaveiro-ferragens-rio-doce",
    name: "Chaveiro & Ferragens Rio Doce",
    neighborhood: "Centro",
    address: "Rua Bárbara Heliodora, 620 - Centro, Gov. Valadares - MG",
    phone: "(33) 3273-3300",
    whatsapp: "5533988771122",
    categories: ["CHAVEIRO", "GERAL"],
    discountNote: "Travas e fechaduras de alta segurança",
    mapsUrl: "https://maps.google.com/?q=Rua+Barbara+Heliodora+620+Governador+Valadares",
  },
]

export type MaterialItem = {
  id: string
  name: string
  quantity: number
  unit: string
  estimatedPrice: number
}

export type TransparentQuoteBreakdown = {
  laborCost: number // Mão de obra (100% no Escrow)
  materialsCost: number // Total dos materiais estimados
  payer: "CLIENT" | "PROVIDER" // Quem compra os insumos
  materials: MaterialItem[]
  suggestedStoreId?: string
}

const TRANSPARENT_QUOTE_TAG_START = "[ORCAMENTO_TRANSPARENTE:"
const TRANSPARENT_QUOTE_TAG_END = ":ORCAMENTO_TRANSPARENTE]"

/**
 * Format a quote note containing transparent labor vs materials breakdown
 */
export function formatTransparentQuoteNote(
  breakdown: TransparentQuoteBreakdown,
  providerGeneralNote?: string,
): string {
  const serialized = `${TRANSPARENT_QUOTE_TAG_START}${JSON.stringify(breakdown)}${TRANSPARENT_QUOTE_TAG_END}`
  const payerText =
    breakdown.payer === "CLIENT"
      ? "Materiais a serem adquiridos pelo cliente"
      : "Materiais fornecidos pelo prestador"

  const friendlySummary = `🛠️ Mão de obra: R$ ${breakdown.laborCost.toFixed(2)} | 📦 Materiais: R$ ${breakdown.materialsCost.toFixed(2)} (${payerText})`

  return providerGeneralNote
    ? `${serialized} ${friendlySummary} — ${providerGeneralNote}`
    : `${serialized} ${friendlySummary}`
}

/**
 * Extract transparent quote breakdown from provider note
 */
export function parseTransparentQuoteNote(note?: string | null): TransparentQuoteBreakdown | null {
  if (!note || !note.includes(TRANSPARENT_QUOTE_TAG_START)) return null
  try {
    const start = note.indexOf(TRANSPARENT_QUOTE_TAG_START) + TRANSPARENT_QUOTE_TAG_START.length
    const end = note.indexOf(TRANSPARENT_QUOTE_TAG_END, start)
    if (end === -1) return null
    const jsonStr = note.substring(start, end)
    return JSON.parse(jsonStr) as TransparentQuoteBreakdown
  } catch {
    return null
  }
}

/**
 * Find partner stores matching service category or name
 */
export function getPartnerStoresForCategory(category?: string | null): PartnerStoreGV[] {
  if (!category) return GV_PARTNER_STORES
  const catUpper = category.toUpperCase()

  let targetCat: PartnerStoreCategory = "GERAL"
  if (catUpper.includes("HIDR") || catUpper.includes("CANO") || catUpper.includes("ENCAN")) {
    targetCat = "HIDRAULICA"
  } else if (catUpper.includes("ELET") || catUpper.includes("LUZ") || catUpper.includes("FIAC")) {
    targetCat = "ELETRICA"
  } else if (catUpper.includes("PINT") || catUpper.includes("TINT")) {
    targetCat = "PINTURA"
  } else if (catUpper.includes("CHAV") || catUpper.includes("FECH")) {
    targetCat = "CHAVEIRO"
  } else if (catUpper.includes("OBRA") || catUpper.includes("PEDR") || catUpper.includes("ALV")) {
    targetCat = "CONSTRUCAO"
  }

  const matched = GV_PARTNER_STORES.filter((s) => s.categories.includes(targetCat))
  return matched.length > 0 ? matched : GV_PARTNER_STORES
}
