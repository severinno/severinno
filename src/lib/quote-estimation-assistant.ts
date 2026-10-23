import { db } from "@/lib/db"
import { categorizeServiceRequest } from "@/lib/ai-categorizer"
import { toMoneyNumber } from "@/lib/money"
import logger from "@/lib/logger"

const log = logger.child({ module: "quote-estimation-assistant" })

export type CategoryMaterialScope = {
  estimatedHours: string
  materialsChecklist: string[]
  safetyChecklist: string[]
  tipsForClient: string
  tipsForProvider: string
}

const CATEGORY_SCOPES: Record<string, CategoryMaterialScope> = {
  eletrica: {
    estimatedHours: "1h a 3h",
    materialsChecklist: [
      "Fita isolante antichama (3M ou similar)",
      "Conectores de emenda rápida (tipo Wago)",
      "Disjuntor bipolar/unipolar compatível com a carga",
      "Fiação com bitola adequada (2.5mm² para tomadas, 1.5mm² iluminação)",
    ],
    safetyChecklist: [
      "Desligar a chave geral ou disjuntor no quadro de distribuição antes da intervenção",
      "Testar ausência de tensão com multímetro ou chave de teste",
      "Conferir aterramento e aperto de bornes para evitar aquecimento",
    ],
    tipsForClient:
      "Verifique se o quadro de luz é acessível e informe a voltagem (110V ou 220V) ao prestador.",
    tipsForProvider:
      "Traga alicate decapador, multímetro e confirme a carga antes de dimensionar os fios.",
  },
  hidraulica: {
    estimatedHours: "1h a 2.5h",
    materialsChecklist: [
      "Fita veda-rosca de teflon alta densidade",
      "Conexões e adaptadores PVC (soldável ou roscável)",
      "Adesivo plástico para PVC e lixa para tubos",
      "Sifão sanfonado universal e anel de vedação de borracha",
    ],
    safetyChecklist: [
      "Localizar e fechar o registro geral de água do imóvel antes de abrir tubulações",
      "Esvaziar a tubulação abrindo torneiras mais baixas",
      "Testar estanqueidade sob pressão de água por pelo menos 15 minutos pós-reparo",
    ],
    tipsForClient: "Identifique onde fica o registro geral do imóvel para agilizar o atendimento.",
    tipsForProvider:
      "Tenha chave de grifo, fita veda-rosca reserva e recipientes para contenção de água residual.",
  },
  pintura: {
    estimatedHours: "4h a 8h",
    materialsChecklist: [
      "Lixas para alvenaria (grão 150 e 220)",
      "Massa corrida (interior) ou massa acrílica (exterior/úmido)",
      "Fita crepe de boa adesão para rodapés e esquadrias",
      "Rolo de lã de pelo baixo antirrespingo e trincha para recortes",
      "Lona plástica protetora de piso",
    ],
    safetyChecklist: [
      "Isolar e cobrir pisos, tomadas e móveis com plástico ou lona",
      "Manter o ambiente bem ventilado durante e após a aplicação",
      "Respeitar o tempo de secagem entre demãos recomendado pelo fabricante da tinta",
    ],
    tipsForClient:
      "Desocupe o espaço próximo às paredes para facilitar a circulação e proteção do piso.",
    tipsForProvider:
      "Prepare a superfície lixando e removendo poeira antes de iniciar a primeira demão.",
  },
  limpeza: {
    estimatedHours: "4h a 6h",
    materialsChecklist: [
      "Detergente neutro concentrado e desengordurante",
      "Desinfetante bactericida de uso geral",
      "Panos de microfibra multiuso em cores separadas por ambiente",
      "Luvas de proteção de borracha",
      "Sacos de lixo reforçados",
    ],
    safetyChecklist: [
      "Não misturar produtos químicos (ex: água sanitária com amoníaco)",
      "Utilizar luvas e calçado antiderrapante em áreas molhadas",
      "Manter janelas abertas para ventilação durante o uso de alvejantes",
    ],
    tipsForClient:
      "Alinhe antecipadamente se os produtos de limpeza serão fornecidos por você ou pelo profissional.",
    tipsForProvider:
      "Priorize os ambientes mais pesados (banheiros e cozinha) no início do expediente.",
  },
  climatizacao: {
    estimatedHours: "2h a 4h",
    materialsChecklist: [
      "Fluido refrigerante adequado (R410A ou R32)",
      "Bomba de vácuo com manômetro digital",
      "Isolamento térmico blindado para tubulação de cobre",
      "Coxins de borracha antivibração para a condensadora",
    ],
    safetyChecklist: [
      "Realizar vácuo mínimo de 500 microns na linha frigorígena",
      "Verificar ausência de vazamentos com nitrogênio sob pressão",
      "Conferir caimento e vedação do dreno para evitar gotejamento interno",
    ],
    tipsForClient:
      "Certifique-se de que o ponto elétrico e o disjuntor exclusivo estão instalados.",
    tipsForProvider: "Realize o vácuo correto antes de liberar a carga de fluido refrigerante.",
  },
}

