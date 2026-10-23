import { describe, it, expect, vi, beforeEach } from "vitest"
import { generateProofOfWorkCertificate, renderProofOfWorkHtml } from "../proof-of-work-certificate"
import { db } from "@/lib/db"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findUnique: vi.fn(),
    },
  },
}))

describe("proof-of-work-certificate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockBooking = {
    id: "booking-pow-123",
    clientId: "client-abc",
    providerId: "provider-xyz",
    serviceId: "service-999",
    status: "COMPLETED",
    address: "Av. Minas Gerais, 1000 - Centro, Gov. Valadares",
    cep: "35010-000",
    lat: -18.8545,
    lng: -41.956,
    amount: 200,
    paymentMethod: "PIX",
    paymentStatus: "PAID",
    beforePhotos: ["https://minio.severinno.com/photos/before1.jpg"],
    afterPhotos: ["https://minio.severinno.com/photos/after1.jpg"],
    completionNote: "Instalação concluída de acordo com as normas ABNT.",
    escrowReleasedAt: new Date("2026-10-16T10:00:00Z"),
    client: {
      id: "client-abc",
      name: "Roberta Vasconcelos",
      whatsapp: "33999991111",
      phone: null,
    },
    provider: {
      id: "provider-xyz",
      name: "Carlos Eletricista",
      cpfCnpj: "12345678909",
      lat: -18.8546,
      lng: -41.9561,
      gpsAccuracyM: 10,
    },
    service: {
      id: "service-999",
      title: "Manutenção de Quadro de Distribuição",
    },
    payment: {
      id: "pay-111",
      lytexId: "lyt_charge_999",
      status: "PAID",
      amount: 200,
      paidAt: new Date("2026-10-16T09:30:00Z"),
    },
  }

  it("gera certificado de conclusão com geofence auditado, split financeiro e hash SHA-256", async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(mockBooking as any)

    const cert = await generateProofOfWorkCertificate("booking-pow-123")

    expect(cert).not.toBeNull()
    expect(cert?.bookingId).toBe("booking-pow-123")
    expect(cert?.status).toBe("CERTIFIED")
    expect(cert?.client.name).toBe("Roberta Vasconcelos")
    expect(cert?.provider.name).toBe("Carlos Eletricista")
    expect(cert?.provider.cpfCnpjMasked).toBe("123.***.***-09")

    // Auditoria Geofence
    expect(cert?.geofenceAudit.verified).toBe(true)
    expect(cert?.geofenceAudit.tier).toBe("STRICT_50M")
    expect(cert?.geofenceAudit.distanceMeters).toBeLessThanOrEqual(50)

    // Auditoria Financeira: R$ 200 -> R$ 30 plataforma (15%) / R$ 170 prestador (85%)
    expect(cert?.financial.grossAmount).toBe(200)
    expect(cert?.financial.platformFee).toBe(30)
    expect(cert?.financial.providerPayout).toBe(170)

    // Hash criptográfico
    expect(cert?.cryptographicDigest).toBeDefined()
    expect(cert?.cryptographicDigest.length).toBe(64) // SHA-256 hex
  })

  it("renderiza documento HTML auditável seguro contra XSS", () => {
    const mockCert = {
      certificateId: "POW-123-ABC",
      bookingId: "booking-123",
      issuedAt: "2026-10-16T10:00:00Z",
      status: "CERTIFIED" as const,
      client: {
        id: "c1",
        name: "<script>alert('xss')</script>Maria",
        address: "Rua Teste, 100",
        cep: "35010-000",
        lat: -18.85,
        lng: -41.95,
      },
      provider: {
        id: "p1",
        name: "João Prestador",
        cpfCnpjMasked: "123.***.***-00",
      },
      service: {
        id: "s1",
        title: "Pintura Residencial",
        amount: 500,
      },
      financial: {
        method: "PIX",
        status: "PAID",
        grossAmount: 500,
        platformFee: 75,
        providerPayout: 425,
      },
      geofenceAudit: {
        verified: true,
        clientCoords: { lat: -18.85, lng: -41.95 },
        distanceMeters: 25,
        accuracyMeters: 8,
        tier: "STRICT_50M" as const,
      },
      mediaAudit: {
        beforePhotosCount: 2,
        afterPhotosCount: 2,
        beforeDigest: "abc123",
        afterDigest: "def456",
        completionNote: "Trabalho finalizado com sucesso.",
      },
      cryptographicDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      verificationUrl: "https://severinno.com/api/bookings/booking-123/certificate",
    }

    const html = renderProofOfWorkHtml(mockCert)

    expect(html).toContain("SEVERINNO MARKETPLACE")
    expect(html).toContain("Certificado Criptográfico de Conclusão de Serviço")
    expect(html).toContain("POW-123-ABC")
    expect(html).toContain("Pintura Residencial")
    expect(html).toContain("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")

    // Garante que o script malicioso foi escapado
    expect(html).not.toContain("<script>alert('xss')</script>")
    expect(html).toContain("&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;Maria")
  })
})
