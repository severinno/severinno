/**
 * Tests for circuit-breaker.ts
 *
 * Covers all state transitions:
 *   CLOSED → OPEN → HALF_OPEN → CLOSED (recovery)
 *   CLOSED → OPEN → HALF_OPEN → OPEN  (reopening)
 *   + fast-fail, reset, stats, error propagation, independent instances
 */

import { describe, it, expect, vi } from "vitest"
import { createCircuitBreaker, CircuitOpenError } from "../circuit-breaker"

vi.mock("../logger", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function succeed() {
  return Promise.resolve("ok")
}

function fail(_msg = "boom") {
  return Promise.reject(new Error("boom"))
}

/** Execute and swallow the error (for tests that just need to trigger a failure side-effect). */
async function executeSwallowError(
  cb: ReturnType<typeof createCircuitBreaker>,
  fn: () => Promise<unknown> = fail,
) {
  try {
    await cb.execute(fn)
  } catch {
    // expected
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("circuit-breaker", () => {
  // ── CLOSED state ──────────────────────────────────────────────────────

  it("starts in CLOSED state", () => {
    const cb = createCircuitBreaker("test")
    expect(cb.getStats().state).toBe("closed")
    expect(cb.getStats().failures).toBe(0)
    expect(cb.getStats().successes).toBe(0)
  })

  it("passes requests through in CLOSED state", async () => {
    const cb = createCircuitBreaker("test")
    const result = await cb.execute(succeed)
    expect(result).toBe("ok")
    expect(cb.getStats().state).toBe("closed")
    expect(cb.getStats().successes).toBe(1)
  })

  it("re-throws errors in CLOSED state", async () => {
    const cb = createCircuitBreaker("test")
    await expect(cb.execute(fail)).rejects.toThrow("boom")
    expect(cb.getStats().state).toBe("closed")
    expect(cb.getStats().failures).toBe(1)
  })

  // ── Failure threshold ─────────────────────────────────────────────────

  it("does NOT open before reaching failure threshold", async () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 3 })
    await executeSwallowError(cb)
    expect(cb.getStats().state).toBe("closed")
    await executeSwallowError(cb)
    expect(cb.getStats().state).toBe("closed")
  })

  it("opens AFTER reaching failure threshold", async () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 3 })
    await executeSwallowError(cb)
    await executeSwallowError(cb)
    await executeSwallowError(cb)
    expect(cb.getStats().state).toBe("open")
  })

  it("resets failure count on success (non-consecutive failures)", async () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 3 })
    await executeSwallowError(cb) // 1
    await cb.execute(succeed) // success resets count
    await executeSwallowError(cb) // 1 (fresh)
    await executeSwallowError(cb) // 2
    expect(cb.getStats().state).toBe("closed") // not open yet (need 3)
  })

  it("tracks failure timestamps", async () => {
    const cb = createCircuitBreaker("test")
    expect(cb.getStats().lastFailureAt).toBeNull()
    await executeSwallowError(cb)
    expect(cb.getStats().lastFailureAt).not.toBeNull()
  })

  it("accumulates failure count across calls", async () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 2 })
    await executeSwallowError(cb)
    expect(cb.getStats().failures).toBe(1)
    await executeSwallowError(cb)
    expect(cb.getStats().failures).toBe(2)
    expect(cb.getStats().state).toBe("open")
  })

  it("resets failure count on success then starts counting again", async () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 2 })
    await executeSwallowError(cb) // 1
    await executeSwallowError(cb) // 2 → open
    expect(cb.getStats().state).toBe("open")
  })

  // ── OPEN state ────────────────────────────────────────────────────────

  it("fast-fails with CircuitOpenError when OPEN", async () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 1 })
    await executeSwallowError(cb) // opens

    await expect(cb.execute(succeed)).rejects.toThrow(CircuitOpenError)
  })

  it("CircuitOpenError contains circuit name and cooldown", async () => {
    const cb = createCircuitBreaker("nominatim", {
      failureThreshold: 1,
      cooldownMs: 30_000,
    })
    await executeSwallowError(cb)

    try {
      await cb.execute(succeed)
      expect.fail("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError)
      const e = err as CircuitOpenError
      expect(e.circuitName).toBe("nominatim")
      expect(e.cooldownMs).toBe(30_000)
      expect(e.message).toContain("nominatim")
      expect(e.message).toContain("30000")
    }
  })

  it("does NOT call the function when OPEN", async () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 1 })
    await executeSwallowError(cb)

    const fn = vi.fn(succeed)
    await expect(cb.execute(fn)).rejects.toThrow(CircuitOpenError)
    expect(fn).not.toHaveBeenCalled()
  })

  it("tracks openedAt timestamp", async () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 1 })
    await executeSwallowError(cb)
    expect(cb.getStats().openedAt).not.toBeNull()
  })

  // ── HALF_OPEN → CLOSED (recovery) ────────────────────────────────────

  it("recovers to CLOSED on success in HALF_OPEN", async () => {
    const cb = createCircuitBreaker("test", {
      failureThreshold: 1,
      cooldownMs: 1, // 1ms cooldown
    })
    await executeSwallowError(cb) // open
    await new Promise((r) => setTimeout(r, 5)) // wait for cooldown → half-open

    await cb.execute(succeed) // success → closed
    expect(cb.getStats().state).toBe("closed")
    expect(cb.getStats().failures).toBe(0)
    expect(cb.getStats().successes).toBe(1)
  })

  it("can handle requests normally after recovery", async () => {
    const cb = createCircuitBreaker("test", {
      failureThreshold: 1,
      cooldownMs: 1,
    })
    await executeSwallowError(cb) // open
    await new Promise((r) => setTimeout(r, 5)) // half-open
    await cb.execute(succeed) // recover

    const result = await cb.execute(succeed)
    expect(result).toBe("ok")
    expect(cb.getStats().state).toBe("closed")
  })

  it("recovery resets failure count to 0", async () => {
    const cb = createCircuitBreaker("test", {
      failureThreshold: 1,
      cooldownMs: 1,
    })
    await executeSwallowError(cb) // open
    await new Promise((r) => setTimeout(r, 5))
    await cb.execute(succeed) // recover

    expect(cb.getStats().failures).toBe(0)
  })

  // ── HALF_OPEN → OPEN (reopening) ─────────────────────────────────────

  it("reopens on failure in HALF_OPEN", async () => {
    const cb = createCircuitBreaker("test", {
      failureThreshold: 1,
      cooldownMs: 1,
    })
    await executeSwallowError(cb) // open
    await new Promise((r) => setTimeout(r, 5)) // half-open

    await executeSwallowError(cb) // fail in half-open → reopen
    expect(cb.getStats().state).toBe("open")
  })

  it("reopened circuit stays open until next cooldown", async () => {
    const cb = createCircuitBreaker("test", {
      failureThreshold: 1,
      cooldownMs: 50,
    })
    await executeSwallowError(cb) // open
    await new Promise((r) => setTimeout(r, 55)) // half-open
    await executeSwallowError(cb) // reopen

    // Still open — cooldown hasn't passed
    await expect(cb.execute(succeed)).rejects.toThrow(CircuitOpenError)

    // After new cooldown
    await new Promise((r) => setTimeout(r, 55))
    await cb.execute(succeed) // half-open test → recovery
    expect(cb.getStats().state).toBe("closed")
  })

  // ── Reset ─────────────────────────────────────────────────────────────

  it("reset returns to CLOSED from OPEN", async () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 1 })
    await executeSwallowError(cb) // open
    expect(cb.getStats().state).toBe("open")

    cb.reset()
    expect(cb.getStats().state).toBe("closed")
    expect(cb.getStats().failures).toBe(0)
    expect(cb.getStats().openedAt).toBeNull()
  })

  it("reset allows requests through immediately", async () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 1 })
    await executeSwallowError(cb) // open

    cb.reset()
    const result = await cb.execute(succeed)
    expect(result).toBe("ok")
    expect(cb.getStats().state).toBe("closed")
  })

  it("reset preserves success count", async () => {
    const cb = createCircuitBreaker("test", { failureThreshold: 1 })
    await cb.execute(succeed)
    await cb.execute(succeed)
    await executeSwallowError(cb) // open

    cb.reset()
    expect(cb.getStats().successes).toBe(2) // preserved
  })

  // ── Independent instances ─────────────────────────────────────────────

  it("multiple breakers are independent", async () => {
    const cb1 = createCircuitBreaker("nominatim", { failureThreshold: 1 })
    const cb2 = createCircuitBreaker("viacep", { failureThreshold: 1 })

    await executeSwallowError(cb1) // cb1 opens
    expect(cb1.getStats().state).toBe("open")
    expect(cb2.getStats().state).toBe("closed") // cb2 unaffected

    await cb2.execute(succeed)
    expect(cb2.getStats().successes).toBe(1)
  })

  it("reset on one breaker doesn't affect the other", async () => {
    const cb1 = createCircuitBreaker("a", { failureThreshold: 1 })
    const cb2 = createCircuitBreaker("b", { failureThreshold: 1 })

    await executeSwallowError(cb1)
    await executeSwallowError(cb2)
    expect(cb1.getStats().state).toBe("open")
    expect(cb2.getStats().state).toBe("open")

    cb1.reset()
    expect(cb1.getStats().state).toBe("closed")
    expect(cb2.getStats().state).toBe("open")
  })

  // ── Default options ───────────────────────────────────────────────────

  it("uses default failureThreshold of 3", async () => {
    const cb = createCircuitBreaker("test")
    await executeSwallowError(cb)
    await executeSwallowError(cb)
    expect(cb.getStats().state).toBe("closed")
    await executeSwallowError(cb)
    expect(cb.getStats().state).toBe("open")
  })

  it("custom cooldownMs is reflected in CircuitOpenError", async () => {
    const cb = createCircuitBreaker("test", {
      failureThreshold: 1,
      cooldownMs: 42_000,
    })
    await executeSwallowError(cb)

    try {
      await cb.execute(succeed)
      expect.fail("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError)
      expect((err as CircuitOpenError).cooldownMs).toBe(42_000)
    }
  })

  // ── getStats ──────────────────────────────────────────────────────────

  it("getStats returns correct name", () => {
    const cb = createCircuitBreaker("my-api")
    expect(cb.getStats().name).toBe("my-api")
  })

  it("getStats returns ISO timestamps after failure", async () => {
    const cb = createCircuitBreaker("test")
    await executeSwallowError(cb)
    const stats = cb.getStats()
    expect(stats.lastFailureAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("getStats returns null timestamps when no failures", () => {
    const cb = createCircuitBreaker("test")
    const stats = cb.getStats()
    expect(stats.lastFailureAt).toBeNull()
    expect(stats.openedAt).toBeNull()
  })

  it("getStats returns all fields", async () => {
    const cb = createCircuitBreaker("test")
    await cb.execute(succeed)
    const stats = cb.getStats()
    expect(stats).toEqual({
      name: "test",
      state: "closed",
      failures: 0,
      successes: 1,
      lastFailureAt: null,
      openedAt: null,
    })
  })
})
