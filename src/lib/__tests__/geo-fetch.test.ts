import { describe, it, expect, vi, afterEach } from "vitest"
import { geoFetchWithRetry } from "../geo-fetch"

// Mock logger to silence output
vi.mock("../logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

describe("geo-fetch.ts — Retry + Backoff", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns response on success (no retry)", async () => {
    const mockResponse = { status: 200, ok: true } as Response
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse))

    const result = await geoFetchWithRetry("https://api.test.com/data")
    expect(result).toBe(mockResponse)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("retries on 503 then succeeds", async () => {
    const failResponse = { status: 503, ok: false } as Response
    const okResponse = { status: 200, ok: true } as Response
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(failResponse).mockResolvedValueOnce(okResponse),
    )

    const result = await geoFetchWithRetry("https://api.test.com/data")
    expect(result).toBe(okResponse)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("retries on 429 then succeeds", async () => {
    const failResponse = { status: 429, ok: false } as Response
    const okResponse = { status: 200, ok: true } as Response
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(failResponse).mockResolvedValueOnce(okResponse),
    )

    const result = await geoFetchWithRetry("https://api.test.com/data")
    expect(result).toBe(okResponse)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("retries on 500 then succeeds", async () => {
    const failResponse = { status: 500, ok: false } as Response
    const okResponse = { status: 200, ok: true } as Response
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(failResponse).mockResolvedValueOnce(okResponse),
    )

    const result = await geoFetchWithRetry("https://api.test.com/data")
    expect(result).toBe(okResponse)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("does NOT retry on 400", async () => {
    const failResponse = { status: 400, ok: false } as Response
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(failResponse))

    const result = await geoFetchWithRetry("https://api.test.com/data")
    expect(result).toBe(failResponse)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("does NOT retry on 404", async () => {
    const failResponse = { status: 404, ok: false } as Response
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(failResponse))

    const result = await geoFetchWithRetry("https://api.test.com/data")
    expect(result).toBe(failResponse)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("retries on ECONNRESET then succeeds", async () => {
    const connError = new Error("read ECONNRESET")
    const okResponse = { status: 200 } as Response
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(connError).mockResolvedValueOnce(okResponse),
    )

    const result = await geoFetchWithRetry("https://api.test.com/data")
    expect(result.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("does NOT retry on AbortError (timeout)", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError")
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError))

    // AbortError should be thrown immediately without retry
    await expect(geoFetchWithRetry("https://api.test.com/data")).rejects.toThrow()
  })

  it("respects maxRetries: 0 (no retry)", async () => {
    const failResponse = { status: 503, ok: false } as Response
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(failResponse))

    const result = await geoFetchWithRetry("https://api.test.com/data", { maxRetries: 0 })
    expect(result).toBe(failResponse)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("exhausts retries and throws last error", async () => {
    const error = new Error("ECONNREFUSED")
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error))

    await expect(geoFetchWithRetry("https://api.test.com/data")).rejects.toThrow("ECONNREFUSED")
    expect(fetch).toHaveBeenCalledTimes(2) // 1 initial + 1 retry
  })
})
