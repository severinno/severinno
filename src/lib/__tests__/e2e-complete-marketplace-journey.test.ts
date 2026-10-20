import { describe, it, expect, vi, beforeEach } from "vitest"
import { lookupCnefeGV } from "../geo-cnefe"
import { calculateRoute } from "../geo-osrm"
import { KalmanFilter2D } from "../geo-kalman"
import { snapToRoad } from "../map-matching"
import { validateEscrowGeofence, GEOFENCE_TIERS } from "../escrow-geofence"
import { validateGeoCheckin } from "../geo-checkin-escrow"
import { FEE_RATE } from "../constants"
import { haversineKm } from "../geo-shared"
import {
  getOrCreateReferralCode,
  getReferrerByCode,
  registerReferralInvite,
  processReferralFirstBookingConversion,
  getReferralStats,
} from "../referral"

const memoryCache = new Map<string, any>()

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi
        .fn()
        .mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
          const users = [
            { id: "usr_ambassador_lucas", name: "Lucas Ferreira", avatarUrl: null },
            { id: "usr_client_mariana", name: "Mariana Souza", avatarUrl: null },
            { id: "usr_provider_marcos", name: "Marcos Elétrica", avatarUrl: null },
            { id: "usr_fraud_antigo", name: "Usuário Antigo", avatarUrl: null },
          ]
          return users.filter((u) => where.id.in.includes(u.id))
        }),
    },
    booking: {
      count: vi
        .fn()
        .mockImplementation(
          async ({
            where,
          }: {
            where: { clientId?: string; providerId?: string; status?: string }
          }) => {
            if (where.clientId === "usr_fraud_antigo") return 2
            return 0
          },
        ),
    },
  },
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async (key: string) => memoryCache.get(key) ?? null),
  cacheSet: vi.fn(async (key: string, val: any) => {
    memoryCache.set(key, val)
    return true
  }),
}))

const mockAwardPoints = vi.fn().mockResolvedValue({ points: 50, total: 50, newBadges: [] })
vi.mock("@/lib/loyalty", () => ({
  awardPoints: (...args: any[]) => mockAwardPoints(...args),
}))

