/**
 * Testing utility helpers for API route tests.
 *
 * createMockRequest  — builds a Next.js Request-like object with optional search params / body.
 * parseResponse      — calls .json() on a NextResponse and returns status + body.
 */

import { NextResponse } from "next/server"

export type MockRequestOptions = {
  method?: string
  body?: unknown
  searchParams?: Record<string, string>
  headers?: Record<string, string>
}

/**
 * Create a minimal Next.js Request for use in route handler tests.
 */
export function createMockRequest(opts?: MockRequestOptions): Request {
  const { method = "GET", body, searchParams = {}, headers = {} } = opts ?? {}

  const url = new URL("http://localhost:3000")
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v)
  }

  const init: RequestInit & { headers: Record<string, string> } = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  return new Request(url.toString(), init)
}

/**
 * Parse a NextResponse into { status, body } for easy assertions.
 */
export async function parseResponse<T = Record<string, unknown>>(
  res: NextResponse | Response,
): Promise<{ status: number; body: T | null }> {
  const status = res.status
  let body: T | null = null
  try {
    body = (await res.json()) as T
  } catch {
    // response may have no body
  }
  return { status, body }
}

// ── callRoute — a cola entre createMockRequest e o handler ──────────────────

/**
 * Handler de rota do Next 16 como os testes o exercitam: Request + ctx. O
 * ctx é `any` de propósito — handlers manuais exigem `{ params: Promise<P> }`,
 * wrappados (withRoute) aceitam ctx OPCIONAL com params mais estreitos
 * (`{ id: string }`); contravariância estrita rejeitaria os estreitos se o
 * parâmetro aqui fosse tipado. (`no-explicit-any` é off em __tests__.)
 */
type AnyRouteHandler = (request: Request, ctx: any) => Promise<Response> | Response

/**
 * Opções de callRoute — a MESMA superfície de createMockRequest, mais o
 * ctx de params da rota dinâmica.
 */
export type CallRouteOptions<P> = MockRequestOptions & {
  /** Params da rota dinâmica ([id] etc.) — viram Promise no ctx. */
  params?: P
  /** URL absoluta ou caminho ("/api/provider/wallet"); default http://localhost:3000. */
  url?: string
}

/**
 * Chama um route handler do Next 16 com Request + ctx de params resolvidos —
 * o boilerplate que todo teste de rota repete:
 *
 *   const req = new Request("http://localhost/api/provider/wallet/history?page=2")
 *   const res = await GET(req, { params: Promise.resolve({}) })
 *   const data = await res.json()
 *
 * vira:
 *
 *   const { res, data } = await callRoute(GET, { url: "/api/provider/wallet/history?page=2" })
 *
 * Reaproveita createMockRequest (method/body/searchParams/headers) e devolve
 * a Response e o body JÁ PARSEADO (`data` é null quando o corpo não é JSON —
 * respostas 204/texto não explodem o teste).
 *
 * searchParams e url.path compõem: `url: "/api/x"` + `searchParams: { a: "1" }`.
 * `params` cobre rotas dinâmicas (o ctx vira `{ params: Promise.resolve(params) }`).
 */
export async function callRoute<TBody = any, P = Record<string, string>>(
  handler: AnyRouteHandler,
  opts: CallRouteOptions<P> = {},
): Promise<{ res: Response; data: TBody | null }> {
  const { params, url, ...requestOpts } = opts
  const request = buildRequestFromUrl(url, requestOpts)
  const res = await handler(request, { params: Promise.resolve(params ?? ({} as P)) })
  // .json() tolerante — corpo não-JSON vira null (204, texto, stream).
  const data = (await res.json().catch(() => null)) as TBody | null
  return { res, data }
}

/** resolve "http://..." ou "/caminho" (com searchParams mesclados na query). */
function buildRequestFromUrl(url: string | undefined, requestOpts: MockRequestOptions): Request {
  const base = url ?? "/"
  const qs = new URLSearchParams(requestOpts.searchParams ?? {}).toString()
  const suffix = qs ? (base.includes("?") ? "&" : "?") + qs : ""
  const full = /^https?:\/\//.test(base) ? base + suffix : `http://localhost:3000${base}${suffix}`
  return new Request(full, {
    method: requestOpts.method ?? "GET",
    headers: { "content-type": "application/json", ...requestOpts.headers },
    ...(requestOpts.body !== undefined ? { body: JSON.stringify(requestOpts.body) } : {}),
  })
}
