/**
 * compare.test.ts
 *
 * Tests for the Compare store (src/store/compare.ts) — the client-side
 * selection of providers for the comparison feature.
 *
 * Coverage:
 *   1. toggle — adds ID when absent, removes when present
 *   2. toggle — respects MAX_COMPARE (ignores when full)
 *   3. remove / clear — remove single vs all
 *   4. isAdded — getter
 *   5. openCompare / closeCompare — modal state
 *   6. persist — partialize saves only `ids`
 */

import { describe, it, expect, beforeEach } from "vitest"
import { useCompareStore, MAX_COMPARE } from "../compare"

// Reset store before each test (ids + modal state)
beforeEach(() => {
  useCompareStore.setState({ ids: [], modalOpen: false })
})

describe("useCompareStore — toggle", () => {
  it("starts with empty ids and closed modal", () => {
    const s = useCompareStore.getState()
    expect(s.ids).toEqual([])
    expect(s.modalOpen).toBe(false)
  })

  it("toggle adds an ID when absent", () => {
    useCompareStore.getState().toggle("p1")
    expect(useCompareStore.getState().ids).toEqual(["p1"])
  })

  it("toggle removes an ID when present", () => {
    useCompareStore.getState().toggle("p1")
    useCompareStore.getState().toggle("p1")
    expect(useCompareStore.getState().ids).toEqual([])
  })

  it("toggle appends multiple distinct IDs in order", () => {
    useCompareStore.getState().toggle("p1")
    useCompareStore.getState().toggle("p2")
    useCompareStore.getState().toggle("p3")
    expect(useCompareStore.getState().ids).toEqual(["p1", "p2", "p3"])
  })

  it(`toggle ignores additions beyond MAX_COMPARE (${MAX_COMPARE})`, () => {
    for (let i = 0; i < MAX_COMPARE; i++) {
      useCompareStore.getState().toggle(`p${i}`)
    }
    // Full — adding a 4th must be ignored
    useCompareStore.getState().toggle("p-overflow")
    const ids = useCompareStore.getState().ids
    expect(ids).toHaveLength(MAX_COMPARE)
    expect(ids).not.toContain("p-overflow")
  })

  it("toggle still allows removal when at MAX_COMPARE", () => {
    for (let i = 0; i < MAX_COMPARE; i++) {
      useCompareStore.getState().toggle(`p${i}`)
    }
    useCompareStore.getState().toggle("p0")
    expect(useCompareStore.getState().ids).toEqual(["p1", "p2"])
  })

  it("toggle is idempotent on repeat calls", () => {
    useCompareStore.getState().toggle("p1")
    useCompareStore.getState().toggle("p1")
    useCompareStore.getState().toggle("p1")
    expect(useCompareStore.getState().ids).toEqual(["p1"])
  })
})

describe("useCompareStore — remove / clear", () => {
  it("remove deletes a single ID", () => {
    useCompareStore.setState({ ids: ["p1", "p2", "p3"] })
    useCompareStore.getState().remove("p2")
    expect(useCompareStore.getState().ids).toEqual(["p1", "p3"])
  })

  it("remove of a non-present ID is a no-op", () => {
    useCompareStore.setState({ ids: ["p1"] })
    useCompareStore.getState().remove("p9")
    expect(useCompareStore.getState().ids).toEqual(["p1"])
  })

  it("clear empties the list", () => {
    useCompareStore.setState({ ids: ["p1", "p2", "p3"] })
    useCompareStore.getState().clear()
    expect(useCompareStore.getState().ids).toEqual([])
  })
})

describe("useCompareStore — isAdded", () => {
  it("returns true when the ID is in the list", () => {
    useCompareStore.setState({ ids: ["p1", "p2"] })
    expect(useCompareStore.getState().isAdded("p1")).toBe(true)
    expect(useCompareStore.getState().isAdded("p2")).toBe(true)
  })

  it("returns false when the ID is not in the list", () => {
    useCompareStore.setState({ ids: ["p1"] })
    expect(useCompareStore.getState().isAdded("p2")).toBe(false)
  })

  it("returns false for an empty list", () => {
    expect(useCompareStore.getState().isAdded("p1")).toBe(false)
  })
})

describe("useCompareStore — modal state", () => {
  it("openCompare sets modalOpen to true", () => {
    useCompareStore.getState().openCompare()
    expect(useCompareStore.getState().modalOpen).toBe(true)
  })

  it("closeCompare sets modalOpen to false", () => {
    useCompareStore.setState({ modalOpen: true })
    useCompareStore.getState().closeCompare()
    expect(useCompareStore.getState().modalOpen).toBe(false)
  })
})

describe("useCompareStore — persist partialize", () => {
  it("partialize keeps only ids (modal state is not persisted)", () => {
    useCompareStore.setState({ ids: ["p1", "p2"], modalOpen: true })
    const partialize = (
      useCompareStore.persist as {
        getOptions: () => { partialize?: (s: unknown) => unknown }
      }
    ).getOptions().partialize
    expect(partialize).toBeDefined()
    const result = partialize!(useCompareStore.getState()) as { ids?: unknown; modalOpen?: unknown }
    expect(result.ids).toEqual(["p1", "p2"])
    expect(result.modalOpen).toBeUndefined()
  })
})
