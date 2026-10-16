import { haversineKm } from "@/lib/geo-server"

export interface GeoLocation {
  lat: number
  lng: number
  neighborhood?: string
  city?: string
}

export interface ProviderScheduleSlot {
  id: string
  providerId: string
  providerName: string
  scheduledAt: Date | string
  durationMinutes: number
  location: GeoLocation
}

export interface RouteBatchRequest {
  requestedAt: Date | string
  estimatedDurationMinutes: number
  location: GeoLocation
}

export interface RouteBatchOpportunity {
  isBatchable: boolean
  distanceKm: number
  timeDeltaMinutes: number
  sameNeighborhood: boolean
  displacementSavingsAmount: number
  clientDiscountAmount: number
  providerBonusScore: number
  badgeLabel: string
  recommendationReason: string
}

export interface RankedBatchProvider {
  providerId: string
  providerName: string
  baseScore: number
  batchingBonus: number
  totalScore: number
  batchOpportunity: RouteBatchOpportunity | null
}

const MAX_BATCH_DISTANCE_KM = 3.5 // Raio máximo de 3.5 km para considerar "carona de serviço"
const MAX_TIME_GAP_MINUTES = 180 // Janela máxima de 3 horas entre atendimentos
const DEFAULT_DISPLACEMENT_FEE = 25.0 // Taxa padrão média de deslocamento em GV

/**
 * Avalia se um novo agendamento pode ser agrupado na rota de um agendamento existente do prestador.
 */
export function calculateRouteBatchOpportunity(
  existingSlot: ProviderScheduleSlot,
  request: RouteBatchRequest,
): RouteBatchOpportunity {
  const distKm = haversineKm(
    existingSlot.location.lat,
    existingSlot.location.lng,
    request.location.lat,
    request.location.lng,
  )

  const existingTime = new Date(existingSlot.scheduledAt).getTime()
  const requestedTime = new Date(request.requestedAt).getTime()
  const timeDeltaMinutes = Math.abs(requestedTime - existingTime) / (1000 * 60)

  const normExistingNeigh = existingSlot.location.neighborhood?.toLowerCase().trim()
  const normReqNeigh = request.location.neighborhood?.toLowerCase().trim()
  const sameNeighborhood = Boolean(
    normExistingNeigh && normReqNeigh && normExistingNeigh === normReqNeigh,
  )

  // Critérios de elegibilidade para Carona de Serviços:
  // 1. Distância <= 3.5 km (ou mesmo bairro)
  // 2. Janela temporal <= 3 horas
  const isBatchable =
    (distKm <= MAX_BATCH_DISTANCE_KM || sameNeighborhood) &&
    timeDeltaMinutes <= MAX_TIME_GAP_MINUTES

  if (!isBatchable) {
    return {
      isBatchable: false,
      distanceKm: Number(distKm.toFixed(2)),
      timeDeltaMinutes: Math.round(timeDeltaMinutes),
      sameNeighborhood,
      displacementSavingsAmount: 0,
      clientDiscountAmount: 0,
      providerBonusScore: 0,
      badgeLabel: "",
      recommendationReason:
        "Distância ou intervalo temporal acima do limite de rota compartilhada.",
    }
  }

  // Economia estimada de deslocamento e combustível
  const displacementSavingsAmount = Math.min(
    DEFAULT_DISPLACEMENT_FEE,
    Math.round(DEFAULT_DISPLACEMENT_FEE * (1 - distKm / MAX_BATCH_DISTANCE_KM)),
  )

  // Desconto repassado ao cliente (R$ 10 a R$ 18 de desconto no deslocamento)
  const clientDiscountAmount = Math.max(10, Math.round(displacementSavingsAmount * 0.7))

  // Pontuação bônus para o ranking de matchmaking (até +30 pontos)
  const proximityFactor = Math.max(0, 1 - distKm / MAX_BATCH_DISTANCE_KM)
  const timeFactor = Math.max(0, 1 - timeDeltaMinutes / MAX_TIME_GAP_MINUTES)
  const providerBonusScore = Math.round((proximityFactor * 0.6 + timeFactor * 0.4) * 30)

  const badgeLabel = sameNeighborhood
    ? "⚡ Prestador já no seu Bairro (Rota Otimizada)"
    : "🚗 Carona de Serviço (< 3 km de outro atendimento)"

  const recommendationReason = sameNeighborhood
    ? `Prestador já possui agendamento confirmado no bairro ${existingSlot.location.neighborhood}. Economia de rota de R$ ${clientDiscountAmount},00 para o cliente.`
    : `Atendimento a apenas ${distKm.toFixed(1)} km do compromisso anterior. Desconto de R$ ${clientDiscountAmount},00 aplicado.`

  return {
    isBatchable: true,
    distanceKm: Number(distKm.toFixed(2)),
    timeDeltaMinutes: Math.round(timeDeltaMinutes),
    sameNeighborhood,
    displacementSavingsAmount,
    clientDiscountAmount,
    providerBonusScore,
    badgeLabel,
    recommendationReason,
  }
}

/**
 * Reordena prestadores com base no bônus de Carona de Serviços (Batching).
 */
export function rankProvidersWithBatching(
  candidates: Array<{
    providerId: string
    providerName: string
    baseScore: number
    scheduleSlots: ProviderScheduleSlot[]
  }>,
  request: RouteBatchRequest,
): RankedBatchProvider[] {
  const ranked: RankedBatchProvider[] = []

  for (const cand of candidates) {
    let bestOpportunity: RouteBatchOpportunity | null = null

    for (const slot of cand.scheduleSlots) {
      const opp = calculateRouteBatchOpportunity(slot, request)
      if (opp.isBatchable) {
        if (!bestOpportunity || opp.providerBonusScore > bestOpportunity.providerBonusScore) {
          bestOpportunity = opp
        }
      }
    }

    const bonus = bestOpportunity ? bestOpportunity.providerBonusScore : 0
    ranked.push({
      providerId: cand.providerId,
      providerName: cand.providerName,
      baseScore: cand.baseScore,
      batchingBonus: bonus,
      totalScore: cand.baseScore + bonus,
      batchOpportunity: bestOpportunity,
    })
  }

  // Ordena pelo totalScore decrescente
  return ranked.sort((a, b) => b.totalScore - a.totalScore)
}
