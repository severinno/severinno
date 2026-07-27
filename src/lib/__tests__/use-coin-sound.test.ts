import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"

// ---- Dynamic mock for useSoundEnabledPreference ----------------------------
const mockSoundEnabled = vi.hoisted(() => ({ current: true as boolean | undefined }))

vi.mock("@/lib/sound-context", () => ({
  useSoundEnabledPreference: vi.fn(() => mockSoundEnabled.current),
  useVibrateEnabledPreference: vi.fn(() => true),
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: vi.fn(),
  playCompletionSound: vi.fn(),
  playReviewSound: vi.fn(),
  playErrorSound: vi.fn(),
  playWelcomeSound: vi.fn(),
}))

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn(
    (selector?: (s: { user: { soundEnabled?: boolean } | null }) => unknown) => {
      const state = {
        user:
          mockSoundEnabled.current === undefined
            ? null
            : { soundEnabled: mockSoundEnabled.current },
      }
      return selector ? selector(state) : state
    },
  ),
}))

// ---------------------------------------------------------------------------
// SUT — import must be after vi.mock calls
// ---------------------------------------------------------------------------

import {
  useCoinSound,
  useTransactionNotificationSound,
  useWelcomeSound,
  resetWelcomeSound,
} from "../use-coin-sound"
import * as sounds from "@/lib/sounds"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type NotifItem = { id: string; type: string }

const TX_CONFIRMED: NotifItem = { id: "1", type: "BOOKING_CONFIRMED" }
const TX_COMPLETED: NotifItem = { id: "2", type: "BOOKING_COMPLETED" }
const TX_QUOTE: NotifItem = { id: "3", type: "QUOTE_APPROVED" }
const NON_TX: NotifItem = { id: "4", type: "MESSAGE" }
const REVIEW_RX: NotifItem = { id: "5", type: "REVIEW_RECEIVED" }
const TX_CANCELLED: NotifItem = { id: "6", type: "BOOKING_CANCELLED" }

beforeEach(() => {
  vi.clearAllMocks()
  mockSoundEnabled.current = true
})

// ---------------------------------------------------------------------------
// useCoinSound
// ---------------------------------------------------------------------------

