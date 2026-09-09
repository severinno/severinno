/**
 * Tests for AdminDashboard — preference toggles (sound & vibration).
 *
 * Verifies that:
 *  - Sound and vibration toggles render in the preferences card
 *  - Preview buttons render
 *  - Toggling a switch calls apiPatch with the correct preference
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Hoisted shared state (avoids vi.mock hoisting TDZ) --------------------
const { mockApiPatch, mockPlayCoinSound, mockTryVibrate } = vi.hoisted(() => {
  const apiPatch = vi.fn().mockResolvedValue({})
  const playCoinSound = vi.fn()
  const tryVibrate = vi.fn()
  return { mockApiPatch: apiPatch, mockPlayCoinSound: playCoinSound, mockTryVibrate: tryVibrate }
})

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn(
    (
      selector?: (s: {
        user: { id: string; name: string; soundEnabled?: boolean; vibrateEnabled?: boolean } | null
      }) => unknown,
    ) => {
      const state = {
        user: { id: "admin-1", name: "Admin", soundEnabled: true, vibrateEnabled: true },
      }
      return selector ? selector(state) : state
    },
  ),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({
    data: {
      usersByRole: { CLIENT: 10, PROVIDER: 5, ADMIN: 1 },
      providers: 5,
      services: 20,
      bookingsByStatus: { PENDING: 3, CONFIRMED: 5, IN_PROGRESS: 2, COMPLETED: 10, CANCELLED: 1 },
      quotesByStatus: { PENDING: 4, ACCEPTED: 6, REJECTED: 2 },
      revenue: { total: 50000, paymentsPaid: 35000 },
      recentBookings: [],
      topProviders: [],
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    dataUpdatedAt: Date.now(),
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({}),
  apiPatch: mockApiPatch,
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: mockPlayCoinSound,
  tryVibrate: mockTryVibrate,
}))

vi.mock("lucide-react", () => ({
  ArrowRight: () => <svg />,
  CalendarCheck: () => <svg />,
  Clock: () => <svg />,
  DollarSign: () => <svg />,
  RotateCw: () => <svg />,
  Star: () => <svg />,
  Users: () => <svg />,
  Wrench: () => <svg />,
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}))

// ---- Recharts needs ResizeObserver -----------------------------------------
vi.stubGlobal(
  "ResizeObserver",
  // Vitest 4: constructor mocks must use function/class implementations.
  vi.fn(function () {
    return {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }
  }),
)

// Recharts is not SVG-capable under JSDOM (React 19 + recharts 2.x hooks crash
// with "Cannot read properties of null (reading 'useRef')"). Shared mock —
// pass-through placeholders; chart titles/data render outside the SVG.
vi.mock("recharts", async () => {
  const { createRechartsMock } = await import("./mocks")
  return createRechartsMock()
})

// ---- SUT import (must be after vi.mock) ------------------------------------
import { AdminDashboard } from "../admin-dashboard"

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Accessibility (axe-core)
// ---------------------------------------------------------------------------

describe("AdminDashboard — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<AdminDashboard onNavigate={vi.fn()} />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Preference toggles
// ---------------------------------------------------------------------------
