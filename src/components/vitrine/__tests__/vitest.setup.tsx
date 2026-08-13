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
  city: null as string | null,
  lat: null as number | null,
  lng: null as number | null,
}

vi.mock("@/store/geo", () => ({
  useGeoStore: Object.assign(
    (selector: (s: typeof mockGeoStore) => unknown) => selector(mockGeoStore),
    { getState: () => mockGeoStore },
  ),
}))

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

export const mockFetchGeoSearch = vi.fn()
export const mockFetchReverseGeo = vi.fn()

vi.mock("@/lib/api", () => ({
  fetchGeoSearch: (...args: any[]) => mockFetchGeoSearch(...args),
  fetchReverseGeo: (...args: any[]) => mockFetchReverseGeo(...args),
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

vi.mock("framer-motion", () => ({    motion: {
    span: (p: any) => {
      const { size, color, stroke, strokeWidth, fill, absoluteStrokeWidth, ...safe } = p
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
    LocateFixed: () => <span data-testid="icon-locate" />,
    Loader2: () => <span data-testid="icon-loading" />,
    Maximize2: () => <span data-testid="icon-maximize" />,
    X: () => <span data-testid="icon-x" />,
  }
})

// ---------------------------------------------------------------------------
// Setup helper — call from each test file's beforeEach
// ---------------------------------------------------------------------------

export function resetCommonMocks(): void {
  vi.clearAllMocks()
  mockGeoStore.city = null
  mockGeoStore.lat = null
  mockGeoStore.lng = null
  mockGeoStore.address = null
  mockGeoStore.setFromCoords = vi.fn()
  mockGeoStore.setFromGPS = vi.fn().mockResolvedValue(undefined)
  mockFetchGeoSearch.mockReset()
  mockFetchReverseGeo.mockReset()
  _mockToast.success.mockReset()
}
