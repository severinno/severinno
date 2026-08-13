/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from "vitest"
import { useViewStore } from "../view"

// Reset store before each test
beforeEach(() => {
  useViewStore.setState({
    view: "vitrine",
    params: {},
    history: [],
  })
})

describe("useViewStore", () => {
  it("starts with vitrine as default view", () => {
    const state = useViewStore.getState()
    expect(state.view).toBe("vitrine")
    expect(state.params).toEqual({})
    expect(state.history).toEqual([])
  })

  it("navigate updates view and pushes to history", () => {
    const store = useViewStore.getState()
    store.navigate("client.dashboard", { userId: "123" })

    const state = useViewStore.getState()
    expect(state.view).toBe("client.dashboard")
    expect(state.params).toEqual({ userId: "123" })
    expect(state.history).toHaveLength(1)
    expect(state.history[0]).toEqual({ view: "vitrine", params: {} })
  })

  it("navigate without params stores empty params", () => {
    const store = useViewStore.getState()
    store.navigate("client.dashboard")

    const state = useViewStore.getState()
    expect(state.view).toBe("client.dashboard")
    expect(state.params).toEqual({})
  })

  it("back restores previous view", () => {
    const store = useViewStore.getState()
    store.navigate("client.dashboard")
    store.navigate("client.bookings")

    // Should be on bookings now
    expect(useViewStore.getState().view).toBe("client.bookings")

    // Go back once
    useViewStore.getState().back()
    expect(useViewStore.getState().view).toBe("client.dashboard")

    // Go back again
    useViewStore.getState().back()
    expect(useViewStore.getState().view).toBe("vitrine")
  })

  it("back does nothing when history is empty", () => {
    const store = useViewStore.getState()
    store.back()

    const state = useViewStore.getState()
    expect(state.view).toBe("vitrine")
    expect(state.history).toHaveLength(0)
  })

  it("reset clears history and sets view", () => {
    const store = useViewStore.getState()
    store.navigate("client.dashboard")
    store.reset("vitrine")

    const state = useViewStore.getState()
    expect(state.view).toBe("vitrine")
    expect(state.history).toHaveLength(0)
  })

  it("reset defaults to vitrine", () => {
    const store = useViewStore.getState()
    store.navigate("client.dashboard")
    store.reset()

    expect(useViewStore.getState().view).toBe("vitrine")
  })

  it("canGoBack returns false when history is empty", () => {
    expect(useViewStore.getState().canGoBack()).toBe(false)
  })

  it("canGoBack returns true when history is not empty", () => {
    useViewStore.getState().navigate("client.dashboard")
    expect(useViewStore.getState().canGoBack()).toBe(true)
  })
})
