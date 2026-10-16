import { describe, it, expect, beforeEach } from "vitest"
import {
  maskOffPlatformData,
  trackDisintermediationStrike,
  resetDisintermediationStrikes,
  processChatMessageWithSafety,
  MASK_BADGE,
} from "../anti-disintermediation-guard"

describe("anti-disintermediation-guard", () => {
  beforeEach(() => {
    resetDisintermediationStrikes("user-test-123")
  })

  it("mascara números de telefone e e-mails compartilhados na conversa", () => {
    const message = "Opa, me liga no 33 99876-5432 ou manda email em prestador@gmail.com"
    const { maskedText, isModified, detectedTypes } = maskOffPlatformData(message)

    expect(isModified).toBe(true)
    expect(maskedText).toContain(MASK_BADGE)
    expect(maskedText).not.toContain("99876-5432")
    expect(maskedText).not.toContain("prestador@gmail.com")
    expect(detectedTypes).toContain("Telefone / Celular")
    expect(detectedTypes).toContain("Endereço de E-mail / Chave Pix E-mail")
  })

  it("mascara termos explícitos de desvio de pagamento (pagar por fora, pix direto)", () => {
    const message = "Se quiser pagar por fora eu dou 10% de desconto, manda o pix direto"
    const { maskedText, isModified } = maskOffPlatformData(message)

    expect(isModified).toBe(true)
    expect(maskedText).toContain(MASK_BADGE)
    expect(maskedText).not.toContain("pagar por fora")
  })

  it("permite mensagens legítimas de negociação sem alteração", () => {
    const message = "Olá! Consigo chegar às 14h para instalar o chuveiro elétrico no Centro."
    const result = processChatMessageWithSafety("user-test-123", message)

    expect(result.isMasked).toBe(false)
    expect(result.blocked).toBe(false)
    expect(result.safeText).toBe(message)
    expect(result.riskLevel).toBe("none")
  })

  it("acumula reincidência e bloqueia mensagem na terceira tentativa de alto risco", () => {
    const bypassMessage = "Me chama no zap 33 98888-1111 que faço por fora"

    // Strike 1
    const res1 = processChatMessageWithSafety("user-test-123", bypassMessage)
    expect(res1.isMasked).toBe(true)
    expect(res1.blocked).toBe(false)
    expect(res1.recidivismCount).toBe(1)
    expect(res1.isRecidivist).toBe(false)

    // Strike 2
    const res2 = processChatMessageWithSafety("user-test-123", bypassMessage)
    expect(res2.recidivismCount).toBe(2)
    expect(res2.blocked).toBe(false)

    // Strike 3 -> Reincidência atingida e bloqueio automático
    const res3 = processChatMessageWithSafety("user-test-123", bypassMessage)
    expect(res3.recidivismCount).toBe(3)
    expect(res3.isRecidivist).toBe(true)
    expect(res3.blocked).toBe(true)
    expect(res3.safeText).toContain("[MENSAGEM BLOQUEADA")
  })

  it("permite contato direto se a reserva estiver formalmente confirmada com escrow", () => {
    const directContactMsg = "Estou no portão, pode me chamar no 33 99999-0000"
    const result = processChatMessageWithSafety("user-test-123", directContactMsg, {
      allowDirectContact: true,
    })

    expect(result.isMasked).toBe(false)
    expect(result.blocked).toBe(false)
    expect(result.safeText).toBe(directContactMsg)
  })
})
