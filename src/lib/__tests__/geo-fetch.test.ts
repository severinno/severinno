import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { geoFetchWithRetry } from "@/lib/geo-fetch"
import logger from "@/lib/logger"

vi.mock("@/lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function ok(body = "", init?: ResponseInit) {
  return new Response(body, { status: 200, statusText: "OK", ...init })
}

function retryable(status: number) {
  return new Response("", { status, statusText: String(status) })
}

function networkError(msg: string, name = "Error") {
  const e = new Error(msg)
  e.name = name
  return e
}

describe("geoFetchWithRetry", () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})),
    )
    fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    vi.mocked(logger.warn).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe("first success", () => {
    it("returns response immediately without retry", async () => {
      fetchSpy.mockResolvedValueOnce(ok("hello"))

      const result = await geoFetchWithRetry("https://api.test/data")

      expect(result.status).toBe(200)
      expect(await result.text()).toBe("hello")
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe("retries on 502/503/504", () => {
    it("succeeds on second attempt after 502", async () => {
      fetchSpy.mockResolvedValueOnce(retryable(502)).mockResolvedValueOnce(ok("recovered"))

      const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 })
      await vi.advanceTimersByTimeAsync(2000)

      const result = await p
      expect(result.status).toBe(200)
      expect(await result.text()).toBe("recovered")
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it("succeeds on second attempt after 503", async () => {
      fetchSpy.mockResolvedValueOnce(retryable(503)).mockResolvedValueOnce(ok("recovered"))

      const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 })
      await vi.advanceTimersByTimeAsync(2000)

      const result = await p
      expect(result.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it("succeeds on second attempt after 504", async () => {
      fetchSpy.mockResolvedValueOnce(retryable(504)).mockResolvedValueOnce(ok("recovered"))

      const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 })
      await vi.advanceTimersByTimeAsync(2000)

      const result = await p
      expect(result.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe("retries on 429", () => {
    it("succeeds on second attempt", async () => {
      fetchSpy.mockResolvedValueOnce(retryable(429)).mockResolvedValueOnce(ok("rate-ok"))

      const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 })
      await vi.advanceTimersByTimeAsync(2000)

      const result = await p
      expect(result.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe("does NOT retry on client errors", () => {
    it("returns 400 without retry", async () => {
      fetchSpy.mockResolvedValueOnce(retryable(400))

      const result = await geoFetchWithRetry("https://api.test/data")

      expect(result.status).toBe(400)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it("returns 401 without retry", async () => {
      fetchSpy.mockResolvedValueOnce(retryable(401))

      const result = await geoFetchWithRetry("https://api.test/data")

      expect(result.status).toBe(401)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it("returns 404 without retry", async () => {
      fetchSpy.mockResolvedValueOnce(retryable(404))

      const result = await geoFetchWithRetry("https://api.test/data")

      expect(result.status).toBe(404)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe("retries on ECONNRESET / ETIMEDOUT", () => {
    it("retries on ECONNRESET and succeeds", async () => {
      fetchSpy
        .mockRejectedValueOnce(networkError("read ECONNRESET", "Error"))
        .mockResolvedValueOnce(ok("ok"))

      const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 })
      await vi.advanceTimersByTimeAsync(2000)

      const result = await p
      expect(result.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it("retries on ETIMEDOUT and succeeds", async () => {
      fetchSpy
        .mockRejectedValueOnce(networkError("connect ETIMEDOUT", "Error"))
        .mockResolvedValueOnce(ok("ok"))

      const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 })
      await vi.advanceTimersByTimeAsync(2000)

      const result = await p
      expect(result.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe("does NOT retry on AbortError", () => {
    it("throws immediately on AbortError", async () => {
      fetchSpy.mockRejectedValueOnce(networkError("The operation was aborted", "AbortError"))

      await expect(geoFetchWithRetry("https://api.test/data", { maxRetries: 3 })).rejects.toThrow(
        "The operation was aborted",
      )
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe("throws after maxRetries exhausted", () => {
    it("returns 503 after all retries exhausted (retryable status)", async () => {
      fetchSpy.mockResolvedValueOnce(retryable(503)).mockResolvedValueOnce(retryable(503))

      const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 })
      await vi.advanceTimersByTimeAsync(2000)

      const result = await p
      expect(result.status).toBe(503)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it("throws error after max transient errors", async () => {
      fetchSpy
        .mockRejectedValueOnce(networkError("read ECONNRESET", "Error"))
        .mockRejectedValueOnce(networkError("read ECONNRESET", "Error"))

      const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 }).catch((e) => e)

      await vi.advanceTimersByTimeAsync(3000)

      const result = await p
      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toBe("read ECONNRESET")
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe("timeout / abort", () => {
    it("aborts fetch when timeoutMs is exceeded", async () => {
      fetchSpy.mockImplementationOnce((_url, init) => {
        return new Promise((_resolve, reject) => {
          const onAbort = () => {
            const err = new Error("The operation was aborted")
            err.name = "AbortError"
            reject(err)
          }
          if (init.signal?.aborted) {
            onAbort()
            return
          }
          init.signal?.addEventListener("abort", onAbort, { once: true })
        })
      })

      const p = geoFetchWithRetry("https://api.test/data", {
        timeoutMs: 1000,
        maxRetries: 0,
      })

      const result = p.catch((e) => e)
      await vi.advanceTimersByTimeAsync(1100)

      const err = await result
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe("AbortError")
      expect((err as Error).message).toBe("The operation was aborted")
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe("logger retry attempts", () => {
    it("logs on retryable HTTP status", async () => {
      fetchSpy.mockResolvedValueOnce(retryable(502)).mockResolvedValueOnce(ok("ok"))

      const p = geoFetchWithRetry("https://api.test/data", {
        maxRetries: 1,
        label: "test-label",
      })
      await vi.advanceTimersByTimeAsync(2000)
      await p

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ label: "test-label", status: 502 }),
        expect.stringContaining("retryable status 502"),
      )
    })

    it("logs on transient network error", async () => {
      fetchSpy
        .mockRejectedValueOnce(networkError("read ECONNRESET", "Error"))
        .mockResolvedValueOnce(ok("ok"))

      const p = geoFetchWithRetry("https://api.test/data", {
        maxRetries: 1,
        label: "net-label",
      })
      await vi.advanceTimersByTimeAsync(2000)
      await p

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ label: "net-label" }),
        expect.stringContaining("transient error"),
      )
    })
  })

  describe("exponential backoff", () => {
    it("waits with exponential backoff between retries", async () => {
      const setTimeoutSpy = vi.spyOn(global, "setTimeout")
      fetchSpy
        .mockRejectedValueOnce(networkError("read ECONNRESET", "Error"))
        .mockResolvedValueOnce(ok("ok"))

      const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 })
      await vi.advanceTimersByTimeAsync(2000)
      await p

      const backoffCalls = setTimeoutSpy.mock.calls.filter(
        ([, ms]) => typeof ms === "number" && ms >= 1000 && ms <= 1500,
      )
      expect(backoffCalls.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("multiple retries (maxRetries=2)", () => {
    it("retries up to maxRetries and returns final result", async () => {
      fetchSpy
        .mockResolvedValueOnce(retryable(502))
        .mockResolvedValueOnce(retryable(503))
        .mockResolvedValueOnce(ok("final"))

      const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 2 })
      await vi.advanceTimersByTimeAsync(2000)
      await vi.advanceTimersByTimeAsync(2000)

      const result = await p
      expect(result.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })
  })
})

describe("isTransientError (via behavior)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})),
    )
    fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("ECONNRESET is transient → retries", async () => {
    fetchSpy
      .mockRejectedValueOnce(networkError("read ECONNRESET", "Error"))
      .mockResolvedValueOnce(ok("ok"))

    const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 })
    await vi.advanceTimersByTimeAsync(2000)

    const r = await p
    expect(r.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("ETIMEDOUT is transient → retries", async () => {
    fetchSpy
      .mockRejectedValueOnce(networkError("connect ETIMEDOUT", "Error"))
      .mockResolvedValueOnce(ok("ok"))

    const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 })
    await vi.advanceTimersByTimeAsync(2000)

    const r = await p
    expect(r.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("AbortError is NOT transient → no retry", async () => {
    fetchSpy.mockRejectedValueOnce(networkError("aborted", "AbortError"))

    await expect(geoFetchWithRetry("https://api.test/data", { maxRetries: 3 })).rejects.toThrow(
      "aborted",
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe("isRetryableStatus (via behavior)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})),
    )
    fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const retryableStatuses = [429, 502, 503, 504] as const
  const nonRetryableStatuses = [200, 400, 404, 500] as const

  it.each(retryableStatuses)("%i is retryable → retries once then returns", async (status) => {
    fetchSpy.mockResolvedValueOnce(retryable(status)).mockResolvedValueOnce(ok("ok"))

    const p = geoFetchWithRetry("https://api.test/data", { maxRetries: 1 })
    await vi.advanceTimersByTimeAsync(2000)

    await p
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it.each(nonRetryableStatuses)("%i is NOT retryable → returns immediately", async (status) => {
    fetchSpy.mockResolvedValueOnce(retryable(status))

    const r = await geoFetchWithRetry("https://api.test/data")
    expect(r.status).toBe(status)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
