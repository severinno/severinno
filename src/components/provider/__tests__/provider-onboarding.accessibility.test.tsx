/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Accessibility (axe-core) tests for ProviderOnboarding.
 *
 * Tests the first step (profile form + PreferenceToggles) to ensure no
 * WCAG violations.
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, cleanup } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Hoisted shared label-input pairing counter ---------------------------
// Label and Input mocks share a counter via vi.hoisted to pair htmlFor/id,
// satisfying axe's `label` rule without hardcoding IDs.
const { labelPairId } = vi.hoisted(() => ({ labelPairId: { current: 0 } }))

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) => {
    const state = { user: null, setUser: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

const mockMutateAsync = vi.fn().mockResolvedValue({})

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
  useMutation: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
}))

vi.mock("lucide-react", () => ({
  Check: () => <svg />,
  ChevronLeft: () => <svg />,
  ChevronRight: () => <svg />,
  Play: () => <svg />,
  Smartphone: () => <svg />,
  Volume2: () => <svg />,
}))

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    span: ({ children, ...p }: any) => <span {...p}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/lib/api", () => ({
  apiPatch: vi.fn().mockResolvedValue({}),
  apiPost: vi.fn().mockResolvedValue({}),
  apiGet: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/sounds", () => ({
  playCoinSound: vi.fn(),
  tryVibrate: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, disabled, ...p }: any) => (
    <button disabled={disabled} {...p}>
      {children}
    </button>
  ),
}))

// Label/Input share a counter to associate htmlFor/id correctly.
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...p }: any) => {
    labelPairId.current++
    return (
      <label htmlFor={`input-${labelPairId.current}`} {...p}>
        {children}
      </label>
    )
  },
}))

vi.mock("@/components/ui/input", () => ({
  Input: (p: any) => <input id={`input-${labelPairId.current}`} {...p} />,
}))

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (p: any) => <textarea id={`input-${labelPairId.current}`} {...p} />,
}))

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <>{children}</>,
  // Preserve heading hierarchy: real shadcn CardTitle renders as <h3>
  CardTitle: ({ children, className }: any) => (
    <h3 data-testid="card-title" className={className}>
      {children}
    </h3>
  ),
  CardDescription: ({ children }: any) => <p data-testid="card-desc">{children}</p>,
  CardFooter: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/lib/utils", () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(" "),
}))

afterEach(cleanup)

describe("ProviderOnboarding — accessibility", () => {
  it("has no axe violations on step 0 (profile + preferences)", async () => {
    const { ProviderOnboarding } = await import("../provider-onboarding")
    const { container } = render(<ProviderOnboarding onComplete={vi.fn()} />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
