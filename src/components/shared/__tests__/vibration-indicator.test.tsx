/**
 * Tests for VibrationIndicator — displays vibration-enabled state.
 *
 * Mocks `useVibrateEnabledPreference` with a controllable variable to
 * test all three states: true, false, and undefined (default enabled).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

// ---- Mock lucide-react Smartphone icon --------------------------------------
vi.mock("lucide-react", () => {
  const MockSvg = (props: Record<string, unknown>) =>
    <svg aria-hidden="true" className="lucide-smartphone" {...props} />
  return { Smartphone: MockSvg }
})

// ---- Dynamic mock for useVibrateEnabledPreference --------------------------
let mockVibrateEnabled: boolean | undefined = true

vi.mock("@/lib/sound-context", () => ({
  useVibrateEnabledPreference: vi.fn(() => mockVibrateEnabled),
}))

// ---- SUT import (must be after vi.mock) ------------------------------------
import React from "react"
import { VibrationIndicator } from "../vibration-indicator"

beforeEach(() => {
  vi.clearAllMocks()
  mockVibrateEnabled = true
})

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VibrationIndicator", () => {
  it("renders the Smartphone icon", () => {
    const { container } = render(<VibrationIndicator />)
    // Lucide Smartphone renders an <svg> with aria-hidden
    const svg = container.querySelector("svg")
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute("aria-hidden", "true")
  })

  it("shows 'Vibração ativada' title when enabled (true)", () => {
    mockVibrateEnabled = true
    render(<VibrationIndicator />)
    const span = screen.getByTitle("Vibração ativada")
    expect(span).toBeInTheDocument()
    expect(span).toHaveAttribute("aria-label", "Vibração ativada")
  })

  it("shows 'Vibração desativada' title when disabled (false)", () => {
    mockVibrateEnabled = false
    render(<VibrationIndicator />)
    const span = screen.getByTitle("Vibração desativada")
    expect(span).toBeInTheDocument()
    expect(span).toHaveAttribute("aria-label", "Vibração desativada")
  })

  it("shows 'Vibração ativada' when vibrateEnabled is undefined (default)", () => {
    mockVibrateEnabled = undefined
    render(<VibrationIndicator />)
    const span = screen.getByTitle("Vibração ativada")
    expect(span).toBeInTheDocument()
  })

  it("has aria-live='polite' for screen reader announcements", () => {
    render(<VibrationIndicator />)
    expect(screen.getByTitle("Vibração ativada")).toHaveAttribute(
      "aria-live",
      "polite",
    )
  })

  it("does NOT show label text when showLabel is not passed", () => {
    render(<VibrationIndicator />)
    expect(screen.queryByText(/Vibração/)).not.toBeInTheDocument()
  })

  it("shows label text when showLabel is true (enabled state)", () => {
    mockVibrateEnabled = true
    render(<VibrationIndicator showLabel />)
    expect(screen.getByText("Vibração ativada")).toBeInTheDocument()
  })

  it("shows label text when showLabel is true (disabled state)", () => {
    mockVibrateEnabled = false
    render(<VibrationIndicator showLabel />)
    expect(screen.getByText("Vibração desativada")).toBeInTheDocument()
  })

  it("forwards className to the wrapper span", () => {
    const { container } = render(
      <VibrationIndicator className="custom-class" />,
    )
    // The wrapper is a span directly rendered
    const span = container.querySelector("span")
    expect(span?.className).toContain("custom-class")
  })

  it("adds opacity-50 class when disabled (false)", () => {
    mockVibrateEnabled = false
    const { container } = render(<VibrationIndicator />)
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("class")).toContain("opacity-50")
  })

  it("does NOT add opacity-50 when enabled (true)", () => {
    mockVibrateEnabled = true
    const { container } = render(<VibrationIndicator />)
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("class")).not.toContain("opacity-50")
  })

  it("does NOT add opacity-50 when vibrateEnabled is undefined", () => {
    mockVibrateEnabled = undefined
    const { container } = render(<VibrationIndicator />)
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("class")).not.toContain("opacity-50")
  })
})