describe("E2E Master: Jornada Completa Integrada (Cliente ↔ Prestador ↔ Escrow ↔ Pontos ↔ Admin)", () => {
  beforeEach(() => {
    memoryCache.clear()
    vi.clearAllMocks()
  })

  it("valida a esteira completa: Indicação -> Descoberta -> Agendamento -> Telemetria -> Geofence -> Escrow -> Pontos", async () => {
    const referrerId = "usr_ambassador_lucas"
    const newClientId = "usr_client_mariana"
    const existingClientId = "usr_fraud_antigo"

    // ── 1. Indicação & Proteção Anti-Fraude ──────────────────────────────────
    const referralCode = await getOrCreateReferralCode(referrerId)
    expect(referralCode).toMatch(/^SEV[A-Z0-9]{6}$/)

    const resolvedReferrer = await getReferrerByCode(referralCode)
    expect(resolvedReferrer).toBe(referrerId)

    // Bloqueio de auto-indicação
    const selfInvite = await registerReferralInvite(referrerId, referralCode)
    expect(selfInvite).toBe(false)

    // Bloqueio de usuário com histórico de agendamentos anteriores
    const fraudInvite = await registerReferralInvite(existingClientId, referralCode)
    expect(fraudInvite).toBe(false)

    // Novo cliente se vincula com sucesso
    const validInvite = await registerReferralInvite(newClientId, referralCode, "client")
    expect(validInvite).toBe(true)

    // ── 2. Vitrine & Geocodificação CNEFE IBGE Rooftop em GV ─────────────────
    const customer = lookupCnefeGV({
      street: "Rua Peçanha",
      number: 450,
      cep: "35010-160",
    })
    expect(customer).not.toBeNull()
    expect(customer?.district).toBe("Centro")
    expect(customer?.source).toBe("cnefe-ibge-rooftop")

    const provider = lookupCnefeGV({
      street: "Avenida Presidente Juscelino Kubitschek",
      number: 1200,
    })
    expect(provider).not.toBeNull()
    expect(provider?.district).toBe("Vila Bretas")

    // ── 3. Despacho Viário & Roteamento OSRM ──────────────────────────────────
    const providerCoord: [number, number] = [provider!.lat, provider!.lng]
    const customerCoord: [number, number] = [customer!.lat, customer!.lng]
    const route = await calculateRoute(providerCoord, customerCoord)

    expect(route.distanceMeters).toBeGreaterThan(1000)
    expect(route.durationSeconds).toBeGreaterThan(60)
    expect(route.polyline.length).toBeGreaterThan(5)

    // ── 4. Telemetria Kalman 2D & Map-Matching ───────────────────────────────
    const kalman = new KalmanFilter2D()
    const p1 = kalman.update(-18.8415, -41.9484, 25.0, Date.now())
    const p2 = kalman.update(-18.8505, -41.9436, 20.0, Date.now() + 10000)
    expect(p2.accuracyMeters).toBeLessThan(25.0)

    const roadSegment: [number, number][] = [
      [-41.945, -18.85],
      [-41.943, -18.852],
      [-41.941, -18.855],
    ]
    const match = snapToRoad([-41.9438, -18.8512], roadSegment)
    expect(match.isMatched).toBe(true)
    expect(match.distanceToRoadMeters).toBeLessThan(45)
    expect(match.bearing).toBeGreaterThan(0)

    // ── 5. Auditoria de Presença Física (Geofence 50m STRICT) ─────────────────
    const arrivalLat = customer!.lat + 0.00008
    const arrivalLng = customer!.lng + 0.00006
    const realDist = haversineKm(arrivalLat, arrivalLng, customer!.lat, customer!.lng) * 1000
    expect(realDist).toBeLessThan(20)

    const geofence = validateEscrowGeofence({
      providerLocation: { lat: arrivalLat, lng: arrivalLng, accuracyM: 7 },
      serviceLocation: { lat: customer!.lat, lng: customer!.lng },
      precisionTier: "STRICT",
      maxAllowedAccuracyMeters: 35,
    })
    expect(geofence.valid).toBe(true)
    expect(geofence.status).toBe("VERIFIED")

    const checkin = validateGeoCheckin({
      bookingId: "book-e2e-master-1",
      providerId: "usr_provider_marcos",
      providerLat: arrivalLat,
      providerLng: arrivalLng,
      clientAddressLat: customer!.lat,
      clientAddressLng: customer!.lng,
      accuracyMeters: 7,
      clientTimestamp: Date.now(),
    })
    expect(checkin.success).toBe(true)

    // ── 6. Liberação Atômica de Custódia (Escrow) & Split 15% ─────────────────
    const grossAmount = 350.0
    const platformFee = grossAmount * FEE_RATE
    const providerPayout = grossAmount - platformFee

    expect(platformFee).toBe(52.5)
    expect(providerPayout).toBe(297.5)
    expect(FEE_RATE).toBe(0.15)

    // ── 7. Motor Dual de Fidelidade & Crédito de Pontos (Indique & Ganhe) ────
    const conversionResult = await processReferralFirstBookingConversion(
      "book-e2e-master-1",
      newClientId,
      "usr_provider_marcos",
    )

    expect(conversionResult.rewarded).toBe(true)
    expect(conversionResult.referrerId).toBe(referrerId)
    expect(conversionResult.pointsAwarded).toBe(50) // +50 pts para o indicador
    expect(conversionResult.welcomePointsAwarded).toBe(25) // +25 pts boas-vindas para novo cliente

    expect(mockAwardPoints).toHaveBeenCalledWith(referrerId, "referral")
    expect(mockAwardPoints).toHaveBeenCalledWith(newClientId, "referral_welcome_client")

    // Idempotência: Segunda chamada para o mesmo cliente não duplica pontos
    const duplicateConversion = await processReferralFirstBookingConversion(
      "book-e2e-master-2",
      newClientId,
      "usr_provider_marcos",
    )
    expect(duplicateConversion.rewarded).toBe(false)
  })

  it("valida conversão com peso 4x para indicação de Prestador Especialista (+200 pts)", async () => {
    const referrerId = "usr_ambassador_lucas"
    const newProviderId = "usr_provider_marcos"

    const referralCode = await getOrCreateReferralCode(referrerId)
    await registerReferralInvite(newProviderId, referralCode, "provider")

    // Prestador realiza e conclui seu 1º atendimento na plataforma
    const conversionResult = await processReferralFirstBookingConversion(
      "book-provider-first-1",
      "usr_client_qualquer",
      newProviderId,
    )

    expect(conversionResult.rewarded).toBe(true)
    expect(conversionResult.referrerId).toBe(referrerId)
    expect(conversionResult.convertedRole).toBe("provider")
    expect(conversionResult.pointsAwarded).toBe(200) // Peso 4x para profissional
    expect(conversionResult.welcomePointsAwarded).toBe(50) // Boas-vindas profissional

    expect(mockAwardPoints).toHaveBeenCalledWith(referrerId, "referral_provider")
    expect(mockAwardPoints).toHaveBeenCalledWith(newProviderId, "referral_welcome_provider")
  })
})
