import * as React from "react"
import { vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// ---------------------------------------------------------------------------
// Mock stores — replaces zustand stores with simple hooks
// ---------------------------------------------------------------------------

type MockAuthState = {
  user: { id: string; name: string; email: string; role: string; avatarUrl: string | null } | null
  status: string
  error: string | null
  login: ReturnType<typeof vi.fn>
  register: ReturnType<typeof vi.fn>
  fetchMe: ReturnType<typeof vi.fn>
}

type MockUIState = {
  authModal: { open: boolean; mode: "login" | "register"; role: "CLIENT" | "PROVIDER" }
  bookingModal: { open: boolean; providerId: string | null; serviceId: string | null }
  providerModal: { open: boolean; providerId: string | null }
  quoteModal: { open: boolean; providerId: string | null; serviceId: string | null }
  openAuth: ReturnType<typeof vi.fn>
  closeAuth: ReturnType<typeof vi.fn>
  closeBooking: ReturnType<typeof vi.fn>
  closeProvider: ReturnType<typeof vi.fn>
  closeQuote: ReturnType<typeof vi.fn>
  openQuote: ReturnType<typeof vi.fn>
  openBooking: ReturnType<typeof vi.fn>
  openProvider: ReturnType<typeof vi.fn>
}

type MockViewState = {
  navigate: ReturnType<typeof vi.fn>
  view: string
  params: Record<string, unknown>
}

export function createMockAuthStore(overrides?: Partial<MockAuthState>): MockAuthState {
  return {
    user: null,
    status: "idle",
    error: null,
    login: vi.fn(),
    register: vi.fn(),
    fetchMe: vi.fn(),
    ...overrides,
  }
}

export function createMockUIStore(overrides?: Partial<MockUIState>): MockUIState {
  return {
    authModal: { open: false, mode: "login", role: "CLIENT" },
    bookingModal: { open: false, providerId: null, serviceId: null },
    providerModal: { open: false, providerId: null },
    quoteModal: { open: false, providerId: null, serviceId: null },
    openAuth: vi.fn(),
    closeAuth: vi.fn(),
    closeBooking: vi.fn(),
    closeProvider: vi.fn(),
    closeQuote: vi.fn(),
    openQuote: vi.fn(),
    openBooking: vi.fn(),
    openProvider: vi.fn(),
    ...overrides,
  }
}

export function createMockViewStore(overrides?: Partial<MockViewState>): MockViewState {
  return {
    navigate: vi.fn(),
    view: "home",
    params: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// React Query wrapper for tests
// ---------------------------------------------------------------------------

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function TestQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => createTestQueryClient())
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