describe("useCoinSound", () => {
  it("returns playCoin, playCompletion, playReview, playError, and soundEnabled", () => {
    const { result } = renderHook(() => useCoinSound())

    expect(result.current).toHaveProperty("playCoin")
    expect(result.current).toHaveProperty("playCompletion")
    expect(result.current).toHaveProperty("playReview")
    expect(result.current).toHaveProperty("playError")
    expect(result.current).toHaveProperty("soundEnabled")
    expect(typeof result.current.playCoin).toBe("function")
    expect(typeof result.current.playCompletion).toBe("function")
    expect(typeof result.current.playReview).toBe("function")
    expect(typeof result.current.playError).toBe("function")
  })

  it("playCoin calls playCoinSound when soundEnabled is true", () => {
    mockSoundEnabled.current = true
    const { result } = renderHook(() => useCoinSound())

    result.current.playCoin()

    expect(sounds.playCoinSound).toHaveBeenCalledTimes(1)
    expect(sounds.playCompletionSound).not.toHaveBeenCalled()
  })

  it("playCoin calls playCoinSound when soundEnabled is undefined", () => {
    mockSoundEnabled.current = undefined
    const { result } = renderHook(() => useCoinSound())

    result.current.playCoin()

    expect(sounds.playCoinSound).toHaveBeenCalledTimes(1)
  })

  it("playCoin does NOT call playCoinSound when soundEnabled is false", () => {
    mockSoundEnabled.current = false
    const { result } = renderHook(() => useCoinSound())

    result.current.playCoin()

    expect(sounds.playCoinSound).not.toHaveBeenCalled()
  })

  it("playCompletion calls playCompletionSound when soundEnabled is true", () => {
    mockSoundEnabled.current = true
    const { result } = renderHook(() => useCoinSound())

    result.current.playCompletion()

    expect(sounds.playCompletionSound).toHaveBeenCalledTimes(1)
    expect(sounds.playCoinSound).not.toHaveBeenCalled()
  })

  it("playCompletion does NOT call playCompletionSound when soundEnabled is false", () => {
    mockSoundEnabled.current = false
    const { result } = renderHook(() => useCoinSound())

    result.current.playCompletion()

    expect(sounds.playCompletionSound).not.toHaveBeenCalled()
  })

  it("playReview calls playReviewSound when soundEnabled is true", () => {
    mockSoundEnabled.current = true
    const { result } = renderHook(() => useCoinSound())

    result.current.playReview()

    expect(sounds.playReviewSound).toHaveBeenCalledTimes(1)
    expect(sounds.playCoinSound).not.toHaveBeenCalled()
  })

  it("playReview does NOT call playReviewSound when soundEnabled is false", () => {
    mockSoundEnabled.current = false
    const { result } = renderHook(() => useCoinSound())

    result.current.playReview()

    expect(sounds.playReviewSound).not.toHaveBeenCalled()
  })

  it("playError calls playErrorSound when soundEnabled is true", () => {
    mockSoundEnabled.current = true
    const { result } = renderHook(() => useCoinSound())

    result.current.playError()

    expect(sounds.playErrorSound).toHaveBeenCalledTimes(1)
    expect(sounds.playCoinSound).not.toHaveBeenCalled()
  })

  it("playError does NOT call playErrorSound when soundEnabled is false", () => {
    mockSoundEnabled.current = false
    const { result } = renderHook(() => useCoinSound())

    result.current.playError()

    expect(sounds.playErrorSound).not.toHaveBeenCalled()
  })

  it("playCoin reflects soundEnabled preference changes via rerender", () => {
    mockSoundEnabled.current = true
    const { result, rerender } = renderHook(() => useCoinSound())

    result.current.playCoin()
    expect(sounds.playCoinSound).toHaveBeenCalledTimes(1)

    // Disable — callback should now be a no-op
    mockSoundEnabled.current = false
    rerender()
    result.current.playCoin()
    expect(sounds.playCoinSound).toHaveBeenCalledTimes(1) // no additional call

    // Re-enable
    mockSoundEnabled.current = true
    rerender()
    result.current.playCoin()
    expect(sounds.playCoinSound).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// useTransactionNotificationSound
// ---------------------------------------------------------------------------

describe("useTransactionNotificationSound", () => {
  it("seeds silently on first load — no sound triggered", () => {
    mockSoundEnabled.current = true
    renderHook(() => useTransactionNotificationSound([TX_CONFIRMED], "PROVIDER"))

    expect(sounds.playCoinSound).not.toHaveBeenCalled()
    expect(sounds.playCompletionSound).not.toHaveBeenCalled()
  })

  it("plays coin sound when a new transaction notification appears", () => {
    mockSoundEnabled.current = true

    const { rerender } = renderHook(
      ({ items, role }: { items: NotifItem[]; role?: string | null }) =>
        useTransactionNotificationSound(items, role),
      { initialProps: { items: [TX_CONFIRMED], role: "PROVIDER" } },
    )

    // First render: seed silently
    expect(sounds.playCoinSound).not.toHaveBeenCalled()

    // Same items again — still no new notification
    rerender({ items: [TX_CONFIRMED], role: "PROVIDER" })
    expect(sounds.playCoinSound).not.toHaveBeenCalled()

    // New notification arrives
    rerender({ items: [TX_CONFIRMED, { id: "10", type: "BOOKING_CONFIRMED" }], role: "PROVIDER" })
    expect(sounds.playCoinSound).toHaveBeenCalledTimes(1)
    expect(sounds.playCompletionSound).not.toHaveBeenCalled()
  })

  it("plays completion sound for BOOKING_COMPLETED when role is CLIENT", () => {
    mockSoundEnabled.current = true

    const { rerender } = renderHook(
      ({ items, role }: { items: NotifItem[]; role?: string | null }) =>
        useTransactionNotificationSound(items, role),
      { initialProps: { items: [TX_CONFIRMED], role: "CLIENT" } },
    )

    rerender({ items: [TX_CONFIRMED, TX_COMPLETED], role: "CLIENT" })
    expect(sounds.playCompletionSound).toHaveBeenCalledTimes(1)
    expect(sounds.playCoinSound).not.toHaveBeenCalled()
  })

  it("plays coin sound for BOOKING_COMPLETED when role is PROVIDER (not CLIENT)", () => {
    mockSoundEnabled.current = true

    const { rerender } = renderHook(
      ({ items, role }: { items: NotifItem[]; role?: string | null }) =>
        useTransactionNotificationSound(items, role),
      { initialProps: { items: [TX_CONFIRMED], role: "PROVIDER" } },
    )

    rerender({ items: [TX_CONFIRMED, TX_COMPLETED], role: "PROVIDER" })
    expect(sounds.playCoinSound).toHaveBeenCalledTimes(1)
    expect(sounds.playCompletionSound).not.toHaveBeenCalled()
  })

  it("plays coin sound for QUOTE_APPROVED regardless of role", () => {
    mockSoundEnabled.current = true

    const { rerender } = renderHook(
      ({ items, role }: { items: NotifItem[]; role?: string | null }) =>
        useTransactionNotificationSound(items, role),
      { initialProps: { items: [TX_CONFIRMED], role: "PROVIDER" } },
    )

    rerender({ items: [TX_CONFIRMED, TX_QUOTE], role: "PROVIDER" })
    expect(sounds.playCoinSound).toHaveBeenCalledTimes(1)
    expect(sounds.playCompletionSound).not.toHaveBeenCalled()
  })

  it("ignores truly non-matching notification types (MESSAGE)", () => {
    mockSoundEnabled.current = true

    const { rerender } = renderHook(
      ({ items, role }: { items: NotifItem[]; role?: string | null }) =>
        useTransactionNotificationSound(items, role),
      { initialProps: { items: [NON_TX], role: "PROVIDER" } },
    )

    rerender({ items: [NON_TX, { id: "20", type: "WELCOME" }], role: "PROVIDER" })
    expect(sounds.playCoinSound).not.toHaveBeenCalled()
    expect(sounds.playCompletionSound).not.toHaveBeenCalled()
    expect(sounds.playReviewSound).not.toHaveBeenCalled()
  })

  it("silences all sound when role is ADMIN", () => {
    mockSoundEnabled.current = true

    const { rerender } = renderHook(
      ({ items, role }: { items: NotifItem[]; role?: string | null }) =>
        useTransactionNotificationSound(items, role),
      { initialProps: { items: [TX_CONFIRMED], role: "ADMIN" } },
    )

    // New notification for ADMIN — should not play
    rerender({ items: [TX_CONFIRMED, { id: "30", type: "BOOKING_CONFIRMED" }], role: "ADMIN" })
    expect(sounds.playCoinSound).not.toHaveBeenCalled()
  })

  it("plays only ONE sound per batch even if multiple new notifications match", () => {
    mockSoundEnabled.current = true

    const { rerender } = renderHook(
      ({ items, role }: { items: NotifItem[]; role?: string | null }) =>
        useTransactionNotificationSound(items, role),
      { initialProps: { items: [TX_CONFIRMED], role: "PROVIDER" } },
    )

    // Three new transaction notifications at once — only first should trigger
    rerender({
      items: [TX_CONFIRMED, TX_COMPLETED, TX_QUOTE],
      role: "PROVIDER",
    })
    expect(sounds.playCoinSound).toHaveBeenCalledTimes(1)
    expect(sounds.playCompletionSound).not.toHaveBeenCalled()
  })

  it("does not sound on re-render with the same items", () => {
    mockSoundEnabled.current = true

    const { rerender } = renderHook(
      ({ items, role }: { items: NotifItem[]; role?: string | null }) =>
        useTransactionNotificationSound(items, role),
      { initialProps: { items: [TX_CONFIRMED], role: "PROVIDER" } },
    )

    rerender({ items: [TX_CONFIRMED], role: "PROVIDER" })
    rerender({ items: [TX_CONFIRMED], role: "PROVIDER" })
    rerender({ items: [TX_CONFIRMED], role: "PROVIDER" })

    expect(sounds.playCoinSound).not.toHaveBeenCalled()
  })

  it("plays review sound for REVIEW_RECEIVED notification", () => {
    mockSoundEnabled.current = true

    const { rerender } = renderHook(
      ({ items, role }: { items: NotifItem[]; role?: string | null }) =>
        useTransactionNotificationSound(items, role),
      { initialProps: { items: [TX_CONFIRMED], role: "PROVIDER" } },
    )

    rerender({ items: [TX_CONFIRMED, REVIEW_RX], role: "PROVIDER" })
    expect(sounds.playReviewSound).toHaveBeenCalledTimes(1)
    expect(sounds.playCoinSound).not.toHaveBeenCalled()
    expect(sounds.playCompletionSound).not.toHaveBeenCalled()
  })

  it("plays error sound for BOOKING_CANCELLED notification", () => {
    mockSoundEnabled.current = true

    const { rerender } = renderHook(
      ({ items, role }: { items: NotifItem[]; role?: string | null }) =>
        useTransactionNotificationSound(items, role),
      { initialProps: { items: [TX_CONFIRMED], role: "PROVIDER" } },
    )

    rerender({ items: [TX_CONFIRMED, TX_CANCELLED], role: "PROVIDER" })
    expect(sounds.playErrorSound).toHaveBeenCalledTimes(1)
    expect(sounds.playCoinSound).not.toHaveBeenCalled()
    expect(sounds.playCompletionSound).not.toHaveBeenCalled()
    expect(sounds.playReviewSound).not.toHaveBeenCalled()
  })

  it("resets seed when switching away from ADMIN and back", () => {
    mockSoundEnabled.current = true

    const { rerender } = renderHook(
      ({ items, role }: { items: NotifItem[]; role?: string | null }) =>
        useTransactionNotificationSound(items, role),
      { initialProps: { items: [TX_CONFIRMED], role: "ADMIN" } },
    )

    // Switch to PROVIDER — first render seeds silently
    rerender({ items: [TX_CONFIRMED], role: "PROVIDER" })
    expect(sounds.playCoinSound).not.toHaveBeenCalled()

    // New notification arrives — should play now
    rerender({ items: [TX_CONFIRMED, { id: "40", type: "BOOKING_CONFIRMED" }], role: "PROVIDER" })
    expect(sounds.playCoinSound).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// useWelcomeSound
// ---------------------------------------------------------------------------

describe("useWelcomeSound", () => {
  beforeEach(() => {
    // Clear localStorage flag before each test
    resetWelcomeSound()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("plays welcome sound on first mount when not played before", () => {
    mockSoundEnabled.current = true
    renderHook(() => useWelcomeSound())

    // After 600ms delay, should play
    vi.advanceTimersByTime(600)

    expect(sounds.playWelcomeSound).toHaveBeenCalledTimes(1)
  })

  it("does NOT play welcome sound on second mount (already played)", () => {
    mockSoundEnabled.current = true

    // First mount — marks as played
    const { unmount } = renderHook(() => useWelcomeSound())
    vi.advanceTimersByTime(600)
    expect(sounds.playWelcomeSound).toHaveBeenCalledTimes(1)
    unmount()

    // Second mount — localStorage says already played
    renderHook(() => useWelcomeSound())
    vi.advanceTimersByTime(600)
    expect(sounds.playWelcomeSound).toHaveBeenCalledTimes(1) // no additional call
  })

  it("does NOT play welcome sound when soundEnabled is false", () => {
    mockSoundEnabled.current = false
    renderHook(() => useWelcomeSound())

    vi.advanceTimersByTime(600)

    expect(sounds.playWelcomeSound).not.toHaveBeenCalled()
  })

  it("does not play before the 600ms delay", () => {
    mockSoundEnabled.current = true
    renderHook(() => useWelcomeSound())

    // Before 600ms — not yet played
    vi.advanceTimersByTime(300)
    expect(sounds.playWelcomeSound).not.toHaveBeenCalled()

    // Exactly at 600ms
    vi.advanceTimersByTime(300)
    expect(sounds.playWelcomeSound).toHaveBeenCalledTimes(1)
  })

  it("cleans up the timer on unmount", () => {
    mockSoundEnabled.current = true
    const { unmount } = renderHook(() => useWelcomeSound())

    // Unmount before the timer fires
    unmount()
    vi.advanceTimersByTime(600)

    expect(sounds.playWelcomeSound).not.toHaveBeenCalled()
  })
})
