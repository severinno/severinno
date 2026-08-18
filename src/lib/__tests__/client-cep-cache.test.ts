/**
 * client-cep-cache.test.ts
 *
 * Comprehensive tests for the client-side CEP cache (ViaCEP results).
 *
 * Coverage:
 *   1. Basic set/get — roundtrip, CEP mask normalization (01310-100 vs 01310100)
 *   2. TTL expiry — entry expires after 7 days, stale entry not returned
 *   3. BroadcastChannel — cross-tab sync, silent flag, unsubscribe
 *   4. localStorage unavailable — private browsing / quota exceeded
 *   5. removeCachedCep — removes a cached entry
 *   6. clearCepCache — removes all CEP-prefixed keys
 *   7. sweepCepCache — removes expired entries proactively
 *   8. getCepCacheDiagnostics — returns correct stats
 *   9. Corrupt data — gracefully handles parse failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { CepResult } from "@/lib/api"

// The vitrine setup file mocks @/lib/client-geo-cache globally, but the CEP
// cache is mocked via clearCepCache only — the module itself is NOT mocked,
// so this file exercises the REAL implementation. For symmetry and to avoid
// any module-level state leaking from component tests, reset modules below.
vi.doUnmock("@/lib/client-cep-cache")

// ---------------------------------------------------------------------------
// Use fake timers for deterministic TTL tests.
// ---------------------------------------------------------------------------

const BASE_TIME = 1_700_000_000_000

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

function createMockStorage(throwOnAccess = false): Storage {
  const store: Record<string, string> = {}
  let keys: string[] = []

  const updateKeys = () => {
    keys = Object.keys(store)
  }

  return {
    get length() {
      return keys.length
    },
    key: (index: number) => keys[index] ?? null,
    getItem: (key: string) => {
      if (throwOnAccess) throw new DOMException("localStorage not available", "QuotaExceededError")
      return store[key] ?? null
    },
    setItem: (key: string, value: string) => {
      if (throwOnAccess) throw new DOMException("localStorage not available", "QuotaExceededError")
      store[key] = value
      updateKeys()
    },
    removeItem: (key: string) => {
      if (!throwOnAccess) {
        delete store[key]
        updateKeys()
      }
    },
    clear: () => {
      for (const key of Object.keys(store)) {
        delete store[key]
      }
      updateKeys()
    },
  } as Storage
}

// ---------------------------------------------------------------------------
// BroadcastChannel mock
// ---------------------------------------------------------------------------

type BcListener = (ev: MessageEvent) => void
let listeners: Map<string, Set<BcListener>>

class BroadcastChannelMock {
  name: string
  onmessage: ((ev: MessageEvent) => void) | null = null

  constructor(name: string) {
    this.name = name
    if (!listeners.has(name)) listeners.set(name, new Set())
  }

  addEventListener(_type: string, handler: BcListener): void {
    const set = listeners.get(this.name)
    if (set) set.add(handler)
  }

  removeEventListener(_type: string, handler: BcListener): void {
    const set = listeners.get(this.name)
    if (set) set.delete(handler)
  }

  postMessage(data: unknown): void {
    const set = listeners.get(this.name)
    if (!set) return
    for (const handler of set) {
      handler({ data } as MessageEvent)
    }
  }

  close(): void {
    listeners.delete(this.name)
  }
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_CEP: CepResult = {
  cep: "01310100",
  street: "Rua Augusta",
  district: "Consolação",
  city: "São Paulo",
  state: "SP",
}

const SAMPLE_CEP_2: CepResult = {
  cep: "20040020",
  street: "Avenida Rio Branco",
  district: "Centro",
  city: "Rio de Janeiro",
  state: "RJ",
}

// ---------------------------------------------------------------------------
// Module under test (import after mocks are set up)
// ---------------------------------------------------------------------------

let mod: typeof import("@/lib/client-cep-cache")

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE_TIME)

  // Fresh module for each test (clears cached _channel from previous tests)
  vi.resetModules()

  // Fresh localStorage for each test
  const localStorageMock = createMockStorage()
  vi.stubGlobal("localStorage", localStorageMock)

  // Fresh BroadcastChannel for each test
  listeners = new Map()
  vi.stubGlobal("BroadcastChannel", BroadcastChannelMock)

  mod = await import("@/lib/client-cep-cache")
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ===========================================================================
// 1. Basic set / get
// ===========================================================================

describe("set/get", () => {
  it("stores and retrieves a CEP result", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    expect(mod.getCachedCep("01310100")).toEqual(SAMPLE_CEP)
  })

  it("normalizes CEP mask — set with hyphen, get without", () => {
    mod.setCachedCep("01310-100", SAMPLE_CEP)
    expect(mod.getCachedCep("01310100")).toEqual(SAMPLE_CEP)
  })

  it("normalizes CEP mask — set without hyphen, get with hyphen", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    expect(mod.getCachedCep("01310-100")).toEqual(SAMPLE_CEP)
  })

  it("returns null for a missing CEP", () => {
    expect(mod.getCachedCep("00000000")).toBeNull()
  })

  it("stores multiple CEPs independently", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    mod.setCachedCep("20040020", SAMPLE_CEP_2)

    expect(mod.getCachedCep("01310100")).toEqual(SAMPLE_CEP)
    expect(mod.getCachedCep("20040020")).toEqual(SAMPLE_CEP_2)
  })

  it("updates existing entry on re-set", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    mod.setCachedCep("01310100", { ...SAMPLE_CEP, street: "Rua Augusta (atualizado)" })
    expect(mod.getCachedCep("01310100")?.street).toBe("Rua Augusta (atualizado)")
  })
})

// ===========================================================================
// 2. TTL expiry
// ===========================================================================

describe("TTL expiry", () => {
  it("returns entry within TTL (3 days)", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000)
    expect(mod.getCachedCep("01310100")).toEqual(SAMPLE_CEP)
  })

  it("returns null for an expired entry (8 days)", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000)
    expect(mod.getCachedCep("01310100")).toBeNull()
  })

  it("removes expired entry from localStorage on access", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000)
    mod.getCachedCep("01310100") // triggers removal
    expect(localStorage.getItem("severinno:cep:01310100")).toBeNull()
  })

  it("handles entry that expires exactly at TTL boundary (7 days)", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    // TTL uses <, not <= — exactly 7 days is NOT fresh
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000)
    expect(mod.getCachedCep("01310100")).toBeNull()
  })
})

// ===========================================================================
// 3. BroadcastChannel cross-tab sync
// ===========================================================================

describe("BroadcastChannel sync", () => {
  it("broadcasts on set (non-silent)", () => {
    const spy = vi.spyOn(BroadcastChannelMock.prototype, "postMessage")

    mod.setCachedCep("01310100", SAMPLE_CEP)

    expect(spy).toHaveBeenCalledTimes(1)
    const payload = spy.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({ cep: "01310100", data: SAMPLE_CEP })
    spy.mockRestore()
  })

  it("does not broadcast on silent set", () => {
    const spy = vi.spyOn(BroadcastChannelMock.prototype, "postMessage")

    mod.setCachedCep("01310100", SAMPLE_CEP, true)

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("subscribeCepUpdates receives a broadcast from another tab", () => {
    const callback = vi.fn()
    const unsub = mod.subscribeCepUpdates(callback)

    const channel = new BroadcastChannel("severinno:cep-cache")
    channel.postMessage({ cep: "20040020", data: SAMPLE_CEP_2, cachedAt: Date.now() })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ cep: "20040020", data: SAMPLE_CEP_2 }),
    )
    unsub()
  })

  it("unsubscribing stops receiving broadcasts", () => {
    const callback = vi.fn()
    const unsub = mod.subscribeCepUpdates(callback)
    unsub()

    const channel = new BroadcastChannel("severinno:cep-cache")
    channel.postMessage({ cep: "20040020", data: SAMPLE_CEP_2, cachedAt: Date.now() })

    expect(callback).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 4. localStorage unavailable
// ===========================================================================

describe("localStorage unavailable", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage(true)) // throws on access
  })

  it("getCachedCep returns null when localStorage throws", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP) // silently fails
    expect(mod.getCachedCep("01310100")).toBeNull()
  })

  it("setCachedCep does not throw when localStorage throws", () => {
    expect(() => {
      mod.setCachedCep("01310100", SAMPLE_CEP)
    }).not.toThrow()
  })

  it("removeCachedCep does not throw", () => {
    expect(() => {
      mod.removeCachedCep("01310100")
    }).not.toThrow()
  })

  it("clearCepCache does not throw", () => {
    expect(() => {
      mod.clearCepCache()
    }).not.toThrow()
  })

  it("sweepCepCache returns 0 without throwing", () => {
    expect(() => {
      expect(mod.sweepCepCache()).toBe(0)
    }).not.toThrow()
  })

  it("subscribeCepUpdates no-ops without throwing", () => {
    expect(() => {
      const unsub = mod.subscribeCepUpdates(vi.fn())
      unsub()
    }).not.toThrow()
  })
})

// ===========================================================================
// 5. removeCachedCep
// ===========================================================================

describe("removeCachedCep", () => {
  it("removes a cached entry", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    expect(mod.getCachedCep("01310100")).not.toBeNull()

    mod.removeCachedCep("01310100")
    expect(mod.getCachedCep("01310100")).toBeNull()
  })

  it("removes a cached entry with masked input", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    mod.removeCachedCep("01310-100")
    expect(mod.getCachedCep("01310100")).toBeNull()
  })

  it("no-ops for a non-existent key", () => {
    expect(() => {
      mod.removeCachedCep("99999999")
    }).not.toThrow()
  })
})

// ===========================================================================
// 6. clearCepCache
// ===========================================================================

describe("clearCepCache", () => {
  it("removes all CEP-prefixed entries", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    mod.setCachedCep("20040020", SAMPLE_CEP_2)

    mod.clearCepCache()

    expect(mod.getCachedCep("01310100")).toBeNull()
    expect(mod.getCachedCep("20040020")).toBeNull()
  })

  it("does not affect non-CEP localStorage keys", () => {
    localStorage.setItem("other-key", "other-value")
    mod.setCachedCep("01310100", SAMPLE_CEP)

    mod.clearCepCache()

    expect(localStorage.getItem("other-key")).toBe("other-value")
  })
})

// ===========================================================================
// 7. sweepCepCache
// ===========================================================================

describe("sweepCepCache", () => {
  it("removes expired entries and returns count", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    mod.setCachedCep("20040020", SAMPLE_CEP_2)
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000) // past 7-day TTL

    const removed = mod.sweepCepCache()
    expect(removed).toBe(2)
    expect(mod.getCachedCep("01310100")).toBeNull()
    expect(mod.getCachedCep("20040020")).toBeNull()
  })

  it("leaves fresh entries untouched", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000) // 3 days — still fresh

    expect(mod.sweepCepCache()).toBe(0)
    expect(mod.getCachedCep("01310100")).toEqual(SAMPLE_CEP)
  })

  it("handles mixed fresh and expired entries", () => {
    mod.setCachedCep("11111111", SAMPLE_CEP)
    vi.advanceTimersByTime(6 * 24 * 60 * 60 * 1000) // 6 days
    mod.setCachedCep("22222222", SAMPLE_CEP_2)
    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000) // +2 days → 11111111 8d, 22222222 2d

    const removed = mod.sweepCepCache()
    expect(removed).toBe(1) // 11111111 expired (8d), 22222222 still fresh (2d)
    expect(mod.getCachedCep("11111111")).toBeNull()
    expect(mod.getCachedCep("22222222")).toEqual(SAMPLE_CEP_2)
  })

  it("returns 0 when cache is empty", () => {
    expect(mod.sweepCepCache()).toBe(0)
  })
})

// ===========================================================================
// 8. getCepCacheDiagnostics
// ===========================================================================

describe("getCepCacheDiagnostics", () => {
  it("reports correct entry count", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    mod.setCachedCep("20040020", SAMPLE_CEP_2)
    const diag = mod.getCepCacheDiagnostics()
    expect(diag.entryCount).toBe(2)
  })

  it("reports zero entries when cache is empty", () => {
    expect(mod.getCepCacheDiagnostics().entryCount).toBe(0)
  })

  it("reports correct TTL (7 days)", () => {
    expect(mod.getCepCacheDiagnostics().ttlMs).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it("reports oldest entry age", () => {
    mod.setCachedCep("01310100", SAMPLE_CEP)
    vi.advanceTimersByTime(10 * 60 * 1000) // 10 min later
    mod.setCachedCep("20040020", SAMPLE_CEP_2)

    const diag = mod.getCepCacheDiagnostics()
    expect(diag.oldestEntryAgeMs).toBeGreaterThanOrEqual(10 * 60 * 1000)
    expect(diag.entryCount).toBe(2)
  })

  it("does not throw when localStorage access fails (jsdom always has the global)", () => {
    vi.stubGlobal("localStorage", createMockStorage(true))
    expect(() => {
      const diag = mod.getCepCacheDiagnostics()
      expect(diag.entryCount).toBe(0)
    }).not.toThrow()
  })
})

// ===========================================================================
// 9. Corrupt data
// ===========================================================================

describe("corrupt data handling", () => {
  it("returns null for malformed JSON", () => {
    localStorage.setItem("severinno:cep:01310100", "not valid json")
    expect(mod.getCachedCep("01310100")).toBeNull()
  })

  it("removes entry with missing data field", () => {
    localStorage.setItem("severinno:cep:01310100", JSON.stringify({ cachedAt: Date.now() }))
    expect(mod.getCachedCep("01310100")).toBeNull()
    expect(localStorage.getItem("severinno:cep:01310100")).toBeNull()
  })

  it("removes entry with missing cachedAt field", () => {
    localStorage.setItem("severinno:cep:01310100", JSON.stringify({ data: SAMPLE_CEP }))
    expect(mod.getCachedCep("01310100")).toBeNull()
    expect(localStorage.getItem("severinno:cep:01310100")).toBeNull()
  })
})
