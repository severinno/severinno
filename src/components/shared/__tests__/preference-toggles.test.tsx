/**
 * Unit tests for PreferenceToggles — shared sound & vibration preference component.
 *
 * Covers both variants ("card" and "compact"), initial values, toggle
 * behavior, preview buttons, auto-save via apiPatch, and callbacks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"
import * as React from "react"

// ---- Hoisted shared state (avoids vi.mock hoisting TDZ) --------------------
const { mockApiPatch, mockPlayCoinSound, mockTryVibrate } = vi.hoisted(() => {
  const apiPatch = vi.fn().mockResolvedValue({})
  const playCoinSound = vi.fn()
  const tryVibrate = vi.fn()
  return { mockApiPatch: apiPatch, mockPlayCoinSound: playCoinSound, mockTryVibrate: tryVibrate }
})

vi.mock("@/lib/api", () => ({
  apiPatch: mockApiPatch,
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: mockPlayCoinSound,
  tryVibrate: mockTryVibrate,
}))

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    "aria-label": ariaLabel,
  }: {
    checked?: boolean
    onCheckedChange?: (v: boolean) => void
    "aria-label"?: string
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange?.(!checked)}
      data-testid="switch"
    />
  ),
}))

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>{children}</div>
  ),
  CardContent: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-testid="card-content" className={className}>{children}</div>
  ),
}))

vi.mock("@/components/ui/separator", () => ({
  Separator: ({ className }: { className?: string }) => (
    <hr data-testid="separator" className={className} />
  ),
}))

vi.mock("lucide-react", () => ({
  Play: () => <svg data-testid="icon-play" />,
  Smartphone: () => <svg data-testid="icon-smartphone" />,
  Volume2: () => <svg data-testid="icon-volume" />,
}))

// ---- SUT import (must be after vi.mock) ------------------------------------
import { PreferenceToggles } from "../preference-toggles"

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Variant: card (default)
// ---------------------------------------------------------------------------

describe("PreferenceToggles — card variant", () => {
  it("renders sound toggle with labels", () => {
    render(<PreferenceToggles />)
    expect(screen.getByText("Sons do painel")).toBeDefined()
    expect(screen.getByLabelText("Ativar sons do painel")).toBeDefined()
  })

  it("renders vibration toggle with labels", () => {
    render(<PreferenceToggles />)
    expect(screen.getByText("Vibração")).toBeDefined()
    expect(screen.getByLabelText("Ativar vibração")).toBeDefined()
  })

  it("renders preview buttons for sound and vibration", () => {
    render(<PreferenceToggles />)
    expect(screen.getByTitle("Prévia do som")).toBeDefined()
    expect(screen.getByTitle("Prévia da vibração")).toBeDefined()
    expect(screen.getByLabelText("Ouvir prévia do som")).toBeDefined()
    expect(screen.getByLabelText("Ouvir prévia da vibração")).toBeDefined()
  })

  it("renders Separator between toggles in card variant", () => {
    render(<PreferenceToggles />)
    expect(screen.getByTestId("separator")).toBeDefined()
  })

  it("renders inside a Card in card variant", () => {
    render(<PreferenceToggles />)
    expect(screen.getByTestId("card")).toBeDefined()
    expect(screen.getByTestId("card-content")).toBeDefined()
  })

  it("Switches start checked by default", () => {
    render(<PreferenceToggles />)
    const switches = screen.getAllByRole("switch")
    expect(switches).toHaveLength(2)
    expect(switches[0].getAttribute("aria-checked")).toBe("true")
    expect(switches[1].getAttribute("aria-checked")).toBe("true")
  })

  it("Switches reflect custom initial values", () => {
    render(<PreferenceToggles soundEnabled={false} vibrateEnabled={false} />)
    const switches = screen.getAllByRole("switch")
    expect(switches[0].getAttribute("aria-checked")).toBe("false")
    expect(switches[1].getAttribute("aria-checked")).toBe("false")
  })
})

// ---------------------------------------------------------------------------
// Variant: compact
// ---------------------------------------------------------------------------

describe("PreferenceToggles — compact variant", () => {
  it("renders sound toggle with labels", () => {
    render(<PreferenceToggles variant="compact" />)
    expect(screen.getByText("Sons do painel")).toBeDefined()
    expect(screen.getByLabelText("Ativar sons do painel")).toBeDefined()
  })

  it("renders vibration toggle with labels", () => {
    render(<PreferenceToggles variant="compact" />)
    expect(screen.getByText("Vibração")).toBeDefined()
    expect(screen.getByLabelText("Ativar vibração")).toBeDefined()
  })

  it("renders preview buttons for sound and vibration", () => {
    render(<PreferenceToggles variant="compact" />)
    expect(screen.getByTitle("Prévia do som")).toBeDefined()
    expect(screen.getByTitle("Prévia da vibração")).toBeDefined()
  })

  it("does NOT render Separator in compact variant", () => {
    render(<PreferenceToggles variant="compact" />)
    expect(screen.queryByTestId("separator")).toBeNull()
  })

  it("does NOT render Card in compact variant", () => {
    render(<PreferenceToggles variant="compact" />)
    expect(screen.queryByTestId("card")).toBeNull()
  })

  it("renders toggles as direct children of container in compact variant", () => {
    const { container } = render(<PreferenceToggles variant="compact" />)
    // With a React fragment, children are direct children of the container
    expect(container.children).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Interaction: preview buttons
// ---------------------------------------------------------------------------

describe("PreferenceToggles — preview buttons", () => {
  it("calls playCoinSound when clicking sound preview button", () => {
    render(<PreferenceToggles />)
    fireEvent.click(screen.getByTitle("Prévia do som"))
    expect(mockPlayCoinSound).toHaveBeenCalledTimes(1)
  })

  it("calls tryVibrate when clicking vibration preview button", () => {
    render(<PreferenceToggles />)
    fireEvent.click(screen.getByTitle("Prévia da vibração"))
    expect(mockTryVibrate).toHaveBeenCalledTimes(1)
  })

  it("preview buttons work in compact variant too", () => {
    render(<PreferenceToggles variant="compact" />)
    fireEvent.click(screen.getByTitle("Prévia do som"))
    fireEvent.click(screen.getByTitle("Prévia da vibração"))
    expect(mockPlayCoinSound).toHaveBeenCalledTimes(1)
    expect(mockTryVibrate).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Interaction: Switch toggles
// ---------------------------------------------------------------------------

describe("PreferenceToggles — switch toggles", () => {
  it("toggles sound switch off and calls apiPatch", () => {
    render(<PreferenceToggles />)
    fireEvent.click(screen.getByLabelText("Ativar sons do painel"))
    expect(mockApiPatch).toHaveBeenCalledWith("/api/users/me", {
      soundEnabled: false,
    })
  })

  it("toggles vibration switch off and calls apiPatch", () => {
    render(<PreferenceToggles />)
    fireEvent.click(screen.getByLabelText("Ativar vibração"))
    expect(mockApiPatch).toHaveBeenCalledWith("/api/users/me", {
      vibrateEnabled: false,
    })
  })

  it("toggles sound switch on and calls apiPatch", () => {
    render(<PreferenceToggles soundEnabled={false} />)
    fireEvent.click(screen.getByLabelText("Ativar sons do painel"))
    expect(mockApiPatch).toHaveBeenCalledWith("/api/users/me", {
      soundEnabled: true,
    })
  })

  it("calls onSoundChange callback when toggling sound", () => {
    const onSoundChange = vi.fn()
    render(<PreferenceToggles onSoundChange={onSoundChange} />)
    fireEvent.click(screen.getByLabelText("Ativar sons do painel"))
    expect(onSoundChange).toHaveBeenCalledWith(false)
  })

  it("calls onVibrateChange callback when toggling vibration", () => {
    const onVibrateChange = vi.fn()
    render(<PreferenceToggles onVibrateChange={onVibrateChange} />)
    fireEvent.click(screen.getByLabelText("Ativar vibração"))
    expect(onVibrateChange).toHaveBeenCalledWith(false)
  })

  it("does not throw if onSoundChange / onVibrateChange are not provided", () => {
    render(<PreferenceToggles />)
    fireEvent.click(screen.getByLabelText("Ativar sons do painel"))
    fireEvent.click(screen.getByLabelText("Ativar vibração"))
    // Should not throw — just no callback called
  })
})

// ---------------------------------------------------------------------------
// Props change after mount (e.g., async auth store hydration)
// ---------------------------------------------------------------------------

describe("PreferenceToggles — props change after mount", () => {
  it("updates soundEnabled when prop changes after initial render", () => {
    const { rerender } = render(<PreferenceToggles soundEnabled={true} />)
    const switches = screen.getAllByRole("switch")
    expect(switches[0].getAttribute("aria-checked")).toBe("true")

    // Simulate async store hydration updating the prop
    rerender(<PreferenceToggles soundEnabled={false} />)

    expect(switches[0].getAttribute("aria-checked")).toBe("false")
  })

  it("updates vibrateEnabled when prop changes after initial render", () => {
    const { rerender } = render(<PreferenceToggles vibrateEnabled={true} />)
    const switches = screen.getAllByRole("switch")
    expect(switches[1].getAttribute("aria-checked")).toBe("true")

    rerender(<PreferenceToggles vibrateEnabled={false} />)

    expect(switches[1].getAttribute("aria-checked")).toBe("false")
  })

  it("updates both when both props change simultaneously", () => {
    const { rerender } = render(
      <PreferenceToggles soundEnabled={true} vibrateEnabled={true} />,
    )
    const switches = screen.getAllByRole("switch")
    expect(switches[0].getAttribute("aria-checked")).toBe("true")
    expect(switches[1].getAttribute("aria-checked")).toBe("true")

    rerender(
      <PreferenceToggles soundEnabled={false} vibrateEnabled={false} />,
    )

    expect(switches[0].getAttribute("aria-checked")).toBe("false")
    expect(switches[1].getAttribute("aria-checked")).toBe("false")
  })

  it("does NOT reset user toggle when parent re-renders with SAME prop value", () => {
    const { rerender } = render(<PreferenceToggles soundEnabled={true} />)

    // User toggles off
    fireEvent.click(screen.getByLabelText("Ativar sons do painel"))
    const switches = screen.getAllByRole("switch")
    expect(switches[0].getAttribute("aria-checked")).toBe("false")

    // Parent re-renders with same prop value (no external change)
    rerender(<PreferenceToggles soundEnabled={true} />)

    // User's toggle should be preserved
    expect(switches[0].getAttribute("aria-checked")).toBe("false")
  })

  it("does NOT reset user toggle when parent re-renders with different unrelated prop", () => {
    const { rerender } = render(
      <PreferenceToggles soundEnabled={true} vibrateEnabled={true} />,
    )

    // User toggles sound off
    fireEvent.click(screen.getByLabelText("Ativar sons do painel"))
    const switches = screen.getAllByRole("switch")
    expect(switches[0].getAttribute("aria-checked")).toBe("false")

    // Parent re-renders with only vibrate changing
    rerender(
      <PreferenceToggles soundEnabled={true} vibrateEnabled={false} />,
    )

    // Sound toggle should be preserved (user interacted with it)
    expect(switches[0].getAttribute("aria-checked")).toBe("false")
    // Vibration toggle should update (prop changed, user didn't interact)
    expect(switches[1].getAttribute("aria-checked")).toBe("false")
  })
})
