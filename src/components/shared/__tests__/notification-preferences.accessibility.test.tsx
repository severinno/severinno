// @ts-nocheck
/**
 * Accessibility (axe-core) tests for NotificationPreferences.
 *
 * Tests the notification preference center table UI to ensure all
 * switches have accessible labels, proper ARIA attributes, and
 * semantic table structure.
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, cleanup } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn().mockReturnValue({
    data: { preferences: [] },
    isLoading: false,
  }),
  useMutation: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  }),
  useQueryClient: vi.fn().mockReturnValue({
    invalidateQueries: vi.fn(),
  }),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ preferences: [] }),
  apiPatch: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    "aria-label": ariaLabel,
    disabled,
    className,
  }: {
    checked?: boolean
    onCheckedChange?: (v: boolean) => void
    "aria-label"?: string
    disabled?: boolean
    className?: string
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked ?? false}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}))

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  CardDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
}))

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => <div className={className} aria-hidden />,
}))

vi.mock("lucide-react", () => ({
  Bell: () => <span>🔔</span>,
  Mail: () => <span>📧</span>,
  Smartphone: () => <span>📱</span>,
  MessageSquare: () => <span>💬</span>,
  Volume2: () => <span>🔊</span>,
  Loader2: () => <span>⏳</span>,
  BellOff: () => <span>🔕</span>,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}))

vi.stubGlobal(
  "matchMedia",
  vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
)

import { useQuery } from "@tanstack/react-query"

// ---- SUT ───────────────────────────────────────────────────────────────────

import { NotificationPreferences } from "../notification-preferences"

afterEach(cleanup)

describe("NotificationPreferences — accessibility", () => {
  it("has no axe violations in loading state", async () => {
    ;(vi.mocked(useQuery) as any).mockReturnValueOnce({
      data: undefined,
      isLoading: true,
    })
    const { container } = render(<NotificationPreferences />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations with empty preferences", async () => {
    const { container } = render(<NotificationPreferences />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations with preferences loaded", async () => {
    ;(vi.mocked(useQuery) as any).mockReturnValueOnce({
      data: {
        preferences: [
          {
            type: "BOOKING_CONFIRMED",
            pushEnabled: true,
            emailEnabled: true,
            whatsappEnabled: false,
            soundEnabled: true,
          },
          {
            type: "MESSAGE",
            pushEnabled: true,
            emailEnabled: false,
            whatsappEnabled: true,
            soundEnabled: false,
          },
        ],
      },
      isLoading: false,
    })
    const { container } = render(<NotificationPreferences />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("renders table switches with aria-labels", () => {
    const { getAllByRole } = render(<NotificationPreferences />)
    const switches = getAllByRole("switch")
    expect(switches.length).toBeGreaterThan(0)
    switches.forEach((s) => {
      expect(s).toHaveAttribute("aria-label")
    })
  })
})
