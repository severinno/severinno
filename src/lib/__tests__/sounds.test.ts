/**
 * Tests for the sound effect functions in sounds.ts.
 *
 * These tests verify that all sound functions handle unavailable or
 * throwing APIs gracefully — specifically `navigator.vibrate` (not
 * available in most desktop browsers) and `AudioContext` (not available
 * in jsdom).
 *
 * The try/catch guards in each function mean they should NEVER throw,
 * even when called in environments without audio/vibration support.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  playCoinSound,
  playCompletionSound,
  playReviewSound,
  playErrorSound,
  playWelcomeSound,
} from "../sounds"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Save the original navigator.vibrate so we can restore it. */
const originalVibrate = navigator.vibrate

beforeEach(() => {
  // jsdom may or may not have navigator.vibrate — ensure it's removed
  // so we explicitly test the "not available" path.
  delete (navigator as Record<string, unknown>).vibrate
})

afterEach(() => {
  // Restore original if it existed, otherwise clean up
  if (originalVibrate) {
    ;(navigator as Record<string, unknown>).vibrate = originalVibrate
  } else {
    delete (navigator as Record<string, unknown>).vibrate
  }
})

// ---------------------------------------------------------------------------
// Tests: navigator.vibrate does NOT exist
// ---------------------------------------------------------------------------

describe("sound functions without navigator.vibrate", () => {
  it("playCoinSound does not throw when navigator.vibrate is undefined", () => {
    expect(() => playCoinSound()).not.toThrow()
  })

  it("playCompletionSound does not throw when navigator.vibrate is undefined", () => {
    expect(() => playCompletionSound()).not.toThrow()
  })

  it("playReviewSound does not throw when navigator.vibrate is undefined", () => {
    expect(() => playReviewSound()).not.toThrow()
  })

  it("playErrorSound does not throw when navigator.vibrate is undefined", () => {
    expect(() => playErrorSound()).not.toThrow()
  })

  it("playWelcomeSound does not throw when navigator.vibrate is undefined", () => {
    expect(() => playWelcomeSound()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: navigator.vibrate exists
// ---------------------------------------------------------------------------

describe("sound functions with navigator.vibrate", () => {
  beforeEach(() => {
    // Set up navigator.vibrate as a mock function
    ;(navigator as Record<string, unknown>).vibrate = vi.fn()
  })

  it("playCoinSound calls navigator.vibrate with coin pattern", () => {
    playCoinSound()
    expect(navigator.vibrate).toHaveBeenCalledWith([30, 50, 30, 50, 30])
  })

  it("playCompletionSound calls navigator.vibrate with completion pattern", () => {
    playCompletionSound()
    expect(navigator.vibrate).toHaveBeenCalledWith([80])
  })

  it("playReviewSound calls navigator.vibrate with review pattern", () => {
    playReviewSound()
    expect(navigator.vibrate).toHaveBeenCalledWith([20, 30, 20, 30, 20])
  })

  it("playErrorSound calls navigator.vibrate with error pattern", () => {
    playErrorSound()
    expect(navigator.vibrate).toHaveBeenCalledWith([40, 60, 40])
  })

  it("playWelcomeSound calls navigator.vibrate with welcome pattern", () => {
    playWelcomeSound()
    expect(navigator.vibrate).toHaveBeenCalledWith([40, 50, 50, 60])
  })
})

// ---------------------------------------------------------------------------
// Tests: navigator.vibrate throws
// ---------------------------------------------------------------------------

describe("tryVibrate when navigator.vibrate throws", () => {
  beforeEach(() => {
    // navigator.vibrate throws an error (unlikely but demonstrates guard)
    ;(navigator as Record<string, unknown>).vibrate = vi.fn(() => {
      throw new Error("vibration failed")
    })
  })

  it("playCoinSound does not throw when navigator.vibrate throws", () => {
    expect(() => playCoinSound()).not.toThrow()
  })

  it("playCompletionSound does not throw when navigator.vibrate throws", () => {
    expect(() => playCompletionSound()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: navigator is not available (SSR guard)
// ---------------------------------------------------------------------------

describe("SSR guard (navigator undefined)", () => {
  const originalNavigator = globalThis.navigator

  beforeEach(() => {
    // Simulate SSR environment where navigator is undefined
    delete (globalThis as Record<string, unknown>).navigator
  })

  afterEach(() => {
    ;(globalThis as Record<string, unknown>).navigator = originalNavigator
  })

  it("playCoinSound does not throw when navigator is undefined", () => {
    expect(() => playCoinSound()).not.toThrow()
  })

  it("playReviewSound does not throw when navigator is undefined", () => {
    expect(() => playReviewSound()).not.toThrow()
  })
})
