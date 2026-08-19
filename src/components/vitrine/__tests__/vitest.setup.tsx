/**
 * Shared vitest mocks for AddressAutocomplete tests.
 *
 * Each test file that needs these mocks must import this file BEFORE
 * importing the AddressAutocomplete component:
 *
 *   import "./vitest.setup"
 *   import AddressAutocomplete from "../address-autocomplete"
 *
 * vitest processes and hoists vi.mock() calls in this file, registering
 * the mocks before any other imports in the test file are resolved.
 */
import { vi } from "vitest"

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------

export const mockGeoStore: Record<string, unknown> = {
  setFromCoords: vi.fn(),
  setFromGPS: vi.fn().mockResolvedValue(undefined),
  setFromCEP: vi.fn(),
  city: null as string | null,
  lat: null as number | null,
  lng: null as number | null,
}

vi.mock("@/store/geo", () => ({
  // selector é OPCIONAL — semântica real do Zustand: useGeoStore() sem
  // argumento devolve o estado INTEIRO (vários componentes do repo — ex.:
  // geo-awareness-badge, provider-profile-modal, topbar, hero, vitrine —
  // chamam sem selector). O mock antigo exigia selector e lançava
  // 'selector is not a function' em toda suíte jsdom que renderizasse
  // esses componentes (pré-existente, descoberto na varredura da Fase 4).
  useGeoStore: Object.assign(
    (selector?: (s: typeof mockGeoStore) => unknown) =>
      selector ? selector(mockGeoStore) : mockGeoStore,
    {
      getState: () => mockGeoStore,
      setState: (partial: Record<string, unknown>) => Object.assign(mockGeoStore, partial),
    },
  ),
}))

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

export const mockFetchGeoSearch = vi.fn()
export const mockFetchGeoSearchStructured = vi.fn()
export const mockFetchReverseGeo = vi.fn()
export const mockFetchCep = vi.fn()

vi.mock("@/lib/api", () => ({
  fetchGeoSearch: (...args: any[]) => mockFetchGeoSearch(...args),
  fetchGeoSearchStructured: (...args: any[]) => mockFetchGeoSearchStructured(...args),
  fetchReverseGeo: (...args: any[]) => mockFetchReverseGeo(...args),
  fetchCep: (...args: any[]) => mockFetchCep(...args),
}))

// ---------------------------------------------------------------------------
// Mock sonner toast — vi.hoisted avoids TDZ with vi.mock hoisting
// ---------------------------------------------------------------------------

const _mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: _mockToast,
}))

export function getMockToast() {
  return _mockToast
}

// ---------------------------------------------------------------------------
// Mock framer-motion
// ---------------------------------------------------------------------------

vi.mock("framer-motion", () => ({
  motion: {
    span: (p: any) => {
      const {
        size: _size,
        color: _color,
        stroke: _stroke,
        strokeWidth: _strokeWidth,
        fill: _fill,
        absoluteStrokeWidth: _absoluteStrokeWidth,
        ...safe
      } = p
      return <span {...safe} />
    },
    div: (p: any) => <div {...p} />,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

// ---------------------------------------------------------------------------
// Mock UI components
// ---------------------------------------------------------------------------

vi.mock("@/components/ui/input", () => ({
  Input: (p: any) => <input {...p} />,
}))

vi.mock("@/lib/utils", () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(" "),
}))

// ---------------------------------------------------------------------------
// Mock lucide icons
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => {
  const Icon = () => <span data-testid="icon" />
  Icon.displayName = "Icon"
  return {
    MapPin: () => <span data-testid="icon-mappin" />,
    Mailbox: () => <span data-testid="icon-mailbox" />,
    LocateFixed: () => <span data-testid="icon-locate" />,
    Loader2: () => <span data-testid="icon-loading" />,
    Navigation: () => <span data-testid="icon-navigation" />,
    Search: () => <span data-testid="icon-search" />,
    SearchX: () => <span data-testid="icon-searchx" />,
    X: () => <span data-testid="icon-x" />,
    HelpCircle: () => <span data-testid="icon-helpcircle" />,
    Briefcase: () => <span data-testid="icon-briefcase" />,
    Users: () => <span data-testid="icon-users" />,
    MessageCircle: () => <span data-testid="icon-messagecircle" />,
    Github: () => <span data-testid="icon-github" />,
    Twitter: () => <span data-testid="icon-twitter" />,
    Instagram: () => <span data-testid="icon-instagram" />,
    Linkedin: () => <span data-testid="icon-linkedin" />,
    Mail: () => <span data-testid="icon-mail" />,
    Heart: () => <span data-testid="icon-heart" />,
    ArrowUp: () => <span data-testid="icon-arrowup" />,
    Send: () => <span data-testid="icon-send" />,
    CheckCircle2: () => <span data-testid="icon-checkcircle2" />,
    XIcon: () => <span data-testid="icon-x" />,
    CheckIcon: () => <span data-testid="icon-check" />,
    ChevronDownIcon: () => <span data-testid="icon-chevron-down" />,
    ChevronUpIcon: () => <span data-testid="icon-chevron-up" />,
    CircleIcon: () => <span data-testid="icon-circle" />,
  }
})

// ---------------------------------------------------------------------------
// Setup helper — call from each test file's beforeEach
// ---------------------------------------------------------------------------

import { clearCepCache } from "@/lib/client-cep-cache"

// ── Mock client-geo-cache ─────────────────────────────────────────────────
// The address-autocomplete component now uses localStorage geo cache.
// By default, return null (cache miss) so component tests exercise the API
// path. The mock ALSO isolates tests from each other: with the real module,
// values written by one test would leak through jsdom localStorage into the
// next test in the same file.
// The real module's own test file opts out via vi.doUnmock (see
// src/lib/__tests__/client-geo-cache.test.ts).

const mockGetCachedGeo = vi.fn().mockReturnValue(null)
const mockSetCachedGeo = vi.fn()
const mockSubscribeGeoUpdates = vi.fn().mockReturnValue(() => {})

vi.mock("@/lib/client-geo-cache", () => ({
  getCachedGeo: (...args: any[]) => mockGetCachedGeo(...args),
  setCachedGeo: (...args: any[]) => mockSetCachedGeo(...args),
  subscribeGeoUpdates: (...args: any[]) => mockSubscribeGeoUpdates(...args),
}))

export function resetCommonMocks(): void {
  vi.clearAllMocks()
  mockGeoStore.city = null
  mockGeoStore.lat = null
  mockGeoStore.lng = null
  mockGeoStore.address = null
  mockGeoStore.setFromCoords = vi.fn()
  mockGeoStore.setFromGPS = vi.fn().mockResolvedValue(undefined)
  mockGeoStore.setFromCEP = vi.fn()
  mockFetchGeoSearch.mockReset()
  mockFetchGeoSearchStructured.mockReset()
  mockFetchReverseGeo.mockReset()
  mockFetchCep.mockReset()
  _mockToast.success.mockReset()
  mockGetCachedGeo.mockReset()
  mockGetCachedGeo.mockReturnValue(null)
  mockSetCachedGeo.mockReset()
  mockSubscribeGeoUpdates.mockReset()
  mockSubscribeGeoUpdates.mockReturnValue(() => {})
  // Clear client-side CEP cache (localStorage) to avoid test pollution
  clearCepCache()
}

/** Cleanup snippet to restore real timers after a describe block using fake timers. */
export const useRealTimersAfterAll = {
  afterAll: () => {
    vi.useRealTimers()
  },
}
