import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  extractStructuredQuoteFromSpeech,
  buildVoiceQuoteWhatsAppReply,
  processVoiceQuote,
} from "../whatsapp-voice-quote"
import * as aiClient from "../ai-client"

vi.mock("@/lib/logger", () => {
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => mockLog,
  }
  return { default: mockLog }
})

describe("whatsapp-voice-quote — Voice-to-Quote Pipeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("extrai dados de orçamento estruturado a partir da fala com auxílio da IA", async () => {
    vi.spyOn(aiClient, "chatCompletionHybrid").mockResolvedValueOnce({
      content: JSON.stringify({
        category: "Encanador",
        serviceTitle: "Conserto de vazamento de pia",
        description: "Cano quebrado embaixo da pia vazando água na cozinha.",
        urgency: "HIGH",
        estimatedPriceRange: [90, 160],
        neighborhood: "Ilha dos Araújos",
        confidence: 0.95,
      }),
      engine: "cloud_groq",
      model: "llama-3.3-70b",
      latencyMs: 120,
    })

    const audioText =
      "Oi, preciso de um encanador urgente aqui na Ilha dos Araújos, o cano embaixo da pia estourou e tá vazando água direto."

    const quote = await extractStructuredQuoteFromSpeech(audioText)

    expect(quote.category).toBe("Encanador")
    expect(quote.serviceTitle).toBe("Conserto de vazamento de pia")
    expect(quote.urgency).toBe("HIGH")
    expect(quote.neighborhood).toBe("Ilha dos Araújos")
    expect(quote.estimatedPriceRange).toEqual([90, 160])
  })

  it("aplica fallback heurístico robusto quando a IA falha ou responde com erro", async () => {
    vi.spyOn(aiClient, "chatCompletionHybrid").mockRejectedValueOnce(new Error("Timeout"))

    const audioText = "Estou trancado para fora de casa sem chave urgente"
    const quote = await extractStructuredQuoteFromSpeech(audioText)

    expect(quote.category).toBe("Geral")
    expect(quote.urgency).toBe("HIGH") // detectou palavra 'urgente' e 'trancado'
    expect(quote.confidence).toBe(0.6)
  })

  it("constrói resposta WhatsApp formatada com card, detalhes e link de 1 clique", () => {
    const { replyText, quoteUrl } = buildVoiceQuoteWhatsAppReply(
      "Preciso trocar chuveiro 220v no São Pedro",
      {
        category: "Eletricista",
        serviceTitle: "Troca de Chuveiro 220V",
        description: "Instalação de chuveiro elétrico",
        urgency: "NORMAL",
        estimatedPriceRange: [70, 120],
        neighborhood: "São Pedro",
        confidence: 0.9,
      },
    )

    expect(replyText).toContain("🎙️ *Áudio Entendido com Sucesso!*")
    expect(replyText).toContain("🔧 *Serviço:* Troca de Chuveiro 220V")
    expect(replyText).toContain("📁 *Categoria:* Eletricista")
    expect(replyText).toContain("📍 *Região:* São Pedro")
    expect(replyText).toContain("Faixa Média Estimada:* R$ 70 a R$ 120")
    expect(quoteUrl).toContain("categoria=Eletricista")
    expect(quoteUrl).toContain("origem=whatsapp_voice")
  })

  it("executa o orquestrador completo processVoiceQuote a partir de texto transcrito", async () => {
    vi.spyOn(aiClient, "chatCompletionHybrid").mockResolvedValueOnce({
      content: JSON.stringify({
        category: "Chaveiro",
        serviceTitle: "Abertura de Porta Residencial",
        description: "Chave quebrada na fechadura",
        urgency: "EMERGENCY",
        estimatedPriceRange: [120, 220],
        neighborhood: "Centro",
        confidence: 0.98,
      }),
      engine: "cloud_groq",
      model: "llama-3.3-70b",
      latencyMs: 80,
    })

    const result = await processVoiceQuote(
      "Chave quebrou dentro da fechadura, porta trancada socorro",
    )

    expect(result.quote.category).toBe("Chaveiro")
    expect(result.quote.urgency).toBe("EMERGENCY")
    expect(result.formattedReply).toContain("EMERGÊNCIA IMEDIATA")
  })
})
