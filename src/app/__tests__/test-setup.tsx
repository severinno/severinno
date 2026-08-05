/**
 * Shared vitest mocks for app-level page tests.
 *
 * Each test file that needs these mocks must import this file BEFORE
 * importing the component:
 *
 *   import "./test-setup"
 *   import { LoginPageClient } from "../login/login-page-client"
 *
 * vitest processes and hoists vi.mock() calls in this file, registering
 * the mocks before any other imports in the test file are resolved.
 */

import { vi } from "vitest"

// ── Mock next/navigation ─────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/",
}))

// ── Mock TanStack Query ──────────────────────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  })),
  useMutation: vi.fn((opts?: { onSuccess?: Function }) => ({
    mutate: vi.fn((data: unknown) => {
      opts?.onSuccess?.({ user: { id: "1", name: "Test User", role: "CLIENT" } })
    }),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  })),
  keepPreviousData: undefined,
  QueryClient: vi.fn(),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// ── Mock stores ──────────────────────────────────────────────────────────

vi.mock("@/store/auth", () => ({
  useAuthStore: Object.assign(
    (selector?: Function) => {
      const store = {
        user: null,
        status: "unauthenticated",
        initialized: true,
        setUser: vi.fn(),
        fetchMe: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn(),
      }
      return selector ? selector(store) : store
    },
    { getState: () => ({ user: null, status: "unauthenticated" }) },
  ),
}))

vi.mock("@/store/ui", () => ({
  useUIStore: Object.assign(
    (selector?: Function) => {
      const store = {
        openAuth: vi.fn(),
        openQuote: vi.fn(),
        openBooking: vi.fn(),
        openProvider: vi.fn(),
        setCompareIds: vi.fn(),
      }
      return selector ? selector(store) : store
    },
    { getState: () => ({}) },
  ),
}))

vi.mock("@/store/geo", () => ({
  useGeoStore: Object.assign(
    (selector?: Function) => {
      const store = {
        lat: null,
        lng: null,
        city: null,
        setFromCoords: vi.fn(),
        setFromGPS: vi.fn().mockResolvedValue(undefined),
      }
      return selector ? selector(store) : store
    },
    { getState: () => ({ lat: null, lng: null }) },
  ),
}))

// ── Mock API ─────────────────────────────────────────────────────────────

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({}),
  apiPost: vi.fn().mockResolvedValue({}),
  fetchCategories: vi.fn().mockResolvedValue([]),
  fetchProviders: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  fetchFavorites: vi.fn().mockResolvedValue([]),
  toggleFavorite: vi.fn().mockResolvedValue({ favorited: true }),
}))

// ── Mock sonner ──────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

// ── Mock framer-motion ───────────────────────────────────────────────────

vi.mock("framer-motion", () => {
  const MotionDiv = ({ children, ...props }: any) => {
    const { initial, animate, exit, transition, whileHover, whileTap, variants, layout, layoutId, ...safe } = props
    return <div {...safe}>{children}</div>
  }
  return {
    motion: {
      div: MotionDiv,
      span: ({ children, ...props }: any) => {
        const { initial, animate, exit, ...safe } = props
        return <span {...safe}>{children}</span>
      },
      section: ({ children, ...props }: any) => {
        const { initial, animate, exit, ...safe } = props
        return <section {...safe}>{children}</section>
      },
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  }
})

// ── Mock lucide-react ────────────────────────────────────────────────────

vi.mock("lucide-react", () => {
  const Icon = ({ children, ...props }: any) => {
    const { size, className, ...safe } = props
    return <span data-testid="icon" className={className} {...safe}>{children}</span>
  }
  return new Proxy({}, {
    get: () => Icon,
  })
})

// ── Mock UI components ───────────────────────────────────────────────────

vi.mock("@/components/ui/input", () => ({
  Input: (p: any) => <input {...p} />,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
}))

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...p }: any) => <label {...p}>{children}</label>,
}))

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...p }: any) => <div data-testid="card" {...p}>{children}</div>,
  CardHeader: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  CardTitle: ({ children, ...p }: any) => <h2 {...p}>{children}</h2>,
  CardDescription: ({ children, ...p }: any) => <p {...p}>{children}</p>,
  CardContent: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  CardFooter: ({ children, ...p }: any) => <div {...p}>{children}</div>,
}))

vi.mock("@/lib/utils", () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(" "),
}))

vi.mock("react-dom", () => ({
  ...vi.importActual("react-dom"),
  useFormStatus: vi.fn(() => ({ pending: false })),
}))

vi.mock("next/link", () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))
