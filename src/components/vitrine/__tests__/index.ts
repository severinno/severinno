/**
 * Vitrine test helpers barrel — import shared utilities via a single path.
 *
 * Usage:
 *   import { MOCK_RESULTS, flushDebounce, resetCommonMocks } from "@/vitrine/__tests__"
 *
 * For the comprehensive lucide-react mock (88 icons, axe-core tests), import
 * the setup file directly:
 *   import "@/vitrine/__tests__/vitrine-a11y-setup"
 *
 * vitrine-a11y-setup is a side-effect module (registers vi.mock("lucide-react"))
 * with no named exports, so it cannot be re-exported from the barrel — it must
 * be imported directly as shown above.
 */

export {
  MOCK_RESULTS,
  flushDebounce,
  resetCommonMocks,
  mockGeoStore,
  mockFetchGeoSearch,
  mockFetchReverseGeo,
  getMockToast,
} from "./test-utils"

// Re-export types
export type { GeoSearchResult } from "@/lib/api"
