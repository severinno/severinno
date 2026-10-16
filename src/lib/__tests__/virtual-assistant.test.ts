import { describe, it, expect } from "vitest"
import { generateVirtualAssistantResponse } from "../virtual-assistant"

describe("virtual-assistant domain knowledge engine", () => {
  it("responde saudações cordialmente com apresentação do Severinno", () => {
    const res = generateVirtualAssistantResponse("oi")
    expect(res).toContain("Olá!")
    expect(res).toContain("Severinno")
    expect(res).toContain("Governador Valadares")
  })

  it("responde 'olá, tudo bem?' com cordialidade", () => {
    const res = generateVirtualAssistantResponse("olá tudo bem")
    expect(res).toContain("Olá!")
    expect(res).toContain("Severinno")
  })

  it("explica como a plataforma funciona quando perguntado", () => {
    const res = generateVirtualAssistantResponse("Como funciona o Severinno?")
    expect(res).toContain("Busca Inteligente")
    expect(res).toContain("Orçamento Direto")
    expect(res).toContain("Pagamento Protegido (Escrow)")
  })

  it("fornece detalhes e valores médios para eletricista", () => {
    const res = generateVirtualAssistantResponse("Preciso de um eletricista, como encontro um?")
    expect(res).toContain("Eletricistas Verificados")
    expect(res).toContain("chuveiro")
    expect(res).toContain("Elétrica")
  })

  it("fornece detalhes para encanador e vazamentos", () => {
    const res = generateVirtualAssistantResponse("estou com um vazamento na pia do banheiro")
    expect(res).toContain("Encanador")
    expect(res).toContain("Hidráulica")
  })

  it("fornece orientações para serviços de pintura", () => {
    const res = generateVirtualAssistantResponse("quero pintar meu apartamento")
    expect(res).toContain("Pintura")
    expect(res).toContain("m²")
  })

  it("fornece orientações para diarista e limpeza", () => {
    const res = generateVirtualAssistantResponse("quanto custa uma diarista para faxina?")
    expect(res).toContain("Diaristas")
    expect(res).toContain("Limpeza")
  })

  it("esclarece segurança e proteção com o Severinno Escrow", () => {
    const res = generateVirtualAssistantResponse("É seguro contratar pelo Severinno?")
    expect(res).toContain("100% seguro")
    expect(res).toContain("KYC")
    expect(res).toContain("Escrow")
  })

  it("esclarece valores e formas de pagamento (PIX e cartão)", () => {
    const res = generateVirtualAssistantResponse("Quanto custa contratar um prestador?")
    expect(res).toContain("gratuito")
    expect(res).toContain("PIX")
    expect(res).toContain("Cartão de Crédito")
  })

  it("responde agradecimentos cordialmente", () => {
    const res = generateVirtualAssistantResponse("muito obrigado pela ajuda!")
    expect(res).toContain("Disponha sempre!")
  })

  it("usa contexto prévio para perguntas de follow-up", () => {
    const res = generateVirtualAssistantResponse("quanto custa?", [
      { role: "user", content: "preciso de um eletricista" },
      { role: "assistant", content: "posso ajudar com eletricista" },
    ])
    expect(res).toContain("Eletricistas")
  })
})
