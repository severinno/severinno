/**
 * Tests for src/lib/realtime-client.ts
 *
 * The module emits real-time events via HTTP POST to the realtime
 * mini-service with an x-api-key (REALTIME_EMIT_API_KEY). Sem a chave
 * configurada, o emit é SKIPADO com warn (fail-closed no lado do serviço:
 * /emit rejeita request sem chave). All network errors are silently caught
 * and logged.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Mock fetch and logger ───────────────────────────────────────────────

const mockLoggerWarn = vi.fn()

vi.mock("@/lib/logger", () => ({
  default: {
    warn: mockLoggerWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: "silent",
  },
}))

// ── Tests ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe("emitRealtime", () => {
  it("envia POST com x-api-key quando REALTIME_EMIT_API_KEY está configurada", async () => {
    vi.stubEnv("REALTIME_EMIT_API_KEY", "secret-key-1")
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    // Import after mocks are set up
    const { emitRealtime } = await import("@/lib/realtime-client")

    await emitRealtime("payment:confirmed", { bookingId: "b-123" })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const call = mockFetch.mock.calls[0]!
    expect(call[0]).toBe("http://localhost:3003/emit")
    expect(call[1]).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "secret-key-1",
      },
    })

    // Verify body
    const body = JSON.parse(call[1]!.body as string)
    expect(body).toEqual({
      event: "payment:confirmed",
      data: { bookingId: "b-123" },
    })
  })

  it("SKIP com warn quando REALTIME_EMIT_API_KEY não está configurada (fail-closed)", async () => {
    vi.stubEnv("REALTIME_EMIT_API_KEY", "")
    const mockFetch = vi.mocked(fetch)

    const { emitRealtime } = await import("@/lib/realtime-client")

    await emitRealtime("booking:update", { bookingId: "b-1" })

    // NÃO chama o serviço — evita 401 garantido e degrada com warn.
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
    expect(mockLoggerWarn.mock.calls[0]![1]).toContain("REALTIME_EMIT_API_KEY not set")
  })

  it("usa REALTIME_URL do env quando definido", async () => {
    vi.stubEnv("REALTIME_EMIT_API_KEY", "k")
    vi.stubEnv("REALTIME_URL", "http://realtime.internal:4000")
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const { emitRealtime } = await import("@/lib/realtime-client")

    await emitRealtime("test:event", {})

    expect(mockFetch).toHaveBeenCalledWith("http://realtime.internal:4000/emit", expect.anything())
  })

  it("captura erro de rede e loga warning sem propagar exceção", async () => {
    vi.stubEnv("REALTIME_EMIT_API_KEY", "k")
    const mockFetch = vi.mocked(fetch)
    const networkError = new Error("ECONNREFUSED")
    mockFetch.mockRejectedValueOnce(networkError)

    const { emitRealtime } = await import("@/lib/realtime-client")

    // Should NOT throw
    await expect(emitRealtime("test:fail", {})).resolves.toBeUndefined()

    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      { err: networkError, event: "test:fail" },
      "realtime emit failed",
    )
  })
})

describe("sendBookingUpdate", () => {
  it("chama emitRealtime com evento booking:update e payload correto", async () => {
    vi.stubEnv("REALTIME_EMIT_API_KEY", "k")
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const { sendBookingUpdate } = await import("@/lib/realtime-client")

    await sendBookingUpdate({
      bookingId: "b-456",
      clientId: "c-1",
      providerId: "p-1",
      status: "CONFIRMED",
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(body).toEqual({
      event: "booking:update",
      data: {
        bookingId: "b-456",
        clientId: "c-1",
        providerId: "p-1",
        status: "CONFIRMED",
      },
    })
  })
})

describe("sendTrackingPosition", () => {
  it("chama emitRealtime com evento tracking:position e payload correto", async () => {
    vi.stubEnv("REALTIME_EMIT_API_KEY", "k")
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const { sendTrackingPosition } = await import("@/lib/realtime-client")

    await sendTrackingPosition({
      bookingId: "b-789",
      clientId: "c-2",
      lat: -19.81,
      lng: -41.97,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(body).toEqual({
      event: "tracking:position",
      data: {
        bookingId: "b-789",
        clientId: "c-2",
        lat: -19.81,
        lng: -41.97,
      },
    })
  })
})