const DEFAULT_SCOPE: CategoryMaterialScope = {
  estimatedHours: "2h a 4h",
  materialsChecklist: [
    "EPIs básicos (luvas, óculos de proteção)",
    "Ferramentas manuais adequadas ao serviço",
    "Insumos de fixação (parafusos, buchas, fitas de vedação)",
  ],
  safetyChecklist: [
    "Inspecionar o local antes de iniciar para identificar potenciais riscos",
    "Manter área de trabalho isolada e sinalizada",
    "Testar o funcionamento completo antes de finalizar o serviço",
  ],
  tipsForClient:
    "Descreva o problema com clareza e envie fotos para facilitar a preparação do profissional.",
  tipsForProvider: "Confirme o escopo detalhado com o cliente antes de iniciar a execução.",
}

export type SmartQuoteEstimation = {
  categoryId?: string
  categoryName: string
  suggestedTitle: string
  problemSeverity: "LOW" | "MEDIUM" | "HIGH"
  priceRange: {
    min: number
    avg: number
    max: number
  }
  estimatedHours: string
  materialsChecklist: string[]
  safetyChecklist: string[]
  tipsForClient: string
  tipsForProvider: string
  dataPointsCount: number
  confidenceScore: number
  source: "platform-history" | "ai-heuristics"
}

/**
 * Calculates smart price estimation, materials checklist, and scope breakdown
 * based on real platform completed bookings history and AI classification.
 */
