/**
 * Tests for POST /api/chat — AI assistant via z-ai-web-dev-sdk.
 *
 * Covers the three core contracts of the route:
 *   - Rate limiting (assertRateLimit com RATE_LIMITS.general → 429)
 *   - Validação de mensagem vazia (400)
 *   - Caminho de sucesso (200 com a resposta do assistente)
 *
 * Plus os irmãos naturais: trim de histórico (últimos 10), assistente sem
 * conteúdo (500) e falha do provider (500 com mensagem neutra).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

// z-ai-web-dev-sdk: export default ZAI com ZAI.create() → { chat: { completions: { create } } }
const mockSdk = vi.hoisted(() => {
  const completionsCreate = vi.fn()
  return {
    default: {
      create: vi.fn(async () => ({
        chat: {
          completions: {
            create: completionsCreate,
          },
        },
      })),
    },
    // Referência direta ao mock interno para asserts (ZAI.create é awaited,
    // então o objeto retornado não é observável pela rota de outra forma).
    completionsCreate,
  }
})

vi.mock("z-ai-web-dev-sdk", () => mockSdk)

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: { prefix: "general", max: 60, windowMs: 60_000 } },
}))

// api-server.ts (handleError/badRequest/HttpError REAIS ficam no teste) importa
// db/redis/logger — transitivos mockados; o mapeamento de erros é o real.
vi.mock("@/lib/db", () => ({ db: {} }))
vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key: string, fn: () => Promise<unknown>) => fn()),
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { NextRequest } from "next/server"
import ZAI from "z-ai-web-dev-sdk"
import { POST } from "../chat/route"
import { HttpError } from "@/lib/api-server"
import { assertRateLimit } from "@/lib/rate-limit"

const DEFAULT_COMPLETION = {
  choices: [{ message: { content: "Claro! Posso ajudar com isso." } }],
}

function chatRequest(body?: unknown): NextRequest {
  // POST assina NextRequest (subclasse de Request) — o createMockRequest
  // devolve um Request genérico, que é estruturalmente compatível.
  return createMockRequest({ method: "POST", body: body ?? {} }) as NextRequest
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockSdk.completionsCreate).mockResolvedValue(DEFAULT_COMPLETION)
  })

  it("retorna 429 quando o rate limit é excedido (sem chamar o SDK)", async () => {
    vi.mocked(assertRateLimit).mockRejectedValueOnce(
      new HttpError(429, "Muitas requisições. Tente novamente em alguns segundos.", {
        "X-RateLimit-Limit": "60",
        "Retry-After": "5",
      }),
    )

    const res = await POST(chatRequest({ message: "olá" }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(429)
    expect((parsed.body as any).error).toBe(
      "Muitas requisições. Tente novamente em alguns segundos.",
    )
    // Os headers do HttpError (rateLimitHeaders) fluem via handleError
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60")
    expect(res.headers.get("Retry-After")).toBe("5")
    expect(ZAI.create).not.toHaveBeenCalled()
  })

  it("aplica o rate limit geral (RATE_LIMITS.general) antes de processar", async () => {
    await POST(chatRequest({ message: "olá" }))

    expect(assertRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ prefix: "general", max: 60 }),
    )
  })

  it("rejeita mensagem vazia com 400", async () => {
    const res = await POST(chatRequest({ message: "" }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toBe("Mensagem é obrigatória.")
    expect(ZAI.create).not.toHaveBeenCalled()
  })

  it("rejeita mensagem só com espaços com 400", async () => {
    const res = await POST(chatRequest({ message: "   " }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toBe("Mensagem é obrigatória.")
  })

  it("rejeita body sem o campo message com 400", async () => {
    const res = await POST(chatRequest({}))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toBe("Mensagem é obrigatória.")
  })

  it("retorna a resposta do assistente no caminho de sucesso", async () => {
    const res = await POST(chatRequest({ message: "preciso de um encanador" }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toEqual({ response: "Claro! Posso ajudar com isso." })
  })

  it("monta as messages com system prompt + histórico + pergunta do usuário", async () => {
    await POST(
      chatRequest({ message: "quanto custa?", history: [{ role: "user", content: "oi" }] }),
    )

    expect(ZAI.create).toHaveBeenCalledTimes(1)
    const callArgs = vi.mocked(mockSdk.completionsCreate).mock.calls[0][0]
    expect(callArgs.messages).toHaveLength(3)
    expect(callArgs.messages[0]).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("Severinno"),
    })
    expect(callArgs.messages[1]).toEqual({ role: "user", content: "oi" })
    expect(callArgs.messages[2]).toEqual({ role: "user", content: "quanto custa?" })
    expect(callArgs).toMatchObject({ thinking: { type: "disabled" } })
  })

  it("limita o histórico aos últimos 10 turnos", async () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turno ${i + 1}`,
    }))

    await POST(chatRequest({ message: "final", history }))

    const messages = vi.mocked(mockSdk.completionsCreate).mock.calls[0][0].messages
    // system + 10 turnos do histórico + pergunta atual
    expect(messages).toHaveLength(12)
    // 12 históricos → mantém os ÚLTIMOS 10 (turno 3..12), não os primeiros
    expect(messages[1].content).toBe("turno 3")
    expect(messages[10].content).toBe("turno 12")
    expect(messages[11]).toEqual({ role: "user", content: "final" })
  })

  it("retorna 500 quando o assistente não devolve conteúdo", async () => {
    vi.mocked(mockSdk.completionsCreate).mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
    })

    const res = await POST(chatRequest({ message: "oi" }))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(500)
    expect((parsed.body as any).error).toBe("Sem resposta do assistente.")
  })

  it("retorna 500 com mensagem neutra quando o provider falha", async () => {
    vi.mocked(mockSdk.completionsCreate).mockRejectedValueOnce(new Error("ECONNREFUSED upstream"))

    const res = await POST(chatRequest({ message: "oi" }))
    const parsed = await parseResponse(res)

    // handleError mapeia erro genérico (não-HttpError) para 500 — não vaza a
    // mensagem interna do provider upstream.
    expect(parsed.status).toBe(500)
    expect((parsed.body as any).error).toBe("Erro interno do servidor")
  })
})
