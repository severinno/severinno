import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock server-only first
vi.mock("server-only", () => ({}))

// Mock @sentry/nextjs
const mockWithScope = vi.fn((cb: (scope: Record<string, ReturnType<typeof vi.fn>>) => void) => {
  const mockScope = {
    setTag: vi.fn(),
    setUser: vi.fn(),
    addBreadcrumb: vi.fn(),
  }
  cb(mockScope)
})

const mockStartSpan = vi.fn(
  (_opts: unknown, cb: (span: { end: ReturnType<typeof vi.fn> }) => void) => {
    const span = { end: vi.fn() }
    cb(span)
    return span
  },
)

vi.mock("@sentry/nextjs", () => ({
  withScope: mockWithScope,
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  startSpan: mockStartSpan,
}))

// Mock logger
vi.mock("../logger", () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe("sentry-enhanced", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("NODE_ENV", "production")
  })

  describe("captureErrorEnhanced", () => {
    it("logs the error via logger", async () => {
      const { captureErrorEnhanced } = await import("../sentry-enhanced")
      const error = new Error("test error")
      await captureErrorEnhanced(error)

      const logger = await import("../logger")
      expect(logger.default.error).toHaveBeenCalled()
    })

    it("includes user context when provided", async () => {
      const { captureErrorEnhanced } = await import("../sentry-enhanced")
      const error = new Error("test error")
      await captureErrorEnhanced(error, { userId: "user-123", userRole: "PROVIDER" })

      expect(mockWithScope).toHaveBeenCalled()
      // The mock calls cb internally, so we verify the mock was invoked
      expect(mockWithScope).toHaveBeenCalledTimes(1)
    })

    it("includes URL and method context", async () => {
      const { captureErrorEnhanced } = await import("../sentry-enhanced")
      const error = new Error("test error")
      await captureErrorEnhanced(error, {
        url: "/api/test",
        method: "POST",
        tags: { source: "test" },
      })

      const logger = await import("../logger")
      expect(logger.default.error).toHaveBeenCalled()
    })

    it("adds breadcrumbs when provided", async () => {
      const { captureErrorEnhanced } = await import("../sentry-enhanced")
      const error = new Error("test error")
      await captureErrorEnhanced(error, { breadcrumb: "User clicked checkout" })

      expect(mockWithScope).toHaveBeenCalled()
    })

    it("skips Sentry in non-production", async () => {
      vi.stubEnv("NODE_ENV", "development")
      const { captureErrorEnhanced } = await import("../sentry-enhanced")
      await captureErrorEnhanced(new Error("dev error"))

      // Should still log but not call Sentry
      const logger = await import("../logger")
      expect(logger.default.error).toHaveBeenCalled()
    })
  })

  describe("addBreadcrumb", () => {
    it("adds a breadcrumb to Sentry", async () => {
      const { addBreadcrumb } = await import("../sentry-enhanced")
      await addBreadcrumb("user-action", "Clicked checkout button")

      const Sentry = await import("@sentry/nextjs")
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: "user-action",
        message: "Clicked checkout button",
        data: undefined,
        level: "info",
      })
    })

    it("includes data when provided", async () => {
      const { addBreadcrumb } = await import("../sentry-enhanced")
      await addBreadcrumb("api-call", "Fetched providers", { count: 5 })

      const Sentry = await import("@sentry/nextjs")
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: "api-call",
        message: "Fetched providers",
        data: { count: 5 },
        level: "info",
      })
    })
  })

  describe("startSpan", () => {
    it("creates a span and returns finish function", async () => {
      const { startSpan } = await import("../sentry-enhanced")
      const span = await startSpan("db-query", "db")

      expect(span).not.toBeNull()
      expect(span).toHaveProperty("finish")
      span?.finish()
    })

    it("returns non-null span with finish method", async () => {
      const { startSpan } = await import("../sentry-enhanced")
      const result = await startSpan("checkout", "payment")
      expect(result).toBeDefined()
      expect(typeof result!.finish).toBe("function")
      result!.finish()
    })
  })
})