export async function calculateSmartQuoteEstimation(opts: {
  description: string
  categoryId?: string
  city?: string
}): Promise<SmartQuoteEstimation> {
  const { description, city } = opts

  // 1. Classify service and resolve category
  let categoryId = opts.categoryId
  let categoryName = ""
  let suggestedTitle = ""
  let severity: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM"

  const aiResult = await categorizeServiceRequest(description)
  if (!categoryId && aiResult.categoryId) {
    categoryId = aiResult.categoryId
  }
  categoryName = aiResult.categoryName
  suggestedTitle = aiResult.suggestedTitle
  severity = aiResult.problemSeverity

  // Enhanced domain keywords for category refinement
  const lowerDesc = description.toLowerCase()
  if (
    lowerDesc.includes("cano") ||
    lowerDesc.includes("vazamento") ||
    lowerDesc.includes("torneira") ||
    lowerDesc.includes("hidráulica") ||
    lowerDesc.includes("hidraulica")
  ) {
    categoryName = "Hidráulica"
    if (!suggestedTitle || suggestedTitle.includes("Geral")) suggestedTitle = "Reparo Hidráulico"
  } else if (
    lowerDesc.includes("disjuntor") ||
    lowerDesc.includes("tomada") ||
    lowerDesc.includes("curto") ||
    lowerDesc.includes("fiação") ||
    lowerDesc.includes("elétrica") ||
    lowerDesc.includes("eletrica")
  ) {
    categoryName = "Elétrica"
    if (!suggestedTitle || suggestedTitle.includes("Geral")) suggestedTitle = "Serviço Elétrico"
  } else if (
    lowerDesc.includes("pintar") ||
    lowerDesc.includes("pintura") ||
    lowerDesc.includes("parede")
  ) {
    categoryName = "Pintura"
    if (!suggestedTitle || suggestedTitle.includes("Geral")) suggestedTitle = "Serviço de Pintura"
  }

  // 2. Query real database history of completed paid bookings in category/city
  let dataPointsCount = 0
  let histMin = 0
  let histAvg = 0
  let histMax = 0
  let source: "platform-history" | "ai-heuristics" = "ai-heuristics"

  try {
    const historicalBookings = await db.booking.findMany({
      where: {
        status: "COMPLETED",
        paymentStatus: "PAID",
        ...(categoryId
          ? {
              service: {
                categoryId: categoryId,
                ...(city ? { provider: { city } } : {}),
              },
            }
          : {}),
      },
      select: {
        amount: true,
      },
      take: 50,
    })

    dataPointsCount = historicalBookings.length

    if (dataPointsCount >= 2) {
      const amounts = historicalBookings
        .map((b) => toMoneyNumber(b.amount))
        .filter((a) => a > 0)
        .sort((a, b) => a - b)

      if (amounts.length >= 2) {
        histMin = Math.round(amounts[0])
        const sum = amounts.reduce((acc, v) => acc + v, 0)
        histAvg = Math.round(sum / amounts.length)
        histMax = Math.round(amounts[amounts.length - 1])
        source = "platform-history"
      }
    }
  } catch (err) {
    log.warn({ err }, "Failed to fetch historical bookings for estimation, falling back")
  }

  // 3. Fallback to AI heuristic price range if insufficient platform history
  if (source === "ai-heuristics" || histAvg === 0) {
    histMin = aiResult.estimatedPriceRange.min
    histMax = aiResult.estimatedPriceRange.max
    histAvg = Math.round((histMin + histMax) / 2)
  }

  // Adjust slightly for severity
  if (severity === "HIGH") {
    histMin = Math.round(histMin * 1.15)
    histAvg = Math.round(histAvg * 1.2)
    histMax = Math.round(histMax * 1.25)
  }

  // 4. Match scope and materials
  const textToScan = `${categoryName} ${description}`.toLowerCase()
  let matchedScope = DEFAULT_SCOPE

  if (
    textToScan.includes("eletric") ||
    textToScan.includes("luz") ||
    textToScan.includes("disjuntor") ||
    textToScan.includes("tomada")
  ) {
    matchedScope = CATEGORY_SCOPES.eletrica
  } else if (
    textToScan.includes("hidraul") ||
    textToScan.includes("encan") ||
    textToScan.includes("cano") ||
    textToScan.includes("torneira") ||
    textToScan.includes("vazamento")
  ) {
    matchedScope = CATEGORY_SCOPES.hidraulica
  } else if (textToScan.includes("pint")) {
    matchedScope = CATEGORY_SCOPES.pintura
  } else if (textToScan.includes("limp") || textToScan.includes("diar")) {
    matchedScope = CATEGORY_SCOPES.limpeza
  } else if (
    textToScan.includes("ar") ||
    textToScan.includes("clima") ||
    textToScan.includes("refrig")
  ) {
    matchedScope = CATEGORY_SCOPES.climatizacao
  }

  return {
    categoryId,
    categoryName,
    suggestedTitle,
    problemSeverity: severity,
    priceRange: {
      min: histMin,
      avg: histAvg,
      max: histMax,
    },
    estimatedHours: matchedScope.estimatedHours,
    materialsChecklist: matchedScope.materialsChecklist,
    safetyChecklist: matchedScope.safetyChecklist,
    tipsForClient: matchedScope.tipsForClient,
    tipsForProvider: matchedScope.tipsForProvider,
    dataPointsCount,
    confidenceScore: source === "platform-history" ? 0.95 : 0.82,
    source,
  }
}
