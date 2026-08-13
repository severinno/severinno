/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest"
import { reducer } from "../use-toast"

const initialState = { toasts: [] }

describe("toast reducer", () => {
  it("adds a toast", () => {
    const state = reducer(initialState, {
      type: "ADD_TOAST",
      toast: { id: "1", title: "Test", open: true } as any,
    })
    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0].title).toBe("Test")
  })

  it("limits toasts to 1", () => {
    let state = reducer(initialState, {
      type: "ADD_TOAST",
      toast: { id: "1", title: "First", open: true } as any,
    })
    state = reducer(state, {
      type: "ADD_TOAST",
      toast: { id: "2", title: "Second", open: true } as any,
    })
    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0].title).toBe("Second")
  })

  it("updates a toast", () => {
    let state = reducer(initialState, {
      type: "ADD_TOAST",
      toast: { id: "1", title: "Original", open: true } as any,
    })
    state = reducer(state, {
      type: "UPDATE_TOAST",
      toast: { id: "1", title: "Updated" } as any,
    })
    expect(state.toasts[0].title).toBe("Updated")
  })

  it("dismisses a specific toast by id", () => {
    const state = reducer(
      { toasts: [{ id: "1", title: "A", open: true } as any] },
      { type: "DISMISS_TOAST", toastId: "1" },
    )
    expect(state.toasts[0].open).toBe(false)
  })

  it("dismisses all toasts when no id provided", () => {
    const state = reducer(
      { toasts: [{ id: "1", open: true } as any, { id: "2", open: true } as any] },
      { type: "DISMISS_TOAST" },
    )
    expect(state.toasts.every((t) => t.open === false)).toBe(true)
  })

  it("removes a specific toast by id", () => {
    const state = reducer(
      { toasts: [{ id: "1", title: "A" } as any, { id: "2", title: "B" } as any] },
      { type: "REMOVE_TOAST", toastId: "1" },
    )
    expect(state.toasts).toHaveLength(1)
    expect(state.toasts[0].id).toBe("2")
  })

  it("removes all toasts when no id provided", () => {
    const state = reducer(
      { toasts: [{ id: "1" } as any, { id: "2" } as any] },
      { type: "REMOVE_TOAST" },
    )
    expect(state.toasts).toHaveLength(0)
  })
})
