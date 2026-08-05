/**
 * Tests for src/lib/realtime-client.ts
 *
 * The module emits real-time events via HTTP POST to the realtime
 * mini-service. All network errors are silently caught and logged.
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
  vi.clearAllMocks()
})

describe("emitRealtime", () => {
  it("envia POST para REALTIME_URL/emit com headers e body corretos", async () => {
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
      headers: { "Content-Type": "application/json" },
    })

    // Verify body
    const body = JSON.parse(call[1]!.body as string)
    expect(body).toEqual({
      event: "payment:confirmed",
      data: { bookingId: "b-123" },
    })
  })

  it("usa REALTIME_URL do env quando definido", async () => {
    vi.stubEnv("REALTIME_URL", "http://realtime.internal:4000")
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const { emitRealtime } = await import("@/lib/realtime-client")

    await emitRealtime("test:event", {})

    expect(mockFetch).toHaveBeenCalledWith("http://realtime.internal:4000/emit", expect.anything())

    vi.unstubAllEnvs()
  })

  it("captura erro de rede e loga warning sem propagar exceção", async () => {
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
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const { sendTrackingPosition } = await import("@/lib/realtime-client")

    await sendTrackingPosition({
      bookingId: "b-789",
      clientId: "c-2",
      lat: -23.55,
      lng: -46.63,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(body).toEqual({
      event: "tracking:position",
      data: {
        bookingId: "b-789",
        clientId: "c-2",
        lat: -23.55,
        lng: -46.63,
      },
    })
  })
})
