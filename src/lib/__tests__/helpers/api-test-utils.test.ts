/**
 * Testes do helper callRoute (src/lib/__tests__/helpers/api-test-utils.ts) —
 * a cola entre createMockRequest e os route handlers do Next 16.
 *
 * Exercita handlers REAIS representativos das duas famílias que os testes de
 * rota usam: handler manual (Request + ctx.params-Promise) e handler
 * wrappado (withRoute/withParams — ctx opcional, params resolvido no ctx).
 */
import { describe, it, expect } from "vitest"
import { NextResponse } from "next/server"
import { callRoute, createMockRequest, parseResponse } from "./api-test-utils"

// ── handlers representativos (sem mocks de rede/db) ─────────────────────────

/** Handler manual: usa params e body, ecoa de volta. */
async function manualHandler(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const params = await ctx.params
  const body = request.method === "GET" ? undefined : await request.json().catch(() => null)
  const url = new URL(request.url)
  return NextResponse.json({
    method: request.method,
    id: params.id ?? null,
    q: url.searchParams.get("q"),
    body: body ?? null,
  })
}

/** Handler wrappado: mesma forma dos ~140 routes convertidos. */
const wrappedHandler = (async (request: Request, ctx?: { params?: Promise<{ id?: string }> }) => {
  const params = ctx?.params ? await ctx.params : {}
  return NextResponse.json({ ok: true, id: params.id ?? null, method: request.method })
}) as unknown as (request: Request, ctx: { params: Promise<never> }) => Promise<Response>

describe("callRoute", () => {
  it("GET com url relativa: monta Request e ctx de params vazio", async () => {
    const { res, data } = await callRoute(manualHandler, { url: "/api/provider/wallet" })
    expect(res.status).toBe(200)
    expect(data).toMatchObject({ method: "GET", id: null, q: null })
  })

  it("params de rota dinâmica chegam como Promise resolvida no ctx", async () => {
    const { data } = await callRoute(manualHandler, { url: "/api/x/42", params: { id: "42" } })
    expect(data).toMatchObject({ id: "42" })
  })

  it("searchParams mesclam na query da url", async () => {
    const { data } = await callRoute(manualHandler, {
      url: "/api/x",
      searchParams: { q: "pintura" },
    })
    expect(data).toMatchObject({ q: "pintura" })
  })

  it("searchParams mesclam em url que JÁ tem query string (join com &)", async () => {
    const { data } = await callRoute(manualHandler, {
      url: "/api/x?fixed=1",
      searchParams: { q: "abc" },
    })
    expect(data).toMatchObject({ q: "abc" })
  })

  it("POST com body JSON serializado e método correto", async () => {
    const { data } = await callRoute(manualHandler, {
      method: "POST",
      body: { amount: 200 },
      params: { id: "b-1" },
    })
    expect(data).toMatchObject({ method: "POST", id: "b-1", body: { amount: 200 } })
  })

  it("headers custom passam ao request", async () => {
    let seen: string | null = null
    const probe = async (request: Request) => {
      seen = request.headers.get("x-api-key")
      return NextResponse.json({})
    }
    await callRoute(probe, { headers: { "x-api-key": "secret" } })
    expect(seen).toBe("secret")
  })

  it("url absoluta (http://) é respeitada", async () => {
    let seen: string | null = null
    const probe = async (request: Request) => {
      seen = new URL(request.url).host
      return NextResponse.json({})
    }
    await callRoute(probe, { url: "http://other-host/api/x" })
    expect(seen).toBe("other-host")
  })

  it("corpo não-JSON (204/texto) vira data:null em vez de explodir o teste", async () => {
    const noContent = async () => new Response(null, { status: 204 })
    const { res, data } = await callRoute(noContent)
    expect(res.status).toBe(204)
    expect(data).toBeNull()
  })

  it("funciona com handler wrappado (withRoute/withParams — ctx opcional)", async () => {
    const { data } = await callRoute(wrappedHandler, { params: { id: "w-1" } })
    expect(data).toMatchObject({ ok: true, id: "w-1" })
  })

  it("composição com os helpers irmãos: parseResponse e createMockRequest seguem funcionando", async () => {
    const req = createMockRequest({ method: "POST", body: { a: 1 } })
    expect(req.method).toBe("POST")
    const res = NextResponse.json({ z: 1 }, { status: 201 })
    const parsed = await parseResponse<{ z: number }>(res)
    expect(parsed.status).toBe(201)
    expect(parsed.body).toEqual({ z: 1 })
  })
})
