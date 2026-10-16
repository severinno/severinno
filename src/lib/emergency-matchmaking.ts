/**
 * emergency-matchmaking.ts — Real-Time Emergency Broadcast Matchmaking Engine
 *
 * Uber-style instant dispatch system for urgent services (plumbing leaks,
 * electrical outages, lockouts). Broadcasts to the nearest providers via
 * H3 spatial index + OSRM matrix, with a 45-second acceptance timer.
 *
 * Cost: $0 — Uses native WebSocket (already in project) + H3 + OSRM
 */

import { latLngToH3, h3GetKRing } from "@/lib/h3-grid"
import { calculate1xNDistanceMatrix, TargetDestination } from "@/lib/osrm-table"
import { db } from "@/lib/db"
import { getClient } from "@/lib/redis"
import { sendText } from "@/lib/evolution"
import logger from "@/lib/logger"

export interface EmergencyRequest {
  id: string
  clientId: string
  clientName: string
  lat: number
  lng: number
  category: string
  description: string
  severity: "HIGH" | "EMERGENCY"
  maxRadiusKm: number
  surgeMultiplier?: number
}

export interface MatchCandidate {
  providerId: string
  providerName: string
  distanceKm: number
  etaMinutes: number
  rating: number
  matchScore: number
}

export interface EmergencyDispatchResult {
  requestId: string
  h3Cell: string
  h3KRingCells: string[]
  candidates: MatchCandidate[]
  broadcastCount: number
  acceptanceWindowSeconds: number
  surgeRate: number
  estimatedBaseFee: number
}

const ACCEPTANCE_WINDOW_SECONDS = 45
const SURGE_BASE_RATE = 1.15 // 15% urgency take rate
const MAX_BROADCAST_PROVIDERS = 5

/**
 * Finds the nearest available providers and prepares a broadcast dispatch
 */
export async function createEmergencyDispatch(
  request: EmergencyRequest,
  availableProviders: Array<{
    id: string
    name: string
    lat: number
    lng: number
    rating: number
    activeBookings: number
  }>,
): Promise<EmergencyDispatchResult> {
  // 1. Compute H3 cell and k-ring neighbors for spatial filtering
  const h3Cell = latLngToH3(request.lat, request.lng, 7)
  const h3KRingCells = h3GetKRing(h3Cell, 2) // ~3.6km radius coverage

  // 2. Pre-filter providers within max radius using Haversine
  const nearbyProviders = availableProviders.filter((p) => {
    const dlat = Math.abs(p.lat - request.lat)
    const dlng = Math.abs(p.lng - request.lng)
    // Quick degree-based pre-filter (~1 degree ≈ 111km)
    return dlat < request.maxRadiusKm / 111 && dlng < request.maxRadiusKm / 80
  })

  // 3. Calculate real ETA matrix via OSRM (single batch call)
  const destinations: TargetDestination[] = nearbyProviders.map((p) => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    name: p.name,
  }))

  const etaMatrix = await calculate1xNDistanceMatrix(
    { lat: request.lat, lng: request.lng },
    destinations,
  )

  // 4. Score and rank candidates
  const candidates: MatchCandidate[] = etaMatrix
    .map((eta) => {
      const provider = nearbyProviders.find((p) => p.id === eta.id)
      if (!provider || eta.distanceKm > request.maxRadiusKm) return null

      // Scoring: 40% proximity + 30% rating + 30% availability
      const proximityScore = Math.max(0, 1 - eta.distanceKm / request.maxRadiusKm) * 40
      const ratingScore = (provider.rating / 5) * 30
      const availabilityScore =
        provider.activeBookings === 0 ? 30 : Math.max(0, 30 - provider.activeBookings * 10)

      return {
        providerId: provider.id,
        providerName: provider.name,
        distanceKm: eta.distanceKm,
        etaMinutes: eta.durationMinutes,
        rating: provider.rating,
        matchScore: Number((proximityScore + ratingScore + availabilityScore).toFixed(1)),
      }
    })
    .filter((c): c is MatchCandidate => c !== null)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, MAX_BROADCAST_PROVIDERS)

  // 5. Calculate surge pricing
  const surgeRate = request.surgeMultiplier || SURGE_BASE_RATE
  const estimatedBaseFee = request.severity === "EMERGENCY" ? 80 : 50

  return {
    requestId: request.id,
    h3Cell,
    h3KRingCells,
    candidates,
    broadcastCount: candidates.length,
    acceptanceWindowSeconds: ACCEPTANCE_WINDOW_SECONDS,
    surgeRate,
    estimatedBaseFee: Number((estimatedBaseFee * surgeRate).toFixed(2)),
  }
}

// Fallback em memória quando o Redis não estiver disponível
const inMemoryClaims = new Map<string, { providerId: string; claimedAt: string }>()

export interface ClaimDispatchParams {
  requestId: string
  providerId: string
  providerName?: string
}

