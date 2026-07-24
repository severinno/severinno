/**
 * Accessibility (axe-core) tests for MuteIndicator and VibrationIndicator.
 *
 * Tests both enabled and disabled states for each indicator, with and
 * without the showLabel prop.
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { axe } from "vitest-axe"

// ---- Mocks -----------------------------------------------------------------

vi.mock("@/lib/sound-context", () => ({
  useSoundEnabledPreference: vi.fn(() => true),
  useVibrateEnabledPreference: vi.fn(() => true),
}))

vi.mock("lucide-react", () => ({
  Volume2: (p: any) => <span data-testid="icon-volume2" {...p} />,
  VolumeX: (p: any) => <span data-testid="icon-volumex" {...p} />,
  Smartphone: (p: any) => <span data-testid="icon-smartphone" {...p} />,
}))

vi.mock("@/lib/utils", () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(" "),
}))

// ---- SUT imports (must be after vi.mock) -----------------------------------
import { MuteIndicator } from "../mute-indicator"
import { VibrationIndicator } from "../vibration-indicator"

afterEach(cleanup)

// ============================================================================
// MuteIndicator
// ============================================================================

describe("MuteIndicator — accessibility", () => {
  it("has no axe violations when sound is enabled (default)", async () => {
    const { container } = render(<MuteIndicator />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when sound is enabled with label", async () => {
    const { container } = render(<MuteIndicator showLabel />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when sound is disabled", async () => {
    const soundCtx = await import("@/lib/sound-context")
    vi.mocked(soundCtx.useSoundEnabledPreference).mockReturnValueOnce(false)
    const { container } = render(<MuteIndicator />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when sound is disabled with label", async () => {
    const soundCtx = await import("@/lib/sound-context")
    vi.mocked(soundCtx.useSoundEnabledPreference).mockReturnValueOnce(false)
    const { container } = render(<MuteIndicator showLabel />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})

// ============================================================================
// VibrationIndicator
// ============================================================================

describe("VibrationIndicator — accessibility", () => {
  it("has no axe violations when vibration is enabled (default)", async () => {
    const { container } = render(<VibrationIndicator />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when vibration is enabled with label", async () => {
    const { container } = render(<VibrationIndicator showLabel />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when vibration is disabled", async () => {
    const soundCtx = await import("@/lib/sound-context")
    vi.mocked(soundCtx.useVibrateEnabledPreference).mockReturnValueOnce(false)
    const { container } = render(<VibrationIndicator />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when vibration is disabled with label", async () => {
    const soundCtx = await import("@/lib/sound-context")
    vi.mocked(soundCtx.useVibrateEnabledPreference).mockReturnValueOnce(false)
    const { container } = render(<VibrationIndicator showLabel />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
