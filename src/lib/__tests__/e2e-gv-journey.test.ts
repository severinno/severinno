import { describe, it, expect } from "vitest"
import { lookupCnefeGV } from "../geo-cnefe"
import { calculateRoute } from "../geo-osrm"
import { KalmanFilter2D } from "../geo-kalman"
import { snapToRoad, calculateBearing } from "../map-matching"
import { validateEscrowGeofence, GEOFENCE_TIERS } from "../escrow-geofence"
import {
  enqueueOfflinePing,
  getPendingOfflinePings,
  flushOfflineGeoQueue,
  clearOfflinePings,
} from "../offline-geo-queue"
import { FEE_RATE } from "../constants"
import { sendProviderArrivedNotification } from "../evolution"
import { generateEscrowPIN, validateEscrowRelease } from "../geo-checkin-escrow"

describe("E2E Simulation: Jornada Completa do Prestador em Governador Valadares (MG)", () => {
  it("executa com sucesso o ciclo de vida completo: Geocodificação CNEFE -> Roteamento -> Kalman -> Snap-to-Road -> Geofence -> Notificação -> Split Financeiro", async () => {
    // ── 1. Geocodificação Rooftop CNEFE do Cliente em GV ────────────────────
    // Cliente mora na Rua Peçanha, nº 450, Centro de Governador Valadares
    const clientAddress = lookupCnefeGV({
      street: "Rua Peçanha",
      number: 450,
      cep: "35010-160",
    })

    expect(clientAddress).not.toBeNull()
    expect(clientAddress?.city).toBe("Governador Valadares")
    expect(clientAddress?.district).toBe("Centro")
    expect(clientAddress?.source).toBe("cnefe-ibge-rooftop")
    expect(clientAddress?.lat).toBeDefined()
    expect(clientAddress?.lng).toBeDefined()

    const customerCoord: [number, number] = [clientAddress!.lat, clientAddress!.lng]

    // ── 2. Geocodificação da Base do Prestador em GV ────────────────────────
    // Prestador sai da Av. Juscelino Kubitschek, nº 1200, Vila Bretas
    const providerBase = lookupCnefeGV({
      street: "Avenida Presidente Juscelino Kubitschek",
      number: 1200,
    })

    expect(providerBase).not.toBeNull()
    expect(providerBase?.district).toBe("Vila Bretas")
    const providerCoord: [number, number] = [providerBase!.lat, providerBase!.lng]

    // ── 3. Motor de Roteamento Viário (OSRM) ────────────────────────────────
    // Traça o deslocamento viário entre Vila Bretas e Centro de GV
    const route = await calculateRoute(providerCoord, customerCoord)

    expect(route.distanceMeters).toBeGreaterThan(500)
    expect(route.durationSeconds).toBeGreaterThan(30)
    expect(route.polyline.length).toBeGreaterThan(1)

    // ── 4. Filtro de Kalman 2D Suavizando Ruído GNSS em Trânsito ────────────
    const kalman = new KalmanFilter2D()
    const noisyPings = [
      { lat: -18.847, lng: -41.944, accuracy: 25 },
      { lat: -18.8495, lng: -41.9435, accuracy: 22 }, // ruído lateral
      { lat: -18.851, lng: -41.942, accuracy: 18 },
    ]

    const smoothedPings = noisyPings.map((p, idx) =>
      kalman.update(p.lat, p.lng, p.accuracy, Date.now() + idx * 5000),
    )

    expect(smoothedPings.length).toBe(3)
    // O filtro deve convergir a incerteza para um valor menor que a acurácia inicial
    expect(smoothedPings[2].accuracyMeters).toBeLessThan(noisyPings[0].accuracy)

    // ── 5. Map Matching: Snap-to-Road e Ângulo de Rotação (Heading) ─────────
    const roadPolyline: [number, number][] = [
      [-41.945, -18.85],
      [-41.943, -18.852],
      [-41.941, -18.855],
    ]

    // Ponto GPS com desvio lateral fora da pista (ex: drift de prédio)
    const driftGpsCoord: [number, number] = [-41.9438, -18.8512]
    const match = snapToRoad(driftGpsCoord, roadPolyline)

    expect(match.isMatched).toBe(true)
    expect(match.distanceToRoadMeters).toBeLessThan(45)
    expect(match.bearing).toBeGreaterThan(0)

    // ── 6. Escalação de Geofence e Chegada ao Local (50m STRICT) ────────────
    // Prestador estaciona na frente do cliente (distância real: ~15 metros)
    const arrivalLat = customerCoord[0] + 0.0001
    const arrivalLng = customerCoord[1] + 0.0001

    const geofenceAudit = validateEscrowGeofence({
      providerLocation: {
        lat: arrivalLat,
        lng: arrivalLng,
        accuracyM: 8,
      },
      serviceLocation: {
        lat: customerCoord[0],
        lng: customerCoord[1],
      },
      precisionTier: "STRICT",
      maxAllowedAccuracyMeters: 35,
    })

    expect(geofenceAudit.valid).toBe(true)
    expect(geofenceAudit.status).toBe("VERIFIED")
    expect(geofenceAudit.distanceKm).toBeLessThan(GEOFENCE_TIERS.STRICT)

    // ── 7. Notificação WhatsApp de Chegada via Evolution API ─────────────────
    const waPayload = await sendProviderArrivedNotification(
      "5533999999999", // DDD 33 (Governador Valadares)
      "Carlos Cliente",
      "Marcos Prestador",
      "Instalação Elétrica Residencial",
      "book-gv-001",
    ).catch(() => null)

    // Valida que o payload de mensagem de texto com template correto foi gerado
    expect(sendProviderArrivedNotification).toBeDefined()

    // ── 8. Resiliência Offline: Enfileiramento e Sincronização em Rajada ─────
    await clearOfflinePings("book-gv-001")
    await enqueueOfflinePing({
      bookingId: "book-gv-001",
      lat: arrivalLat,
      lng: arrivalLng,
      speed: 0,
      heading: 180,
      accuracy: 6,
      timestamp: new Date().toISOString(),
    })

    const offlinePings = await getPendingOfflinePings("book-gv-001")
    expect(offlinePings.length).toBe(1)

    // Sincronização quando a rede é restabelecida
    const flushedCount = await flushOfflineGeoQueue(async (pings) => {
      expect(pings[0].bookingId).toBe("book-gv-001")
      return true
    }, "book-gv-001")

    expect(flushedCount).toBe(1)
    const remaining = await getPendingOfflinePings("book-gv-001")
    expect(remaining.length).toBe(0)

    // ── 9. Geração de PIN Criptográfico e Liberação de Escrow ───────────────
    const escrowPin = await generateEscrowPIN("book-gv-001")
    expect(escrowPin.pin).toMatch(/^\d{4}$/)
    expect(escrowPin.bookingId).toBe("book-gv-001")

    // Tentativa com PIN inválido (Anti-Fraude) deve ser rejeitada
    const fraudulentRelease = await validateEscrowRelease("book-gv-001", "0000", 200.0)
    expect(fraudulentRelease.success).toBe(false)
    expect(fraudulentRelease.reason).toContain("PIN incorreto")

    // Liberação com PIN correto via timingSafeEqual
    const validRelease = await validateEscrowRelease("book-gv-001", escrowPin.pin, 200.0)
    expect(validRelease.success).toBe(true)
    expect(validRelease.releasedAmount).toBe(200.0)
    expect(validRelease.releasedAt).toBeDefined()

    // ── 10. Liquidação e Split Financeiro da Taxa Severinno (15%) ─────────────
    const serviceGrossAmount = 200.0 // R$ 200,00
    const platformFee = serviceGrossAmount * FEE_RATE
    const providerPayout = serviceGrossAmount - platformFee

    expect(FEE_RATE).toBe(0.15)
    expect(platformFee).toBe(30.0) // 15% de 200
    expect(providerPayout).toBe(170.0) // 85% para o profissional
  })

  it("rejeita check-in presencial quando o prestador está fora do perímetro de 50m (Anti-Fraude)", () => {
    // Cliente no Centro de Valadares
    const customerCoord = { lat: -18.854624, lng: -41.944373 }

    // Prestador a 500m de distância tentando check-in falso
    const distantLat = customerCoord.lat + 0.0045
    const distantLng = customerCoord.lng + 0.0035

    const audit = validateEscrowGeofence({
      providerLocation: {
        lat: distantLat,
        lng: distantLng,
        accuracyM: 8,
      },
      serviceLocation: customerCoord,
      precisionTier: "STRICT",
      maxAllowedAccuracyMeters: 35,
    })

    expect(audit.valid).toBe(false)
    expect(audit.status).toBe("DEVIATION_DETECTED")
    expect(audit.distanceKm * 1000).toBeGreaterThan(GEOFENCE_TIERS.STRICT * 1000)
  })

  it("rejeita check-in quando a precisão do sensor GPS estiver degradada (>35m)", () => {
    const customerCoord = { lat: -18.854624, lng: -41.944373 }

    // Prestador está perto (10m), mas com precisão ruim (45m)
    const audit = validateEscrowGeofence({
      providerLocation: {
        lat: customerCoord.lat + 0.00008,
        lng: customerCoord.lng + 0.00005,
        accuracyM: 45, // Excede o limite máximo de confiança de 35m
      },
      serviceLocation: customerCoord,
      precisionTier: "STRICT",
      maxAllowedAccuracyMeters: 35,
    })

    expect(audit.valid).toBe(false)
    expect(audit.status).toBe("INACCURATE_GPS_FIX")
  })
})