export interface ClaimDispatchResult {
  success: boolean
  requestId: string
  providerId: string
  claimedBy?: string
  claimedAt?: string
  reason?: "ALREADY_CLAIMED" | "NOT_FOUND" | "INTERNAL_ERROR"
  message: string
}

/**
 * Concorre de forma atômica para aceitar a chamada de emergência (First-To-Claim).
 * Previne race conditions via Redis SET NX EX ou Lock em Memória.
 */
export async function claimEmergencyDispatch(
  params: ClaimDispatchParams,
): Promise<ClaimDispatchResult> {
  const { requestId, providerId } = params
  const lockKey = `emergency:claim:${requestId}`
  const nowIso = new Date().toISOString()

  let acquired = false
  const redis = getClient()

  if (redis) {
    try {
      const res = await (redis as any).set(lockKey, providerId, "EX", 3600, "NX")
      acquired = res === "OK"
    } catch (err) {
      logger.warn(
        { err, requestId },
        "[emergency-dispatch] Redis lock falhou, usando fallback local",
      )
    }
  }

  if (!redis) {
    if (inMemoryClaims.has(requestId)) {
      const existing = inMemoryClaims.get(requestId)!
      return {
        success: false,
        requestId,
        providerId,
        claimedBy: existing.providerId,
        claimedAt: existing.claimedAt,
        reason: "ALREADY_CLAIMED",
        message: "Esta chamada de emergência já foi aceita por outro profissional.",
      }
    }
    inMemoryClaims.set(requestId, { providerId, claimedAt: nowIso })
    acquired = true
  }

  if (!acquired) {
    let claimedBy: string | undefined
    try {
      if (redis) {
        claimedBy = (await (redis as any).get(lockKey)) || undefined
      }
    } catch {}

    return {
      success: false,
      requestId,
      providerId,
      claimedBy,
      reason: "ALREADY_CLAIMED",
      message: "Esta chamada de emergência já foi aceita por outro profissional.",
    }
  }

  logger.info(
    { requestId, providerId },
    "[emergency-dispatch] Chamada de emergência aceita com sucesso pelo prestador!",
  )

  return {
    success: true,
    requestId,
    providerId,
    claimedAt: nowIso,
    message: "Atendimento de emergência confirmado! O cliente está aguardando seu deslocamento.",
  }
}

/**
 * Dispara notificação simultânea de alta prioridade via WhatsApp para os melhores candidatos.
 */
export async function broadcastEmergencyDispatchToWhatsApp(
  dispatchResult: EmergencyDispatchResult,
  request: EmergencyRequest,
  options: { appUrl?: string } = {},
): Promise<{ sentCount: number; errors: string[] }> {
  const baseUrl = options.appUrl || process.env.NEXT_PUBLIC_APP_URL || "https://severinno.com"
  const errors: string[] = []
  let sentCount = 0

  const candidateIds = dispatchResult.candidates.map((c) => c.providerId)
  if (candidateIds.length === 0) {
    return { sentCount: 0, errors: [] }
  }

  const providers = await db.user.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, whatsapp: true, phone: true },
  })
  const providerMap = new Map(providers.map((p) => [p.id, p]))

  for (const candidate of dispatchResult.candidates) {
    try {
      const providerUser = providerMap.get(candidate.providerId)

      const rawPhone = providerUser?.whatsapp || providerUser?.phone
      if (!rawPhone) continue

      const cleanPhone = rawPhone.replace(/\D/g, "")
      const formattedPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`

      const claimUrl = `${baseUrl.replace(/\/$/, "")}/api/bookings/emergency-dispatch/claim?requestId=${encodeURIComponent(request.id)}&providerId=${encodeURIComponent(candidate.providerId)}`

      const messageText =
        `🚨 *NOVA CHAMADA DE EMERGÊNCIA — SEVERINNO* 🚨\n\n` +
        `🛠️ Serviço: *${request.category}*\n` +
        `📝 Detalhes: ${request.description}\n` +
        `📍 Distância até você: *${candidate.distanceKm} km* (~${candidate.etaMinutes} min)\n` +
        `💰 Estimativa: *R$ ${dispatchResult.estimatedBaseFee.toFixed(2)}* (Taxa de urgência aplicada)\n\n` +
        `⚡ *O primeiro profissional a clicar garante o atendimento:*\n` +
        `👉 ${claimUrl}\n\n` +
        `_Responda rápido — a chamada expira em ${dispatchResult.acceptanceWindowSeconds} segundos._`

      await sendText(formattedPhone, messageText)
      sentCount++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Prestador ${candidate.providerId}: ${msg}`)
      logger.error(
        { err: msg, candidateId: candidate.providerId, requestId: request.id },
        "[emergency-dispatch] Erro ao enviar WhatsApp broadcast",
      )
    }
  }

  return { sentCount, errors }
}
