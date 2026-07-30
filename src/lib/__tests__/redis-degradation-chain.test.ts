/**
 * redis-degradation-chain.test.ts
 *
 * Unit test for the three-tier degradation chain: cluster → standalone → memory.
 *
 * Architecture tested:
 *   Tier 1 — Redis Cluster
 *   Tier 2 — Standalone Redis
 *   Tier 3 — In-memory Map (always available)
 *
 * Key insight: `degradeTier()` and `tryRecoverTier()` are module-private but
 * exported as `__testing__degradeTier` and `__testing__tryRecoverTier` for
 * direct testing. Internally they are triggered when a Redis operation throws.
 * The test validates the chain by:
 *   1. Calling the `__testing__` prefixed exports directly
 *   2. Observing the exported `activeTier`, `degradationCount`, and fallback
 *      behavior via `getCacheStats()`, `isRedisAvailable()`, and `cacheGet()`
 *
 * Test scenarios:
 *   1. Full chain: cluster → standalone → memory (two consecutive failures)
 *   2. Single degradation: cluster → standalone (standalone GET succeeds)
 *   3. Stale error ignored: error from already-degraded tier is ignored
 *   4. degradationCount increments correctly across multiple degradations
 *   5. cacheGet inline retry after degradation
 *   6. isRedisAvailable returns false when at memory tier
 *   7. Memory store works after full degradation
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import fc from "fast-check"

// ===========================================================================
// Hoisted — shared state and factory functions
// ===========================================================================

const { createMockNode, mockCaptureMessage } = vi.hoisted(() => {
  function createMockNode() {
    return {
      scan: vi.fn().mockResolvedValue(["0", []]),
    }
  }
  return {
    createMockNode,
    mockCaptureMessage: vi.fn(),
  }
})

// ===========================================================================
// Mock ioredis — real classes so instanceof checks pass
// ===========================================================================
//
// We use two-level control:
//   mockGetResult  — controls what c.get() returns (value or throws)
//   mockSetResult  — controls what c.setex() does (success or throws)
//
// These are declared with `let` after hoisting but before vi.mock, so they
// are accessible inside the mock factory closure at call time.

let mockGetResult: ReturnType<typeof vi.fn>
let mockSetexResult: ReturnType<typeof vi.fn>
let activeNodes: Array<{ scan: ReturnType<typeof vi.fn> }>

vi.mock("ioredis", () => {
  class MockCluster {
    nodes(role: string) {
      return role === "master" ? activeNodes : []
    }
    del = vi.fn().mockResolvedValue(1)
    get = (...args: unknown[]) => mockGetResult(...args)
    set = vi.fn().mockResolvedValue("OK")
    setex = (...args: unknown[]) => mockSetexResult(...args)
    keys = vi.fn().mockResolvedValue([])
    on = vi.fn()
    ping = vi.fn().mockResolvedValue("PONG")
    quit = vi.fn().mockResolvedValue(undefined)
    disconnect = vi.fn()
    status = "ready"
  }

  class MockRedis {
    del = vi.fn().mockResolvedValue(1)
    get = (...args: unknown[]) => mockGetResult(...args)
    set = vi.fn().mockResolvedValue("OK")
    setex = (...args: unknown[]) => mockSetexResult(...args)
    keys = vi.fn().mockResolvedValue([])
    on = vi.fn()
    quit = vi.fn().mockResolvedValue(undefined)
    disconnect = vi.fn()
    status = "ready"
    ping = vi.fn().mockResolvedValue("PONG")
  }

  return {
    Cluster: MockCluster,
    Redis: MockRedis,
  }
})

// ===========================================================================
// Mock @/lib/sentry — captureMessage is called by degradeTier() when
// degradationCount >= 3.  We verify the call args in the alert test below.
// ===========================================================================

vi.mock("@/lib/sentry", () => ({
  captureMessage: mockCaptureMessage,
}))

// ===========================================================================
// Module under test (reloaded for each test block)
// ===========================================================================

let redisModule: typeof import("@/lib/redis")

async function reloadModule(clusterMode: boolean) {
  vi.resetModules()
  process.env.REDIS_CLUSTER_MODE = clusterMode ? "true" : "false"
  process.env.REDIS_CLUSTER_NODES = clusterMode ? "localhost:7000,localhost:7001" : "localhost:6379"

  activeNodes = [createMockNode()]
  mockGetResult = vi.fn().mockResolvedValue(null) // default: cache miss
  mockSetexResult = vi.fn().mockResolvedValue("OK")

  redisModule = await import("@/lib/redis")
  await redisModule.resetCacheCounters()
}

// ===========================================================================
// Tests
// ===========================================================================

describe("Redis three-tier degradation chain", () => {
  afterEach(() => {
    delete process.env.REDIS_CLUSTER_MODE
    delete process.env.REDIS_CLUSTER_NODES
    activeNodes = []
  })

  // ── 1. Full chain: cluster → standalone → memory ─────────────────────

  it("degrades cluster → standalone → memory on consecutive failures", async () => {
    await reloadModule(true) // start in cluster mode

    // Seed memory store (cacheSet always writes to memory regardless of tier)
    await redisModule.cacheSet("key:chain", "full_chain", 60)

    // Make ALL Redis GET operations throw → triggers two degradeTier() calls
    // (cluster throws → degrade to standalone → retry → standalone also throws → degrade to memory)
    mockGetResult = vi.fn().mockRejectedValue(new Error("Redis connection refused"))

    const result = await redisModule.cacheGet("key:chain")
    expect(result).toBe("full_chain")

    const stats = redisModule.getCacheStats()
    expect(stats.activeTier).toBe("memory")
    expect(stats.degradationCount).toBe(2)
  })

  // ── 2. Single degradation: cluster → standalone only ─────────────────

  it("degrades only once when standalone tier succeeds", async () => {
    await reloadModule(true) // start in cluster mode

    await redisModule.cacheSet("key:single", "single_degrade", 60)

    // First call (cluster) throws → triggers degradeTier("cluster")
    // Second call (standalone retry) returns the cached value → no further degradation
    mockGetResult = vi
      .fn()
      .mockRejectedValueOnce(new Error("Cluster node unreachable"))
      .mockResolvedValue('"single_degrade"')

    const result = await redisModule.cacheGet("key:single")
    expect(result).toBe("single_degrade")

    const stats = redisModule.getCacheStats()
    // Should have degraded to standalone (only one degradation)
    expect(stats.activeTier).toBe("standalone")
    expect(stats.degradationCount).toBe(1)
  })

  // ── 3. No further degradation when current tier succeeds ────────────

  it("does not degrade further when the current standalone tier operates successfully", async () => {
    await reloadModule(true) // start in cluster mode

    await redisModule.cacheSet("key:stable", "stable_test", 60)

    // First call (cluster) throws → degrade to standalone
    // Subsequent calls (standalone) return the value → no further degradation
    mockGetResult = vi
      .fn()
      .mockRejectedValueOnce(new Error("Cluster error"))
      .mockResolvedValue('"stable_test"')

    const result1 = await redisModule.cacheGet("key:stable")
    expect(result1).toBe("stable_test")

    const stats = redisModule.getCacheStats()
    expect(stats.activeTier).toBe("standalone")
    expect(stats.degradationCount).toBe(1)

    // Now at standalone — another cacheGet should work without degrading further
    await redisModule.cacheSet("key:stable2", "test2", 60)
    mockGetResult = vi.fn().mockResolvedValue('"test2"')
    const result2 = await redisModule.cacheGet("key:stable2")
    expect(result2).toBe("test2")

    const stats2 = redisModule.getCacheStats()
    expect(stats2.degradationCount).toBe(1) // still 1 — no new degradation
    expect(stats2.activeTier).toBe("standalone") // still standalone
  })

  // ── 4. degradationCount increments correctly ────────────────────────

  it("increments degradationCount for each valid degradation step", async () => {
    await reloadModule(true)

    await redisModule.cacheSet("key:count", "count_test", 60)

    // Two-step degradation
    mockGetResult = vi.fn().mockRejectedValue(new Error("Redis down"))

    await redisModule.cacheGet("key:count")

    const stats = redisModule.getCacheStats()
    expect(stats.degradationCount).toBe(2)

    // Additional cache operations at memory tier should not increase the count
    mockGetResult = vi.fn().mockRejectedValue(new Error("Still down"))
    await redisModule.cacheSet("key:count2", "noop", 60)
    await redisModule.cacheGet("key:count2")

    const stats2 = redisModule.getCacheStats()
    expect(stats2.degradationCount).toBe(2) // unchanged
  })

  // ── 5. cacheGet inline retry after degradation ──────────────────────

  it("retries cacheGet with new tier after degrading from cluster to standalone", async () => {
    await reloadModule(true)

    // Cluster fails (throws), standalone succeeds with a real cached value
    await redisModule.cacheSet("key:retry", "retry_value", 60)

    // First call to get() (cluster) throws; second call (standalone) returns raw JSON
    let callIdx = 0
    mockGetResult = vi.fn().mockImplementation(() => {
      callIdx++
      if (callIdx <= 1) {
        return Promise.reject(new Error("Cluster timeout"))
      }
      // Standalone returns the cached value
      return Promise.resolve('"retry_value"')
    })

    const result = await redisModule.cacheGet("key:retry")
    // The retry with standalone should have found the cached value
    // (but note: memoryStore also has the value from cacheSet, so both paths work)
    expect(result).toBe("retry_value")

    const stats = redisModule.getCacheStats()
    expect(stats.activeTier).toBe("standalone")
  })

  // ── 6. isRedisAvailable returns false at memory tier ───────────────

  it("isRedisAvailable returns false when active tier is memory", async () => {
    await reloadModule(false) // standalone mode

    // Start: standalone should be available
    expect(redisModule.isRedisAvailable()).toBe(true)

    await redisModule.cacheSet("key:avail", "test", 60)

    // Trigger degradation to memory
    mockGetResult = vi.fn().mockRejectedValue(new Error("Standalone down"))

    await redisModule.cacheGet("key:avail")

    expect(redisModule.isRedisAvailable()).toBe(false)
  })

  // ── 7. Memory store survives full degradation ──────────────────────

  it("serves data from memory store after full cluster→standalone→memory degradation", async () => {
    await reloadModule(true)

    // cacheSet always writes to memory store regardless of Redis tier
    await redisModule.cacheSet("mem:persist", { nested: { value: 42 } }, 120)

    // Trigger full degradation
    mockGetResult = vi.fn().mockRejectedValue(new Error("Redis fully down"))

    // cacheGet should fall through to memory after both tiers fail
    const result = await redisModule.cacheGet<{ nested: { value: number } }>("mem:persist")
    expect(result).toEqual({ nested: { value: 42 } })

    // Confirm we're at memory tier
    expect(redisModule.getCacheStats().activeTier).toBe("memory")

    // Another get at memory tier should still work
    const result2 = await redisModule.cacheGet<{ nested: { value: number } }>("mem:persist")
    expect(result2).toEqual({ nested: { value: 42 } })

    // cacheSet still works at memory tier
    await redisModule.cacheSet("mem:after", "still_working", 60)
    const result3 = await redisModule.cacheGet<string>("mem:after")
    expect(result3).toBe("still_working")
  })
})

// ===========================================================================
// __testing__tryRecoverTier — recovery cycle from memory → standalone → cluster
// ===========================================================================
//
// __testing__tryRecoverTier() promotes ONE TIER per call (memory → standalone
// or standalone → cluster), because the checkRedis() timer always moves one
// level at a time.  To recover two tiers (memory → cluster), call it twice.
//
// Validates that after degrading to the lowest tier (memory), mocking
// Redis ping as success causes __testing__tryRecoverTier() to promote back up.

describe("Redis tier recovery (__testing__tryRecoverTier)", () => {
  afterEach(() => {
    delete process.env.REDIS_CLUSTER_MODE
    delete process.env.REDIS_CLUSTER_NODES
    activeNodes = []
  })

  it("promotes one tier per call: memory → standalone (cluster mode)", async () => {
    await reloadModule(true)
    await redisModule.cacheSet("key:recovery", "val", 60)

    // Degrade fully to memory
    mockGetResult = vi.fn().mockRejectedValue(new Error("Down"))
    await redisModule.cacheGet("key:recovery")

    expect(redisModule.isRedisAvailable()).toBe(false)
    expect(redisModule.getCacheStats().activeTier).toBe("memory")

    // First call: memory → standalone
    await redisModule.__testing__tryRecoverTier()
    expect(redisModule.isRedisAvailable()).toBe(true)
    expect(redisModule.getCacheStats().activeTier).toBe("standalone")

    // Second call: standalone → cluster
    await redisModule.__testing__tryRecoverTier()
    expect(redisModule.getCacheStats().activeTier).toBe("cluster")

    // After recovery, cacheGet reads from Redis (active tier = cluster)
    mockGetResult = vi.fn().mockResolvedValue('"cluster_value"')
    const result = await redisModule.cacheGet<string>("key:recovery")
    expect(result).toBe("cluster_value")
  })

  it("recovers from memory to standalone (standalone mode only)", async () => {
    await reloadModule(false) // standalone mode — cluster not configured

    await redisModule.cacheSet("key:standalone_rec", "val", 60)

    // Degrade to memory
    mockGetResult = vi.fn().mockRejectedValue(new Error("Standalone down"))
    await redisModule.cacheGet("key:standalone_rec")

    expect(redisModule.isRedisAvailable()).toBe(false)
    expect(redisModule.getCacheStats().activeTier).toBe("memory")

    // Recover: standalone ping succeeds
    await redisModule.__testing__tryRecoverTier()

    expect(redisModule.isRedisAvailable()).toBe(true)
    expect(redisModule.getCacheStats().activeTier).toBe("standalone")
  })

  it("does not promote when already at cluster (no-op)", async () => {
    await reloadModule(true)

    // Active tier starts at cluster
    expect(redisModule.getCacheStats().activeTier).toBe("cluster")

    // Calling __testing__tryRecoverTier at the top tier should be a no-op
    await redisModule.__testing__tryRecoverTier()
    expect(redisModule.getCacheStats().activeTier).toBe("cluster")
  })

  it("is exported and callable without throwing", async () => {
    await reloadModule(true)

    // Direct call — no crash, returns void
    await expect(redisModule.__testing__tryRecoverTier()).resolves.toBeUndefined()
  })
})

// ===========================================================================
// Sentry degradation alert — captureMessage called when degradationCount >= 3
// ===========================================================================
//
// The architecture limits each degradation cycle to 2 steps (cluster →
// standalone → memory).  To reach degradationCount=3 and trigger the Sentry
// alert we need a recovery cycle in between:
//
//   1. cacheGet fails (cluster down)
//        → degradeTier("cluster")     count=1  activeTier=standalone
//   2. cacheGet retry (standalone down)
//        → degradeTier("standalone")  count=2  activeTier=memory
//   3. __testing__tryRecoverTier()
//        → memory → standalone (ping mocked as PONG)
//   4. cacheGet fails (standalone down again)
//        → degradeTier("standalone")  count=3  → captureMessage fires
//
// This mirrors the real-world pattern: sustained outage -> 30s recovery timer
// -> brief recovery -> renewed failure -> 3rd degradation -> Sentry alert.

describe("Redis Sentry degradation alert", () => {
  afterEach(() => {
    delete process.env.REDIS_CLUSTER_MODE
    delete process.env.REDIS_CLUSTER_NODES
    activeNodes = []
    vi.clearAllMocks()
  })

  it(
    "calls captureMessage with severity='error' and degradationCount=3 " +
      "after 3 degradations (cacheGet + recovery + cacheGet)",
    async () => {
      await reloadModule(true)

      // Seed memory store so cacheGet has a fallback value
      await redisModule.cacheSet("key:alert", "sentry_test", 60)

      // ── Step 1: trigger 2 degradations via cacheGet ────────────────
      // Both cluster and standalone throw → two degradeTier calls
      mockGetResult = vi.fn().mockRejectedValue(new Error("Redis connection refused"))
      const result1 = await redisModule.cacheGet("key:alert")
      expect(result1).toBe("sentry_test")

      let stats = redisModule.getCacheStats()
      expect(stats.degradationCount).toBe(2)
      expect(stats.activeTier).toBe("memory")

      // captureMessage should NOT have been called yet (count < 3)
      expect(mockCaptureMessage).not.toHaveBeenCalled()

      // ── Step 2: recover to standalone ──────────────────────────────
      await redisModule.__testing__tryRecoverTier()
      expect(redisModule.getCacheStats().activeTier).toBe("standalone")

      // ── Step 3: trigger 3rd degradation (standalone → memory) ──────
      // captureMessage should fire during this call (count reaches 3)
      const result2 = await redisModule.cacheGet("key:alert")
      expect(result2).toBe("sentry_test")

      stats = redisModule.getCacheStats()
      expect(stats.degradationCount).toBe(3)
      expect(stats.activeTier).toBe("memory")

      // ── Assert captureMessage was called with expected arguments ───
      expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
      expect(mockCaptureMessage).toHaveBeenCalledWith(
        expect.stringContaining("Múltiplas degradações"),
        "error",
        expect.objectContaining({
          degradationCount: 3,
        }),
      )
    },
  )
})

// ===========================================================================
// Property-based: degradation chain invariants (fast-check)
// ===========================================================================
//
// Instead of hand-picking a few fixed scenarios, these tests use fast-check
// to generate thousands of random sequences of degradeTier calls and verify
// that the module's state machine follows universal invariants:
//
//   Property 1 — Order monotonicity:
//     degradeTier() only moves activeTier down the chain one step at a time,
//     never skipping tiers (cluster → standalone → memory).
//
//   Property 2 — Stale error immunity:
//     Calling degradeTier with a tier BELOW the current active tier is
//     silently ignored (the `failedIdx > activeIdx` guard).
//
//   Property 3 — Terminal tier:
//     Once at "memory", no further degradeTier call changes the tier.
//
//   Property 4 — Count monotonicity:
//     degradationCount never decreases, regardless of the sequence.
//
//   Property 5 — Availability correlation:
//     isRedisAvailable() === (activeTier !== "memory") at all times.
//
// The model is a pure function that mirrors the logic inside degradeTier()
// so the test can compare the actual module state against the expected state
// for any generated sequence of operations.

// Pure model of the degradation state machine.
// Mirrors the logic in redis.ts degradeTier().
const TIER_ORDER: readonly ["cluster", "standalone", "memory"] = ["cluster", "standalone", "memory"]

type Tier = (typeof TIER_ORDER)[number]

function modelDegrade(current: Tier, failedTier: Tier): Tier {
  const currentIdx = TIER_ORDER.indexOf(current)
  const failedIdx = TIER_ORDER.indexOf(failedTier)

  // Stale error from a tier below the current one — ignore
  if (failedIdx > currentIdx) return current

  const nextIdx = currentIdx + 1
  // Already at the lowest tier — stay
  if (nextIdx >= TIER_ORDER.length) return current

  return TIER_ORDER[nextIdx]
}

describe("Property-based: degradation chain invariants", () => {
  // Load the module once at the start; each fast-check run resets internal
  // state via __testing__resetDegradationState() (synchronous, no re-import).
  beforeEach(async () => {
    await reloadModule(true)
  })

  afterEach(() => {
    delete process.env.REDIS_CLUSTER_MODE
    delete process.env.REDIS_CLUSTER_NODES
    activeNodes = []
  })

  // ── Property 1: cluster mode — monotonic order ──────────────────────
  //
  // Fast-check generates arrays of Tier values (0-100 ops).  Each run starts
  // by resetting the module state via __testing__resetDegradationState()
  // instead of re-importing the module (50× faster than reloadModule).

  it("cluster mode: activeTier never skips tiers and never goes up via degradeTier", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...TIER_ORDER), { minLength: 0, maxLength: 100 }),
        async (operations) => {
          redisModule.__testing__resetDegradationState()

          let expectedTier: Tier = "cluster"

          for (const op of operations) {
            redisModule.__testing__degradeTier(op)
            expectedTier = modelDegrade(expectedTier, op)

            const stats = redisModule.getCacheStats()
            expect(stats.activeTier).toBe(expectedTier)
          }
        },
      ),
      { verbose: true, numRuns: 200 },
    )
  })

  // ── Property 2: standalone mode — monotonic order ───────────────────
  //
  // The module was loaded with clusterMode=true (beforeEach), so we start
  // at "cluster", then degrade once to reach "standalone" as the starting
  // tier.  Each fast-check run resets to cluster first.

  it("standalone mode: activeTier correctly degrades from standalone to memory", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...TIER_ORDER), { minLength: 0, maxLength: 100 }),
        async (operations) => {
          redisModule.__testing__resetDegradationState()
          // Degrade once: cluster → standalone
          redisModule.__testing__degradeTier("cluster")
          expect(redisModule.getCacheStats().activeTier).toBe("standalone")

          let expectedTier: Tier = "standalone"

          for (const op of operations) {
            redisModule.__testing__degradeTier(op)
            expectedTier = modelDegrade(expectedTier, op)

            const stats = redisModule.getCacheStats()
            expect(stats.activeTier).toBe(expectedTier)
          }
        },
      ),
      { verbose: true, numRuns: 200 },
    )
  })

  // ── Property 3: degradationCount monotônicity ───────────────────────

  it("degradationCount only increases, never decreases", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...TIER_ORDER), { minLength: 1, maxLength: 100 }),
        async (operations) => {
          redisModule.__testing__resetDegradationState()

          let prevCount = 0

          for (const op of operations) {
            redisModule.__testing__degradeTier(op)
            const stats = redisModule.getCacheStats()
            expect(stats.degradationCount).toBeGreaterThanOrEqual(prevCount)
            prevCount = stats.degradationCount
          }
        },
      ),
      { verbose: true, numRuns: 200 },
    )
  })

  // ── Property 4: isRedisAvailable correlation ────────────────────────

  it("isRedisAvailable is true iff activeTier is not 'memory'", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...TIER_ORDER), { minLength: 0, maxLength: 100 }),
        async (operations) => {
          redisModule.__testing__resetDegradationState()

          for (const op of operations) {
            redisModule.__testing__degradeTier(op)
            expect(redisModule.isRedisAvailable()).toBe(
              redisModule.getCacheStats().activeTier !== "memory",
            )
          }
        },
      ),
      { verbose: true, numRuns: 200 },
    )
  })
})
