import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  normalizePromptText,
  computeAICacheKey,
  getCachedAIResponse,
  setCachedAIResponse,
  getAICacheMetrics,
  resetAICacheMetrics,
} from "../ai-cache"
import { chatCompletionHybrid } from "../ai-client"

const mockStore = new Map<string, any>()

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async (key: string) => mockStore.get(key) ?? null),
  cacheSet: vi.fn(async (key: string, val: any) => {
    mockStore.set(key, val)
  }),
  cacheInvalidate: vi.fn(async (key: string) => {
    mockStore.delete(key)
  }),
}))

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

describe("ai-cache — Cache Semântico de Prompts no Redis", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetAICacheMetrics()
    mockStore.clear()
  })

  it("normaliza texto removendo acentos, pontuações e espaços extras", () => {
    const raw = "  Olá!! Preciso de um conserto de ELÉTRICA na Ilha dos Araújos...  "
    const normalized = normalizePromptText(raw)

    expect(normalized).toBe("ola preciso de um conserto de eletrica na ilha dos araujos")
  })

  it("gera chaves de cache idênticas para variações com formatações diferentes do mesmo prompt", () => {
    const key1 = computeAICacheKey(
      [{ role: "user", content: "Troca de disjuntor 220V no Centro" }],
      "llama-3.3-70b-versatile",
      0.2,
    )
    const key2 = computeAICacheKey(
      [{ role: "user", content: "troca de disjuntor 220v no centro!" }],
      "llama-3.3-70b-versatile",
      0.2,
    )

    expect(key1).toBe(key2)
    expect(key1.startsWith("ai:cache:v1:")).toBe(true)
  })

  it("armazena e recupera respostas em cache computando métricas de hit e miss", async () => {
    const key = "ai:cache:v1:test-sample-key"

    // 1. Inicialmente miss
    const miss = await getCachedAIResponse(key)
    expect(miss).toBeNull()

    // 2. Salva em cache
    await setCachedAIResponse(key, "Resposta de teste cacheada", "llama-3.3-70b")

    // 3. Recupera em cache (hit)
    const hit = await getCachedAIResponse(key)
    expect(hit).not.toBeNull()
    expect(hit?.content).toBe("Resposta de teste cacheada")

    // 4. Métricas
    const metrics = getAICacheMetrics()
    expect(metrics.hits).toBe(1)
    expect(metrics.misses).toBe(1)
    expect(metrics.total).toBe(2)
    expect(metrics.hitRatio).toBe(0.5)
  })

  it("integra com chatCompletionHybrid retornando engine = 'cache' no segundo acesso", async () => {
    process.env.GROQ_API_KEY = "gsk_test"

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "chat-1",
        choices: [{ message: { role: "assistant", content: "Resultado IA Groq" } }],
      }),
    } as any)

    const messages = [{ role: "user" as const, content: "Preciso de encanador em GV" }]

    // Primeira chamada: vai para a nuvem
    const res1 = await chatCompletionHybrid(messages, { preferredEngine: "cloud" })
    expect(res1.engine).toBe("cloud_groq")
    expect(res1.content).toBe("Resultado IA Groq")
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Segunda chamada com mesmo prompt: deve vir do cache em < 5ms sem novo fetch!
    const res2 = await chatCompletionHybrid(messages, { preferredEngine: "cloud" })
    expect(res2.engine).toBe("cache")
    expect(res2.cached).toBe(true)
    expect(res2.content).toBe("Resultado IA Groq")
    expect(fetchSpy).toHaveBeenCalledTimes(1) // nenhuma chamada extra de rede
  })
})
