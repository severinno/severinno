import { describe, it, expect } from "vitest"
import { analyzeServicePhoto } from "@/lib/vision-diagnostic"
import { createEmergencyDispatch, EmergencyRequest } from "@/lib/emergency-matchmaking"
import {
  validateGeoCheckin,
  generateEscrowPIN,
  validateEscrowRelease,
} from "@/lib/geo-checkin-escrow"
import { mediateDispute, DisputeCase } from "@/lib/dispute-mediator"
import { generateMEIAnnualReport } from "@/lib/mei-fiscal"

describe("1. AI Vision-Based Service Diagnostic Engine", () => {
  it("should classify plumbing leak description into plumbing category with materials", async () => {
    const result = await analyzeServicePhoto({
      clientDescription: "Vazamento forte de água no cano embaixo da pia da cozinha",
    })

    expect(result.category).toContain("Hidráulica")
    expect(result.subcategory).toBe("Reparo de Vazamento")
    expect(result.severity).toBe("HIGH")
    expect(result.suggestedMaterials.length).toBeGreaterThan(0)
    expect(result.estimatedPriceRange.min).toBeGreaterThan(0)
  })

  it("should classify electrical short circuit into electrical category", async () => {
    const result = await analyzeServicePhoto({
      clientDescription: "O disjuntor do chuveiro desarmou e a tomada está com cheiro de queimado",
    })

    expect(result.category).toContain("Elétrica")
    expect(result.severity).toBe("HIGH")
    expect(result.suggestedMaterials).toContain("Disjuntor")
  })
})

describe("2. Emergency Broadcast Matchmaking Engine", () => {
  it("should find nearest providers and create an emergency dispatch packet", async () => {
    const req: EmergencyRequest = {
      id: "emg-test-1",
      clientId: "client-1",
      clientName: "Ana Silva",
      lat: -23.5505,
      lng: -46.6333,
      category: "Vazamento Grave",
      description: "Cano estourou no apartamento",
      severity: "EMERGENCY",
      maxRadiusKm: 15,
    }

    const availableProviders = [
      {
        id: "p1",
        name: "Carlos Encanador",
        lat: -23.56,
        lng: -46.64,
        rating: 4.9,
        activeBookings: 0,
      },
      {
        id: "p2",
        name: "Marcos Hidráulica",
        lat: -23.58,
        lng: -46.66,
        rating: 4.7,
        activeBookings: 1,
      },
      { id: "p3", name: "Lucas Longe", lat: -23.9, lng: -46.9, rating: 5.0, activeBookings: 0 }, // Out of radius
    ]

    const dispatch = await createEmergencyDispatch(req, availableProviders)

    expect(dispatch.h3Cell).toBeDefined()
    expect(dispatch.h3KRingCells.length).toBeGreaterThan(1)
    expect(dispatch.candidates.length).toBe(2) // p1 and p2 inside radius
    expect(dispatch.candidates[0].providerId).toBe("p1") // closer + 0 active bookings
    expect(dispatch.surgeRate).toBeGreaterThanOrEqual(1.15)
    expect(dispatch.acceptanceWindowSeconds).toBe(45)
  })
})

describe("3. Geo Check-in & PIN-Based Escrow Release Protocol", () => {
  it("should validate check-in when provider is within 150m and reject when far away", () => {
    const closeAttempt = validateGeoCheckin({
      bookingId: "b-1",
      providerId: "p-1",
      providerLat: -23.5505,
      providerLng: -46.6333,
      clientAddressLat: -23.5509,
      clientAddressLng: -46.6335, // ~50m away
    })
    expect(closeAttempt.success).toBe(true)
    expect(closeAttempt.distanceMeters).toBeLessThan(150)

    const farAttempt = validateGeoCheckin({
      bookingId: "b-1",
      providerId: "p-1",
      providerLat: -23.5505,
      providerLng: -46.6333,
      clientAddressLat: -23.59,
      clientAddressLng: -46.68, // ~6km away
    })
    expect(farAttempt.success).toBe(false)
    expect(farAttempt.reason).toContain("Aproxime-se")
  })

  it("should generate secure 4-digit PIN and validate escrow release correctly", async () => {
    const bookingId = `b-test-${Date.now()}`
    const pinData = await generateEscrowPIN(bookingId)

    expect(pinData.pin.length).toBe(4)
    expect(pinData.qrPayload).toContain(bookingId)

    // Test invalid PIN
    const failRelease = await validateEscrowRelease(bookingId, "9999", 250.0)
    if (pinData.pin !== "9999") {
      expect(failRelease.success).toBe(false)
    }

    // Test correct PIN
    const okRelease = await validateEscrowRelease(bookingId, pinData.pin, 250.0)
    expect(okRelease.success).toBe(true)
    expect(okRelease.releasedAmount).toBe(250.0)
  })
})

describe("4. AI-Powered Dispute Mediation Engine", () => {
  it("should produce a structured recommendation with reasoning and actions", async () => {
    const dispute: DisputeCase = {
      bookingId: "disp-101",
      clientId: "client-joao",
      clientName: "João Paulo",
      providerId: "prov-claudio",
      providerName: "Cláudio Reformas",
      serviceTitle: "Pintura de Quarto",
      serviceDescription: "Pintura de 2 paredes com tinta acrílica branca",
      totalAmount: 400.0,
      clientComplaint: "O acabamento ficou manchado e o prestador não passou a segunda demão.",
      providerResponse: "Passei as demãos combinadas, mas a parede precisava de fundo preparador.",
      chatMessageCount: 14,
      hasBeforePhotos: true,
      hasAfterPhotos: true,
      providerRating: 4.2,
      providerCompletedJobs: 18,
      providerDisputeRate: 0.05,
    }

    const rec = await mediateDispute(dispute)

    expect(rec.bookingId).toBe("disp-101")
    expect([
      "FULL_REFUND",
      "PARTIAL_REFUND",
      "REDO_SERVICE",
      "SPLIT_DECISION",
      "NO_REFUND",
    ]).toContain(rec.verdict)
    expect(rec.refundAmount + rec.providerPayout).toBeCloseTo(400.0, 1)
    expect(rec.reasoning.length).toBeGreaterThan(10)
    expect(rec.suggestedActions.length).toBeGreaterThan(0)
  })
})

describe("5. MEI/DASN-SIMEI Fiscal Module", () => {
  it("should generate annual fiscal report with deductions and DASN compliance", () => {
    const bookings = [
      { completedAt: new Date(2026, 0, 15), totalAmount: 1500, distanceKm: 40, materialsCost: 100 },
      { completedAt: new Date(2026, 1, 20), totalAmount: 2000, distanceKm: 60, materialsCost: 150 },
      { completedAt: new Date(2026, 2, 10), totalAmount: 1800, distanceKm: 50, materialsCost: 80 },
    ]

    const report = generateMEIAnnualReport(
      "prov-123",
      "Roberto Eletricista MEI",
      2026,
      bookings,
      "12.345.678/0001-90",
    )

    expect(report.providerId).toBe("prov-123")
    expect(report.year).toBe(2026)
    expect(report.annualSummary.totalGrossRevenue).toBe(5300)
    expect(report.annualSummary.totalBookings).toBe(3)
    expect(report.annualSummary.totalKmTraveled).toBe(150)
    expect(report.meiCompliance.isWithinLimit).toBe(true)
    expect(report.meiCompliance.remainingAllowance).toBe(81000 - 5300)
    expect(report.dasnSimeiData.campoReceitaServicos).toBe(5300)
    expect(report.monthlyBreakdown.length).toBe(12)
  })
})
