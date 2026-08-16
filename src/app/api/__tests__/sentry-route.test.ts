/**
 * Tests for POST /api/sentry — GlitchTip/Sentry tunnel.
 *
 * Valida que o fetch para o GlitchTip carrega o AbortSignal.timeout via
 * helper compartilhado (fetch-timeout.ts): um GlitchTip que aceita o TCP mas
 * nunca responde não pode pendurar o POST que responde 200 ao browser.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** Envelope Sentry válido: 1ª linha = header JSON com dsn do projeto 42. */
function sentryEnvelope(): string {
  return [
    JSON.stringify({ dsn: "https://public-key@glitchtip.local/42", event_id: "evt-1" }),
    JSON.stringify({ type: "event" }),
    "{}",
  ].join("\n")
}

describe("POST /api/sentry — tunnel", () => {
  it("envia o envelope ao GlitchTip com AbortSignal.timeout como signal", async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
    )

    const { POST } = await import("../sentry/route")
    const req = new NextRequest(
      new Request("http://localhost/api/sentry", {
        method: "POST",
        body: sentryEnvelope(),
      }),
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://glitchtip-web:8000/api/42/envelope/")
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal!.aborted).toBe(false)
  })

  it("responde 200 mesmo quando o GlitchTip está fora (sem propagar erro)", async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockRejectedValueOnce(new TypeError("ECONNREFUSED"))

    const { POST } = await import("../sentry/route")
    const req = new NextRequest(
      new Request("http://localhost/api/sentry", {
        method: "POST",
        body: sentryEnvelope(),
      }),
    )
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
