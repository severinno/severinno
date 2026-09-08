/**
 * Tests for POST /api/chat/assist — AI copilot suggestions for chat negotiations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"
import type { NextRequest } from "next/server"

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
    completionsCreate,
  }
})

vi.mock("z-ai-web-dev-sdk", () => mockSdk)

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "u-1", role: "CLIENT" }),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: { prefix: "general", max: 120, windowMs: 60_000 } },
}))

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

import { POST } from "../chat/assist/route"
import { requireUser } from "@/lib/auth"

function assistRequest(body?: unknown): NextRequest {
  return createMockRequest({ method: "POST", body: body ?? {} }) as NextRequest
}

describe("POST /api/chat/assist", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: "u-1", role: "CLIENT" } as any)
  })

  it("rejeita quando usuário não está autenticado", async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("UNAUTHORIZED"))
    const req = assistRequest({
      messages: [{ role: "user", content: "Olá" }],
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("rejeita quando array de mensagens está vazio (400)", async () => {
    const req = assistRequest({
      messages: [],
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await parseResponse(res)
    expect(data.body).toEqual({ error: "Mensagens são obrigatórias." })
  })

  it("retorna sugestões via ZAI quando SDK está disponível", async () => {
    mockSdk.completionsCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestions: [
                "Posso chegar aí em 20 minutos.",
                "Qual é o endereço exato?",
                "Vou levar as peças necessárias.",
              ],
              intent: "agendamento",
              urgency: "medium",
            }),
          },
        },
      ],
    })

    const req = assistRequest({
      messages: [{ role: "user", content: "Que horas você chega?" }],
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await parseResponse(res)
    expect((data.body as any).suggestions).toHaveLength(3)
    expect((data.body as any).intent).toBe("agendamento")
    expect((data.body as any).urgency).toBe("medium")
  })

  it("usa fallback heurístico contextual se o ZAI lançar erro", async () => {
    mockSdk.completionsCreate.mockRejectedValueOnce(new Error("Config missing"))

    const req = assistRequest({
      messages: [{ role: "user", content: "Qual o valor do orçamento?" }],
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await parseResponse(res)
    expect((data.body as any).suggestions.length).toBeGreaterThanOrEqual(1)
    expect((data.body as any).intent).toBe("orcamento")
  })

  it("detecta urgência alta para palavras-chave de emergência no fallback", async () => {
    mockSdk.completionsCreate.mockRejectedValueOnce(new Error("SDK offline"))

    const req = assistRequest({
      messages: [{ role: "user", content: "Temos um vazamento de água urgente na pia!" }],
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await parseResponse(res)
    expect((data.body as any).intent).toBe("urgencia")
    expect((data.body as any).urgency).toBe("high")
  })
})
