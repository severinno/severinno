import { describe, it, expect } from "vitest"
import {
  generateWhatsAppPixCheckoutBundle,
  normalizeWhatsAppNumber,
  formatWhatsAppPixPaymentReceipt,
} from "../whatsapp-pix-checkout"

describe("whatsapp-pix-checkout", () => {
  it("normaliza número de telefone brasileiro para formato E.164 (55 + DDD + número)", () => {
    expect(normalizeWhatsAppNumber("33998765432")).toBe("5533998765432")
    expect(normalizeWhatsAppNumber("(33) 98888-1111")).toBe("5533988881111")
    expect(normalizeWhatsAppNumber("5533999990000")).toBe("5533999990000")
  })

  it("gera o pacote completo de mensagens garantindo mensagem de Pix pura e isolada para cópia em 1 toque", () => {
    const rawPix =
      "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865405150.005802BR5913Severinno App6008BRASILIA62070503***6304E2CA"

    const bundle = generateWhatsAppPixCheckoutBundle({
      bookingId: "booking-999",
      clientName: "Carolina Silva",
      clientPhone: "(33) 98888-2222",
      providerName: "Lucas Eletricista",
      serviceTitle: "Instalação de Ventilador de Teto",
      amount: 150.0,
      pixCopyPaste: rawPix,
      qrCodeBase64:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    })

    expect(bundle.clientPhone).toBe("5533988882222")
    expect(bundle.totalAmount).toBe(150.0)

    // Mensagem 1: Resumo com valor e garantia
    expect(bundle.summaryMessage.content).toContain("Carolina Silva")
    expect(bundle.summaryMessage.content).toContain("Lucas Eletricista")
    expect(bundle.summaryMessage.content).toContain("Garantia Escrow")

    // Mensagem 2: CÓDIGO PIX PURO (Sem quebras, sem texto extra)
    expect(bundle.pixCodeOnlyMessage.content).toBe(rawPix)
    expect(bundle.pixCodeOnlyMessage.content).not.toContain("Valor:")
    expect(bundle.pixCodeOnlyMessage.content).not.toContain("Olá")

    // Mensagem 3: QR Code como mídia
    expect(bundle.qrCodeMessage).toBeDefined()
    expect(bundle.qrCodeMessage?.mediaBase64).toBeDefined()
    expect(bundle.qrCodeMessage?.caption).toContain("Escaneie este QR Code")
  })

  it("formata o recibo de confirmação digital de pagamento para envio no WhatsApp", () => {
    const receipt = formatWhatsAppPixPaymentReceipt({
      bookingId: "booking-123456",
      clientName: "Rodrigo Mendes",
      providerName: "Antônio Encanador",
      amount: 180.0,
      scheduledAt: "16/10 às 14:30",
      trackingUrl: "https://severinno.com.br/rastreio/live-999",
    })

    expect(receipt).toContain("PAGAMENTO CONFIRMADO")
    expect(receipt).toContain("Rodrigo Mendes")
    expect(receipt).toContain("Antônio Encanador")
    expect(receipt).toContain("16/10 às 14:30")
    expect(receipt).toContain("https://severinno.com.br/rastreio/live-999")
  })
})
