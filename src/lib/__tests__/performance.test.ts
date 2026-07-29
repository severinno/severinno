// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mocks ─────────────────────────────────────────────────────────────────
// Note: mockLogger must be inside vi.mock callback or vi.hoisted
// because vi.mock calls are hoisted to the top of the file
vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return {
    default: mockLogger,
    logger: mockLogger,
  }
})

const mockStartSpan = vi.fn()
vi.mock("@sentry/nextjs", () => ({
  default: {
    startSpan: vi.fn(),
    captureException: vi.fn(),
  },
  startSpan: (...args: unknown[]) => mockStartSpan(...args),
  captureException: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────

import { startSpan, startSpanSync, logPerformance } from "../performance"
import { logger } from "@/lib/logger"

// ===========================================================================
// startSpan
// ============================================================================

describe("startSpan", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("executa a função e retorna resultado com duração", async () => {
    const result = await startSpan(
      { op: "test.op", description: "Test operation" },
      async () => "hello",
    )

    expect(result.data).toBe("hello")
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("propaga erro da função interna", async () => {
    await expect(
      startSpan(
        { op: "test.error" },
        async () => { throw new Error("test error") },
      ),
    ).rejects.toThrow("test error")
  })

  it("usa op como description quando description não é fornecida", async () => {
    const result = await startSpan(
      { op: "test.only-op" },
      async () => 42,
    )

    expect(result.data).toBe(42)
  })
})

// ============================================================================
// startSpanSync
// ============================================================================

describe("startSpanSync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("executa função síncrona e retorna resultado com duração", () => {
    const result = startSpanSync(
      { op: "sync.test" },
      () => "sync result",
    )

    expect(result.data).toBe("sync result")
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("propaga erro de função síncrona", () => {
    expect(() =>
      startSpanSync(
        { op: "sync.error" },
        () => { throw new Error("sync error") },
      ),
    ).toThrow("sync error")
  })
})

// ============================================================================
// logPerformance
// ============================================================================

describe("logPerformance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loga warning para operações lentas (>1000ms)", () => {
    logPerformance("slow.op", 1500)

    expect(logger.warn).toHaveBeenCalled()
    const args = vi.mocked(logger.warn).mock.calls[0]
    expect(args[1]).toContain("SLOW")
    expect(args[1]).toContain("slow.op")
  })

  it("loga info para operações moderadas (200-1000ms)", () => {
    logPerformance("medium.op", 500)

    expect(logger.info).toHaveBeenCalled()
    const args = vi.mocked(logger.info).mock.calls[0]
    expect(args[1]).toContain("medium.op")
  })

  it("não loga para operações rápidas (<200ms)", () => {
    logPerformance("fast.op", 50)

    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
  })

  it("inclui tags no log quando fornecidas", () => {
    logPerformance("tagged.op", 1500, { db: "postgresql", query: "findMany" })

    expect(logger.warn).toHaveBeenCalled()
    const args = vi.mocked(logger.warn).mock.calls[0]
    expect(args[0]).toMatchObject({ operation: "tagged.op", durationMs: 1500, db: "postgresql" })
  })
})
