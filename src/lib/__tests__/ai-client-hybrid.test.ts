import { describe, it, expect, vi, beforeEach } from "vitest"

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

import { chatCompletionHybrid, chatCompletion, isLocalAiOnline } from "../ai-client"

describe("ai-client hybrid architecture", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete process.env.GROQ_API_KEY
    delete process.env.AI_API_KEY
    delete process.env.OLLAMA_URL
  })

  it("utiliza Groq Cloud como motor primário quando chave está configurada e responde ok", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key"
    process.env.AI_BASE_URL = "https://api.groq.com/openai/v1"

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "chat-123",
        choices: [{ message: { role: "assistant", content: "Resposta rápida da Groq Cloud" } }],
      }),
    } as any)

    const result = await chatCompletionHybrid([{ role: "user", content: "Olá" }])

    expect(result.engine).toBe("cloud_groq")
    expect(result.content).toBe("Resposta rápida da Groq Cloud")
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer gsk_test_key",
        }),
      }),
    )
  })

  it("faz failover automático para Ollama local quando Groq Cloud falha ou dá timeout", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key"
    process.env.OLLAMA_URL = "http://127.0.0.1:11434/v1"

    const fetchSpy = vi
      .spyOn(global, "fetch")
      // 1ª chamada (Cloud): falha com HTTP 500 ou timeout
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as any)
      // 2ª chamada (Ollama Local): sucesso
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ollama-456",
          choices: [
            { message: { role: "assistant", content: "Resposta de contingência do Ollama local" } },
          ],
        }),
      } as any)

    const result = await chatCompletionHybrid([{ role: "user", content: "Preciso de ajuda" }])

    expect(result.engine).toBe("local_ollama")
    expect(result.content).toBe("Resposta de contingência do Ollama local")
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("chama diretamente o Ollama local quando preferredEngine = 'local'", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key"
    process.env.OLLAMA_URL = "http://127.0.0.1:11434/v1"

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "ollama-789",
        choices: [{ message: { role: "assistant", content: "Resposta forçada no Ollama" } }],
      }),
    } as any)

    const result = await chatCompletionHybrid([{ role: "user", content: "Teste local" }], {
      preferredEngine: "local",
    })

    expect(result.engine).toBe("local_ollama")
    expect(result.content).toBe("Resposta forçada no Ollama")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("retorna engine = 'fallback' graciosamente quando ambos os motores falham", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key"

    vi.spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("Cloud network error"))
      .mockRejectedValueOnce(new Error("Local container connection refused"))

    const result = await chatCompletionHybrid([{ role: "user", content: "Oi" }])

    expect(result.engine).toBe("fallback")
    expect(result.content).toBeNull()
  })

  it("mantém retrocompatibilidade da função legada chatCompletion", async () => {
    process.env.OLLAMA_URL = "http://127.0.0.1:11434/v1"

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Texto direto compatível" } }],
      }),
    } as any)

    const content = await chatCompletion([{ role: "user", content: "Teste" }])
    expect(content).toBe("Texto direto compatível")
  })

  it("detecta Ollama online via /api/tags", async () => {
    process.env.OLLAMA_URL = "http://127.0.0.1:11434/v1"

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
    } as any)

    const online = await isLocalAiOnline()
    expect(online).toBe(true)
  })
})
