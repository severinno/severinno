import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("logger", () => {
  it("exports a pino instance with default level", async () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("LOG_LEVEL", "debug")
    const { default: logger } = await import("../logger")

    expect(logger).toBeDefined()
    expect(logger.level).toBe("debug")
  })

  it("uses info level in production when LOG_LEVEL unset", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const { default: logger } = await import("../logger")

    expect(logger.level).toBe("info")
  })

  it("uses debug level in dev when LOG_LEVEL unset", async () => {
    vi.stubEnv("NODE_ENV", "development")
    delete process.env.LOG_LEVEL
    const { default: logger } = await import("../logger")

    expect(logger.level).toBe("debug")
  })

  it("logs at different levels", async () => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("LOG_LEVEL", "trace")
    const { default: logger } = await import("../logger")

    expect(() => {
      logger.info("info message")
      logger.warn("warn message")
      logger.error("error message")
      logger.debug("debug message")
    }).not.toThrow()
  })
})
