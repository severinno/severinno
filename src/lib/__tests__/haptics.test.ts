import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { triggerHaptic, isHapticSupported, cancelHaptic } from "../haptics"

describe("Haptic Feedback Helper (src/lib/haptics.ts)", () => {
  const originalNavigator = globalThis.navigator

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  it("returns false when navigator.vibrate is not available", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    })

    expect(isHapticSupported()).toBe(false)
    expect(triggerHaptic("light")).toBe(false)
    expect(cancelHaptic()).toBe(false)
  })

  it("calls navigator.vibrate with correct pattern when supported", () => {
    const mockVibrate = vi.fn().mockReturnValue(true)
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate: mockVibrate },
      writable: true,
      configurable: true,
    })

    expect(isHapticSupported()).toBe(true)

    expect(triggerHaptic("light")).toBe(true)
    expect(mockVibrate).toHaveBeenLastCalledWith(10)

    expect(triggerHaptic("medium")).toBe(true)
    expect(mockVibrate).toHaveBeenLastCalledWith(25)

    expect(triggerHaptic("heavy")).toBe(true)
    expect(mockVibrate).toHaveBeenLastCalledWith(50)

    expect(triggerHaptic("selection")).toBe(true)
    expect(mockVibrate).toHaveBeenLastCalledWith(8)

    expect(triggerHaptic("success")).toBe(true)
    expect(mockVibrate).toHaveBeenLastCalledWith([15, 40, 15])

    expect(triggerHaptic("warning")).toBe(true)
    expect(mockVibrate).toHaveBeenLastCalledWith([30, 50, 30])

    expect(triggerHaptic("error")).toBe(true)
    expect(mockVibrate).toHaveBeenLastCalledWith([50, 50, 50, 50, 100])
  })

  it("cancels active vibration by passing 0", () => {
    const mockVibrate = vi.fn().mockReturnValue(true)
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate: mockVibrate },
      writable: true,
      configurable: true,
    })

    expect(cancelHaptic()).toBe(true)
    expect(mockVibrate).toHaveBeenCalledWith(0)
  })

  it("catches and swallows errors thrown by navigator.vibrate gracefully", () => {
    const mockVibrate = vi.fn().mockImplementation(() => {
      throw new Error("Hardware vibration exception")
    })
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate: mockVibrate },
      writable: true,
      configurable: true,
    })

    expect(triggerHaptic("success")).toBe(false)
    expect(cancelHaptic()).toBe(false)
  })
})
