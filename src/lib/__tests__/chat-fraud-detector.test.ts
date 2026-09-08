import { describe, it, expect } from "vitest"
import { detectChatFraud } from "../chat-fraud-detector"

describe("chat-fraud-detector", () => {
  it("returns no risk for innocent conversation", () => {
    const result = detectChatFraud(
      "Olá, tudo bem? Gostaria de saber se você pode vir amanhã às 14h.",
    )
    expect(result.hasRisk).toBe(false)
    expect(result.riskLevel).toBe("none")
    expect(result.detectedPatterns).toHaveLength(0)
  })

  it("detects off-platform payment attempts ('por fora')", () => {
    const result = detectChatFraud("Se você fizer por fora eu te dou um desconto de 15%.")
    expect(result.hasRisk).toBe(true)
    expect(result.isOffPlatformPayment).toBe(true)
    expect(result.riskLevel).toBe("high")
    expect(result.detectedPatterns).toContain("Menção a pagamento fora da plataforma")
  })

  it("detects direct Pix requests", () => {
    const result = detectChatFraud("Me passa a chave pix para eu te pagar.")
    expect(result.hasRisk).toBe(true)
    expect(result.isOffPlatformPayment).toBe(true)
    expect(result.riskLevel).toBe("high")
  })

  it("detects WhatsApp invitation ('chama no zap')", () => {
    const result = detectChatFraud("Não uso muito aqui, me chama no zap pra gente combinar.")
    expect(result.hasRisk).toBe(true)
    expect(result.isContactSharing).toBe(true)
    expect(result.riskLevel).toBe("medium")
    expect(result.detectedPatterns).toContain("Solicitação de contato via WhatsApp / Zap")
  })

  it("detects telephone numbers", () => {
    const result = detectChatFraud("Meu contato é 11 98765-4321, me liga.")
    expect(result.hasRisk).toBe(true)
    expect(result.isContactSharing).toBe(true)
    expect(result.riskLevel).toBe("medium")
    expect(result.detectedPatterns).toContain("Compartilhamento de número de telefone")
  })

  it("detects email addresses", () => {
    const result = detectChatFraud("Pode mandar o comprovante para joao.silva@gmail.com")
    expect(result.hasRisk).toBe(true)
    expect(result.isContactSharing).toBe(true)
    expect(result.detectedPatterns).toContain("Endereço de e-mail / Chave Pix externa")
  })

  it("detects combined high risk (contact sharing + off-platform payment)", () => {
    const result = detectChatFraud("Chama no zap 11988887777 que faço por fora sem a taxa")
    expect(result.hasRisk).toBe(true)
    expect(result.riskLevel).toBe("high")
    expect(result.isOffPlatformPayment).toBe(true)
    expect(result.isContactSharing).toBe(true)
    expect(result.warningTitle).toBe("Aviso de Segurança — Pagamento Protegido")
  })
})
