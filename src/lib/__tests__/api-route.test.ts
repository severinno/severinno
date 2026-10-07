/**
 * Tests for src/lib/api-route.ts — withRoute / withParams wrappers.
 *
 * Contratos testados:
 *   - handler roda dentro de traceSpan (span disponível no ctx);
 *   - establishRequestContext é chamado (requestId no ctx);
 *   - erro HttpError → handleError mapeia para status correto;
 *   - erro Zod → 400; erro genérico → 500 com no-store;
 *   - sucesso → a Response do handler passa intacta;
 *   - withRoute resolve params Promise (Next 16) e passa ao ctx;
 *   - withParams: params ausente → 500 explícito; presente → obrigatório no ctx.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import { badRequest, unauthorized } from "@/lib/api-server"
import type { HandlerArgs } from "@/lib/api-route"

// Mocks declarados com vi.hoisted — vi.mock é hoistado para o topo do
// arquivo e não pode referenciar variáveis comuns.
const { mockTraceSpan, mockEstablish, mockGetRequestId, lastSpan } = vi.hoisted(() => ({
  mockTraceSpan: vi.fn(async (_name: string, fn: (span: unknown) => Promise<Response>) =>
    fn({ setAttribute: vi.fn() }),
  ),
  mockEstablish: vi.fn(async () => "req-123"),
  mockGetRequestId: vi.fn(() => "req-123"),
  // Span capturado pelo teste: o setAttribute REAL do wrapper registra cada
  // chamada para as asserções de observabilidade.
  lastSpan: { setAttribute: vi.fn() },
}))

vi.mock("@/lib/tracing", () => ({
  traceSpan: vi.fn(async (name: string, fn: (span: unknown) => Promise<Response>) => {
    lastSpan.setAttribute.mockClear()
    return mockTraceSpan(name, () => fn(lastSpan))
  }),
}))

vi.mock("@/lib/request-context", () => ({
  establishRequestContext: mockEstablish,
  getRequestId: () => mockGetRequestId(),
}))

// handleError real (api-server) — sem mocks: contratos de status são dele.
// db/redis são importados por api-server → mockar para não conectar.
vi.mock("@/lib/db", () => ({ db: {} }))
vi.mock("@/lib/redis", () => ({
  withCache: vi.fn(),
  cacheInvalidate: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
}))
vi.mock("@/lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { withRoute, withParams } from "@/lib/api-route"

function makeCtx<P>(params?: P) {
  return { params: params !== undefined ? Promise.resolve(params) : undefined }
}

describe("withRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("passa a Response do handler intacta em caso de sucesso", async () => {
    const GET = withRoute("api.test.GET", async () =>
      NextResponse.json({ ok: true }, { status: 201 }),
    )

    const res = await GET(new Request("http://localhost/api/test"), makeCtx())
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it("estampa os atributos OTel padronizados no span (sucesso)", async () => {
    const GET = withRoute("api.bookings.GET", async () => NextResponse.json({}, { status: 200 }))

    await GET(new Request("http://localhost/api/bookings?page=2"), makeCtx())

    const attrs = Object.fromEntries(
      lastSpan.setAttribute.mock.calls.map((c) => [c[0], c[1]]),
    ) as Record<string, unknown>
    expect(attrs["http.request_id"]).toBe("req-123")
    expect(attrs["http.request.method"]).toBe("GET")
    expect(attrs["http.route"]).toBe("api.bookings.GET")
    expect(attrs["url.path"]).toBe("/api/bookings")
    expect(attrs["http.response.status_code"]).toBe(200)
    expect(attrs["http.duration_ms"]).toBeTypeOf("number")
    expect(attrs["http.duration_ms"]).toBeGreaterThanOrEqual(0)
  })

  it("estampa os atributos também no caminho de ERRO (status do handleError)", async () => {
    const POST = withRoute("api.test.POST", async () => {
      throw badRequest("Dados inválidos")
    })

    const res = await POST(new Request("http://localhost/api/test", { method: "POST" }), makeCtx())
    expect(res.status).toBe(400)

    const attrs = Object.fromEntries(
      lastSpan.setAttribute.mock.calls.map((c) => [c[0], c[1]]),
    ) as Record<string, unknown>
    expect(attrs["http.response.status_code"]).toBe(400)
    expect(attrs["http.duration_ms"]).toBeTypeOf("number")
    expect(attrs["http.request.method"]).toBe("POST")
  })

  it("entrega span e requestId no contexto do handler", async () => {
    const GET = withRoute("api.test.GET", async (_req, ctx) => {
      ctx.span.setAttribute("test.key", "value")
      return NextResponse.json({ requestId: ctx.requestId })
    })

    const res = await GET(new Request("http://localhost/api/test"), makeCtx())
    await expect(res.json()).resolves.toEqual({ requestId: "req-123" })
    expect(mockEstablish).toHaveBeenCalledTimes(1)
    expect(mockTraceSpan).toHaveBeenCalledWith("api.test.GET", expect.any(Function))
  })

  it("não entrega params em rota estática (undefined)", async () => {
    const GET = withRoute("api.test.GET", async (_req, ctx) => {
      return NextResponse.json({ hasParams: "params" in ctx && ctx.params !== undefined })
    })

    const res = await GET(new Request("http://localhost/api/test"), makeCtx())
    await expect(res.json()).resolves.toEqual({ hasParams: false })
  })

  it("resolve params Promise do Next 16 e passa tipado ao handler", async () => {
    const GET = withRoute<{ id: string }>("api.test.GET", async (_req, ctx) => {
      return NextResponse.json({ id: ctx.params?.id })
    })

    const res = await GET(new Request("http://localhost/api/test/42"), makeCtx({ id: "42" }))
    await expect(res.json()).resolves.toEqual({ id: "42" })
  })

  it("HttpError(badRequest) vira 400 com mensagem", async () => {
    const POST = withRoute("api.test.POST", async () => {
      throw badRequest("Dados inválidos")
    })

    const res = await POST(new Request("http://localhost/api/test", { method: "POST" }), makeCtx())
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("Dados inválidos")
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  it("AuthError-like (duck typing via handleError) vira 401", async () => {
    const POST = withRoute("api.test.POST", async () => {
      throw unauthorized("Não autorizado")
    })

    const res = await POST(new Request("http://localhost/api/test", { method: "POST" }), makeCtx())
    expect(res.status).toBe(401)
  })

  it("erro genérico vira 500 com requestId e sem vazamento", async () => {
    const POST = withRoute("api.test.POST", async () => {
      throw new Error("senha-secreta-no-erro")
    })

    const res = await POST(new Request("http://localhost/api/test", { method: "POST" }), makeCtx())
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; requestId: string }
    expect(body.error).toBe("Erro interno do servidor")
    expect(body.requestId).toBe("req-123")
    expect(JSON.stringify(body)).not.toContain("senha-secreta-no-erro")
  })

  it("erros síncronos (throw não-await) também caem no handleError", async () => {
    const GET = withRoute("api.test.GET", () => {
      throw badRequest("sync")
    })

    const res = await GET(new Request("http://localhost/api/test"), makeCtx())
    expect(res.status).toBe(400)
  })
})

describe("withParams", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("entrega params obrigatório (não opcional) ao handler", async () => {
    const GET = withParams<{ id: string }>("api.test.GET", async (_req, ctx) => {
      return NextResponse.json({ id: ctx.params.id })
    })

    const res = await GET(new Request("http://localhost/api/test/x"), makeCtx({ id: "x" }))
    await expect(res.json()).resolves.toEqual({ id: "x" })
  })

  it("params ausente (contrato quebrado do framework) → 500 explícito", async () => {
    const GET = withParams<{ id: string }>("api.test.GET", async (_req, ctx) => {
      return NextResponse.json({ id: ctx.params.id })
    })

    const res = await GET(new Request("http://localhost/api/test/x"), makeCtx(undefined))
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: "Parâmetros de rota ausentes" })
  })

  it("erro do handler com params resolve → handleError normal", async () => {
    const PATCH = withParams<{ id: string }>("api.test.PATCH", async () => {
      throw badRequest("id inválido")
    })

    const res = await PATCH(
      new Request("http://localhost/api/test/x", { method: "PATCH" }),
      makeCtx({ id: "x" }),
    )
    expect(res.status).toBe(400)
  })
})

// Type-level sanity: HandlerArgs permite omitir params no handler estático.
describe("type ergonomics", () => {
  it("handler estático aceita ctx sem params", async () => {
    // Type-level: um handler tipado apenas com HandlerArgs (params opcional)
    // é aceito por withRoute — o compilador infere P a partir do handler.
    const GET = withRoute(
      "api.test.GET",
      async (_req: Request, _ctx: HandlerArgs<Record<string, never>>) => NextResponse.json({}),
    )
    expect(typeof GET).toBe("function")
  })
})
