// @ts-nocheck
/**
 * Tests for useBalancePulse — tracks balance increases and triggers a
 * temporary "pulsing" flag + optional onIncrease callback.
 *
 * Key behaviors to cover:
 *  - Seeds silently when balance is undefined (first load)
 *  - Seeds silently on first non-undefined value
 *  - Pulses + calls onIncrease when balance goes up
 *  - Silent ref update when balance goes down or stays same
 *  - onIncrease called exactly once per increase
 *  - Custom pulseMs duration
 *  - Timer cleanup on unmount
 *  - Multiple rapid increases cancel previous timer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@/__tests__/test-utils"

import { useBalancePulse } from "../use-balance-pulse"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useBalancePulse", () => {
  // ── Initial state ───────────────────────────────────────────────────────

  it("returns isPulsing = false initially", () => {
    const { result } = renderHook(() => useBalancePulse(undefined))

    expect(result.current.isPulsing).toBe(false)
  })

  // ── Seed behaviour ──────────────────────────────────────────────────────

  it("does NOT pulse when balance goes from undefined to a value (first load)", () => {
    const onIncrease = vi.fn()
    const { result, rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal, onIncrease),
      { initialProps: { bal: undefined } },
    )

    rerender({ bal: 100 } as any)

    expect(result.current.isPulsing).toBe(false)
    expect(onIncrease).not.toHaveBeenCalled()
  })

  it("does NOT pulse on the very first non-undefined balance (seed)", () => {
    const onIncrease = vi.fn()
    const { result } = renderHook(() => useBalancePulse(50, onIncrease))

    expect(result.current.isPulsing).toBe(false)
    expect(onIncrease).not.toHaveBeenCalled()
  })

  // ── Increase → pulse + callback ─────────────────────────────────────────

  it("pulses when balance increases", () => {
    const onIncrease = vi.fn()
    const { result, rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal, onIncrease),
      { initialProps: { bal: 0 } },
    )

    rerender({ bal: 100 })

    expect(result.current.isPulsing).toBe(true)
    expect(onIncrease).toHaveBeenCalledTimes(1)
  })

  it("resets isPulsing to false after pulseMs (default 800ms)", () => {
    const { result, rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal),
      { initialProps: { bal: 0 } },
    )

    rerender({ bal: 100 })
    expect(result.current.isPulsing).toBe(true)

    // Advance past the default 800ms pulse duration inside act()
    act(() => {
      vi.advanceTimersByTime(800)
    })

    expect(result.current.isPulsing).toBe(false)
  })

  it("does NOT call onIncrease for same balance", () => {
    const onIncrease = vi.fn()
    const { rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal, onIncrease),
      { initialProps: { bal: 50 } },
    )

    rerender({ bal: 50 })
    rerender({ bal: 50 })
    rerender({ bal: 50 })

    expect(onIncrease).not.toHaveBeenCalled()
  })

  // ── Decrease → silent ───────────────────────────────────────────────────

  it("does NOT pulse when balance decreases", () => {
    const onIncrease = vi.fn()
    const { result, rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal, onIncrease),
      { initialProps: { bal: 100 } },
    )

    rerender({ bal: 50 })

    expect(result.current.isPulsing).toBe(false)
    expect(onIncrease).not.toHaveBeenCalled()
  })

  it("can pulse again after a decrease (increase from new lower base)", () => {
    const onIncrease = vi.fn()
    const { result, rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal, onIncrease),
      { initialProps: { bal: 100 } },
    )

    // Decrease → silent
    rerender({ bal: 50 })
    expect(onIncrease).not.toHaveBeenCalled()

    // New increase from 50 → 150 → should pulse
    rerender({ bal: 150 })
    expect(result.current.isPulsing).toBe(true)
    expect(onIncrease).toHaveBeenCalledTimes(1)
  })

  // ── Multiple increases ──────────────────────────────────────────────────

  it("calls onIncrease for each increase, not just the first", () => {
    const onIncrease = vi.fn()
    const { result, rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal, onIncrease),
      { initialProps: { bal: 0 } },
    )

    rerender({ bal: 50 })
    expect(onIncrease).toHaveBeenCalledTimes(1)

    // Reset pulse timer so next increase doesn't overlap
    act(() => {
      vi.advanceTimersByTime(800)
    })
    // isPulsing should now be false
    expect(result.current.isPulsing).toBe(false)

    rerender({ bal: 100 })
    expect(onIncrease).toHaveBeenCalledTimes(2)

    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(result.current.isPulsing).toBe(false)

    rerender({ bal: 200 })
    expect(onIncrease).toHaveBeenCalledTimes(3)
  })

  it("restarts the pulse timer if balance increases again while already pulsing", () => {
    const onIncrease = vi.fn()
    const { result, rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal, onIncrease),
      { initialProps: { bal: 0 } },
    )

    // First increase → pulse starts
    rerender({ bal: 100 })
    expect(onIncrease).toHaveBeenCalledTimes(1)
    expect(result.current.isPulsing).toBe(true)

    // Second increase before timer expires → timer restarts
    act(() => {
      vi.advanceTimersByTime(400)
    }) // half of 800ms
    rerender({ bal: 200 })
    expect(onIncrease).toHaveBeenCalledTimes(2)
    expect(result.current.isPulsing).toBe(true)

    // If the old timer had not been cleared, isPulsing would reset now
    // (800ms from first increase). But since it was restarted ~400ms ago,
    // isPulsing should stay true for another ~400ms.
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(result.current.isPulsing).toBe(true) // still pulsing (new timer)

    // Advance past the new timer (800ms from second increase)
    act(() => {
      vi.advanceTimersByTime(400 + 50)
    })
    expect(result.current.isPulsing).toBe(false)
  })

  // ── Custom pulseMs ──────────────────────────────────────────────────────

  it("accepts custom pulseMs duration", () => {
    const { result, rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal, undefined, 300),
      { initialProps: { bal: 0 } },
    )

    rerender({ bal: 100 })
    expect(result.current.isPulsing).toBe(true)

    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(result.current.isPulsing).toBe(true) // still pulsing

    act(() => {
      vi.advanceTimersByTime(100)
    }) // 350ms total → past 300ms
    expect(result.current.isPulsing).toBe(false)
  })

  // ── No onIncrease provided ──────────────────────────────────────────────

  it("works without onIncrease callback (pulse still fires)", () => {
    const { result, rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal),
      { initialProps: { bal: 0 } },
    )

    rerender({ bal: 100 })

    expect(result.current.isPulsing).toBe(true)
  })

  // ── undefined stays undefined ───────────────────────────────────────────

  it("never pulses if balance stays undefined", () => {
    const onIncrease = vi.fn()
    const { result, rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal, onIncrease),
      { initialProps: { bal: undefined } },
    )

    rerender({ bal: undefined })
    rerender({ bal: undefined })

    expect(result.current.isPulsing).toBe(false)
    expect(onIncrease).not.toHaveBeenCalled()
  })

  // ── Cleanup on unmount ──────────────────────────────────────────────────

  it("cleans up the pulse timer on unmount", () => {
    const onIncrease = vi.fn()
    const { result, rerender, unmount } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal, onIncrease),
      { initialProps: { bal: 0 } },
    )

    rerender({ bal: 100 })
    expect(result.current.isPulsing).toBe(true)

    // Unmount while pulsing — timer should be cleaned up
    unmount()

    // Advance past the pulse duration — no crash expected
    vi.advanceTimersByTime(2000)
  })

  // ── onIncrease is called exactly at the right time ──────────────────────

  it("calls onIncrease synchronously when balance increases", () => {
    const onIncrease = vi.fn()
    const { rerender } = renderHook(
      ({ bal }: { bal: number | undefined }) => useBalancePulse(bal, onIncrease),
      { initialProps: { bal: 0 } },
    )

    rerender({ bal: 100 })

    // onIncrease must have been called during the render, not after a timeout
    expect(onIncrease).toHaveBeenCalledTimes(1)
  })
})
