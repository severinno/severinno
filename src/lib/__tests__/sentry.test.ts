import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock server-only first
vi.mock("server-only", () => ({}))

// Mock logger
vi.mock("../logger", () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

describe("sentry (src/lib/sentry.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SENTRY_DSN", "http://testkey@localhost:8000/1")
  })

  it("captureError logs error to pino logger", async () => {
    const { captureError } = await import("../sentry")
    const logger = (await import("../logger")).default

    const error = new Error("Teste de erro para sentry")
    await captureError(error, { route: "/api/test" })

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error, route: "/api/test" }),
      "Teste de erro para sentry",
    )
  })

  it("captureMessage logs message with designated severity", async () => {
    const { captureMessage } = await import("../sentry")
    const logger = (await import("../logger")).default

    await captureMessage("Alerta de degradacao", "warn", { service: "database" })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ service: "database" }),
      "Alerta de degradacao",
    )
  })

  it("flushSentry resolves cleanly when Sentry module is not loaded", async () => {
    const { flushSentry } = await import("../sentry")
    await expect(flushSentry(100)).resolves.toBeUndefined()
  })
})
