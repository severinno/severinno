/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Accessibility (axe-core) tests for PreferenceToggles.
 *
 * Tests both "card" and "compact" variants to ensure no WCAG violations
 * (form labels, button names, color contrast, heading hierarchy, etc.).
 *
 * ── Known limitation in jsdom ────────────────────────────────────────────
 * color-contrast checks always pass as "incomplete" because jsdom's CSSOM
 * cannot resolve Tailwind CSS variable references (hsl(var(--primary)), etc.).
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, cleanup } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Minimal mocks (only what PreferenceToggles needs to render without crashing)
vi.mock("lucide-react", () => ({
  Play: () => <svg />,
  Smartphone: () => <svg />,
  Volume2: () => <svg />,
}))

vi.mock("@/lib/api", () => ({
  apiPatch: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: vi.fn(),
  tryVibrate: vi.fn(),
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
    />
  ),
}))

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children?: React.ReactNode }) => (
    <div role="region" aria-label="Preferências">
      {children}
    </div>
  ),
  CardContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr aria-orientation="horizontal" />,
}))

// ---- SUT import (must be after vi.mock) ------------------------------------
import { PreferenceToggles } from "../preference-toggles"

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Card variant
// ---------------------------------------------------------------------------

describe("PreferenceToggles — accessibility (card variant)", () => {
  it("has no axe violations with default values", async () => {
    const { container } = render(<PreferenceToggles />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations with all toggles off", async () => {
    const { container } = render(<PreferenceToggles soundEnabled={false} vibrateEnabled={false} />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations with mixed values", async () => {
    const { container } = render(<PreferenceToggles soundEnabled={true} vibrateEnabled={false} />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Compact variant
// ---------------------------------------------------------------------------

describe("PreferenceToggles — accessibility (compact variant)", () => {
  it("has no axe violations with default values", async () => {
    const { container } = render(<PreferenceToggles variant="compact" />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations with all toggles off", async () => {
    const { container } = render(
      <PreferenceToggles variant="compact" soundEnabled={false} vibrateEnabled={false} />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
