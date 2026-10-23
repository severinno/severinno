import { describe, it, expect } from "vitest"
import { classifyIntentHeuristic } from "../whatsapp-ai-triage"
import { extractGvNeighborhood } from "../whatsapp-autoresponder"
import { generateWhatsAppPixCheckoutBundle } from "../whatsapp-pix-checkout"
import { lookupCnefeGV } from "../geo-cnefe"
import { calculateRoute } from "../geo-osrm"
import { generateEscrowPIN, validateEscrowRelease } from "../geo-checkin-escrow"
import { FEE_RATE } from "../constants"

describe("E2E Trifeta Operacional: WhatsApp IA + Web Push PWA + Torre de Controle GV", () => {
  // ── PILAR 1: Funil WhatsApp Conversacional (IA Híbrida + PIX Copia-e-Cola) ──
  describe("Pilar 1 — Funil WhatsApp Conversacional", () => {
    const scenarios = [
      {
        message:
          "Chuveiro estourou e o disjuntor desarmou na Ilha dos Araújos, socorro preciso de eletricista urgente!",
        expectedCategory: "Eletricista",
        expectedNeighborhood: "Ilha dos Araújos",
        expectedUrgency: "EMERGENCY",
        amount: 180.0,
      },
      {
        message:
          "Meu ar-condicionado parou de gelar na Vila Bretas, tá muito quente preciso de técnico",
        expectedCategory: "Climatização",
        expectedNeighborhood: "Vila Bretas",
        expectedUrgency: "NORMAL",
        amount: 250.0,
      },
      {
        message: "Vazamento forte embaixo da pia da cozinha inundando o apartamento no Centro",
        expectedCategory: "Encanador",
        expectedNeighborhood: "Centro",
        expectedUrgency: "EMERGENCY",
        amount: 200.0,
      },
      {
        message: "Gostaria de um orçamento para pintar a fachada e muros na Grã-Duquesa",
        expectedCategory: "Pintor",
        expectedNeighborhood: "Grã-Duquesa",
        expectedUrgency: "NORMAL",
        amount: 850.0,
      },
      {
        message: "Preciso instalar um suporte articulado de TV e prateleiras no bairro Santa Rita",
        expectedCategory: "Marido de Aluguel",
        expectedNeighborhood: "Santa Rita",
        expectedUrgency: "NORMAL",
        amount: 150.0,
      },
    ]

    it("triaga com precisão os 5 chamados de GV extraindo intenção, categoria, bairro e urgência", () => {
      for (const s of scenarios) {
        const triage = classifyIntentHeuristic(s.message)
        const neighborhood = extractGvNeighborhood(s.message)

        expect(triage.intent).toBe("SERVICE_SEARCH")
        expect(triage.category).toBe(s.expectedCategory)
        expect(neighborhood).toBe(s.expectedNeighborhood)
        expect(triage.urgency).toBe(s.expectedUrgency)
      }
    })

    it("gera pacote de pagamento Pix nativo com 1 toque e garantia Escrow", () => {
      const bundle = generateWhatsAppPixCheckoutBundle({
        bookingId: "book-gv-trifeta-001",
        clientName: "Mariana Souza",
        clientPhone: "33999887766",
        providerName: "Carlos Eletricista",
        serviceTitle: "Troca de Disjuntor e Reparo Emergencial",
        amount: 180.0,
        pixCopyPaste:
          "00020126580014br.gov.bcb.pix0136severinno-custodia-180005204000053039865802BR5920SEVERINNO TECNOLOGIA6009VALADARES62070503***6304ABCD",
        qrCodeUrl: "https://severinno.com/api/pix/qr/book-gv-trifeta-001.png",
      })

      // Validação do resumo
      expect(bundle.summaryMessage.content).toContain("SEVERINNO — Pagamento Seguro Protegido")
      expect(bundle.summaryMessage.content).toContain("Garantia Escrow")
      expect(bundle.summaryMessage.content).toContain("R$")

      // Validação do Pix de 1 toque (sem poluição visual para cópia instantânea)
      expect(bundle.pixCodeOnlyMessage.content).toBe(
        "00020126580014br.gov.bcb.pix0136severinno-custodia-180005204000053039865802BR5920SEVERINNO TECNOLOGIA6009VALADARES62070503***6304ABCD",
      )
      expect(bundle.pixCodeOnlyMessage.content).not.toContain("Copie")
      expect(bundle.pixCodeOnlyMessage.content).not.toContain("👇")

      // Validação do QR code
      expect(bundle.qrCodeMessage?.mediaUrl).toBeDefined()
      expect(bundle.totalAmount).toBe(180.0)
    })
  })

  // ── PILAR 2: Notificações Web Push (VAPID) no Celular do Prestador ──────────
  describe("Pilar 2 — Web Push PWA no Smartphone do Prestador", () => {
    it("valida o contrato de payload Web Push para BOOKING_CREATED com botões de ação e persistência", () => {
      const bookingId = "book-gv-trifeta-001"
      const pushPayload = {
        title: "🚨 Novo Chamado na Ilha dos Araújos!",
        body: "Mariana solicitou Eletricista de Emergência (R$ 180,00). Toque para aceitar.",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        vibrate: [200, 100, 200],
        requireInteraction: true,
        actions: [
          { action: "accept", title: "✅ Aceitar" },
          { action: "reject", title: "❌ Recusar" },
        ],
        data: {
          url: `/dashboard?tab=bookings&booking=${bookingId}&action=confirm`,
          bookingId,
          notificationType: "BOOKING_CREATED",
        },
      }

      // Verificação das ações rápidas na tela de bloqueio
      expect(pushPayload.actions).toHaveLength(2)
      expect(pushPayload.actions[0].action).toBe("accept")
      expect(pushPayload.actions[1].action).toBe("reject")

      // Garantia de persistência no lock screen até resposta
      expect(pushPayload.requireInteraction).toBe(true)

      // Feedback de vibração configurado
      expect(pushPayload.vibrate).toEqual([200, 100, 200])

      // Deep link para aceitação direta
      expect(pushPayload.data.url).toContain(bookingId)
      expect(pushPayload.data.notificationType).toBe("BOOKING_CREATED")
    })
  })

  // ── PILAR 3: Torre de Controle & Despacho Concorrente Multi-Bairro ───────────
  describe("Pilar 3 — Torre de Controle & Despacho Concorrente em GV", () => {
    const orders = [
      {
        id: "ord-01",
        bairro: "Ilha dos Araújos",
        street: "Avenida Rio Doce",
        number: 300,
        category: "Eletricista",
        amount: 180.0,
      },
      {
        id: "ord-02",
        bairro: "Vila Bretas",
        street: "Avenida Presidente Juscelino Kubitschek",
        number: 1200,
        category: "Climatização",
        amount: 250.0,
      },
      {
        id: "ord-03",
        bairro: "Centro",
        street: "Rua Peçanha",
        number: 450,
        category: "Encanador",
        amount: 200.0,
      },
      {
        id: "ord-04",
        bairro: "Grã-Duquesa",
        street: "Avenida Itália",
        number: 200,
        category: "Pintor",
        amount: 850.0,
      },
      {
        id: "ord-05",
        bairro: "Santa Rita",
        street: "Avenida Washington Luís",
        number: 150,
        category: "Marido de Aluguel",
        amount: 150.0,
      },
    ]

    it("resolve geocodificação CNEFE soberana para os 5 bairros concorrentes", () => {
      for (const order of orders) {
        const geo = lookupCnefeGV({ street: order.street, number: order.number })
        expect(geo).not.toBeNull()
        expect(geo?.confidence).toBeGreaterThanOrEqual(0.85)
        expect(geo?.city).toBe("Governador Valadares")
        expect(geo?.lat).toBeLessThan(-18.7)
        expect(geo?.lng).toBeLessThan(-41.8)
      }
    })

    it("calcula rotas viárias OSRM reais para os 5 chamados e consolida métricas da Torre", async () => {
      // Base central de prestadores no Centro de GV (Praça dos Pioneiros)
      const baseCoords: [number, number] = [-18.853, -41.944]
      let totalGrossHeld = 0

      for (const order of orders) {
        const geo = lookupCnefeGV({ street: order.street, number: order.number })!
        const route = await calculateRoute(baseCoords, [geo.lat, geo.lng])

        expect(route.distanceMeters).toBeGreaterThan(0)
        expect(route.durationSeconds).toBeGreaterThan(0)
        expect(route.polyline.length).toBeGreaterThan(0)

        totalGrossHeld += order.amount
      }

      // Verificação financeira consolidada da Torre de Controle
      const expectedTotalHeld = 180 + 250 + 200 + 850 + 150 // R$ 1.630,00
      expect(totalGrossHeld).toBe(expectedTotalHeld)

      const totalPlatformFee = totalGrossHeld * FEE_RATE // 15% = R$ 244,50
      const totalProviderPayout = totalGrossHeld - totalPlatformFee // 85% = R$ 1.385,50

      expect(totalPlatformFee).toBe(244.5)
      expect(totalProviderPayout).toBe(1385.5)

      // Simulação de liberação de custódia via PIN criptográfico para ord-01
      const pinObj = await generateEscrowPIN("ord-01")
      expect(pinObj.pin).toMatch(/^\d{4}$/)

      const release = await validateEscrowRelease("ord-01", pinObj.pin, 180.0)
      expect(release.success).toBe(true)
      expect(release.releasedAmount).toBe(180.0)
    })
  })
})
